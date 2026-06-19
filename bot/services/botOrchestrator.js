const { parseRecruitMessage, parseJoinMessage, isAdminCommand } = require('../../server/services/messageParser');
const reminderService = require('../../server/services/reminderService');
const db = require('../../server/db');
const { v4: uuidv4 } = require('uuid');
const { getCarpoolWithPlayers } = require('../../server/routes/carpools');

const ADMIN_NICKNAMES = (process.env.ADMIN_NICKNAMES || '').split(',').map(n => n.trim()).filter(Boolean);
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

class BotOrchestrator {
  constructor() {
    this.adapters = [];
    this.activeCarpools = new Map();
    this.setupEventListeners();
  }

  registerAdapter(adapter) {
    this.adapters.push(adapter);
    adapter.setOrchestrator(this);
  }

  registerCarpool(groupId, carpoolId) {
    if (!this.activeCarpools.has(groupId)) {
      this.activeCarpools.set(groupId, { list: [], currentIdx: 0 });
    }
    const group = this.activeCarpools.get(groupId);
    const exists = group.list.find(c => c.carpoolId === carpoolId);
    if (!exists) {
      group.list.push({ idx: group.list.length + 1, carpoolId });
    }
    group.currentIdx = group.list.length - 1;
  }

  getCurrentCarpoolId(groupId) {
    const group = this.activeCarpools.get(groupId);
    if (!group || group.list.length === 0) return null;
    return group.list[group.currentIdx].carpoolId;
  }

  switchCarpool(groupId, idxOrNumber) {
    const group = this.activeCarpools.get(groupId);
    if (!group) return null;
    const target = idxOrNumber.idx != null
      ? group.list.find(c => c.idx === idxOrNumber.idx)
      : group.list.find(c => c.carpoolId === idxOrNumber.carpoolId);
    if (!target) return null;
    group.currentIdx = group.list.indexOf(target);
    return target;
  }

  getGroupCarpools(groupId) {
    const group = this.activeCarpools.get(groupId);
    return group ? [...group.list] : [];
  }

  setupEventListeners() {
    reminderService.on('carpool:full', (data) => {
      this.sendLockReminder(data);
    });

    reminderService.on('carpool:upcoming', (data) => {
      this.sendStartReminder(data);
    });

    reminderService.on('standby:promote', (data) => {
      this.sendStandbyPromote(data);
    });
  }

  async start() {
    console.log('[BotOrchestrator] 启动剧本杀拼车机器人...');
    for (const adapter of this.adapters) {
      try {
        await adapter.start();
      } catch (e) {
        console.error(`[BotOrchestrator] 适配器启动失败:`, e.message);
      }
    }
    console.log('[BotOrchestrator] 机器人已就绪');
  }

