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
    kecepatan: 100, // persen, default 100%
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
  sensor: {
    jarak_cm:  0,
    status:    'normal',
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

  // Subscribe 4 topic dari ESP32
  const topics = [
    'edasmart/press',
    'edasmart/giling',
    'edasmart/estop',
    'edasmart/device',
    'edasmart/sensor',
  ];
  topics.forEach(t => client.subscribe(t, { qos: 1 }));
  console.log('📡 Subscribe ke semua topic ESP32');
});

client.on('message', async (topic, message) => {
  const raw = message.toString().trim();
  console.log(`[MQTT IN] ${topic}: ${raw}`);

  let val;
  try {
    val = JSON.parse(raw);
  } catch {
    // Fallback: handle payload string lama dari ESP32 (sebelum update firmware)
    // estop lama: "TRIGGERED" / "RELEASED"
    // device lama: "ONLINE" / "OFFLINE"
    if (topic === 'edasmart/estop') {
      val = { aktif: raw === 'TRIGGERED' };
    } else if (topic === 'edasmart/device') {
      val = { status: raw };
    } else {
      console.warn(`[MQTT] Payload bukan JSON valid di topic ${topic}: ${raw}`);
      return;
    }
  }

  try {
    switch (topic) {

      // ── Press ───────────────────────────────────────────────
      // Payload: {"status":"ON","phase":"TAHAN","sisa":45}
      case 'edasmart/press': {
        realtimeState.press.status    = val.status ?? realtimeState.press.status;
        realtimeState.press.phase     = val.phase  ?? realtimeState.press.phase;
        realtimeState.press.sisa      = val.sisa   ?? realtimeState.press.sisa;
        realtimeState.press.updatedAt = new Date();

        const dbStatus = val.status === 'ON' ? 'aktif' : 'nonaktif';
        await db.query(
          "UPDATE alat SET status = ? WHERE nama_alat LIKE '%pengepres%' OR nama_alat LIKE '%press%' LIMIT 1",
          [dbStatus]
        );
        const [[alatPress]] = await db.query(
          "SELECT id FROM alat WHERE nama_alat LIKE '%pengepres%' OR nama_alat LIKE '%press%' LIMIT 1"
        );
        if (alatPress) {
          if (val.status === 'ON') {
            await db.query(
              "INSERT INTO monitoring (alat_id, status, waktu_aktif, sumber) VALUES (?, 'aktif', NOW(), 'mqtt')",
              [alatPress.id]
            );
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

        // Simpan phase ke press_log jika ada
        if (val.phase) {
          await db.query(
            'INSERT INTO press_log (fase, waktu) VALUES (?, NOW())',
            [val.phase]
          );
        }
        break;
      }

      // ── Giling ──────────────────────────────────────────────
      // Payload: {"status":"ON","rpm":1200,"sisa":30,"kecepatan":75}
      case 'edasmart/giling': {
        realtimeState.giling.status    = val.status    ?? realtimeState.giling.status;
        realtimeState.giling.rpm       = val.rpm       ?? realtimeState.giling.rpm;
        realtimeState.giling.sisa      = val.sisa      ?? realtimeState.giling.sisa;
        // Simpan kecepatan (persen) jika dikirim ESP32
        if (val.kecepatan !== undefined) {
          realtimeState.giling.kecepatan = parseInt(val.kecepatan);
        }
        realtimeState.giling.updatedAt = new Date();

        const dbStatusGiling = val.status === 'ON' ? 'aktif' : 'nonaktif';
        await db.query(
          "UPDATE alat SET status = ? WHERE nama_alat LIKE '%penggiling%' LIMIT 1",
          [dbStatusGiling]
        );
        const [[alatGiling]] = await db.query(
          "SELECT id FROM alat WHERE nama_alat LIKE '%penggiling%' LIMIT 1"
        );
        if (alatGiling) {
          if (val.status === 'ON') {
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

        // Simpan RPM ke sensor_rpm (rate-limited: hanya kalau berbeda ≥5)
        if (val.rpm !== undefined) {
          const rpm = parseInt(val.rpm);
          if (!isNaN(rpm) && Math.abs(rpm - (realtimeState.giling._lastSavedRpm || 0)) >= 5) {
            realtimeState.giling._lastSavedRpm = rpm;
            await db.query(
              'INSERT INTO sensor_rpm (rpm, waktu) VALUES (?, NOW())',
              [rpm]
            );
          }
        }
        break;
      }

      // ── Emergency Stop ──────────────────────────────────────
      // Payload: {"aktif":true} | {"aktif":false}
      case 'edasmart/estop': {
        const aktif = val.aktif === true;
        realtimeState.estop.aktif     = aktif;
        realtimeState.estop.updatedAt = new Date();
        if (aktif) {
          await db.query("UPDATE alat SET status = 'nonaktif'");
        }
        await db.query(
          'INSERT INTO device_status (tipe, nilai, waktu) VALUES (?, ?, NOW())',
          ['estop', aktif ? 'TRIGGERED' : 'RELEASED']
        );
        console.log(`🚨 E-Stop: ${aktif ? 'TRIGGERED' : 'RELEASED'}`);
        break;
      }

      // ── Device Online/Offline ───────────────────────────────
      // Payload: {"status":"ONLINE"} | {"status":"OFFLINE"}
      case 'edasmart/device': {
        realtimeState.device.status    = val.status ?? 'OFFLINE';
        realtimeState.device.updatedAt = new Date();
        await db.query(
          'INSERT INTO device_status (tipe, nilai, waktu) VALUES (?, ?, NOW())',
          ['device', val.status]
        );
        console.log(`📟 Device: ${val.status}`);
        break;
      }

      // ── Sensor HC-SR04 ──────────────────────────────────────
      // Payload: {"jarak":15.3,"status":"normal"}
      case 'edasmart/sensor': {
        const jarak = parseFloat(val.jarak);
        // 999 adalah sentinel value ESP32 saat sensor timeout — abaikan
        if (isNaN(jarak) || jarak >= 999) break;

        // Tentukan status jika tidak dikirim ESP32
        let statusSensor = val.status ?? 'normal';

        realtimeState.sensor.jarak_cm  = jarak;
        realtimeState.sensor.status    = statusSensor;
        realtimeState.sensor.updatedAt = new Date();

        // Simpan ke DB (rate-limited: hanya kalau jarak berubah > 1 cm, dan bukan nilai error)
        const lastJarak = realtimeState.sensor._lastSavedJarak ?? -99;
        if (Math.abs(jarak - lastJarak) >= 1 && jarak < 999) {
          realtimeState.sensor._lastSavedJarak = jarak;
          await db.query(
            'INSERT INTO sensor_hcsr (jarak_cm, status, waktu) VALUES (?, ?, NOW())',
            [jarak, statusSensor]
          );
        }
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
function publishCommand(mesin, perintah, durasiMenit = null, kecepatanPersen = null) {
  // mesin: 'press' | 'giling'
  // perintah: 'STOP' | 'START'
  // durasiMenit: opsional, hanya untuk START
  // kecepatanPersen: 0-100, dikirim langsung ke ESP32 (ESP32 konversi ke PWM via persenKePwm())
  const data = { mesin, perintah };
  if (perintah === 'START') {
    if (durasiMenit !== null && !isNaN(durasiMenit)) {
      data.durasi = durasiMenit;
    }
    if (kecepatanPersen !== null && !isNaN(kecepatanPersen)) {
      // Kirim langsung dalam persen (0-100), ESP32 yang konversi ke PWM via persenKePwm()
      data.kecepatan = Math.round(kecepatanPersen);
    }
  }
  const payload = JSON.stringify(data);
  client.publish('edasmart/cmd', payload, { qos: 1 }, (err) => {
    if (err) console.error(`[MQTT] Gagal publish edasmart/cmd:`, err.message);
    else     console.log(`✅ CMD → edasmart/cmd: ${payload}`);
  });
}

module.exports = { client, realtimeState, publishCommand };