const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'jubensha.json');

const DEFAULT_DATA = {
  carpools: [],
  players: [],
  messages: [],
  _meta: { version: 1 }
};

let data = null;
let saveTimer = null;

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf-8');
      data = JSON.parse(raw);
      if (!data.carpools) data.carpools = [];
      if (!data.players) data.players = [];
      if (!data.messages) data.messages = [];
    } catch (e) {
      console.error('[DB] 数据文件损坏，使用备份或默认数据:', e.message);
      data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  } else {
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    saveDataSync();
  }
}

function saveDataSync() {
  ensureDataDir();
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, dbPath);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveDataSync();
    } catch (e) {
      console.error('[DB] 保存失败:', e.message);
    }
  }, 100);
}

loadData();

class Statement {
  constructor(tableName, operation, queryFn) {
    this.tableName = tableName;
    this.operation = operation;
    this.queryFn = queryFn;
  }

  all(...params) {
    if (!data) loadData();
    return this.queryFn(data, ...params) || [];
  }

  get(...params) {
    if (!data) loadData();
    const result = this.queryFn(data, ...params);
    return Array.isArray(result) ? result[0] : result;
  }

  run(...params) {
    if (!data) loadData();
    const result = this.queryFn(data, ...params);
    scheduleSave();
    return result || { changes: 0, lastInsertRowid: null };
  }
}

const db = {
  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const trimmed = normalized.toLowerCase();

    if (trimmed.startsWith('select')) {
      return buildSelectStatement(normalized);
    }
    if (trimmed.startsWith('insert')) {
      return buildInsertStatement(normalized);
    }
    if (trimmed.startsWith('update')) {
      return buildUpdateStatement(normalized);
    }
    if (trimmed.startsWith('delete')) {
      return buildDeleteStatement(normalized);
    }
    if (trimmed.startsWith('create') || trimmed.startsWith('pragma')) {
      return new Statement(null, 'noop', () => ({ changes: 0 }));
    }

    console.warn('[DB] 未支持的 SQL:', sql);
    return new Statement(null, 'noop', () => ({}));
  },

  exec(sql) {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      this.prepare(stmt).run();
    }
  },

  pragma() {
    return null;
  }
};