  async handleMessage(message) {
    const { groupId, groupName, senderId, senderName, text, timestamp } = message;

    console.log(`[Bot] 收到消息 [${groupName || '私聊'}] ${senderName}: ${text.substring(0, 50)}`);

    try {
      const recruitData = parseRecruitMessage(text);
      if (recruitData) {
        return this.handleRecruit({ groupId, groupName, senderId, senderName, ...recruitData });
      }

      const joinData = parseJoinMessage(text, senderName);
      if (joinData && this.getCurrentCarpoolId(groupId)) {
        return this.handleJoin({ groupId, senderId, ...joinData });
      }

      if (this.isAdmin(senderName) && isAdminCommand(text)) {
        return this.handleAdminCommand({ groupId, senderName, text });
      }

      const switchMatch = text.match(/^(切换到|切到|切换)\s*#?\s*第?\s*(\d+)\s*(场|局|个)?$/);
      if (switchMatch) {
        const idx = parseInt(switchMatch[2]);
        return this.handleSwitchCarpool(groupId, idx);
      }

      if (text.trim() === '帮助' || text.trim() === '/help') {
        return this.sendHelpMessage({ groupId });
      }

      if (text.trim() === '列表' || text.trim() === '车位') {
        return this.sendCarpoolList({ groupId });
      }
    } catch (e) {
      console.error('[Bot] 处理消息出错:', e);
    }

    return null;
  }

  isAdmin(nickname) {
    if (ADMIN_NICKNAMES.length === 0) return true;
    return ADMIN_NICKNAMES.includes(nickname);
  }

  async handleRecruit(data) {
    const { groupId, groupName, senderId, senderName, shop_name, script_name, start_time, need_count, role_requirement } = data;

    const id = uuidv4();
    db.prepare(`
      INSERT INTO carpools (id, shop_name, script_name, start_time, need_count, role_requirement, group_id, group_name, owner_nickname, owner_wxid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, shop_name, script_name, start_time, need_count, role_requirement || '', groupId, groupName || '', senderName, senderId || '');

    this.registerCarpool(groupId, id);

    const carpool = getCarpoolWithPlayers(id);
    const groupList = this.getGroupCarpools(groupId);
    const reply = this.formatCarpoolCreatedMessage(carpool, groupList.length);

    this.sendMessage(groupId, reply);

    return { type: 'recruit_created', carpoolId: id, reply };
  }

  async handleJoin(data) {
    const { groupId, senderId, nickname, gender, can_crossplay, arrival_time, note, is_standby } = data;

    const carpoolId = this.getCurrentCarpoolId(groupId);
    if (!carpoolId) {
      return null;
    }

    const carpool = db.prepare('SELECT * FROM carpools WHERE id = ?').get(carpoolId);
    if (!carpool) {
      this.activeCarpools.delete(groupId);
      return null;
    }

    if (carpool.status === 'cancelled') {
      return this.sendMessage(groupId, `❌ ${carpool.script_name} 拼车已取消，无法报名`);
    }

    if (carpool.status === 'locked' && !is_standby) {
      this.sendMessage(groupId, `🔒 ${carpool.script_name} 已锁车，已自动将 ${nickname} 加入候补队列\n\n`);
      return this.handleJoin({ ...data, is_standby: true });
    }

    const existing = db.prepare(`
      SELECT * FROM players 
      WHERE carpool_id = ? AND (nickname = ? OR (wxid IS NOT NULL AND wxid = ?)) AND status = 'confirmed'
    `).get(carpoolId, nickname, senderId || '');

    if (existing) {
      db.prepare(`
        UPDATE players SET 
          gender = COALESCE(NULLIF(?, ''), gender),
          can_crossplay = CASE WHEN ? = 1 THEN 1 ELSE can_crossplay END,
          arrival_time = COALESCE(NULLIF(?, ''), arrival_time),
          note = COALESCE(NULLIF(?, ''), note),
          last_active_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(gender || '', can_crossplay ? 1 : 0, arrival_time || '', note || '', existing.id);

      const updated = getCarpoolWithPlayers(carpoolId);
      const reply = `${nickname}，已更新你的信息\n\n` + this.formatCarpoolStatus(updated);
      this.sendMessage(groupId, reply);
      return { type: 'player_updated', reply };
    }

    const confirmedCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM players WHERE carpool_id = ? AND is_standby = 0 AND status = 'confirmed'
    `).get(carpoolId).cnt;

    const actualStandby = is_standby || (confirmedCount >= carpool.need_count);
    const standbyOrder = actualStandby ? this.getNextStandbyOrder(carpoolId) : null;

    const playerId = uuidv4();
    db.prepare(`
      INSERT INTO players (id, carpool_id, nickname, wxid, gender, can_crossplay, arrival_time, note, is_standby, standby_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      playerId, carpoolId, nickname, senderId || '', gender || '',
      can_crossplay ? 1 : 0,
      arrival_time || '', note || '',
      actualStandby ? 1 : 0,
      standbyOrder
    );

    const updated = getCarpoolWithPlayers(carpoolId);
    let reply = '';

    if (actualStandby && !is_standby) {
      reply = `🚗 ${nickname}，车位已满，已自动加入候补队列（第${standbyOrder}位）\n\n`;
    } else if (is_standby) {
      reply = `⏳ ${nickname}，已加入候补队列（第${standbyOrder}位）\n\n`;
    } else {
      reply = `✅ ${nickname}，报名成功！\n\n`;
    }

    reply += this.formatCarpoolStatus(updated);
    this.sendMessage(groupId, reply);

    if (!actualStandby && updated.current_count >= updated.need_count && !updated.lock_message_sent) {
      this.sendLockReminder({
        carpoolId: carpoolId,
        groupId,
        shopName: updated.shop_name,
        scriptName: updated.script_name,
        startTime: updated.start_time,
        count: updated.current_count,
        needCount: updated.need_count
      });
    }

    return { type: actualStandby ? 'standby_added' : 'player_added', reply, playerId };
  }

  getNextStandbyOrder(carpoolId) {
    const max = db.prepare(`
      SELECT COALESCE(MAX(standby_order), 0) as max_order 
      FROM players 
      WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed'
    `).get(carpoolId);
    return max.max_order + 1;
  }

  async handleAdminCommand(data) {
    const { groupId, senderName, text } = data;
    const carpoolId = this.getCurrentCarpoolId(groupId);

    // 新增：取消上车命令（玩家自己也可用）
    const quitMatch = text.match(/^(取消上车|取消报名|不去了|鸽车|下车|退出)\s*$/i);
    if (quitMatch) {
      if (!carpoolId) return this.sendMessage(groupId, '当前没有进行中的拼车');
      return this.handlePlayerQuit(groupId, carpoolId, senderName, senderId);
    }

    // 新增：修改到店时间/备注
    if (!carpoolId) {
      return null;
    }

    if (text.startsWith('锁车')) {
      if (!carpoolId) return this.sendMessage(groupId, '当前没有进行中的拼车');
      db.prepare("UPDATE carpools SET status = ? WHERE id = ?").run('locked', carpoolId);
      const carpool = getCarpoolWithPlayers(carpoolId);
      return this.sendMessage(groupId, `🔒 ${carpool.script_name} 已锁车！\n\n` + this.formatCarpoolStatus(carpool));
    }

    if (text.startsWith('解锁')) {
      if (!carpoolId) return this.sendMessage(groupId, '当前没有进行中的拼车');
      db.prepare("UPDATE carpools SET status = ? WHERE id = ?").run('recruiting', carpoolId);
      const carpool = getCarpoolWithPlayers(carpoolId);
      return this.sendMessage(groupId, `🔓 ${carpool.script_name} 已解锁，继续招募\n\n` + this.formatCarpoolStatus(carpool));
    }

    if (text.startsWith('取消') || text.startsWith('删除')) {
      if (!carpoolId) return this.sendMessage(groupId, '当前没有进行中的拼车');
      const carpool = getCarpoolWithPlayers(carpoolId);
      db.prepare("UPDATE carpools SET status = ? WHERE id = ?").run('cancelled', carpoolId);
      return this.sendMessage(groupId, `❌ ${carpool.script_name} 已取消`);
    }

    const kickMatch = text.match(/^(踢人|移除|踢)\s*[@]?\s*(.+)$/);
    if (kickMatch) {
      if (!carpoolId) return this.sendMessage(groupId, '当前没有进行中的拼车');
      const targetName = kickMatch[2].trim().replace(/^@/, '').trim();
      return this.handleKickPlayer(groupId, carpoolId, targetName);
    }

    return null;
  }

  async handleKickPlayer(groupId, carpoolId, targetName) {
    const target = db.prepare(`
      SELECT * FROM players 
      WHERE carpool_id = ? AND nickname = ? AND status = 'confirmed'
    `).get(carpoolId, targetName);

    if (!target) {
      return this.sendMessage(groupId, `❌ 找不到玩家「${targetName}」`);
    }

    const wasStandby = target.is_standby === 1;

    db.prepare("UPDATE players SET status = 'cancelled', last_active_at = CURRENT_TIMESTAMP WHERE id = ?").run(target.id);

    let promotedPlayer = null;
    if (!wasStandby) {
      promotedPlayer = this.promoteNextStandby(carpoolId);
    }

    const updated = getCarpoolWithPlayers(carpoolId);

    let msg = wasStandby
      ? `⏳ 已将候补「${targetName}」移出队列\n\n`
      : `👢 已将「${targetName}」移出确认名单\n\n`;

    if (promotedPlayer) {
      msg += `🎊 候补「${promotedPlayer.nickname}」自动转正！\n\n`;
    }

    msg += this.formatCarpoolStatus(updated);
    this.sendMessage(groupId, msg);

    if (promotedPlayer) {
      reminderService.emit('standby:promote', {
        carpoolId,
        player: promotedPlayer,
        shopName: updated.shop_name,
        scriptName: updated.script_name,
        groupId
      });
    }

    return { type: 'player_kicked', targetName, promotedPlayer };
  }

  promoteNextStandby(carpoolId) {
    const nextStandby = db.prepare(`
      SELECT * FROM players 
      WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed'
      ORDER BY last_active_at DESC, standby_order ASC
      LIMIT 1
    `).get(carpoolId);

    if (!nextStandby) return null;

    const oldOrder = nextStandby.standby_order;

    db.prepare(`
      UPDATE players SET is_standby = 0, standby_order = NULL, last_active_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextStandby.id);

    db.prepare(`
      UPDATE players SET standby_order = standby_order - 1
      WHERE carpool_id = ? AND is_standby = 1 AND status = 'confirmed' AND standby_order > ?
    `).run(carpoolId, oldOrder);

    return db.prepare('SELECT * FROM players WHERE id = ?').get(nextStandby.id);
  }

  sendHelpMessage({ groupId }) {
    const help = `🎲 剧本杀拼车助手 使用指南

【群主发车格式】
急招：店名、剧本：XXX、时间：今天19:00、缺5人、角色：3男2女可反串

【玩家报名】
上车 / 报名 / 我来
男生可反串 / 女生不反串
到店20分钟
候补 / 排队
取消上车 / 鸽车 - 退出当前拼车

【多车局操作】
列表 - 查看所有拼车及编号
切换 2 / 切到第2场 - 切换当前场次

【管理命令】
锁车 / 解锁 / 取消
踢人 @玩家名 或 移除 玩家名
帮助 - 显示本说明

📊 车位详情: ${CLIENT_URL}/carpool/{ID}`;
    this.sendMessage(groupId, help);
  }

  sendCarpoolList({ groupId }) {
    const list = this.getGroupCarpools(groupId);
    if (list.length === 0) {
      return this.sendMessage(groupId, '当前没有进行中的拼车');
    }

    const currentId = this.getCurrentCarpoolId(groupId);
    let msg = '📋 当前拼车列表（共' + list.length + '场）：\n\n';
    const sortedByTime = list
      .map(item => ({ ...item, carpool: getCarpoolWithPlayers(item.carpoolId) }))
      .sort((a, b) => new Date(a.carpool.start_time) - new Date(b.carpool.start_time));

    sortedByTime.forEach((entry, i) => {
      const c = entry.carpool;
      if (!c) return;
      const date = new Date(c.start_time);
      const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      const statusTag = c.status === 'locked' ? '🔒' : c.status === 'cancelled' ? '❌' : '🎲';
      const currentTag = c.id === currentId ? ' ← 当前' : '';
      msg += `  #${entry.idx} ${statusTag} ${c.script_name} @ ${c.shop_name}\n`;
      msg += `     ⏰ ${timeStr} | ${c.current_count}/${c.need_count}人${currentTag}\n\n`;
    });

    msg += '发送「切换 2」切换到对应场次';
    this.sendMessage(groupId, msg);
  }

