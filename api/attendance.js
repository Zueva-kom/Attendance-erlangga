const { Pool } = require('pg');

// Optimasi Pool untuk Serverless Lingkungan (mencegah kebanjiran koneksi di Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,             // Maksimal koneksi per instance serverless
  idleTimeoutMillis: 5000 // Segera putuskan koneksi idle agar bisa dipakai instance lain
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
    // OPTIMASI 1: LOGIKA WAKTU DIBAWA KE ATAS (EARLY EXIT)
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
    // OPTIMASI 2: VERIFIKASI SISWA & KELAS (Hanya berjalan jika jamnya tepat)
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

    // PENGAMAN KELAS (Regex dioptimalkan)
    const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (deviceClean !== kelasClean) {
      return res.status(200).json({ status: "REJECTED", name: namaSiswa, message: "Salah Kelas" });
    }

    // ========================================================
    // 3. PROSES VALIDASI & SIMPAN KE DATABASE
    // ========================================================
    if (hitungDatabase) {
      
      // Ambil tanggal hari ini dalam format YYYY-MM-DD sesuai zona waktu WITA
      const tahun = targetTime.getUTCFullYear();
      const bulan = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
      const tanggal = String(targetTime.getUTCDate()).padStart(2, '0');
      const tanggalHariIni = `${tahun}-${bulan}-${tanggal}`;

      // QUERY CEK: Apakah siswa ini sudah melakukan absen dengan status yang sama HARI INI?
      const queryCekAbsen = `
        SELECT id FROM presensi 
        WHERE uid_tag = $1 
          AND status = $2 
          AND (waktu AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar')::date = $3::date
        LIMIT 1;
      `; [cite: 2]

      const resultCek = await pool.query(queryCekAbsen, [uid, dbStatus, tanggalHariIni]);

      if (resultCek.rows.length > 0) {
        // Jika sudah pernah tap untuk sesi ini (IN atau OUT) hari ini, kunci!
        return res.status(200).json({
          status: "SUDAH_ABSEN", // Status ini akan dibaca oleh NodeMCU 
          name: namaSiswa
        });
      }

      // Jika belum pernah absen sesi ini, baru lakukan INSERT
      const queryInsert = `INSERT INTO presensi (uid_tag, status) VALUES ($1, $2);`;
      await pool.query(queryInsert, [uid, dbStatus]);
      console.log(`[POSTGRES] ${namaSiswa} -> Berhasil Simpan DB (${dbStatus})`);

    } else {
      console.log(`[POSTGRES] ${namaSiswa} -> Diabaikan (Diluar jam absen)`);
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
