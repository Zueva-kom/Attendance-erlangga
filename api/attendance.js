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
// 2. LOGIKA WAKTU & VALIDASI JENDELA ABSEN (FIXED TIMEZONE)
// ========================================================
// Gunakan Intl.DateTimeFormat untuk mendapatkan waktu lokal Asia/Makassar secara akurat
const opsiWaktu = { timeZone: 'Asia/Makassar', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' };
const formatter = new Intl.DateTimeFormat('id-ID', opsiWaktu);
const [{ value: tgl }, , { value: bln }, , { value: thn }, , { value: jam }, , { value: mnt }] = formatter.formatToParts(new Date());

const currentHour = parseInt(jam);
const currentMinute = parseInt(mnt);
const totalMenitSekarang = (currentHour * 60) + currentMinute;
const tanggalHariIni = `${thn}-${bln}-${tgl}`; // Format: YYYY-MM-DD sesuai WITA

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
// 3. PROSES CHECK & INSERT KE DATABASE (ANTI-DUPLIKASI FIXED)
// ========================================================

// 1. CEK PERTAMA: Apakah sudah tap dengan status yang SAMA hari ini?
// Gunakan timezone server murni (atau cast langsung) agar pencocokan tanggal akurat
const queryCekStatusSama = `
  SELECT uid_tag FROM presensis 
  WHERE uid_tag = $1 
    AND status = $2 
    AND (created_at AT TIME ZONE 'Asia/Makassar')::date = $3::date
  LIMIT 1;
`;
const resultCekStatus = await pool.query(queryCekStatusSama, [uid, dbStatus, tanggalHariIni]);

if (resultCekStatus.rows.length > 0) {
  return res.status(200).json({ status: "SUDAH_ABSEN", name: namaSiswa });
}

// 2. CEK KEDUA: Jika ingin membatasi total tap harian max 2 kali (1 IN, 1 OUT)
const queryHitungTotalHariIni = `
  SELECT COUNT(*) as total FROM presensis
  WHERE uid_tag = $1
    AND (created_at AT TIME ZONE 'Asia/Makassar')::date = $2::date;
`;
const resultHitung = await pool.query(queryHitungTotalHariIni, [uid, tanggalHariIni]);
const totalAbsenHariIni = parseInt(resultHitung.rows[0].total);

if (totalAbsenHariIni >= 2) {
  return res.status(200).json({ status: "SUDAH_ABSEN", name: namaSiswa });
}

    // --- BAGIAN 4 (RESPONS SUKSES) ---
    return res.status(200).json({ status: responStatusNodeMCU, name: namaSiswa });

  } catch (error) {
    console.error("[ERROR] Sistem backend gagal:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: error.message });
  }
};
