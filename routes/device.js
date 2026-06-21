const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const db = require('../config/db');
const mqttClient = require('../config/mqtt');
require('dotenv').config();

// GET /api/device/alat
router.get('/alat', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM alat ORDER BY id ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/device/jadwal-hari-ini
router.get('/jadwal-hari-ini', verifyToken, async (req, res) => {
  try {
    const [jadwal] = await db.query(`
      SELECT j.*, a.nama_alat
      FROM jadwal j
      LEFT JOIN alat a ON j.alat_id = a.id
      WHERE DATE(j.waktu_mulai) = CURDATE()
      ORDER BY j.waktu_mulai ASC
    `);

    const [monitoring] = await db.query(`
      SELECT m.*, a.nama_alat
      FROM monitoring m
      LEFT JOIN alat a ON m.alat_id = a.id
      WHERE DATE(m.created_at) = CURDATE()
    `);

    return res.json({ success: true, jadwal, monitoring });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/device/kontrol
router.post('/kontrol', verifyToken, async (req, res) => {
  const { alat_id, perintah } = req.body;

  if (!perintah) {
    return res.status(400).json({ success: false, message: 'Perintah wajib diisi' });
  }

  try {
    // 1. Update status alat
    if (alat_id) {
      await db.query('UPDATE alat SET status = ? WHERE id = ?', [perintah, alat_id]);
    }

    // 2. Simpan ke riwayat
    if (alat_id) {
      await db.query(
        'INSERT INTO riwayat (alat_id, user_id, aksi, keterangan) VALUES (?, ?, ?, ?)',
        [
          alat_id,
          req.user.id,
          perintah === 'aktif' ? 'aktifkan' : 'nonaktifkan',
          `Mesin di${perintah}kan via aplikasi`,
        ]
      );
    }

    // 3. Insert/update tabel jadwal
    if (alat_id) {
      if (perintah === 'aktif') {
        await db.query(
          "INSERT INTO jadwal (alat_id, waktu_mulai, waktu_selesai, status, created_by) VALUES (?, NOW(), NOW(), 'berjalan', ?)",
          [alat_id, req.user.id]
        );
      } else {
        await db.query(
          "UPDATE jadwal SET waktu_selesai = NOW(), status = 'selesai' WHERE alat_id = ? AND status = 'berjalan' ORDER BY id DESC LIMIT 1",
          [alat_id]
        );
      }
    }

    // 4. Insert/update tabel monitoring
    if (alat_id) {
      if (perintah === 'aktif') {
        await db.query(
          "INSERT INTO monitoring (alat_id, status, waktu_aktif, sumber) VALUES (?, 'aktif', NOW(), 'manual')",
          [alat_id]
        );
      } else {
        await db.query(
          `UPDATE monitoring 
           SET waktu_nonaktif = NOW(),
               status = 'nonaktif',
               durasi_menit = TIMESTAMPDIFF(MINUTE, waktu_aktif, NOW())
           WHERE alat_id = ? AND status = 'aktif'
           ORDER BY id DESC LIMIT 1`,
          [alat_id]
        );
      }
    }

    // 5. Publish ke MQTT HiveMQ
    const topic   = `edasmart/alat/${alat_id}`;
    const payload = perintah === 'aktif' ? '1' : '0';
    mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) console.log('MQTT publish error:', err.message);
      else console.log(`✅ MQTT → ${topic}: ${payload}`);
    });

    return res.json({ success: true, message: `Perintah ${perintah} berhasil dikirim` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/device/riwayat
router.get('/riwayat', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.*, a.nama_alat, u.nama AS nama_user
      FROM riwayat r
      LEFT JOIN alat a ON r.alat_id = a.id
      LEFT JOIN users u ON r.user_id = u.id
      ORDER BY r.waktu DESC
      LIMIT 100
    `);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/device/riwayat/:id
router.delete('/riwayat/:id', verifyToken, async (req, res) => {
  try {
    await db.query('DELETE FROM riwayat WHERE id = ?', [req.params.id]);
    return res.json({ success: true, message: 'Riwayat berhasil dihapus' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/device/riwayat - hapus semua
router.delete('/riwayat', verifyToken, async (req, res) => {
  try {
    await db.query('DELETE FROM riwayat');
    return res.json({ success: true, message: 'Semua riwayat berhasil dihapus' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// BARU DITAMBAH — Sensor HC-SR04
// ============================================================

// POST /api/device/sensor-hcsr  ← dipanggil oleh ESP32
router.post('/sensor-hcsr', async (req, res) => {
  const { jarak_cm } = req.body;

  if (jarak_cm === undefined || jarak_cm === null) {
    return res.status(400).json({ 
      success: false, 
      message: 'jarak_cm wajib diisi' 
    });
  }

  // Tentukan status berdasarkan jarak
  let status = 'normal';
  if (jarak_cm < 5)       status = 'bahaya';
  else if (jarak_cm < 10) status = 'peringatan';

  try {
    await db.query(
      'INSERT INTO sensor_hcsr (jarak_cm, status, waktu) VALUES (?, ?, NOW())',
      [jarak_cm, status]
    );
    return res.json({ 
      success: true, 
      message: 'Data sensor tersimpan', 
      status 
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/device/sensor-rpm?alat_id=  ← dipanggil oleh Dashboard
router.get('/sensor-rpm', verifyToken, async (req, res) => {
  const { alat_id } = req.query;
  try {
    let rows;
    if (alat_id) {
      [rows] = await db.query(
        'SELECT * FROM sensor_rpm WHERE alat_id = ? ORDER BY id DESC LIMIT 1',
        [alat_id]
      );
    } else {
      [rows] = await db.query('SELECT * FROM sensor_rpm ORDER BY id DESC LIMIT 1');
    }
    if (rows.length === 0) {
      return res.json({ success: false, message: 'Belum ada data RPM' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/device/sensor-hcsr  ← dipanggil oleh frontend
router.get('/sensor-hcsr', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sensor_hcsr ORDER BY id DESC LIMIT 1'
    );

    if (rows.length === 0) {
      return res.json({ 
        success: false, 
        message: 'Belum ada data sensor' 
      });
    }

    return res.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;