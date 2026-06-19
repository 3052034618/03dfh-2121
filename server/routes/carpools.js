const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { parseTimeString } = require('../services/messageParser');
const reminderService = require('../services/reminderService');

const router = express.Router();

function validateCarpoolInput(data, { isUpdate = false } = {}) {
  const errors = [];

  if (!isUpdate || data.shop_name !== undefined) {
    if (!data.shop_name || !String(data.shop_name).trim()) errors.push('店名不能为空');
    else if (String(data.shop_name).length > 50) errors.push('店名不能超过50字');
  }
  if (!isUpdate || data.script_name !== undefined) {
    if (!data.script_name || !String(data.script_name).trim()) errors.push('剧本名称不能为空');
    else if (String(data.script_name).length > 80) errors.push('剧本名不能超过80字');
  }
  if (!isUpdate || data.need_count !== undefined) {
    const nc = parseInt(data.need_count);
    if (!Number.isFinite(nc) || nc <= 0) errors.push('缺人数必须大于0');
    else if (nc > 30) errors.push('缺人数不能超过30人');
  }
  if (!isUpdate || data.start_time !== undefined) {
    let startTime = data.start_time;
    if (startTime && typeof startTime === 'string' && /[今明后]天|\d月\d日/.test(startTime)) {
      startTime = parseTimeString(startTime);
    }
    if (!startTime) {
      if (!isUpdate) errors.push('发车时间不能为空或格式错误');
    } else {
      const t = new Date(startTime).getTime();
      if (Number.isNaN(t)) errors.push('发车时间格式错误');
      else if (t < Date.now() - 60 * 60 * 1000) errors.push('发车时间不能早于1小时前');
      else if (t > Date.now() + 365 * 24 * 60 * 60 * 1000) errors.push('发车时间不能超过1年后');
    }
  }
  if (data.role_requirement !== undefined && String(data.role_requirement).length > 200) {
    errors.push('角色要求不能超过200字');
  }

  return errors;
}

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
    ORDER BY last_active_at DESC, standby_order ASC
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

  const errors = validateCarpoolInput(req.body);
  if (!group_id || !group_id.trim()) errors.push('缺少group_id');
  if (!owner_nickname || !String(owner_nickname).trim()) errors.push('群主昵称不能为空');
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('；') });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO carpools (id, shop_name, script_name, start_time, need_count, role_requirement, group_id, group_name, owner_nickname, owner_wxid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, String(shop_name).trim(), String(script_name).trim(),
    start_time,
    parseInt(need_count),
    role_requirement || '',
    group_id, String(group_name || '').trim(),
    String(owner_nickname).trim(), owner_wxid || '');

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

  const errors = validateCarpoolInput(req.body, { isUpdate: true });
  if (status && !CARPOOL_STATUSES.includes(status)) errors.push('无效的状态值');
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('；') });
  }

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
    shop_name ? String(shop_name).trim() : null,
    script_name ? String(script_name).trim() : null,
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

router.get('/groups/summary', (req, res) => {
  const { days = 30 } = req.query;
  const cutoffMs = Date.now() - parseInt(days) * 24 * 60 * 60 * 1000;

  const all = db.prepare('SELECT * FROM carpools ORDER BY created_at DESC').all();

  const groupMap = new Map();

  for (const c of all) {
    const createdMs = new Date(c.created_at).getTime();
    const startMs = new Date(c.start_time).getTime();
    if (createdMs < cutoffMs && startMs < cutoffMs) continue;

    const gid = c.group_id || '未分组';
    if (!groupMap.has(gid)) {
      groupMap.set(gid, {
        group_id: gid,
        group_name: c.group_name || gid,
        total: 0,
        recruiting: 0,
        locked: 0,
        cancelled: 0,
        completed: 0,
        carpools: []
      });
    }
    const g = groupMap.get(gid);
    g.total++;
    if (c.status === 'recruiting') g.recruiting++;
    else if (c.status === 'locked') g.locked++;
    else if (c.status === 'cancelled') g.cancelled++;
    else if (c.status === 'completed') g.completed++;

    const playerCount = db.prepare('SELECT COUNT(*) AS cnt FROM players WHERE carpool_id = ? AND status = ?')
      .get(c.id, 'confirmed').cnt;
    g.carpools.push({
      id: c.id,
      shop_name: c.shop_name,
      script_name: c.script_name,
      start_time: c.start_time,
      need_count: c.need_count,
      confirmed_count: playerCount,
      status: c.status
    });
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const aActive = a.recruiting + a.locked;
    const bActive = b.recruiting + b.locked;
    if (aActive !== bActive) return bActive - aActive;
    return b.total - a.total;
  });

  res.json({ groups, generated_at: new Date().toISOString() });
});

module.exports = router;
module.exports.getCarpoolWithPlayers = getCarpoolWithPlayers;
