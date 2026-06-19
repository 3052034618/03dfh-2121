# 🎲 剧本杀拼车机器人

面向剧本杀社群群主和拼车车头的微信群消息整理机器人，把临开车急招从刷屏聊天变成可管理的车位清单。

## ✨ 核心功能

- **自动识别急招消息**：群主按格式发车，机器人自动识别并生成车位清单
- **玩家报名汇总**：玩家在群里回复「上车」「男生可反串」等自动加入名单
- **车位状态实时更新**：进度条展示当前人数，满员自动提醒
- **候补队列管理**：人满自动进入候补，有人鸽车时按顺位自动转正
- **临开车提醒**：发车前自动 @ 所有人提醒到店
- **两个 Web 页面**：车位详情页（公开）+ 群主管理台（管理所有拼车）

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装依赖

```bash
# 安装后端和机器人依赖
npm install

# 安装前端依赖
cd client && npm install && cd ..
```

或者一键安装：
```bash
npm run install:all
```

### 配置

复制环境变量文件：
```bash
cp .env.example .env
```

编辑 `.env` 文件：
```env
# 服务端口
PORT=3000

# 机器人名称
BOT_NAME=剧本杀拼车助手

# 群主微信昵称（多个用英文逗号分隔）
ADMIN_NICKNAMES=群主,管理员

# 临开车提前多少分钟提醒
REMIND_BEFORE_START=30

# 前端访问地址（用于群里分享链接）
CLIENT_URL=http://localhost:3000
```

### 启动服务

#### 方式一：开发模式（推荐）

分别启动三个终端：

```bash
# 终端1：启动后端 API 服务
npm run dev

# 终端2：启动前端开发服务器
npm run client

# 终端3：启动机器人服务
npm run bot
```

#### 方式二：生产模式

先构建前端：
```bash
cd client && npm run build && cd ..
```

然后启动后端（内置前端静态文件）和机器人：
```bash
# 启动 API + 前端页面
npm start

# 另一个终端启动机器人
npm run bot
```

访问：
- 首页：http://localhost:3000
- 群主管理台：http://localhost:3000/#/admin
- API 健康检查：http://localhost:3000/api/health

## 📱 微信群使用指南

### 群主发车格式

在群里发送以下任一格式的消息即可创建拼车：

**格式一（推荐）：**
```
急招：推理俱乐部、剧本：雾鸦馆、时间：今天19:00、缺6人、角色：3男3女可反串
```

**格式二（换行更清晰）：**
```
急招
店名：推理俱乐部
剧本：雾鸦馆
时间：6月20日19:00
缺6人
角色要求：3男3女可反串
```

**格式三（简洁版）：**
```
急招 推理俱乐部 雾鸦馆 今天19:00 缺6人 3男3女
```

机器人会自动回复报名入口和车位详情链接。

### 玩家报名指令

在群里回复以下消息即可自动加入名单：

| 指令示例 | 说明 |
|---------|------|
| `上车` | 直接报名 |
| `报名` | 同上 |
| `男生可反串` | 报名并说明性别+可反串 |
| `女生不反串` | 报名并说明性别 |
| `到店20分钟` | 报名并说明到店时间 |
| `男生 到店15分钟` | 组合指令 |
| `候补` | 直接加入候补队列 |
| `排队` | 同上 |

### 管理命令

仅群主/管理员可用：

| 命令 | 说明 |
|-----|------|
| `锁车` | 锁定当前拼车，停止自动招募 |
| `解锁` | 解锁继续招募 |
| `取消` / `删除` | 取消当前拼车 |
| `列表` / `车位` | 查看当前拼车状态 |
| `帮助` | 显示使用说明 |

## 🌐 Web 页面

### 车位详情页（公开）

路径：`/#/carpool/{拼车ID}`

功能：
- 查看拼车基本信息（店名、剧本、时间、角色要求）
- 查看已确认玩家列表（含性别、到店时间、备注）
- 查看候补队列
- 实时进度条展示
- 每 15 秒自动刷新

### 群主管理台

路径：`/#/admin`

