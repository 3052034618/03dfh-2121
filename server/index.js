const express = require('express');
const cors = require('cors');
const path = require('path');
const carpoolRoutes = require('./routes/carpools');
const playerRoutes = require('./routes/players');
const reminderService = require('./services/reminderService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/carpools', carpoolRoutes);
app.use('/api/players', playerRoutes);

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/__debug/check-upcoming', (req, res) => {
  try {
    const reminder = require('./services/reminderService');
    reminder.checkUpcomingCarpools();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/__debug/check-full', (req, res) => {
  try {
    const reminder = require('./services/reminderService');
    reminder.checkFullCarpools();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  res.sendFile(indexPath);
});

app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: '服务器内部错误', message: err.message });
});

reminderService.start();

app.listen(PORT, () => {
  console.log(`[Server] 剧本杀拼车服务已启动: http://localhost:${PORT}`);
});

module.exports = app;
