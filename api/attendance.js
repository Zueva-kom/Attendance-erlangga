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

    // PENGAMAN KELAS (Mencocokkan DEVICE_ID dengan nama_kelas)
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
    const m_14_30 = (14 * 60) + 30; // Batas TERLAMBAT selesai, sekaligus KELUAR dimulai
    const m_18_00 = 18 * 60;

    if (totalMenitSekarang >= m_06_00 && totalMenitSekarang < m_07_15) {
      responStatusNodeMCU = "MASUK";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    // Mengubah batas akhir TERLAMBAT langsung ke 14:30
    else if (totalMenitSekarang >= m_07_15 && totalMenitSekarang < m_14_30) {
      responStatusNodeMCU = "TERLAMBAT";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_14_30 && totalMenitSekarang < m_18_00) {
      responStatusNodeMCU = "KELUAR";
      dbStatus = "OUT";
      hitungDatabase = true;
    } 

    // Jika di luar jam operasional sekolah (di bawah jam 6 pagi atau di atas jam 6 sore)
    if (!hitungDatabase) {
      return res.status(200).json({ status: "DILUAR_JAM", name: namaSiswa });
    }

    // ========================================================
    // 3. PROSES VALIDASI GANDA (BATAS 1x IN DAN 1x OUT)
    // ========================================================
    const tahun = targetTime.getUTCFullYear();
    const bulan = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
    const tanggal = String(targetTime.getUTCDate()).padStart(2, '0');
    const tanggalHariIni = `${tahun}-${bulan}-${tanggal}`;

    // KUNCI PENGAMAN: Mencari apakah dbStatus (IN atau OUT) saat ini sudah pernah tersimpan hari ini
    const queryCekAbsen = `
      SELECT uid_tag FROM presensis 
      WHERE uid_tag = $1 
        AND status = $2 
        AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar')::date = $3::date
      LIMIT 1;
    `;

    const resultCek = await pool.query(queryCekAbsen, [uid, dbStatus, tanggalHariIni]);

    // Jika sudah pernah absen untuk status yang sama hari ini, langsung tolak!
    if (resultCek.rows.length > 0) {
      return res.status(200).json({
        status: "SUDAH_ABSEN", 
        name: namaSiswa
      });
    }

    // Ambil id_kelas untuk keperluan data foreign key
    const resKelasSiswa = await pool.query(`SELECT id_kelas FROM siswas WHERE uid_tag = $1 LIMIT 1;`, [uid]);
    const idKelasSiswa = resKelasSiswa.rows[0].id_kelas;

    const jamLokal = String(targetTime.getUTCHours()).padStart(2, '0');
    const menitLokal = String(targetTime.getUTCMinutes()).padStart(2, '0');
    const waktuString = `${jamLokal}:${menitLokal}`; 

    // Simpan data log presensi 
    const queryInsert = `
      INSERT INTO presensis (uid_tag, id_kelas, status, waktu) 
      VALUES ($1, $2, $3, $4);
    `;
    await pool.query(queryInsert, [uid, idKelasSiswa, dbStatus, waktuString]);

    // ========================================================
    // 4. RESPONS BALIK SUCCESS
    // ========================================================
    return res.status(200).json({
      status: responStatusNodeMCU, 
      name: namaSiswa
    });

  } catch (error) {
    console.error("[ERROR] Sistem backend gagal:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: error.message });
  }
};