  formatCarpoolCreatedMessage(carpool, idx) {
    const date = new Date(carpool.start_time);
    const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    const idxStr = idx ? ` [#${idx}]` : '';

    return `🎲 新拼车已创建${idxStr}！

📍 店名：${carpool.shop_name}
📖 剧本：${carpool.script_name}
⏰ 时间：${timeStr}
👥 需求：${carpool.need_count}人
${carpool.role_requirement ? `🎭 角色：${carpool.role_requirement}` : ''}

回复「上车」即可报名
🔗 查看详情：${CLIENT_URL}/carpool/${carpool.id}`;
  }

  formatCarpoolStatus(carpool, idx) {
    const date = new Date(carpool.start_time);
    const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    const statusEmoji = carpool.status === 'locked' ? '🔒' : carpool.status === 'cancelled' ? '❌' : '🎲';
    const idxStr = idx ? ` [#${idx}]` : '';

    let msg = `${statusEmoji} ${carpool.script_name}${idxStr} @ ${carpool.shop_name}
⏰ ${timeStr} | ${carpool.current_count}/${carpool.need_count}人\n`;

    if (carpool.confirmed_players.length > 0) {
      msg += `\n✅ 已确认 (${carpool.confirmed_players.length}):\n`;
      carpool.confirmed_players.forEach((p, i) => {
        const info = [
          p.nickname,
          p.gender ? (p.gender + (p.can_crossplay ? '(可反串)' : '')) : '',
          p.arrival_time || ''
        ].filter(Boolean).join(' | ');
        msg += `  ${i + 1}. ${info}\n`;
      });
    }

    if (carpool.standby_players.length > 0) {
      msg += `\n⏳ 候补 (${carpool.standby_players.length}):\n`;
      carpool.standby_players.forEach((p, i) => {
        msg += `  ${p.standby_order || i + 1}. ${p.nickname}\n`;
      });
    }

    if (carpool.remaining_count > 0 && carpool.status === 'recruiting') {
      msg += `\n还差 ${carpool.remaining_count} 人，回复「上车」报名`;
    } else if (carpool.status === 'locked') {
      msg += `\n🔒 已锁车，如需加入请回复「候补」`;
    } else if (carpool.status === 'cancelled') {
      msg += `\n❌ 拼车已取消`;
    }

    msg += `\n🔗 详情：${CLIENT_URL}/carpool/${carpool.id}`;
    return msg;
  }

