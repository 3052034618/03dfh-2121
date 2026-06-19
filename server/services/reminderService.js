const schedule = require('node-schedule');
const db = require('../db');

const REMIND_BEFORE_MINUTES = parseInt(process.env.REMIND_BEFORE_START || '30');

let eventListeners = [];

function on(event, callback) {
  eventListeners.push({ event, callback });
}

function emit(event, data) {
  eventListeners
    .filter(l => l.event === event)
    .forEach(l => l.callback(data));
}

function getActiveCarpools() {
  return db.prepare(`
    SELECT * FROM carpools 
    WHERE status IN ('recruiting', 'locked')
  `).all();
}

function checkFullCarpools() {
  const carpools = db.prepare(`
    SELECT c.*, 
           (SELECT COUNT(*) FROM players p WHERE p.carpool_id = c.id AND p.is_standby = 0 AND p.status = 'confirmed') as confirmed_count
    FROM carpools c
    WHERE c.status = 'recruiting' AND c.lock_message_sent = 0
  `).all();

  carpools.forEach(c => {
    if (c.confirmed_count >= c.need_count) {
      emit('carpool:full', {
        carpoolId: c.id,
        shopName: c.shop_name,
        scriptName: c.script_name,
        startTime: c.start_time,
        groupId: c.group_id,
        count: c.confirmed_count,
        needCount: c.need_count
      });
    }
  });
}

function checkUpcomingCarpools() {
  const now = new Date();
  const REMIND_MINUTES = parseInt(process.env.REMIND_BEFORE_START || '30');
  const WINDOW_BEFORE = Math.max(1, REMIND_MINUTES - 25);
  const WINDOW_AFTER = REMIND_MINUTES + 5;
  const windowStart = new Date(now.getTime() + WINDOW_BEFORE * 60 * 1000);
  const windowEnd = new Date(now.getTime() + WINDOW_AFTER * 60 * 1000);

  const carpools = db.prepare(`
    SELECT * FROM carpools 
    WHERE status IN ('recruiting', 'locked') 
      AND remind_sent = 0
      AND start_time >= ?
      AND start_time <= ?
  `).all(windowStart.toISOString(), windowEnd.toISOString());

  carpools.forEach(c => {
    const players = db.prepare(`
      SELECT * FROM players 
      WHERE carpool_id = ? AND is_standby = 0 AND status = 'confirmed'
    `).all(c.id);

    const diffMinutes = Math.round((new Date(c.start_time) - now) / 60000);

    emit('carpool:upcoming', {
      carpoolId: c.id,
      shopName: c.shop_name,
      scriptName: c.script_name,
      startTime: c.start_time,
      groupId: c.group_id,
      players,
      minutesBefore: Math.max(1, Math.round(diffMinutes))
    });
  });
}

function checkStandbyPromotion(carpoolId) {
  const carpool = db.prepare('SELECT * FROM carpools WHERE id = ?').get(carpoolId);
  if (!carpool) return;

  const confirmedCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM players WHERE carpool_id = ? AND is_standby = 0 AND status = 'confirmed'
  `).get(carpoolId).cnt;

  if (confirmedCount < carpool.need_count) {
    const nextStandby = db.prepare(`
      SELECT * FROM players 
      WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed'
      ORDER BY last_active_at DESC, standby_order ASC
      LIMIT 1
    `).get(carpoolId);

    if (nextStandby) {
      emit('standby:promote', {
        carpoolId,
        player: nextStandby,
        shopName: carpool.shop_name,
        scriptName: carpool.script_name,
        groupId: carpool.group_id
      });
    }
  }
}

function start() {
  schedule.scheduleJob('*/30 * * * * *', () => {
    checkFullCarpools();
  });

  schedule.scheduleJob('0 * * * * *', () => {
    checkUpcomingCarpools();
  });

  console.log(`[ReminderService] 提醒服务已启动，临开车提醒: ${REMIND_BEFORE_MINUTES}分钟前`);
}

function stop() {
  schedule.gracefulShutdown();
}

module.exports = {
  start,
  stop,
  on,
  emit,
  checkFullCarpools,
  checkUpcomingCarpools,
  checkStandbyPromotion
};
