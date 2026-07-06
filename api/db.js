const mysql = require('mysql2/promise');

// Ganti konfigurasi di bawah ini sesuai dengan database MySQL kamu
const pool = mysql.createPool({
  host: 'localhost',       // Ubah jika menggunakan hosting database cloud
  user: 'root',            // Username database kamu
  password: '',            // Password database kamu
  database: 'absensi_db',  // Nama database yang kamu buat di MySQL
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;