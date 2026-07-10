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
      SELECT s.nama_siswa, k.nama_kelas, s.id_kelas
      FROM siswas s
      JOIN kelas k ON s.id_kelas = k.id
      WHERE s.uid_tag = $1 LIMIT 1;
    `, [uid]);

    if (resultSiswa.rows.length === 0) {
      return res.status(200).json({ status: "REJECTED", name: "Unknown", message: "Tidak Terdaftar" });
    }

    const { nama_siswa: namaSiswa, nama_kelas: kelasSiswa, id_kelas: idKelasSiswa } = resultSiswa.rows[0];

    // PENGAMAN KELAS
    const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (deviceClean !== kelasClean) {
      return res.status(200).json({ status: "REJECTED", name: namaSiswa, message: "Salah Kelas" });
    }

    // ========================================================
    // 2. LOGIKA WAKTU JENDELA ABSEN
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

    const jamLokal = String(currentHour).padStart(2, '0');
    const menitLokal = String(currentMinute).padStart(2, '0');
    const waktuString = `${jamLokal}:${menitLokal}`; 

    // ========================================================
    // 3. PROSES INSERT DATA (DILINDUNGI UNIQUE CONSTRAINT)
    // ========================================================
    try {
      const queryInsert = `
        INSERT INTO presensis (uid_tag, id_kelas, status, waktu) 
        VALUES ($1, $2, $3, $4);
      `;
      await pool.query(queryInsert, [uid, idKelasSiswa, dbStatus, waktuString]);
      
      // Jika berhasil masuk tanpa crash, kirim respon sukses ke NodeMCU
      return res.status(200).json({ status: responStatusNodeMCU, name: namaSiswa });

    } catch (dbError) {
      // Perangkap Kode Error 23505 (Unique Violation / Duplikat terdeteksi oleh database)
      if (dbError.code === '23505') {
        return res.status(200).json({ status: "SUDAH_ABSEN", name: namaSiswa });
      }
      // Lempar error lain jika ada masalah koneksi database
      throw dbError; 
    }

  } catch (error) {
    console.error("[ERROR] Sistem backend gagal:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: error.message });
  }
};