  sendLockReminder(data) {
    const { groupId, shopName, scriptName, startTime, count, needCount } = data;
    const date = new Date(startTime);
    const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

    const msg = `🎉 【发车提醒】
${scriptName} @ ${shopName}
⏰ ${timeStr}
✅ 已凑齐 ${count}/${needCount} 人！

请群主发送「锁车」确认，或检查人员后发车。`;

    this.sendMessage(groupId, msg);

    try {
      db.prepare('UPDATE carpools SET lock_message_sent = 1 WHERE id = ?').run(data.carpoolId);
    } catch (e) {}
  }

  sendStartReminder(data) {
    const { groupId, shopName, scriptName, startTime, players, minutesBefore } = data;
    const date = new Date(startTime);
    const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

    const playerMentions = players.map(p => `@${p.nickname}`).join(' ');

    const msg = `⏰ 【临开车提醒】
${scriptName} @ ${shopName}
还有 ${minutesBefore} 分钟开始 (${timeStr})

${playerMentions}
请大家准时到店，路上注意安全~`;

    this.sendMessage(groupId, msg);

    try {
      db.prepare('UPDATE carpools SET remind_sent = 1 WHERE id = ?').run(data.carpoolId);
    } catch (e) {}
  }

  sendStandbyPromote(data) {
    const { groupId, player, shopName, scriptName } = data;

    const msg = `🎊 【候补转正】
@${player.nickname} 你有位置啦！
${scriptName} @ ${shopName}

请回复「确认」或直接在群里打招呼，5分钟内未响应将顺位给下一位~`;

    this.sendMessage(groupId, msg);
  }

