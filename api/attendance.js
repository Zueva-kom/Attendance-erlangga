const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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

    // 1. VERIFIKASI SISWA & KELAS (Supabase)
    const querySiswa = `
      SELECT s.nama_siswa, k.nama_kelas 
      FROM siswa s
      JOIN kelas k ON s.id_kelas = k.id_kelas
      WHERE s.uid_tag = $1;
    `;
    const resultSiswa = await pool.query(querySiswa, [uid]);

    if (resultSiswa.rows.length === 0) {
      return res.status(200).json({ status: "REJECTED", name: "Unknown", message: "Tidak Terdaftar" });
    }

    const siswa = resultSiswa.rows[0];
    const namaSiswa = siswa.nama_siswa;
    const kelasSiswa = siswa.nama_kelas; 

    // PENGAMAN KELAS
    const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (deviceClean !== kelasClean) {
      return res.status(200).json({ status: "REJECTED", name: namaSiswa, message: "Salah Kelas" });
    }

    // ========================================================
    // 2. LOGIKA PENENTUAN WAKTU SECARA AMAN (Zona Waktu WITA)
    // ========================================================
    // Menggunakan Intl.DateTimeFormat untuk mengambil angka jam & menit secara murni demi menghindari bug string Vercel
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Makassar',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(new Date());
    let currentHour = 0;
    let currentMinute = 0;

    for (const part of parts) {
      if (part.type === 'hour') currentHour = parseInt(part.value, 10);
      if (part.type === 'minute') currentMinute = parseInt(part.value, 10);
    }

    // Konversi penuh ke menit agar kalkulasi perbandingan jendela waktu akurat
    const totalMenitSekarang = (currentHour * 60) + currentMinute;

    let responStatusNodeMCU = ""; 
    let dbStatus = "";            
    let hitungDatabase = false;   

    // --- KONFIGURASI BATAS JENDELA WAKTU AMAN ---
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
      responStatusNodeMCU = "DILUAR_JAM";
      hitungDatabase = false; 
    }

    // ========================================================
    // 3. PROSES SIMPAN KE DATABASE
    // ========================================================
    if (hitungDatabase) {
      const queryInsert = `
        INSERT INTO presensi (uid_tag, status, dibuat_at) 
        VALUES ($1, $2, NOW() AT TIME ZONE 'Asia/Makassar');
      `;
      await pool.query(queryInsert, [uid, dbStatus]);
      console.log(`[POSTGRES] ${namaSiswa} -> Berhasil Simpan DB (${dbStatus}) pada ${currentHour}:${currentMinute} WITA`);
    } else {
      console.log(`[POSTGRES] ${namaSiswa} -> Diabaikan (Diluar jam absen) pada ${currentHour}:${currentMinute} WITA`);
    }

    // ========================================================
    // 4. RESPONS BALIK KE NODEMCU
    // ========================================================
    return res.status(200).json({
      status: responStatusNodeMCU, 
      name: namaSiswa
    });

  } catch (error) {
    console.error("[ERROR] Sistem backend gagal:", error);
    return res.status(500).send("SERVER_ERROR");
  }
};
