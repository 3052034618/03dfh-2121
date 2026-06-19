const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { getCarpoolWithPlayers } = require('./carpools');
const reminderService = require('../services/reminderService');

const router = express.Router();

function getNextStandbyOrder(carpoolId) {
  const max = db.prepare(`
    SELECT COALESCE(MAX(standby_order), 0) as max_order 
    FROM players 
    WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed'
  `).get(carpoolId);
  return max.max_order + 1;
}

router.get('/carpool/:carpoolId', (req, res) => {
  const { carpoolId } = req.params;
  const players = db.prepare(`
    SELECT * FROM players 
    WHERE carpool_id = ? 
    ORDER BY is_standby ASC, 
             CASE WHEN is_standby = 1 THEN standby_order END ASC,
             joined_at ASC
  `).all(carpoolId);
  res.json(players);
});

router.post('/', (req, res) => {
  const {
    carpool_id,
    nickname,
    wxid,
    gender,
    can_crossplay,
    arrival_time,
    note,
    is_standby
  } = req.body;

  if (!carpool_id || !nickname) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const carpool = db.prepare('SELECT * FROM carpools WHERE id = ?').get(carpool_id);
  if (!carpool) {
    return res.status(404).json({ error: '拼车不存在' });
  }

  if (carpool.status === 'cancelled') {
    return res.status(400).json({ error: '该拼车已取消，无法加入' });
  }

  if (carpool.status !== 'recruiting' && carpool.status !== 'locked') {
    return res.status(400).json({ error: '当前拼车状态不允许加入' });
  }

  const forceStandby = carpool.status === 'locked' && !is_standby;
  const actualStandby = forceStandby || is_standby;

  const existing = db.prepare(`
    SELECT * FROM players 
    WHERE carpool_id = ? AND (nickname = ? OR (wxid IS NOT NULL AND wxid = ?)) AND status = 'confirmed'
  `).get(carpool_id, nickname, wxid || '');

  if (existing) {
    return res.status(409).json({ error: '你已经在这个拼车里了', player: existing });
  }

  const confirmedCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM players WHERE carpool_id = ? AND is_standby = 0 AND status = 'confirmed'
  `).get(carpool_id).cnt;

  const finalStandby = actualStandby || (confirmedCount >= carpool.need_count);
  const standbyOrder = finalStandby ? getNextStandbyOrder(carpool_id) : null;

  const id = uuidv4();
  db.prepare(`
    INSERT INTO players (id, carpool_id, nickname, wxid, gender, can_crossplay, arrival_time, note, is_standby, standby_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, carpool_id, nickname, wxid || '', gender || '',
    can_crossplay ? 1 : 0,
    arrival_time || '', note || '',
    finalStandby ? 1 : 0,
    standbyOrder
  );

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  const updatedCarpool = getCarpoolWithPlayers(carpool_id);

  if (!finalStandby && updatedCarpool.current_count >= updatedCarpool.need_count && !carpool.lock_message_sent) {
    reminderService.emit('carpool:full', {
      carpoolId: carpool_id,
      groupId: carpool.group_id,
      shopName: carpool.shop_name,
      scriptName: carpool.script_name,
      startTime: carpool.start_time,
      count: updatedCarpool.current_count,
      needCount: carpool.need_count
    });
  }

  res.status(201).json({
    player,
    carpool: updatedCarpool,
    auto_standby: finalStandby && !is_standby,
    message: finalStandby && !is_standby ? '车位已满，已自动加入候补队列' : '报名成功'
  });
});

router.put('/:id', (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) {
    return res.status(404).json({ error: '玩家不存在' });
  }

  const { gender, can_crossplay, arrival_time, note } = req.body;

  db.prepare(`
    UPDATE players SET
      gender = COALESCE(?, gender),
      can_crossplay = COALESCE(?, can_crossplay),
      arrival_time = COALESCE(?, arrival_time),
      note = COALESCE(?, note),
      last_active_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    gender || null,
    can_crossplay !== undefined ? (can_crossplay ? 1 : 0) : null,
    arrival_time !== undefined ? arrival_time : null,
    note !== undefined ? note : null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.post('/:id/cancel', (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) {
    return res.status(404).json({ error: '玩家不存在' });
  }

  const wasStandby = player.is_standby === 1;

  db.prepare(`
    UPDATE players SET status = 'cancelled', last_active_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(req.params.id);

  if (!wasStandby) {
    const nextStandby = db.prepare(`
      SELECT * FROM players 
      WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed'
      ORDER BY last_active_at DESC, standby_order ASC
      LIMIT 1
    `).get(player.carpool_id);

    if (nextStandby) {
      db.prepare(`
        UPDATE players SET is_standby = 0, standby_order = NULL, last_active_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextStandby.id);

      db.prepare(`
        UPDATE players SET standby_order = standby_order - 1
        WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed' AND standby_order > ?
      `).run(player.carpool_id, nextStandby.standby_order);
    }
  }

  const updatedCarpool = getCarpoolWithPlayers(player.carpool_id);
  res.json({
    success: true,
    promoted_player: !wasStandby ? (db.prepare('SELECT * FROM players WHERE id = ?').get(
      db.prepare(`SELECT id FROM players WHERE carpool_id = ? AND is_standby = 0 AND status = 'confirmed' ORDER BY joined_at DESC LIMIT 1`).get(player.carpool_id)?.id
    ) || null) : null,
    carpool: updatedCarpool
  });
});

router.post('/:id/promote', (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) {
    return res.status(404).json({ error: '玩家不存在' });
  }
  if (player.is_standby !== 1) {
    return res.status(400).json({ error: '该玩家不在候补队列中' });
  }

  const oldOrder = player.standby_order;

  db.prepare(`
    UPDATE players SET is_standby = 0, standby_order = NULL, last_active_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  db.prepare(`
    UPDATE players SET standby_order = standby_order - 1
    WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed' AND standby_order > ?
  `).run(player.carpool_id, oldOrder);

  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  const updatedCarpool = getCarpoolWithPlayers(player.carpool_id);

  res.json({ player: updated, carpool: updatedCarpool });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '玩家不存在' });
  }
  res.json({ success: true });
});

module.exports = router;
