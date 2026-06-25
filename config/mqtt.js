// config/mqtt.js
const mqtt = require('mqtt');
const db   = require('./db');
require('dotenv').config();

// ── State realtime (in-memory, diakses oleh routes/sensor.js) ──────────────
const realtimeState = {
  press: {
    status: 'OFF',
    phase:  'IDLE',
    sisa:   0,
    updatedAt: null,
  },
  giling: {
    status: 'OFF',
    rpm:    0,
    sisa:   0,
    updatedAt: null,
  },
  estop: {
    aktif:     false,
    updatedAt: null,
  },
  device: {
    status:    'OFFLINE',
    updatedAt: null,
  },
};

const client = mqtt.connect({
  host:     process.env.MQTT_HOST,
  port:     parseInt(process.env.MQTT_PORT),
  protocol: 'mqtts',
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  rejectUnauthorized: false, // sama seperti setInsecure() di Arduino
});

client.on('connect', () => {
  console.log('✅ MQTT terhubung ke HiveMQ');

  // Subscribe semua topic dari Arduino
  const topics = [
    'edasmart/giling/rpm',
    'edasmart/giling/sisa',
    'edasmart/giling/status',
    'edasmart/press/status',
    'edasmart/press/phase',
    'edasmart/press/sisa',
    'edasmart/estop',
    'edasmart/device',
  ];
  topics.forEach(t => client.subscribe(t, { qos: 1 }));
  console.log('📡 Subscribe ke semua topic Arduino');
});

