const { Pool } = require('pg');

// Konfigurasi koneksi PostgreSQL ke Supabase via Environment Variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Wajib untuk penyedia cloud seperti Supabase
  }
});

module.exports = async (req, res) => {
  // Mengatur Header CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Gunakan HTTP POST.' });
  }

  try {
    const { device_id, uid } = req.body; 

    if (!uid) {
      return res.status(400).json({ error: 'Bad Request. Parameter UID tidak ditemukan.' });
    }

    // 1. VERIFIKASI SISWA & KELAS (Membaca dari Supabase)
    const querySiswa = `
      SELECT s.nama_siswa, k.nama_kelas 
      FROM siswa s
      JOIN kelas k ON s.id_kelas = k.id_kelas
      WHERE s.uid_tag = $1;
    `;
    const resultSiswa = await pool.query(querySiswa, [uid]);

    // Menghentikan fungsi jika kartu tidak terdaftar di Supabase
    if (resultSiswa.rows.length === 0) {
      return res.status(200).json({
        status: "REJECTED",
        name: "Unknown",
        message: "Tidak Terdaftar"
      });
    }

    const siswa = resultSiswa.rows[0];
    const namaSiswa = siswa.nama_siswa;
    const kelasSiswa = siswa.nama_kelas; 

    // PENGAMAN KELAS
    const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (deviceClean !== kelasClean) {
      return res.status(200).json({
        status: "REJECTED",
        name: namaSiswa,
        message: "Salah Kelas"
      });
    }

    // 2. LOGIKA PENENTUAN WAKTU & STATUS (WITA)
    const options = { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false };
    const timeString = new Date().toLocaleTimeString('id-ID', options); 
    const currentHour = parseInt(timeString.split(/[.:]/)[0], 10);

    let statusAbsen = "MASUK";

    if (currentHour >= 0 && currentHour < 15) {
      statusAbsen = "IN"; 
    } else {
      statusAbsen = "OUT"; 
    }

    // 3. INSERT LOG PRESENSI KE POSTGRESQL (Definisi dbStatus diperbaiki agar tidak crash)
    const dbStatus = (statusAbsen === "IN") ? "IN" : "OUT";
    
    const queryInsert = `
      INSERT INTO presensi (uid_tag, status) 
      VALUES ($1, $2);
    `;
    await pool.query(queryInsert, [uid, dbStatus]);

    console.log(`[POSTGRES LOG] ${namaSiswa} -> Status: ${dbStatus}`);

    // 4. RESPONS BALIK KE ESP8266
    return res.status(200).json({
      status: (dbStatus === "IN") ? "MASUK" : "KELUAR", 
      name: namaSiswa
    });

  } catch (error) {
    console.error("[ERROR] Terjadi kegagalan sistem backend:", error);
    return res.status(500).send("SERVER_ERROR");
  }
};
