const express = require('express');

class HttpAdapter {
  constructor(botOrchestrator, port = 4000) {
    this.bot = botOrchestrator;
    this.port = port;
    this.app = express();
    this.messageQueue = [];
    this.setupRoutes();
  }

  setOrchestrator(bot) {
    this.bot = bot;
  }

  setupRoutes() {
    this.app.use(express.json());

    this.app.post('/api/message', async (req, res) => {
      const { group_id, group_name, sender_id, sender_name, text, timestamp } = req.body;

      if (!text) {
        return res.status(400).json({ error: '缺少消息内容' });
      }

      const result = await this.bot.handleMessage({
        groupId: group_id || 'default',
        groupName: group_name || '',
        senderId: sender_id || '',
        senderName: sender_name || '匿名',
        text,
        timestamp: timestamp || Date.now()
      });

      res.json({ success: true, result });
    });

    this.app.get('/api/messages', (req, res) => {
      const since = parseInt(req.query.since || '0');
      const messages = this.messageQueue.filter(m => m.timestamp > since);
      res.json({ messages });
    });

    this.app.post('/api/carpool/set-active', (req, res) => {
      const { group_id, carpool_id } = req.body;
      if (!group_id || !carpool_id) {
        return res.status(400).json({ error: '缺少参数' });
      }
      this.bot.setActiveCarpool(group_id, carpool_id);
      res.json({ success: true });
    });

    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', bot: 'running' });
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`[HttpAdapter] HTTP API 已启动: http://localhost:${this.port}`);
        console.log(`[HttpAdapter] 消息接收: POST http://localhost:${this.port}/api/message`);
        console.log(`[HttpAdapter] 消息轮询: GET  http://localhost:${this.port}/api/messages`);
        resolve();
      });
    });
  }

  sendMessage(groupId, text) {
    this.messageQueue.push({
      id: Date.now() + Math.random(),
      groupId,
      text,
      timestamp: Date.now()
    });

    if (this.messageQueue.length > 1000) {
      this.messageQueue = this.messageQueue.slice(-500);
    }
  }
}

module.exports = HttpAdapter;
