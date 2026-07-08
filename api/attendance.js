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
    // 1. LOGIKA WAKTU (EARLY EXIT)
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
    const m_11_00 = 11 * 60;
    const m_14_30 = (14 * 60) + 30;
    const m_18_00 = 18 * 60;

    if (totalMenitSekarang >= m_06_00 && totalMenitSekarang < m_07_15) {
      responStatusNodeMCU = "MASUK";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_07_15 && totalMenitSekarang < m_11_00) {
      responStatusNodeMCU = "TERLAMBAT";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_14_30 && totalMenitSekarang < m_18_00) {
      responStatusNodeMCU = "KELUAR";
      dbStatus = "OUT";
      hitungDatabase = true;
    } 
    else {
      return res.status(200).json({ status: "DILUAR_JAM", name: "Siswa" });
    }

    // ========================================================
    // 2. VERIFIKASI SISWA & KELAS 
    // ========================================================
    const resultSiswa = await pool.query(`
      SELECT s.nama_siswa, k.nama_kelas 
      FROM siswa s
      JOIN kelas k ON s.id_kelas = k.id_kelas
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
    // 3. PROSES VALIDASI GANDA & SIMPAN KE DATABASE
    // ========================================================
    if (hitungDatabase) {
      const tahun = targetTime.getUTCFullYear();
      const bulan = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
      const tanggal = String(targetTime.getUTCDate()).padStart(2, '0');
      const tanggalHariIni = `${tahun}-${bulan}-${tanggal}`;

      // PENTING: Ganti "waktu" di bawah ini dengan nama kolom tabelmu (misal: created_at) jika error!
      const queryCekAbsen = `
        SELECT id FROM presensi 
        WHERE uid_tag = $1 
          AND status = $2 
          AND (waktu AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar')::date = $3::date
        LIMIT 1;
      `;

      const resultCek = await pool.query(queryCekAbsen, [uid, dbStatus, tanggalHariIni]);

      if (resultCek.rows.length > 0) {
        return res.status(200).json({
          status: "SUDAH_ABSEN", 
          name: namaSiswa
        });
      }

      const queryInsert = `INSERT INTO presensi (uid_tag, status) VALUES ($1, $2);`;
      await pool.query(queryInsert, [uid, dbStatus]);
    }

    // ========================================================
    // 4. RESPONS BALIK
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
