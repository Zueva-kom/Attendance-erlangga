const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// URL Web App Google Sheets hasil deployment terbaru
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbxkPd4k0jG5YvdSj2NApcP-7_LuAyN8vOHE4pgVr3cDE-bLxFzHrHLdHuC7sPWWKUj1Qw/exec";

module.exports = async (req, res) => {
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
    const { device_id, uid } = req.body; // Menerima "TKJ 1" dan UID Hexa

    if (!uid || !device_id) {
      return res.status(400).json({ error: 'Bad Request. Parameter UID atau Device ID tidak lengkap.' });
    }

    let user = null;
    let targetNamaTab = device_id.trim(); // Menjadi target nama tab di Sheets: "TKJ 1"

    // =========================================================================
    // STEP 1: VALIDASI MASTER BYPASS UNTUK GURU
    // =========================================================================
    const pathGuru = path.join(process.cwd(), 'data', 'guru.json');
    if (fs.existsSync(pathGuru)) {
      const dataGuru = JSON.parse(fs.readFileSync(pathGuru, 'utf8'));
      if (dataGuru[uid]) {
        user = dataGuru[uid];
        targetNamaTab = "ALL_GURU"; 
      }
    }

    // =========================================================================
    // STEP 2: JIKA BUKAN GURU, CARI DI FILE JSON KELAS MODULAR
    // =========================================================================
    if (!user) {
      // Mengubah input "TKJ 1" menjadi "tkj_1" untuk mencocokkan nama file lokal
      const namaFileKelas = device_id.toLowerCase().replace(" ", "_").trim(); 
      const pathKelas = path.join(process.cwd(), 'data', `${namaFileKelas}.json`);

      // Proteksi jika file JSON kelas belum dibuat di repo
      if (!fs.existsSync(pathKelas)) {
        console.log(`[REJECTED] Database lokal data/${namaFileKelas}.json tidak ditemukan.`);
        return res.status(200).json({
          status: "REJECTED",
          name: "Unknown",
          message: "Kelas Tak Ada"
        });
      }

      const dataSiswaKelas = JSON.parse(fs.readFileSync(pathKelas, 'utf8'));
      user = dataSiswaKelas[uid];

      // Proteksi jika kartu di-tap di mesin yang benar, tetapi UID-nya tidak terdaftar di kelas itu
      if (!user) {
        console.log(`[REJECTED] UID: ${uid} tidak terdaftar di kelas ${device_id}`);
        return res.status(200).json({
          status: "REJECTED",
          name: "Asing",
          message: "Bukan Kelas Ini!"
        });
      }
    }

    const namaSiswa = user.nama;
    const nomorInduk = user.nis;

    // =========================================================================
    // STEP 3: LOGIKA TIME WINDOW FILO (Zona Waktu WITA)
    // =========================================================================
    const options = { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false };
    const timeString = new Date().toLocaleTimeString('id-ID', options); 
    const currentHour = parseInt(timeString.split(/[.:]/)[0], 10);

    let statusAbsen = "MASUK";

    if (currentHour >= 6 && currentHour < 15) {
      if (currentHour >= 6 && currentHour < 9) {
        statusAbsen = "MASUK";
      } else {
        statusAbsen = "TERLAMBAT"; 
      }
    } 
    else if (currentHour >= 15 && currentHour < 21) {
      statusAbsen = "KELUAR";
    } 
    else {
      statusAbsen = "DILUAR_JAM"; 
    }

    console.log(`[LOG] [${user.role.toUpperCase()}] Device: ${device_id} -> Tab Sheets: ${targetNamaTab} | NIS: ${nomorInduk} | Status: ${statusAbsen}`);

    // =========================================================================
    // STEP 4: KONEKSI KE GOOGLE APPS SCRIPT
    // =========================================================================
    const forwardUrl = `${GOOGLE_SHEET_URL}?name=${encodeURIComponent(namaSiswa)}&id=${encodeURIComponent(nomorInduk)}&status=${statusAbsen}&kelas=${encodeURIComponent(targetNamaTab)}`;
    
    try {
      const sheetRes = await fetch(forwardUrl, { method: 'GET', redirect: 'follow' });
      const sheetText = await sheetRes.text();
      console.log("[SHEETS RESPONSE]", sheetText);
    } catch (err) {
      console.error("[WARNING] Gagal meneruskan data ke Google Sheets:", err.message);
    } 
    
    // Mengembalikan payload JSON murni yang siap dibaca oleh fungsi ambilNilaiJson() di ESP8266
    return res.status(200).json({
      status: statusAbsen,
      name: namaSiswa,
      message: user.role === "guru" ? "Halo Guru" : "Sukses"
    });

  } catch (error) {
    console.error("[FATAL ERROR BACKEND]", error);
    return res.status(500).send("SERVER_ERROR");
  }
};
