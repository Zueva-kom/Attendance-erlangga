const fetch = require('node-fetch');
const daftarSiswa = require('../data/siswa.json');

// URL Web App Google Sheets (Ganti sesuai URL Deployment Google Apps Script milikmu)
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbxgY_CB-T6SWOgD7NaMWMuxf6gvwNXc_9NVj5WNINDcsBMBJbTl8TSQDb2XqZY2Blk0gQ/exec";

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

    // Validasi input data dari ESP8266
    if (!uid) {
      return res.status(400).json({ error: 'Bad Request. Parameter UID tidak ditemukan.' });
    }

    // 1. PEMETAAN DATA SISWA (Server-Side Mapping)
    // Mencari nama berdasarkan UID dari file JSON. Jika tidak ada, otomatis 'Unknown'
    const namaSiswa = daftarSiswa[uid] || "Unknown";

    // 2. LOGIKA PENENTUAN WAKTU (Zona Waktu WITA)
    const options = { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false };
    const timeString = new Date().toLocaleTimeString('id-ID', options); // Menghasilkan format "HH.mm" atau "HH:mm"
    
    // Parsing nilai jam secara aman
    const currentHour = parseInt(timeString.split(/[.:]/)[0], 10);

    let statusAbsen = "TERLAMBAT";

    // Aturan Waktu Operasional Presensi:
    // Absen Masuk  : Jam 06:00 s/d 08:59 WITA
    // Absen Keluar : Jam 16:00 s/d 18:59 WITA
    if (currentHour >= 6 && currentHour < 9) {
      statusAbsen = "MASUK";
    } else if (currentHour >= 16 && currentHour < 19) {
      statusAbsen = "KELUAR";
    }

    console.log(`[LOG] Device: ${device_id || "Aparat"} | UID: ${uid} | Nama: ${namaSiswa} | Jam: ${currentHour} | Status: ${statusAbsen}`);

    // --- 3. MENERUSKAN DATA KE GOOGLE SHEETS ---
    const forwardUrl = `${GOOGLE_SHEET_URL}?name=${encodeURIComponent(namaSiswa)}&id=${uid}&status=${statusAbsen}`;
    console.log("[DEBUG] forwardUrl:", forwardUrl);
    // Gunakan try-catch lokal atau biarkan fetch berjalan tanpa mempedulikan return bodynya
  try {
    const sheetRes = await fetch(forwardUrl, { 
      method: 'GET',
      redirect: 'follow'
    });
    const sheetText = await sheetRes.text();
    console.log("[SHEETS]", sheetRes.status, sheetText);
  } catch (err) {
    console.error("[WARNING] Gagal meneruskan ke Google Sheets:", err.message);
  } 
    
    // --- 4. RESPONS BALIK KE ESP8266 ---
    // Pastikan ini dieksekusi secara bersih dan independen
    return res.status(200).json({
      status: statusAbsen,
      name: namaSiswa
    });

  } catch (error) {
    console.error("[ERROR] Terjadi kegagalan sistem backend:", error);
    return res.status(500).send("SERVER_ERROR");
  }
};
