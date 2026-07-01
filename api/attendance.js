const fetch = require('node-fetch');
const daftarSiswa = require('../data/siswa.json');

// URL Web App Google Sheets (Ganti sesuai URL Deployment Google Apps Script milikmu)
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbxXdPPeF0W-vavS7xK10WBdsSFzbiwI9C52vEyM9Pn7snSx1wYPJru_FkfZfPkB42LEMQ/exec";

module.exports = async (req, res) => {
  // Mengatur Header CORS agar bisa diakses secara fleksibel jika dikembangkan ke web dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Menangani preflight request CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Proteksi Keamanan: Hanya menerima metode HTTP POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Gunakan HTTP POST.' });
  }

  try {
    const { device_id, uid } = req.body;

    // Validasi input data mendasar dari ESP8266
    if (!uid) {
      return res.status(400).json({ error: 'Bad Request. Parameter UID tidak ditemukan.' });
    }

    // =========================================================================
    // 1. PEMETAAN & VALIDASI DATA SISWA MULTI-KELAS / MASTER GURU
    // =========================================================================
    const user = daftarSiswa[uid];

    // Kondisi A: Jika kartu RFID sama sekali tidak terdaftar di database JSON siswa.json
    if (!user) {
      console.log(`[REJECTED] UID: ${uid} tidak terdaftar di database.`);
      return res.status(404).json({
        status: "REJECTED",
        name: "Unknown",
        message: "Kartu Tak Terdaftar"
      });
    }

    const namaSiswa = user.nama;
    const nomorInduk = user.nis; // Menggunakan NIS siswa sebagai identitas log pengganti UID Hexa
    const roleUser = user.role;
    
    // Normalisasi nama kelas dari alat (Contoh alat mengirim "TKJ_1" diubah menjadi "TKJ 1")
    const namaMesinKelas = device_id ? device_id.replace("_", " ") : "";

    // Kondisi B: Validasi Geofencing Kelas (Jika user adalah siswa, tapi kelasnya tidak sesuai dengan penempatan mesin)
    if (roleUser === "siswa" && user.kelas !== namaMesinKelas) {
      console.log(`[REJECTED] Siswa ${namaSiswa} (${user.kelas}) mencoba tap di mesin kelas ${namaMesinKelas}`);
      return res.status(403).json({
        status: "REJECTED",
        name: namaSiswa,
        message: "Salah Kelas!"
      });
    }

    // =========================================================================
    // 2. LOGIKA PENENTUAN WAKTU & FILO TIME WINDOW LOCKING (Zona Waktu WITA)
    // =========================================================================
    const options = { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false };
    const timeString = new Date().toLocaleTimeString('id-ID', options); 
    
    // Parsing nilai jam secara aman
    const currentHour = parseInt(timeString.split(/[.:]/)[0], 10);

    let statusAbsen = "MASUK"; // Default fallback awal

    if (currentHour >= 6 && currentHour < 15) {
      // JAM 06:00 s/d 14:59 WITA -> Sesi Masuk Kelas (Kunci First In)
      // Di rentang jam ini, status dikunci konstan masuk atau terlambat untuk memotong double-tap
      if (currentHour >= 6 && currentHour < 9) {
        statusAbsen = "MASUK";
      } else {
        statusAbsen = "TERLAMBAT"; 
      }
    } 
    else if (currentHour >= 15 && currentHour < 21) {
      // JAM 15:00 s/d 20:59 WITA -> Sesi Pulang (Mendukung Last Out)
      // Di rentang jam ini baru diizinkan mencatat status KELUAR ke sistem Sheets
      statusAbsen = "KELUAR";
    } 
    else {
      // Di luar jam operasional normal sekolah (malam hari / subuh awal)
      statusAbsen = "DILUAR_JAM"; 
    }

    console.log(`[LOG] [${roleUser.toUpperCase()}] Device: ${device_id || "Aparat"} | NIS: ${nomorInduk} | Nama: ${namaSiswa} | Jam: ${currentHour} | Status: ${statusAbsen}`);

    // =========================================================================
    // 3. MENERUSKAN DATA VALID KE GOOGLE SHEETS
    // =========================================================================
    // Parameter 'id' sekarang diisi dengan nomorInduk (NIS) hasil pemetaan server
    const forwardUrl = `${GOOGLE_SHEET_URL}?name=${encodeURIComponent(namaSiswa)}&id=${encodeURIComponent(nomorInduk)}&status=${statusAbsen}`;
    console.log("[DEBUG] Membuka Jaringan ke Google Sheets:", forwardUrl);
    
    try {
      const sheetRes = await fetch(forwardUrl, { 
        method: 'GET',
        redirect: 'follow'
      });
      const sheetText = await sheetRes.text();
      console.log("[SHEETS RESPONSE]", sheetRes.status, sheetText);
    } catch (err) {
      console.error("[WARNING] Gagal meneruskan paket data ke Google Sheets:", err.message);
    } 
    
    // =========================================================================
    // 4. RESPONS BALIK SUKSES KE ESP8266
    // =========================================================================
    return res.status(200).json({
      status: statusAbsen,
      name: namaSiswa,
      message: roleUser === "guru" ? "Halo Guru" : "Sukses"
    });

  } catch (error) {
    console.error("[ERROR] Terjadi kegagalan fatal pada sistem backend Vercel:", error);
    return res.status(500).send("SERVER_ERROR");
  }
};
