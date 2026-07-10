const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,             
  idleTimeoutMillis: 5000 
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { device_id, uid } = req.body; 
    if (!uid) return res.status(400).json({ error: 'Parameter UID tidak ditemukan.' });

    // ========================================================
    // 1. VERIFIKASI SISWA & KELAS 
    // ========================================================
    const resultSiswa = await pool.query(`
      SELECT s.nama_siswa, k.nama_kelas 
      FROM siswas s
      JOIN kelas k ON s.id_kelas = k.id
      WHERE s.uid_tag = $1 LIMIT 1;
    `, [uid]);

    if (resultSiswa.rows.length === 0) {
      return res.status(200).json({ status: "REJECTED", name: "Unknown", message: "Tidak Terdaftar" });
    }

    const { nama_siswa: namaSiswa, nama_kelas: kelasSiswa } = resultSiswa.rows[0];

    // PENGAMAN KELAS
    const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (deviceClean !== kelasClean) {
      return res.status(200).json({ status: "REJECTED", name: namaSiswa, message: "Salah Kelas" });
    }

    // ========================================================
    // 2. LOGIKA WAKTU & VALIDASI JENDELA ABSEN
    // ========================================================
    const targetTime = new Date(new Date().getTime() + (8 * 60 * 60 * 1000)); 
    const currentHour = targetTime.getUTCHours();
    const currentMinute = targetTime.getUTCMinutes();
    const totalMenitSekarang = (currentHour * 60) + currentMinute;

    let responStatusNodeMCU = ""; 
    let dbStatus = "";            
    let hitungDatabase = false;   

    const m_06_00 = 6 * 60;
    const m_07_15 = (7 * 60) + 15;
    const m_14_30 = (14 * 60) + 30; 
    const m_14_31 = (14 * 60) + 31; 
    const m_19_00 = 19 * 60;        

    if (totalMenitSekarang >= m_06_00 && totalMenitSekarang <= m_14_30) {
      responStatusNodeMCU = totalMenitSekarang < m_07_15 ? "MASUK" : "TERLAMBAT";
      dbStatus = "IN"; 
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_14_31 && totalMenitSekarang < m_19_00) {
      responStatusNodeMCU = "KELUAR";
      dbStatus = "OUT"; 
      hitungDatabase = true;
    } 

    if (!hitungDatabase) {
      return res.status(200).json({ status: "DILUAR_JAM", name: namaSiswa });
    }

// ========================================================
    // 3. PROSES CHECK & INSERT KE DATABASE (MAKS 2 KALI SEHARI)
    // ========================================================
    const tahun = targetTime.getUTCFullYear();
    const bulan = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
    const tanggal = String(targetTime.getUTCDate()).padStart(2, '0');
    const tanggalHariIni = `${tahun}-${bulan}-${tanggal}`; 

    // 1. CEK PERTAMA: Apakah siswa sudah pernah tap dengan status yang SAMA hari ini?
    // (Mencegah IN dua kali atau OUT dua kali)
    const queryCekStatusSama = `
      SELECT uid_tag FROM presensis 
      WHERE uid_tag = $1 
        AND status = $2 
        AND created_at::date = $3::date
      LIMIT 1;
    `;
    const resultCekStatus = await pool.query(queryCekStatusSama, [uid, dbStatus, tanggalHariIni]);

    if (resultCekStatus.rows.length > 0) {
      return res.status(200).json({ status: "SUDAH_ABSEN", name: namaSiswa });
    }

    // 2. CEK KEDUA: Hitung total absensi siswa tersebut pada hari ini
    // (Mencegah inputan ketiga, keempat, dst)
    const queryHitungTotalHariIni = `
      SELECT COUNT(*) as total FROM presensis
      WHERE uid_tag = $1
        AND created_at::date = $2::date;
    `;
    const resultHitung = await pool.query(queryHitungTotalHariIni, [uid, tanggalHariIni]);
    const totalAbsenHariIni = parseInt(resultHitung.rows[0].total);

    // Jika total baris data hari ini sudah mencapai 2 atau lebih, langsung tolak
    if (totalAbsenHariIni >= 2) {
      return res.status(200).json({ status: "SUDAH_ABSEN", name: namaSiswa });
    }

    // Ambil id_kelas untuk insert data baru
    const resKelasSiswa = await pool.query(`SELECT id_kelas FROM siswas WHERE uid_tag = $1 LIMIT 1;`, [uid]);
    const idKelasSiswa = resKelasSiswa.rows[0].id_kelas;

    const jamLokal = String(targetTime.getUTCHours()).padStart(2, '0');
    const menitLokal = String(targetTime.getUTCMinutes()).padStart(2, '0');
    const waktuString = `${jamLokal}:${menitLokal}`; 

    try {
      const queryInsert = `
        INSERT INTO presensis (uid_tag, id_kelas, status, waktu) 
        VALUES ($1, $2, $3, $4);
      `;
      await pool.query(queryInsert, [uid, idKelasSiswa, dbStatus, waktuString]);
    } catch (dbError) {
      // Jika lolos dari cek kueri di atas karena request masuk berbarengan,
      // Unique Index database akan menangkapnya dan melempar error code 23505
      if (dbError.code === '23505') {
        return res.status(200).json({ status: "SUDAH_ABSEN", name: namaSiswa });
      }
      throw dbError; 
    }

    return res.status(200).json({ status: responStatusNodeMCU, name: namaSiswa });
