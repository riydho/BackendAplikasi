// routes/sensor.js  — v2 (sensor field added)
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const verifyToken = require('../middleware/auth');
const { realtimeState, publishCommand } = require('../config/mqtt');

// ── GET /api/sensor/realtime ─────────────────────────────────────────────────
// Kembalikan state realtime ESP32 (press, giling, estop, device)
// Tidak perlu token agar dashboard bisa polling tanpa login
router.get('/realtime', (req, res) => {
  res.json({
    success: true,
    data: {
      press:  realtimeState.press,
      giling: realtimeState.giling,
      estop:  realtimeState.estop,
      device: realtimeState.device,
      sensor: realtimeState.sensor,
    },
    timestamp: new Date(),
  });
});

// ── GET /api/sensor/press ────────────────────────────────────────────────────
// Status realtime mesin press saja
router.get('/press', (req, res) => {
  res.json({ success: true, data: realtimeState.press });
});

// ── GET /api/sensor/giling ───────────────────────────────────────────────────
// Status realtime mesin penggiling saja
router.get('/giling', (req, res) => {
  res.json({ success: true, data: realtimeState.giling });
});

// ── GET /api/sensor/rpm/history ─────────────────────────────────────────────
// Riwayat RPM penggiling (butuh token)
router.get('/rpm/history', verifyToken, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  try {
    const [rows] = await db.query(
      'SELECT * FROM sensor_rpm ORDER BY id DESC LIMIT ?',
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/sensor/press/history ───────────────────────────────────────────
// Riwayat fase press (butuh token)
router.get('/press/history', verifyToken, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  try {
    const [rows] = await db.query(
      'SELECT * FROM press_log ORDER BY id DESC LIMIT ?',
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/sensor/device/log ───────────────────────────────────────────────
// Log device online/offline & estop (butuh token)
router.get('/device/log', verifyToken, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  try {
    const [rows] = await db.query(
      'SELECT * FROM device_status ORDER BY id DESC LIMIT ?',
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/sensor/cmd ─────────────────────────────────────────────────────
// Kirim perintah ke ESP32 via MQTT
// Body: { mesin: 'press'|'giling', perintah: 'STOP' }
router.post('/cmd', verifyToken, async (req, res) => {
  const { mesin, perintah } = req.body;

  if (!mesin || !perintah) {
    return res.status(400).json({ success: false, message: 'mesin dan perintah wajib diisi' });
  }
  if (!['press', 'giling'].includes(mesin)) {
    return res.status(400).json({ success: false, message: 'mesin harus "press" atau "giling"' });
  }
  if (!['STOP', 'START'].includes(perintah)) {
    return res.status(400).json({ success: false, message: 'perintah tidak dikenali (gunakan: STOP atau START)' });
  }

  try {
    publishCommand(mesin, perintah);

    // Catat ke riwayat
    const [[alat]] = await db.query(
      'SELECT id FROM alat WHERE nama_alat LIKE ? LIMIT 1',
      [`%${mesin === 'press' ? 'press' : 'penggiling'}%`]
    );
    if (alat) {
      await db.query(
        'INSERT INTO riwayat (alat_id, user_id, aksi, keterangan) VALUES (?, ?, ?, ?)',
        [alat.id, req.user.id, 'nonaktifkan', `${perintah} dikirim via aplikasi ke mesin ${mesin}`]
      );
    }

    res.json({ success: true, message: `Perintah ${perintah} dikirim ke mesin ${mesin}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