client.on('message', async (topic, message) => {
  const val = message.toString().trim();
  console.log(`[MQTT IN] ${topic}: ${val}`);

  try {
    switch (topic) {

      // ── Press Status ────────────────────────────────────────
      case 'edasmart/press/status': {
        realtimeState.press.status    = val;
        realtimeState.press.updatedAt = new Date();
        const dbStatus = val === 'ON' ? 'aktif' : 'nonaktif';
        // Nama alat di DB: 'Mesin Pengepres'
        await db.query(
          "UPDATE alat SET status = ? WHERE nama_alat LIKE '%pengepres%' OR nama_alat LIKE '%press%' LIMIT 1",
          [dbStatus]
        );
        const [[alatPress]] = await db.query(
          "SELECT id FROM alat WHERE nama_alat LIKE '%pengepres%' OR nama_alat LIKE '%press%' LIMIT 1"
        );
        if (alatPress) {
          if (val === 'ON') {
            await db.query(
              "INSERT INTO monitoring (alat_id, status, waktu_aktif, sumber) VALUES (?, 'aktif', NOW(), 'mqtt')",
              [alatPress.id]
            );
            // created_by pakai NULL — hapus foreign key constraint kalau ada masalah
            await db.query(
              "INSERT INTO jadwal (alat_id, waktu_mulai, status) VALUES (?, NOW(), 'berjalan')",
              [alatPress.id]
            );
          } else {
            await db.query(
              `UPDATE monitoring SET waktu_nonaktif = NOW(), status = 'nonaktif',
               durasi_menit = TIMESTAMPDIFF(MINUTE, waktu_aktif, NOW())
               WHERE alat_id = ? AND status = 'aktif' ORDER BY id DESC LIMIT 1`,
              [alatPress.id]
            );
            await db.query(
              "UPDATE jadwal SET waktu_selesai = NOW(), status = 'selesai' WHERE alat_id = ? AND status = 'berjalan' ORDER BY id DESC LIMIT 1",
              [alatPress.id]
            );
          }
        }
        break;
      }

      // ── Press Phase ─────────────────────────────────────────
      case 'edasmart/press/phase': {
        realtimeState.press.phase     = val;          // 'TURUN'|'TAHAN'|'NAIK'|'MUNDUR'|'IDLE'
        realtimeState.press.updatedAt = new Date();
        // Simpan ke press_log
        await db.query(
          'INSERT INTO press_log (fase, waktu) VALUES (?, NOW())',
          [val]
        );
        break;
      }

      // ── Press Sisa Waktu ────────────────────────────────────
      case 'edasmart/press/sisa': {
        const sisa = parseInt(val);
        if (!isNaN(sisa)) {
          realtimeState.press.sisa      = sisa;
          realtimeState.press.updatedAt = new Date();
        }
        break;
      }

      // ── Giling Status ───────────────────────────────────────
      case 'edasmart/giling/status': {
        realtimeState.giling.status    = val;
        realtimeState.giling.updatedAt = new Date();
        const dbStatusGiling = val === 'ON' ? 'aktif' : 'nonaktif';
        await db.query(
          "UPDATE alat SET status = ? WHERE nama_alat LIKE '%penggiling%' LIMIT 1",
          [dbStatusGiling]
        );
        const [[alatGiling]] = await db.query(
          "SELECT id FROM alat WHERE nama_alat LIKE '%penggiling%' LIMIT 1"
        );
        if (alatGiling) {
          if (val === 'ON') {
            await db.query(
              "INSERT INTO monitoring (alat_id, status, waktu_aktif, sumber) VALUES (?, 'aktif', NOW(), 'mqtt')",
              [alatGiling.id]
            );
            await db.query(
              "INSERT INTO jadwal (alat_id, waktu_mulai, status) VALUES (?, NOW(), 'berjalan')",
              [alatGiling.id]
            );
          } else {
            await db.query(
              `UPDATE monitoring SET waktu_nonaktif = NOW(), status = 'nonaktif',
               durasi_menit = TIMESTAMPDIFF(MINUTE, waktu_aktif, NOW())
               WHERE alat_id = ? AND status = 'aktif' ORDER BY id DESC LIMIT 1`,
              [alatGiling.id]
            );
            await db.query(
              "UPDATE jadwal SET waktu_selesai = NOW(), status = 'selesai' WHERE alat_id = ? AND status = 'berjalan' ORDER BY id DESC LIMIT 1",
              [alatGiling.id]
            );
          }
        }
        break;
      }

      // ── Giling RPM ──────────────────────────────────────────
      case 'edasmart/giling/rpm': {
        const rpm = parseInt(val);
        if (!isNaN(rpm)) {
          realtimeState.giling.rpm      = rpm;
          realtimeState.giling.updatedAt = new Date();
          // Simpan ke sensor_rpm (rate-limited: hanya kalau berbeda ≥5 dari sebelumnya)
          if (Math.abs(rpm - (realtimeState.giling._lastSavedRpm || 0)) >= 5) {
            realtimeState.giling._lastSavedRpm = rpm;
            await db.query(
              'INSERT INTO sensor_rpm (rpm, waktu) VALUES (?, NOW())',
              [rpm]
            );
          }
        }
        break;
      }

      // ── Giling Sisa Waktu ───────────────────────────────────
      case 'edasmart/giling/sisa': {
        const sisa = parseInt(val);
        if (!isNaN(sisa)) {
          realtimeState.giling.sisa      = sisa;
          realtimeState.giling.updatedAt = new Date();
        }
        break;
      }

      // ── Emergency Stop ──────────────────────────────────────
      case 'edasmart/estop': {
        const aktif = val === 'TRIGGERED';
        realtimeState.estop.aktif     = aktif;
        realtimeState.estop.updatedAt = new Date();
        // Update semua alat jadi nonaktif saat estop
        if (aktif) {
          await db.query("UPDATE alat SET status = 'nonaktif'");
        }
        // Simpan ke device_status
        await db.query(
          'INSERT INTO device_status (tipe, nilai, waktu) VALUES (?, ?, NOW())',
          ['estop', val]
        );
        console.log(`🚨 E-Stop: ${val}`);
        break;
      }

      // ── Device Online/Offline ───────────────────────────────
      case 'edasmart/device': {
        realtimeState.device.status    = val;   // 'ONLINE' | 'OFFLINE'
        realtimeState.device.updatedAt = new Date();
        await db.query(
          'INSERT INTO device_status (tipe, nilai, waktu) VALUES (?, ?, NOW())',
          ['device', val]
        );
        console.log(`📟 Device: ${val}`);
        break;
      }
    }
  } catch (err) {
    console.error(`[MQTT] Gagal proses topic ${topic}:`, err.message);
  }
});

client.on('error', (err) => {
  console.error('❌ MQTT error:', err.message);
});

client.on('offline', () => {
  console.warn('⚠️  MQTT offline, mencoba reconnect...');
});

// ── Helper publish command ke ESP32 ────────────────────────────────────────
function publishCommand(mesin, perintah) {
  // mesin: 'press' | 'giling'
  // perintah: 'STOP' (saat ini ESP32 hanya handle STOP)
  const topic = `edasmart/cmd/${mesin}`;
  client.publish(topic, perintah, { qos: 1 }, (err) => {
    if (err) console.error(`[MQTT] Gagal publish ${topic}:`, err.message);
    else     console.log(`✅ CMD → ${topic}: ${perintah}`);
  });
}

module.exports = { client, realtimeState, publishCommand };