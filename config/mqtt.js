// config/mqtt.js
const mqtt = require('mqtt');
const db   = require('./db');
require('dotenv').config();

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
  client.subscribe('edasmart/giling/rpm',    { qos: 1 });
  client.subscribe('edasmart/giling/sisa',   { qos: 1 });
  client.subscribe('edasmart/giling/status', { qos: 1 });
  client.subscribe('edasmart/press/status',  { qos: 1 });
  client.subscribe('edasmart/press/phase',   { qos: 1 });
  client.subscribe('edasmart/press/sisa',    { qos: 1 });
  client.subscribe('edasmart/press/sonar',   { qos: 1 }); // topic baru
  client.subscribe('edasmart/device',        { qos: 1 });

  console.log('📡 Subscribe ke semua topic Arduino');
});

client.on('message', async (topic, message) => {
  const val = message.toString().trim();
  console.log(`[MQTT IN] ${topic}: ${val}`);

  try {
    switch (topic) {

      // ── RPM Penggiling ──────────────────────────────────────
      case 'edasmart/giling/rpm': {
        const rpm = parseInt(val);
        if (!isNaN(rpm)) {
          await db.query(
            'INSERT INTO sensor_rpm (rpm, waktu) VALUES (?, NOW())',
            [rpm]
          );
        }
        break;
      }

      // ── Sonar HC-SR04 ───────────────────────────────────────
      case 'edasmart/press/sonar': {
        const jarak = parseFloat(val);
        if (!isNaN(jarak)) {
          let status = 'normal';
          if (jarak < 5)       status = 'bahaya';
          else if (jarak < 10) status = 'peringatan';

          await db.query(
            'INSERT INTO sensor_hcsr (jarak_cm, status, waktu) VALUES (?, ?, NOW())',
            [jarak, status]
          );
        }
        break;
      }

      // ── Status mesin (update tabel alat) ───────────────────
      case 'edasmart/giling/status': {
        const status = val === 'ON' ? 'aktif' : 'nonaktif';
        await db.query(
          "UPDATE alat SET status = ? WHERE nama_alat LIKE '%penggiling%' LIMIT 1",
          [status]
        );
        break;
      }

      case 'edasmart/press/status': {
        const status = val === 'ON' ? 'aktif' : 'nonaktif';
        await db.query(
          "UPDATE alat SET status = ? WHERE nama_alat LIKE '%press%' LIMIT 1",
          [status]
        );
        break;
      }

      // ── Device online/offline ───────────────────────────────
      case 'edasmart/device': {
        console.log(`[Device] Status: ${val}`);
        // opsional: simpan ke tabel log jika perlu
        break;
      }
    }
  } catch (err) {
    console.error(`[MQTT] Gagal simpan topic ${topic}:`, err.message);
  }
});

client.on('error', (err) => {
  console.error('❌ MQTT error:', err.message);
});

client.on('offline', () => {
  console.warn('⚠️  MQTT offline, mencoba reconnect...');
});

module.exports = client;