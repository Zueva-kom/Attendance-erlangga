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
    // 1. LOGIKA WAKTU (MODUL TESTING - BEBAS JAM)
    // ========================================================
    const targetTime = new Date(new Date().getTime() + (8 * 60 * 60 * 1000)); 
    
    // PILIHAN MODE TEST (Ubah string ini sesuai kebutuhan tes Anda):
    // "MASUK"     -> Simulasi jam masuk normal
    // "TERLAMBAT" -> Simulasi siswa terlambat
    const modeTest = "MASUK"; 

    let responStatusNodeMCU = ""; 
    let dbStatus = "";            
    let hitungDatabase = true; // Selalu true agar data masuk ke DB saat testing

    if (modeTest === "MASUK") {
      responStatusNodeMCU = "MASUK";
      dbStatus = "IN";
    } else if (modeTest === "TERLAMBAT") {
      responStatusNodeMCU = "TERLAMBAT";
      dbStatus = "IN";
    } else {
      // Cadangan jika Anda nanti ingin tes "KELUAR"
      responStatusNodeMCU = "KELUAR";
      dbStatus = "OUT";
    }
// ========================================================
// 2. VERIFIKASI SISWA & KELAS 
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

// PENGAMAN KELAS (Mencocokkan DEVICE_ID di .ino dengan nama_kelas di DB)
const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');
if (deviceClean !== kelasClean) {
  return res.status(200).json({ status: "REJECTED", name: namaSiswa, message: "Salah Kelas" });
}

// ========================================================
// 3. PROSES VALIDASI GANDA & SIMPAN KE DATABASE
// ========================================================
if (hitungDatabase) { // Hanya berjalan jika masuk dalam jendela jam IN atau OUT
  const tahun = targetTime.getUTCFullYear();
  const bulan = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
  const tanggal = String(targetTime.getUTCDate()).padStart(2, '0');
  const tanggalHariIni = `${tahun}-${bulan}-${tanggal}`;

  // KUNCI PENGAMAN: Cek apakah status (IN/OUT) yang aktif saat ini sudah pernah tersimpan hari ini
  const queryCekAbsen = `
    SELECT uid_tag FROM presensis 
    WHERE uid_tag = $1 
      AND status = $2 
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar')::date = $3::date
    LIMIT 1;
  `;

  const resultCek = await pool.query(queryCekAbsen, [uid, dbStatus, tanggalHariIni]);

  // Jika di hari yang sama sudah pernah absen IN (atau OUT), maka tolak tap berikutnya
  if (resultCek.rows.length > 0) {
    return res.status(200).json({
      status: "SUDAH_ABSEN", 
      name: namaSiswa
    });
  }

  // Ambil id_kelas untuk kebutuhan relasi foreign key tabel presensis
  const resKelasSiswa = await pool.query(`SELECT id_kelas FROM siswas WHERE uid_tag = $1 LIMIT 1;`, [uid]);
  const idKelasSiswa = resKelasSiswa.rows[0].id_kelas;

  // Membuat format string jam lokal untuk mengisi kolom 'waktu' (varchar)
  const jamLokal = String(targetTime.getUTCHours()).padStart(2, '0');
  const menitLokal = String(targetTime.getUTCMinutes()).padStart(2, '0');
  const waktuString = `${jamLokal}:${menitLokal}`; 

  // Simpan data log presensi (Akan menghasilkan maksimal 2 row per siswa dalam 1 hari)
  const queryInsert = `
    INSERT INTO presensis (uid_tag, id_kelas, status, waktu) 
    VALUES ($1, $2, $3, $4);
  `;
  await pool.query(queryInsert, [uid, idKelasSiswa, dbStatus, waktuString]);
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
