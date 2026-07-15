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
    // Tambahkan parameter opsional untuk manipulasi data demo
    const { device_id, uid, waktu_demo, status_demo } = req.body; 
    if (!uid) return res.status(400).json({ error: 'Parameter UID tidak ditemukan.' });

    // ========================================================
    // 1. VERIFIKASI SISWA & KELAS 
    // ========================================================
    const resultSiswa = await pool.query(`
      SELECT s.nama_siswa, k.nama_kelas, s.id_kelas
      FROM siswas s
      JOIN kelas k ON s.id_kelas = k.id
      WHERE s.uid_tag = $1 LIMIT 1;
    `, [uid]);

    if (resultSiswa.rows.length === 0) {
      return res.status(200).json({ status: "REJECTED", name: "Unknown", message: "Tidak Terdaftar" });
    }

    const { nama_siswa: namaSiswa, nama_kelas: kelasSiswa, id_kelas: idKelasSiswa } = resultSiswa.rows[0];

    // PENGAMAN KELAS
    const deviceClean = device_id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kelasClean = kelasSiswa.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (deviceClean !== kelasClean) {
      return res.status(200).json({ status: "REJECTED", name: namaSiswa, message: "Salah Kelas" });
    }

    // ========================================================
    // 2. LOGIKA WAKTU JENDELA ABSEN (DIBEBASKAN UNTUK DEMO)
    // ========================================================
    const targetTime = new Date(new Date().getTime() + (8 * 60 * 60 * 1000)); 
    const currentHour = targetTime.getUTCHours();
    const currentMinute = targetTime.getUTCMinutes();

    // Generate tanggal hari ini
    const tahun = targetTime.getUTCFullYear();
    const bulan = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
    const tanggal = String(targetTime.getUTCDate()).padStart(2, '0');
    const tanggalHariIni = `${tahun}-${bulan}-${tanggal}`; 

    // Tentukan waktu (Gunakan waktu_demo jika dikirim, jika tidak gunakan waktu asli)
    let waktuString = waktu_demo || `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

    // Tentukan Status (Gunakan status_demo jika ada, atau otomatis berdasarkan jam)
    let dbStatus = "";            
    let responStatusNodeMCU = ""; 

    if (status_demo) {
      dbStatus = status_demo.toUpperCase(); // "IN" atau "OUT"
      responStatusNodeMCU = dbStatus === "IN" ? "MASUK" : "KELUAR";
    } else {
      // Otomatisasi cerdas: Sebelum jam 12 siang dianggap masuk, setelahnya dianggap pulang
      const jamUntukCek = parseInt(waktuString.split(':')[0]);
      if (jamUntukCek < 12) {
        dbStatus = "IN";
        responStatusNodeMCU = jamUntukCek < 7 || (jamUntukCek === 7 && parseInt(waktuString.split(':')[1]) <= 15) ? "MASUK" : "TERLAMBAT";
      } else {
        dbStatus = "OUT";
        responStatusNodeMCU = "KELUAR";
      }
    }

    // ========================================================
    // 3. PROSES CEK DATA, INSERT ATAU UPDATE
    // ========================================================
    const queryCekExist = `
      SELECT id FROM presensis 
      WHERE uid_tag = $1 
        AND status = $2 
        AND tanggal = $3
      LIMIT 1;
    `;
    const resultCek = await pool.query(queryCekExist, [uid, dbStatus, tanggalHariIni]);

    if (resultCek.rows.length > 0) {
      const idExisting = resultCek.rows[0].id;

      if (dbStatus === 'IN') {
        // Biar gampang demo berulang kali, kita ijinkan UPDATE waktu masuknya jika di-tap lagi
        const queryUpdateIn = `
          UPDATE presensis 
          SET waktu = $1, updated_at = NOW() 
          WHERE id = $2;
        `;
        await pool.query(queryUpdateIn, [waktuString, idExisting]);
        return res.status(200).json({ status: responStatusNodeMCU, name: namaSiswa, message: "Waktu MASUK diperbarui (Demo Mode)" });
      } 
      else if (dbStatus === 'OUT') {
        const queryUpdateOut = `
          UPDATE presensis 
          SET waktu = $1, updated_at = NOW() 
          WHERE id = $2;
        `;
        await pool.query(queryUpdateOut, [waktuString, idExisting]);
        return res.status(200).json({ status: responStatusNodeMCU, name: namaSiswa, message: "Waktu KELUAR diperbarui (Demo Mode)" });
      }
    } else {
      // DATA BELUM ADA -> INSERT BARU
      const queryInsert = `
        INSERT INTO presensis (uid_tag, id_kelas, status, waktu, tanggal) 
        VALUES ($1, $2, $3, $4, $5);
      `;
      await pool.query(queryInsert, [uid, idKelasSiswa, dbStatus, waktuString, tanggalHariIni]);
      return res.status(200).json({ status: responStatusNodeMCU, name: namaSiswa });
    }

  } catch (error) {
    console.error("[ERROR] Sistem backend gagal:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: error.message });
  }
};
