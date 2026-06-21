const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit:       0,
  // Railway MySQL kadang butuh SSL
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL terhubung ke db_edasmart');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Gagal koneksi MySQL:', err.message);
  });

module.exports = pool;