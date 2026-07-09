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
    // 3. PROSES SIMPAN KE DATABASE (Kolom dikembalikan asli agar tidak crash)
    // ========================================================
    if (hitungDatabase) {
      const queryInsert = `
        INSERT INTO presensi (uid_tag, status) 
        VALUES ($1, $2);
      `;
      await pool.query(queryInsert, [uid, dbStatus]);
      console.log(`[POSTGRES] ${namaSiswa} -> Berhasil Simpan DB (${dbStatus})`);
    } else {
      console.log(`[POSTGRES] ${namaSiswa} -> Diabaikan (Diluar jam absen)`);
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