function buildSelectStatement(sql) {
  if (sql.includes('SELECT COUNT(*)')) {
    if (sql.includes('FROM players WHERE carpool_id = ? AND is_standby = ? AND status = ?')) {
      return new Statement('players', 'select', (db, carpoolId, isStandby, status) => {
        const cnt = db.players.filter(p =>
          p.carpool_id === carpoolId &&
          p.is_standby === isStandby &&
          p.status === status
        ).length;
        return [{ cnt }];
      });
    }
    if (sql.includes('SELECT COUNT(*)') && sql.includes('FROM players')) {
      return new Statement('players', 'select', (db, carpoolId) => {
        const cnt = db.players.filter(p => p.carpool_id === carpoolId && p.is_standby === 0 && p.status === 'confirmed').length;
        return [{ cnt }];
      });
    }
  }

  if (sql.includes('SELECT COALESCE(MAX(standby_order), 0)') && sql.includes('FROM players')) {
    return new Statement('players', 'select', (db, carpoolId) => {
      const players = db.players.filter(p =>
        p.carpool_id === carpoolId && p.is_standby === 1 && p.status === 'confirmed'
      );
      const max = players.length > 0 ? Math.max(...players.map(p => p.standby_order || 0)) : 0;
      return [{ max_order: max }];
    });
  }

  if (sql.includes('SELECT * FROM carpools WHERE id = ?')) {
    return new Statement('carpools', 'select', (db, id) =>
      db.carpools.find(c => c.id === id)
    );
  }

  if (sql.includes('SELECT * FROM carpools') && sql.includes('remind_sent = 0')) {
    return new Statement('carpools', 'select', (db, time1, time2) => {
      return db.carpools.filter(c => {
        if (!['recruiting', 'locked'].includes(c.status)) return false;
        if (c.remind_sent === 1 || c.remind_sent === true) return false;
        const t = new Date(c.start_time).getTime();
        return t >= new Date(time1).getTime() && t <= new Date(time2).getTime();
      });
    });
  }

  if (sql.includes('SELECT * FROM carpools WHERE status IN') && sql.includes('SELECT')) {
    return new Statement('carpools', 'select', (db) =>
      db.carpools.filter(c => ['recruiting', 'locked'].includes(c.status))
    );
  }

  if (sql.includes('SELECT * FROM carpools') && sql.includes('WHERE status = ?') && sql.includes('lock_message_sent = 0')) {
    return new Statement('carpools', 'select', (db) => {
      return db.carpools.filter(c => c.status === 'recruiting' && (c.lock_message_sent === 0 || c.lock_message_sent === false))
        .map(c => {
          const confirmedCount = db.players.filter(p => p.carpool_id === c.id && p.is_standby === 0 && p.status === 'confirmed').length;
          return { ...c, confirmed_count: confirmedCount };
        });
    });
  }

  if (sql.includes('SELECT * FROM carpools WHERE 1=1')) {
    return new Statement('carpools', 'select', (db, ...args) => {
      const hasStatusCond = sql.includes('AND status = ?');
      const hasGroupCond = sql.includes('AND group_id = ?');
      const nums = args.filter(a => typeof a === 'number');
      const strs = args.filter(a => typeof a === 'string');
      let status = null, groupId = null;
      let strIdx = 0;
      if (hasStatusCond) { status = strs[strIdx]; strIdx++; }
      if (hasGroupCond) { groupId = strs[strIdx]; strIdx++; }
      let limit = 50, offset = 0;
      if (nums.length >= 2) {
        limit = nums[nums.length - 2];
        offset = nums[nums.length - 1];
      } else if (nums.length === 1) {
        limit = nums[0];
      }

      let result = [...db.carpools];
      if (status && status !== 'all') {
        result = result.filter(c => c.status === status);
      }
      if (groupId && groupId !== 'all') {
        result = result.filter(c => c.group_id === groupId);
      }
      result.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
      return result.slice(offset || 0, (offset || 0) + (limit || 50));
    });
  }

  if (sql.includes('SELECT * FROM carpools ORDER BY created_at')) {
    return new Statement('carpools', 'select', (db, ...args) => {
      let result = [...db.carpools];
      if (sql.includes('DESC')) {
        result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      } else {
        result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }
      const nums = args.filter(a => typeof a === 'number');
      if (nums.length >= 2) {
        const [limit, offset] = [nums[nums.length - 2], nums[nums.length - 1]];
        return result.slice(offset, offset + limit);
      }
      return result;
    });
  }

  if (sql.includes('SELECT * FROM players WHERE id = ?')) {
    return new Statement('players', 'select', (db, id) =>
      db.players.find(p => p.id === id)
    );
  }

  if (sql.includes('SELECT * FROM players WHERE carpool_id = ?') && sql.includes("status = 'confirmed'") && !sql.includes('is_standby')) {
    return new Statement('players', 'select', (db, carpoolId) =>
      db.players.filter(p => p.carpool_id === carpoolId && p.status === 'confirmed')
    );
  }

  if (sql.includes('SELECT * FROM players WHERE carpool_id = ?') && sql.includes('is_standby = 0') && (sql.includes("status = 'confirmed'") || sql.includes('status = ?'))) {
    return new Statement('players', 'select', (db, carpoolId) =>
      db.players.filter(p => p.carpool_id === carpoolId && p.is_standby === 0 && p.status === 'confirmed')
        .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at))
    );
  }

  if (sql.includes('SELECT * FROM players WHERE carpool_id = ?') && sql.includes('is_standby = 1') && (sql.includes("status = 'confirmed'") || sql.includes('status = ?'))) {
    return new Statement('players', 'select', (db, carpoolId) =>
      db.players.filter(p => p.carpool_id === carpoolId && p.is_standby === 1 && p.status === 'confirmed')
        .sort((a, b) => {
          const activeDiff = new Date(b.last_active_at) - new Date(a.last_active_at);
          if (activeDiff !== 0) return activeDiff;
          return (a.standby_order || 0) - (b.standby_order || 0);
        })
    );
  }

  if (sql.includes('SELECT * FROM players WHERE carpool_id = ?') && sql.includes('LIMIT 1')) {
    return new Statement('players', 'select', (db, carpoolId) => {
      const list = db.players.filter(p =>
        p.carpool_id === carpoolId && p.is_standby === 1 && p.status === 'confirmed'
      ).sort((a, b) => {
        const activeDiff = new Date(b.last_active_at) - new Date(a.last_active_at);
        if (activeDiff !== 0) return activeDiff;
        return (a.standby_order || 0) - (b.standby_order || 0);
      });
      return list.slice(0, 1);
    });
  }

  if (sql.includes('SELECT id FROM players WHERE carpool_id = ?')) {
    return new Statement('players', 'select', (db, carpoolId) => {
      const list = db.players.filter(p => p.carpool_id === carpoolId && p.is_standby === 0 && p.status === 'confirmed')
        .sort((a, b) => new Date(b.joined_at) - new Date(a.joined_at));
      return list.slice(0, 1);
    });
  }

  if (sql.includes('SELECT * FROM players') && sql.includes('WHERE carpool_id = ? AND nickname = ?')) {
    return new Statement('players', 'select', (db, carpoolId, nickname) =>
      db.players.find(p =>
        p.carpool_id === carpoolId && p.nickname === nickname && p.status === 'confirmed'
      )
    );
  }

  if (sql.includes('SELECT * FROM players') && sql.includes('WHERE carpool_id = ? AND (nickname = ?')) {
    return new Statement('players', 'select', (db, carpoolId, nickname, wxid) =>
      db.players.find(p =>
        p.carpool_id === carpoolId && p.status === 'confirmed' &&
        (p.nickname === nickname || (p.wxid && p.wxid === wxid))
      )
    );
  }

  if (sql.includes('SELECT * FROM players') && sql.includes('status = \'cancelled\'')) {
    return new Statement('players', 'select', (db, carpoolId) =>
      db.players.filter(p => p.carpool_id === carpoolId && p.status === 'cancelled')
        .sort((a, b) => new Date(b.joined_at) - new Date(a.joined_at))
    );
  }

  if (sql.includes('SELECT * FROM players') && sql.includes('ORDER BY is_standby')) {
    return new Statement('players', 'select', (db, carpoolId) => {
      const confirmed = db.players.filter(p => p.carpool_id === carpoolId && p.is_standby === 0 && p.status === 'confirmed')
        .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));
      const standby = db.players.filter(p => p.carpool_id === carpoolId && p.is_standby === 1 && p.status === 'confirmed')
        .sort((a, b) => {
          const activeDiff = new Date(b.last_active_at) - new Date(a.last_active_at);
          if (activeDiff !== 0) return activeDiff;
          return (a.standby_order || 0) - (b.standby_order || 0);
        });
      return [...confirmed, ...standby];
    });
  }

  console.warn('[DB] 未匹配的 SELECT:', sql.substring(0, 100));
  return new Statement(null, 'select', () => []);
}