  sendMessage(groupId, text) {
    for (const adapter of this.adapters) {
      try {
        adapter.sendMessage(groupId, text);
      } catch (e) {
        console.error(`[Bot] 适配器发送消息失败:`, e.message);
      }
    }
  }

  handleSwitchCarpool(groupId, idx) {
    const list = this.getGroupCarpools(groupId);
    if (list.length === 0) {
      return this.sendMessage(groupId, '当前没有进行中的拼车');
    }
    const target = this.switchCarpool(groupId, { idx });
    if (!target) {
      return this.sendMessage(groupId, `❌ 未找到 #${idx} 号拼车，请先发送「列表」查看`);
    }
    const carpool = getCarpoolWithPlayers(target.carpoolId);
    let msg = `✅ 已切换到 #${idx} 场\n\n`;
    msg += this.formatCarpoolStatus(carpool, idx);
    msg += `\n后续上车、锁车、取消等操作将作用到本场`;
    this.sendMessage(groupId, msg);
  }

  handlePlayerQuit(groupId, carpoolId, nickname, wxid) {
    const player = db.prepare(`
      SELECT * FROM players 
      WHERE carpool_id = ? AND status = 'confirmed' AND (nickname = ? OR (wxid AND wxid = ?))
    `).get(carpoolId, nickname, wxid || '');

    if (!player) {
      return this.sendMessage(groupId, `❌ ${nickname} 未在当前拼车名单中`);
    }

    db.prepare("UPDATE players SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(new Date().toISOString(), player.id);

    const carpool = getCarpoolWithPlayers(carpoolId);
    const wasStandby = player.is_standby === 1;
    let promotedMsg = '';
    if (!wasStandby && carpool.current_count < carpool.need_count) {
      const next = this.promoteNextStandby(carpoolId);
      if (next) {
        promotedMsg = `\n\n🎊 【候补转正】@${next.nickname} 你有位置啦！请回复「确认」或直接在群里打招呼~`;
      }
    }
    const updated = getCarpoolWithPlayers(carpoolId);
    const idx = this.getGroupCarpools(groupId).find(c => c.carpoolId === carpoolId)?.idx;
    let msg = `👋 ${nickname} 已退出${wasStandby ? '候补队列' : '确认名单'}\n\n`;
    msg += this.formatCarpoolStatus(updated, idx);
    msg += promotedMsg;
    this.sendMessage(groupId, msg);
  }

  setActiveCarpool(groupId, carpoolId) {
    this.registerCarpool(groupId, carpoolId);
  }

  getActiveCarpool(groupId) {
    return this.getCurrentCarpoolId(groupId);
  }
}

module.exports = BotOrchestrator;