功能：
- 查看所有拼车列表（按状态筛选：招募中/已锁车/全部）
- 手动创建拼车
- 编辑拼车信息（时间、人数、角色等）
- 添加/移除玩家
- 候补手动转正
- 锁车/解锁/标记完成/删除拼车

## 🔌 机器人集成方式

### 方式一：WeChaty（推荐，真·微信群机器人）

需要额外安装：
```bash
npm install wechaty wechaty-puppet-wechat4u
```

启动 `npm run bot` 后扫码登录即可。

> ⚠️ 注意：使用个人微信号做机器人可能违反微信使用条款，请自行评估风险。

### 方式二：HTTP API 模式（适合对接其他平台）

机器人默认启动 HTTP API，端口 4000：

**发送群消息给机器人处理：**
```bash
POST http://localhost:4000/api/message
Content-Type: application/json

{
  "group_id": "群唯一标识",
  "group_name": "剧本杀拼车群",
  "sender_id": "发送者ID",
  "sender_name": "张三",
  "text": "急招：推理俱乐部、剧本：雾鸦馆、时间：今天19:00、缺6人"
}
```

**轮询机器人要发送的消息：**
```bash
GET http://localhost:4000/api/messages?since=0
```

返回机器人需要发送到群里的消息列表，由你的对接程序转发到微信群。

## 📁 项目结构

```
.
├── server/                  # 后端 API 服务
│   ├── index.js            # 入口
│   ├── db.js               # SQLite 数据库
│   ├── routes/
│   │   ├── carpools.js     # 拼车相关 API
│   │   └── players.js      # 玩家相关 API
│   └── services/
│       ├── messageParser.js # 消息解析服务
│       └── reminderService.js # 定时提醒服务
├── bot/                     # 微信机器人
│   ├── index.js            # 入口
│   ├── services/
│   │   └── botOrchestrator.js # 机器人核心逻辑
│   └── adapters/
│       ├── httpAdapter.js  # HTTP API 适配器
│       └── wechatyAdapter.js # WeChaty 适配器
├── client/                  # 前端页面（React + Vite）
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── styles.css
│       └── pages/
│           ├── HomePage.jsx
│           ├── CarpoolDetail.jsx
│           ├── AdminPanel.jsx
│           └── AdminCarpoolDetail.jsx
├── data/                    # SQLite 数据文件（自动生成）
├── package.json
└── README.md
```

## 🔧 API 接口

### 拼车相关

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/carpools` | 获取拼车列表（支持 `?status=recruiting&group_id=xxx`） |
| GET | `/api/carpools/:id` | 获取拼车详情（含玩家列表） |
| POST | `/api/carpools` | 创建拼车 |
| PUT | `/api/carpools/:id` | 更新拼车信息 |
| PATCH | `/api/carpools/:id/status` | 更新状态（recruiting/locked/completed/cancelled） |
| DELETE | `/api/carpools/:id` | 删除拼车 |

### 玩家相关

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/players/carpool/:carpoolId` | 获取某拼车的所有玩家 |
| POST | `/api/players` | 添加玩家（人满自动进候补） |
| PUT | `/api/players/:id` | 更新玩家信息 |
| POST | `/api/players/:id/cancel` | 玩家取消/鸽车（自动顺位候补） |
| POST | `/api/players/:id/promote` | 候补手动转正 |
| DELETE | `/api/players/:id` | 删除玩家 |

## 🛠️ 常见问题

**Q: 时间格式支持哪些？**
A: 支持以下格式：
- `今天19:00` / `明天14:00` / `后天20:00`
- `6月20日19:00` / `6/20 19:00`
- `2025-06-20 19:00`
- `19:00`（如果时间已过则算明天）

**Q: 数据库存在哪里？**
A: SQLite 数据库文件在 `data/jubensha.db`，直接备份该文件即可备份所有数据。

**Q: 可以同时管理多个群吗？**
A: 可以。每个群通过 `group_id` 区分，各自维护独立的当前拼车状态。

**Q: 机器人消息没响应？**
A: 检查：
1. `.env` 中的 `ADMIN_NICKNAMES` 是否包含正确的群主昵称
2. 急招消息格式是否匹配（关键字「急招」+「剧本」+「缺X人」）
3. 玩家报名时该群是否已有进行中的拼车

## 📄 License

MIT