function buildInsertStatement(sql) {
  if (sql.includes('INSERT INTO carpools')) {
    return new Statement('carpools', 'insert', (db, id, shop_name, script_name, start_time, need_count, role_requirement, group_id, group_name, owner_nickname, owner_wxid) => {
      const now = new Date().toISOString();
      const carpool = {
        id, shop_name, script_name, start_time, need_count: parseInt(need_count), role_requirement,
        group_id, group_name, owner_nickname, owner_wxid,
        status: 'recruiting',
        lock_message_sent: 0,
        remind_sent: 0,
        created_at: now,
        updated_at: now
      };
      db.carpools.push(carpool);
      return { changes: 1, lastInsertRowid: id };
    });
  }

  if (sql.includes('INSERT INTO players')) {
    return new Statement('players', 'insert', (db, id, carpool_id, nickname, wxid, gender, can_crossplay, arrival_time, note, is_standby, standby_order) => {
      const now = new Date().toISOString();
      const player = {
        id, carpool_id, nickname, wxid, gender, can_crossplay, arrival_time, note,
        is_standby, standby_order,
        status: 'confirmed',
        last_active_at: now,
        joined_at: now
      };
      db.players.push(player);
      return { changes: 1, lastInsertRowid: id };
    });
  }

  console.warn('[DB] 未匹配的 INSERT:', sql.substring(0, 100));
  return new Statement(null, 'insert', () => ({ changes: 0 }));
}

