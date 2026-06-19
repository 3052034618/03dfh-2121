let Wechaty, MessageType;

try {
  ({ Wechaty, MessageType } = require('wechaty'));
} catch (e) {
  throw new Error('WeChaty 未安装，请执行: npm install wechaty wechaty-puppet-wechat4u');
}

class WechatyAdapter {
  constructor(botOrchestrator) {
    this.bot = botOrchestrator;
    this.botInstance = null;
  }

  setOrchestrator(bot) {
    this.bot = bot;
  }

  async start() {
    this.botInstance = new Wechaty({
      name: process.env.BOT_NAME || 'jubensha-bot',
      puppet: process.env.WECHATY_PUPPET || undefined
    });

    this.botInstance
      .on('scan', (qrcode, status) => {
        console.log(`[WeChaty] 扫码登录: https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`);
        console.log(`[WeChaty] 状态: ${status}`);
      })
      .on('login', (user) => {
        console.log(`[WeChaty] 登录成功: ${user.name()}`);
      })
      .on('logout', (user) => {
        console.log(`[WeChaty] 登出: ${user.name()}`);
      })
      .on('message', this.handleWechatMessage.bind(this))
      .on('error', (e) => {
        console.error('[WeChaty] 错误:', e);
      });

    await this.botInstance.start();
    console.log('[WeChatyAdapter] WeChaty 机器人已启动');
  }

  async handleWechatMessage(msg) {
    if (msg.self()) return;

    const room = msg.room();
    if (!room) return;

    const text = msg.text();
    const talker = msg.talker();

    const groupId = room.id;
    const groupName = await room.topic().catch(() => '');
    const senderId = talker.id;
    const senderName = talker.name() || talker.payload?.alias || '匿名';

    await this.bot.handleMessage({
      groupId,
      groupName,
      senderId,
      senderName,
      text,
      timestamp: msg.date().getTime()
    });
  }

  async sendMessage(groupId, text) {
    if (!this.botInstance) return;

    try {
      const room = await this.botInstance.Room.find({ id: groupId });
      if (room) {
        await room.say(text);
      }
    } catch (e) {
      console.error('[WeChaty] 发送消息失败:', e.message);
    }
  }
}

module.exports = WechatyAdapter;
