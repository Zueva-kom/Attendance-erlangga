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
    // 2. LOGIKA PENENTUAN WAKTU AKURAT (Zona Waktu WITA)
    // ========================================================
    const options = { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false };
    const timeString = new Date().toLocaleTimeString('id-ID', options); // Format "HH:MM" (Misal "07:25")
    
    const parts = timeString.split(/[.:]/);
    const currentHour = parseInt(parts[0], 10);
    const currentMinute = parseInt(parts[1], 10);
    
    // Mengubah jam & menit saat ini menjadi total menit dalam sehari agar mudah dibandingkan
    // Contoh: Jam 07:15 = (7 * 60) + 15 = 435 menit
    const totalMenitSekarang = (currentHour * 60) + currentMinute;

    let responStatusNodeMCU = ""; // Status teks yang dikirim ke LCD NodeMCU [cite: 30]
    let dbStatus = "";            // Nilai ENUM yang dimasukkan ke Supabase ('IN' atau 'OUT')
    let hitungDatabase = false;   // Flag apakah data perlu dimasukkan ke DB atau tidak

    // --- PENGATURAN JENDELA WAKTU ABSENSI ---
    const m_06_00 = 6 * 60;
    const m_07_15 = (7 * 60) + 15;
    const m_11_00 = 11 * 60;
    const m_14_30 = (14 * 60) + 30;
    const m_18_00 = 18 * 60;

    if (totalMenitSekarang >= m_06_00 && totalMenitSekarang < m_07_15) {
      // Sesi 1: Absen Masuk Tepat Waktu
      responStatusNodeMCU = "MASUK";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_07_15 && totalMenitSekarang < m_11_00) {
      // Sesi 2: Absen Masuk Terlambat
      responStatusNodeMCU = "TERLAMBAT";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_14_30 && totalMenitSekarang < m_18_00) {
      // Sesi 3: Absen Pulang
      responStatusNodeMCU = "KELUAR";
      dbStatus = "OUT";
      hitungDatabase = true;
    } 
    else {
      // Sesi 4: Di luar jam operasional (Siang bolong atau tengah malam)
      responStatusNodeMCU = "DILUAR_JAM";
      hitungDatabase = false; // Kunci agar tidak memenuhi baris database kosong
    }

    // ========================================================
    // 3. PROSES SIMPAN KE DATABASE (Jika masuk dalam jendela absen)
    // ========================================================
    if (hitungDatabase) {
      const queryInsert = `
        INSERT INTO presensi (uid_tag, status, dibuat_at) 
        VALUES ($1, $2, NOW() AT TIME ZONE 'Asia/Makassar');
      `;
      await pool.query(queryInsert, [uid, dbStatus]);
      console.log(`[POSTGRES] Terbaca: ${namaSiswa} -> Simpan Status DB: ${dbStatus}`);
    } else {
      console.log(`[POSTGRES] Terbaca: ${namaSiswa} -> Diabaikan (Diluar Jam Operasional)`);
    }

    // ========================================================
    // 4. RESPONS BALIK KE NODE MCU (Menyesuaikan if-else di .ino kamu)
    // ========================================================
    return res.status(200).json({
      status: responStatusNodeMCU, // Mengirim "MASUK", "TERLAMBAT", "KELUAR", atau "DILUAR_JAM" [cite: 30]
      name: namaSiswa
    });

  } catch (error) {
    console.error("[ERROR] Sistem backend gagal:", error);
    return res.status(500).send("SERVER_ERROR");
  }
};
