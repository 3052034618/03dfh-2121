const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

const CARPOOL_STATUSES = ['recruiting', 'locked', 'completed', 'cancelled'];

function getCarpoolWithPlayers(id) {
  const carpool = db.prepare('SELECT * FROM carpools WHERE id = ?').get(id);
  if (!carpool) return null;

  const confirmedPlayers = db.prepare(`
    SELECT * FROM players 
    WHERE carpool_id = ? AND is_standby = 0 AND status = 'confirmed'
    ORDER BY joined_at ASC
  `).all(id);

  const standbyPlayers = db.prepare(`
    SELECT * FROM players 
    WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed'
    ORDER BY standby_order ASC, last_active_at DESC
  `).all(id);

  const cancelledPlayers = db.prepare(`
    SELECT * FROM players 
    WHERE carpool_id = ? AND status = 'cancelled'
    ORDER BY joined_at DESC
  `).all(id);

  return {
    ...carpool,
    confirmed_players: confirmedPlayers,
    standby_players: standbyPlayers,
    cancelled_players: cancelledPlayers,
    current_count: confirmedPlayers.length,
    remaining_count: Math.max(0, carpool.need_count - confirmedPlayers.length),
    is_full: confirmedPlayers.length >= carpool.need_count
  };
}

router.get('/', (req, res) => {
  const { status, group_id, limit = 50, offset = 0 } = req.query;

  let query = 'SELECT * FROM carpools WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (group_id) {
    query += ' AND group_id = ?';
    params.push(group_id);
  }

  query += ' ORDER BY start_time DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const carpools = db.prepare(query).all(...params);

  const result = carpools.map(c => getCarpoolWithPlayers(c.id));
  res.json(result);
});

router.get('/:id', (req, res) => {
  const carpool = getCarpoolWithPlayers(req.params.id);
  if (!carpool) {
    return res.status(404).json({ error: '拼车不存在' });
  }
  res.json(carpool);
});

router.post('/', (req, res) => {
  const {
    shop_name,
    script_name,
    start_time,
    need_count,
    role_requirement,
    group_id,
    group_name,
    owner_nickname,
    owner_wxid
  } = req.body;

  if (!shop_name || !script_name || !start_time || !need_count || !group_id || !owner_nickname) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO carpools (id, shop_name, script_name, start_time, need_count, role_requirement, group_id, group_name, owner_nickname, owner_wxid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, shop_name, script_name, start_time, parseInt(need_count), role_requirement || '', group_id, group_name || '', owner_nickname, owner_wxid || '');

  const carpool = getCarpoolWithPlayers(id);
  res.status(201).json(carpool);
});

router.put('/:id', (req, res) => {
  const carpool = db.prepare('SELECT * FROM carpools WHERE id = ?').get(req.params.id);
  if (!carpool) {
    return res.status(404).json({ error: '拼车不存在' });
  }

  const {
    shop_name,
    script_name,
    start_time,
    need_count,
    role_requirement,
    status
  } = req.body;

  db.prepare(`
    UPDATE carpools SET
      shop_name = COALESCE(?, shop_name),
      script_name = COALESCE(?, script_name),
      start_time = COALESCE(?, start_time),
      need_count = COALESCE(?, need_count),
      role_requirement = COALESCE(?, role_requirement),
      status = COALESCE(?, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    shop_name || null,
    script_name || null,
    start_time || null,
    need_count ? parseInt(need_count) : null,
    role_requirement !== undefined ? role_requirement : null,
    status || null,
    req.params.id
  );

  const updated = getCarpoolWithPlayers(req.params.id);
  res.json(updated);
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!CARPOOL_STATUSES.includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }

  const result = db.prepare('UPDATE carpools SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: '拼车不存在' });
  }

  res.json({ success: true, status });
});

router.patch('/:id/lock-notified', (req, res) => {
  db.prepare('UPDATE carpools SET lock_message_sent = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.patch('/:id/remind-notified', (req, res) => {
  db.prepare('UPDATE carpools SET remind_sent = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM carpools WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '拼车不存在' });
  }
  res.json({ success: true });
});

module.exports = router;
module.exports.getCarpoolWithPlayers = getCarpoolWithPlayers;
