const express = require('express');
const cors = require('cors');
require('dotenv').config();

require('./config/db');
require('./config/mqtt'); // inisialisasi MQTT client & mulai subscribe

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/device', require('./routes/device'));
app.use('/api/sensor', require('./routes/sensor'));

app.get('/', (req, res) => {
  res.json({ success: true, message: '🌿 EdaSmart Backend berjalan!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server EdaSmart jalan di port ${PORT}`);
});