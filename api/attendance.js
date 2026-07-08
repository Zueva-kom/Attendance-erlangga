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
    if (!uid || !device_id) return res.status(400).json({ error: 'Parameter tidak lengkap.' });

    // 1. VERIFIKASI SISWA & KELAS
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

    const { nama_siswa: namaSiswa, nama_kelas: kelasSiswa } = resultSiswa.rows[0];

    // PENGAMAN KELAS
    const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (deviceClean !== kelasClean) {
      return res.status(200).json({ status: "REJECTED", name: namaSiswa, message: "Salah Kelas" });
    }

    // ========================================================
    // 2. LOGIKA PENENTUAN WAKTU SECARA AMAN (Zona Waktu WITA)
    // ========================================================
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

    const totalMenitSekarang = (currentHour * 60) + currentMinute;

    let responStatusNodeMCU = "DILUAR_JAM"; 
    let dbStatus = "";            
    let hitungDatabase = false;   

    // --- DEKLARASI JENDELA WAKTU (SUDAH DIPERBAIKI) ---
    const m_06_00 = 6 * 60;
    const m_07_15 = (7 * 60) + 15;
    const m_15_59 = (15 * 60) + 59;
    const m_16_00 = 16 * 60;
    const m_19_00 = 19 * 60;

    if (totalMenitSekarang >= m_06_00 && totalMenitSekarang < m_07_15) {
      responStatusNodeMCU = "MASUK";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_07_15 && totalMenitSekarang < m_15_59) {
      responStatusNodeMCU = "TERLAMBAT";
      dbStatus = "IN";
      hitungDatabase = true;
    } 
    else if (totalMenitSekarang >= m_16_00 && totalMenitSekarang < m_19_00) {
      responStatusNodeMCU = "KELUAR";
      dbStatus = "OUT";
      hitungDatabase = true;
    } 

    //Cek double tap//
    if (hitungDatabase) {
      // Query untuk mengecek apakah sudah ada data absen di tanggal yang sama (WITA)
      // timezone('Asia/Makassar', CURRENT_TIMESTAMP): memastikan perbandingan hari menggunakan tanggal WITA
      const queryCekDuplikat = `
        SELECT id_presensi FROM presensi 
        WHERE uid_tag = $1 
          AND status = $2 
          AND waktu::date = (timezone('Asia/Makassar', CURRENT_TIMESTAMP)::date);
      `;
      const resultDuplikat = await pool.query(queryCekDuplikat, [uid, dbStatus]);

      if (resultDuplikat.rows.length > 0) {
        console.log(`[POSTGRES] ${namaSiswa} -> Diabaikan (Sudah absen ${dbStatus} hari ini)`);
        return res.status(200).json({
          status: "SUDAH_ABSEN",
          name: namaSiswa
        });
      }
    }

    // ========================================================
    // 3. PROSES SIMPAN KE DATABASE 
    // ========================================================
    if (hitungDatabase) {
      // OPSI OPTIMASI: Anda bisa menambahkan pengecekan data duplikat di sini sebelum INSERT
      const queryInsert = `
        INSERT INTO presensi (uid_tag, status, nama_siswa) 
        VALUES ($1, $2, $3);
      `;
      await pool.query(queryInsert, [uid, dbStatus, namaSiswa]);
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
