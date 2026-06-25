-- ============================================================
-- EdaSmart — Railway MySQL Schema
-- Jalankan file ini di TablePlus (database: railway)
-- ============================================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nama       VARCHAR(100)  NOT NULL,
  email      VARCHAR(100)  NOT NULL UNIQUE,
  password   VARCHAR(255)  NOT NULL,
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- 2. ALAT
CREATE TABLE IF NOT EXISTS alat (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nama_alat  VARCHAR(100)  NOT NULL,
  status     ENUM('aktif','nonaktif') DEFAULT 'nonaktif',
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- Data awal alat
INSERT INTO alat (nama_alat, status) VALUES
  ('Mesin Penggiling', 'nonaktif'),
  ('Mesin Pengepres',  'nonaktif');

-- 3. JADWAL
CREATE TABLE IF NOT EXISTS jadwal (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  alat_id       INT NOT NULL,
  waktu_mulai   DATETIME,
  waktu_selesai DATETIME,
  status        ENUM('berjalan','selesai','dibatalkan') DEFAULT 'berjalan',
  created_by    INT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alat_id)    REFERENCES alat(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 4. MONITORING
CREATE TABLE IF NOT EXISTS monitoring (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  alat_id        INT NOT NULL,
  status         ENUM('aktif','nonaktif') DEFAULT 'nonaktif',
  waktu_aktif    DATETIME,
  waktu_nonaktif DATETIME,
  durasi_menit   INT DEFAULT 0,
  sumber         ENUM('manual','otomatis','mqtt') DEFAULT 'manual',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alat_id) REFERENCES alat(id)
);

-- 5. RIWAYAT
CREATE TABLE IF NOT EXISTS riwayat (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  alat_id    INT,
  user_id    INT,
  aksi       ENUM('aktifkan','nonaktifkan') NOT NULL,
  keterangan VARCHAR(255),
  waktu      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alat_id) REFERENCES alat(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 6. SENSOR_HCSR
CREATE TABLE IF NOT EXISTS sensor_hcsr (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  jarak_cm FLOAT NOT NULL,
  status   ENUM('normal','peringatan','bahaya') DEFAULT 'normal',
  waktu    DATETIME DEFAULT NOW()
);

-- 7. SENSOR_RPM
CREATE TABLE IF NOT EXISTS sensor_rpm (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  alat_id INT,
  rpm     INT NOT NULL,
  status  ENUM('normal','peringatan','bahaya') DEFAULT 'normal',
  waktu   DATETIME DEFAULT NOW(),
  FOREIGN KEY (alat_id) REFERENCES alat(id)
);

-- 8. LOG_DEVICE
CREATE TABLE IF NOT EXISTS log_device (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT,
  tipe       ENUM('sensor','kontrol') NOT NULL,
  data       JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
