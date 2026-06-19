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
      if (joinData && this.activeCarpools.has(groupId)) {
        return this.handleJoin({ groupId, senderId, ...joinData });
      }

      if (this.isAdmin(senderName) && isAdminCommand(text)) {
        return this.handleAdminCommand({ groupId, senderName, text });
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

    this.activeCarpools.set(groupId, id);

    const carpool = getCarpoolWithPlayers(id);
    const reply = this.formatCarpoolCreatedMessage(carpool);

    this.sendMessage(groupId, reply);

    return { type: 'recruit_created', carpoolId: id, reply };
  }

  async handleJoin(data) {
    const { groupId, senderId, nickname, gender, can_crossplay, arrival_time, note, is_standby } = data;

    const carpoolId = this.activeCarpools.get(groupId);
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
    const carpoolId = this.activeCarpools.get(groupId);

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

【管理命令】
锁车 / 解锁 / 取消
踢人 @玩家名 或 移除 玩家名
列表 - 查看当前拼车
帮助 - 显示本说明

📊 车位详情: ${CLIENT_URL}/carpool/{ID}`;
    this.sendMessage(groupId, help);
  }

  sendCarpoolList({ groupId }) {
    const carpoolId = this.activeCarpools.get(groupId);
    if (!carpoolId) {
      return this.sendMessage(groupId, '当前没有进行中的拼车');
    }
    const carpool = getCarpoolWithPlayers(carpoolId);
    this.sendMessage(groupId, this.formatCarpoolStatus(carpool));
  }

  formatCarpoolCreatedMessage(carpool) {
    const date = new Date(carpool.start_time);
    const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

    return `🎲 新拼车已创建！

📍 店名：${carpool.shop_name}
📖 剧本：${carpool.script_name}
⏰ 时间：${timeStr}
👥 需求：${carpool.need_count}人
${carpool.role_requirement ? `🎭 角色：${carpool.role_requirement}` : ''}

回复「上车」即可报名
🔗 查看详情：${CLIENT_URL}/carpool/${carpool.id}`;
  }

  formatCarpoolStatus(carpool) {
    const date = new Date(carpool.start_time);
    const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    const statusEmoji = carpool.status === 'locked' ? '🔒' : carpool.status === 'cancelled' ? '❌' : '🎲';

    let msg = `${statusEmoji} ${carpool.script_name} @ ${carpool.shop_name}
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

  setActiveCarpool(groupId, carpoolId) {
    this.activeCarpools.set(groupId, carpoolId);
  }

  getActiveCarpool(groupId) {
    return this.activeCarpools.get(groupId);
  }
}

module.exports = BotOrchestrator;
