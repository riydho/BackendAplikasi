-- Buat database
CREATE DATABASE IF NOT EXISTS db_edasmart;
USE db_edasmart;

-- Tabel users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel log_device (opsional, untuk nyimpen histori data sensor/perintah)
CREATE TABLE IF NOT EXISTS log_device (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  tipe ENUM('sensor', 'kontrol') NOT NULL,
  data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);