function buildUpdateStatement(sql) {
  if (sql.includes('UPDATE carpools SET') && sql.includes('WHERE id = ?') && sql.includes('COALESCE')) {
    return new Statement('carpools', 'update', (db, shop_name, script_name, start_time, need_count, role_requirement, status, id) => {
      const c = db.carpools.find(c => c.id === id);
      if (!c) return { changes: 0 };
      if (shop_name !== null && shop_name !== undefined) c.shop_name = shop_name;
      if (script_name !== null && script_name !== undefined) c.script_name = script_name;
      if (start_time !== null && start_time !== undefined) c.start_time = start_time;
      if (need_count !== null && need_count !== undefined) c.need_count = parseInt(need_count);
      if (role_requirement !== null && role_requirement !== undefined) c.role_requirement = role_requirement;
      if (status !== null && status !== undefined) c.status = status;
      c.updated_at = new Date().toISOString();
      return { changes: 1 };
    });
  }

  if (sql.includes('UPDATE carpools SET status = ?')) {
    return new Statement('carpools', 'update', (db, status, id) => {
      const c = db.carpools.find(c => c.id === id);
      if (!c) return { changes: 0 };
      c.status = status;
      c.updated_at = new Date().toISOString();
      return { changes: 1 };
    });
  }

  if (sql.includes('UPDATE carpools SET lock_message_sent = 1')) {
    return new Statement('carpools', 'update', (db, id) => {
      const c = db.carpools.find(c => c.id === id);
      if (!c) return { changes: 0 };
      c.lock_message_sent = 1;
      return { changes: 1 };
    });
  }

  if (sql.includes('UPDATE carpools SET remind_sent = 1')) {
    return new Statement('carpools', 'update', (db, id) => {
      const c = db.carpools.find(c => c.id === id);
      if (!c) return { changes: 0 };
      c.remind_sent = 1;
      return { changes: 1 };
    });
  }

  if (sql.includes('UPDATE players SET') && sql.includes('gender = COALESCE')) {
    return new Statement('players', 'update', (db, gender, can_crossplay, arrival_time, note, id) => {
      const p = db.players.find(p => p.id === id);
      if (!p) return { changes: 0 };
      if (gender !== null && gender !== undefined && gender !== '') p.gender = gender;
      if (can_crossplay !== null && can_crossplay !== undefined) p.can_crossplay = can_crossplay ? 1 : 0;
      if (arrival_time !== null && arrival_time !== undefined && arrival_time !== '') p.arrival_time = arrival_time;
      if (note !== null && note !== undefined && note !== '') p.note = note;
      p.last_active_at = new Date().toISOString();
      return { changes: 1 };
    });
  }

  if (sql.includes('UPDATE players SET status = \'cancelled\'')) {
    return new Statement('players', 'update', (db, cancelledAt, id) => {
      const p = db.players.find(p => p.id === id);
      if (!p) return { changes: 0 };
      p.status = 'cancelled';
      p.cancelled_at = cancelledAt;
      p.last_active_at = new Date().toISOString();
      return { changes: 1 };
    });
  }

  if (sql.includes('UPDATE players SET is_standby = 0, standby_order = NULL')) {
    return new Statement('players', 'update', (db, id) => {
      const p = db.players.find(p => p.id === id);
      if (!p) return { changes: 0 };
      p.is_standby = 0;
      p.standby_order = null;
      p.last_active_at = new Date().toISOString();
      return { changes: 1 };
    });
  }

  if (sql.includes('UPDATE players SET standby_order = standby_order - 1')) {
    return new Statement('players', 'update', (db, carpoolId, minOrder) => {
      let count = 0;
      db.players.forEach(p => {
        if (p.carpool_id === carpoolId && p.is_standby === 1 && p.status === 'confirmed' && p.standby_order > minOrder) {
          p.standby_order = (p.standby_order || 0) - 1;
          count++;
        }
      });
      return { changes: count };
    });
  }

  console.warn('[DB] 未匹配的 UPDATE:', sql.substring(0, 100));
  return new Statement(null, 'update', () => ({ changes: 0 }));
}

function buildDeleteStatement(sql) {
  if (sql.includes('DELETE FROM carpools WHERE id = ?')) {
    return new Statement('carpools', 'delete', (db, id) => {
      const idx = db.carpools.findIndex(c => c.id === id);
      if (idx === -1) return { changes: 0 };
      db.carpools.splice(idx, 1);
      db.players = db.players.filter(p => p.carpool_id !== id);
      return { changes: 1 };
    });
  }

  if (sql.includes('DELETE FROM players WHERE id = ?')) {
    return new Statement('players', 'delete', (db, id) => {
      const idx = db.players.findIndex(p => p.id === id);
      if (idx === -1) return { changes: 0 };
      db.players.splice(idx, 1);
      return { changes: 1 };
    });
  }

  console.warn('[DB] 未匹配的 DELETE:', sql.substring(0, 100));
  return new Statement(null, 'delete', () => ({ changes: 0 }));
}

module.exports = db;
module.exports._saveSync = saveDataSync;
module.exports._getData = () => data;
