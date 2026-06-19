require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BotOrchestrator = require('./services/botOrchestrator');
const HttpAdapter = require('./adapters/httpAdapter');

const bot = new BotOrchestrator();

const httpPort = parseInt(process.env.BOT_HTTP_PORT || '4000');
const httpAdapter = new HttpAdapter(bot, httpPort);
bot.registerAdapter(httpAdapter);

try {
  const WechatyAdapter = require('./adapters/wechatyAdapter');
  const wechatyAdapter = new WechatyAdapter(bot);
  bot.registerAdapter(wechatyAdapter);
} catch (e) {
  console.log('[Bot] WeChaty 适配器未安装，仅启用 HTTP API 模式');
  console.log('[Bot] 如需启用微信机器人，请执行: npm install wechaty wechaty-puppet-wechat4u');
}

bot.start();
