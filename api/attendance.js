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
    // 2. LOGIKA WAKTU JENDELA ABSEN 
    // ========================================================
    const targetTime = new Date(new Date().getTime() + (8 * 60 * 60 * 1000)); 
    const currentHour = targetTime.getUTCHours();
    const currentMinute = targetTime.getUTCMinutes();
    const totalMenitSekarang = (currentHour * 60) + currentMinute;

    // Membuat string tanggal lokal (YYYY-MM-DD) untuk disimpan ke kolom baru
    const tahun = targetTime.getUTCFullYear();
    const bulan = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
    const tanggal = String(targetTime.getUTCDate()).padStart(2, '0');
    const tanggalHariIni = `${tahun}-${bulan}-${tanggal}`; 

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

    const jamLokal = String(currentHour).padStart(2, '0');
    const menitLokal = String(currentMinute).padStart(2, '0');
    const waktuString = `${jamLokal}:${menitLokal}`; 

    // ========================================================
    // 3. PROSES CEK DATA, INSERT ATAU UPDATE (BERDASARKAN KOLOM TANGGAL)
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
      // DATA SUDAH ADA HARI INI
      const idExisting = resultCek.rows[0].id;

      if (dbStatus === 'IN') {
        // Jika statusnya 'IN' (Pagi), abaikan dan kunci (Kirim status SUDAH_ABSEN)
        return res.status(200).json({ status: "SUDAH_ABSEN", name: namaSiswa });
      } 
      else if (dbStatus === 'OUT') {
        // Jika statusnya 'OUT' (Pulang), lakukan UPDATE pada kolom waktu ke menit terbaru
        const queryUpdate = `
          UPDATE presensis 
          SET waktu = $1, updated_at = NOW() 
          WHERE id = $2;
        `;
        await pool.query(queryUpdate, [waktuString, idExisting]);
        return res.status(200).json({ status: responStatusNodeMCU, name: namaSiswa });
      }
    } else {
      // DATA BELUM ADA HARI INI -> LAKUKAN INSERT BARU
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
