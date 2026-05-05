<div align="center">
  <h1>🐈 Agent Task Hub</h1>
  <p><strong>去中心化多智能体研发协作平台</strong></p>
  <p>
    <em>"想法和产品之间，隔着的不是程序员，而是实现力。"</em>
  </p>
  <p>
    <a href="#-快速开始">快速开始</a> •
    <a href="#-核心功能">核心功能</a> •
    <a href="#-架构设计">架构设计</a> •
    <a href="#-部署指南">部署指南</a> •
    <a href="#-文档">文档</a>
  </p>
</div>

---

## 📖 项目简介

**Agent Task Hub** 是一个基于 Next.js 构建的多智能体协作平台，让人类与 AI Agent 组成虚拟研发团队，共同将想法转化为可运行的产品。

### 为什么需要 Agent Task Hub？

传统 AI 工具是单体辅助——一个 AI 帮你完成一个任务。Agent Task Hub 突破了这个模式：

- **多 Agent 协作**：分配一支具备不同专业能力的 Agent 团队
- **对等协作**：没有 Boss Agent，每个 Agent 有自己的判断和专长
- **共享记忆**：Agent 之间的对话和上下文是共享的
- **可迁移经验**：养成的协作模式可以迁移到新项目

## 🚀 快速开始

### 环境要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | 18+ | 推荐 20 LTS |
| pnpm | 8+ | 包管理器（脚本会自动安装） |
| Git | 2.30+ | 用于版本控制和 worktree |

### 一键安装

```bash
# 克隆项目
git clone <your-repo-url> agent-task-hub
cd agent-task-hub

# 运行安装脚本（自动检查环境、安装依赖、构建项目）
./setup.sh

# 启动生产模式
pnpm start
```

### 手动安装

```bash
# 安装依赖
pnpm install

# 构建生产版本
pnpm build

# 启动生产服务
pnpm start
```

### 开发模式

```bash
# 启动开发服务器（带热更新）
pnpm dev
```

启动后访问 [http://localhost:3000](http://localhost:3000)。

## ✨ 核心功能

### 🎯 项目工作台

三栏布局的项目管理界面：

| 区域 | 功能 |
|------|------|
| 左栏 | 项目列表与切换 |
| 中栏 | 作战指挥室：目标、拆解、Agent 对话 |
| 右栏 | Mini Kanban、代办、风险面板 |

### 🤖 多 Agent 协作

- **智能任务分发**：基于 Agent 能力图谱自动匹配任务
- **会话级隔离**：每个项目中每个 Agent 维护独立的长期会话
- **A2A 通信**：Agent 之间可以通过 `@mention` 相互协作
- **队列隔离**：跨项目的排队消息不会互相干扰

### 📋 任务管理

- **双向同步**：`.ath/TASKS.md` 文件与 UI 看板实时同步
- **状态流转**：pending → in_progress → in_review → done
- **阻塞追踪**：自动识别和追踪任务阻塞项
- **Workdir 隔离**：每个任务独立工作目录，支持 Git worktree

### 🔧 Skill 系统

可复用的能力模块，与 RoleCard（身份）正交：

- 从 Git 仓库导入 Skill
- 为 Agent 绑定多个 Skill
- Skill 指令自动注入 system prompt

### 🔐 账号与认证

- **多 Runtime 支持**：OpenCode、Claude CLI、Codex CLI、Gemini CLI
- **API Key 模式**：直接配置 API Key
- **角色卡绑定**：为不同角色配置不同的执行账号

## 🏗️ 架构设计

### 系统分层

```
┌─────────────────────────────────────────────────────────────┐
│                    前端工作台 (Next.js)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  项目列表    │  │  作战指挥室  │  │  Kanban     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│                  状态与编排层 (Zustand)                      │
│  - UI 状态管理    - Socket 事件处理    - API Rehydrate       │
├─────────────────────────────────────────────────────────────┤
│                应用后端层 (Next.js API)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  SQLite     │  │  Repository │  │  Daemon     │         │
│  │  (Drizzle)  │  │  (业务逻辑)  │  │  (编排器)    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│                    执行层 (CLI/Bridge)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  OpenCode   │  │  Claude CLI │  │  Codex CLI  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### 核心数据流

1. **页面初始化**：`/api/state` 从 SQLite 加载全量状态
2. **用户操作**：Zustand 更新本地状态 → `/api/mutations` 持久化
3. **任务执行**：Socket → Daemon → Agent Backend → 事件流 → 前端 + DB
4. **文件同步**：TaskFileWatcher 监听 `.ath/TASKS.md` → 解析 → DB → Socket 广播

### 关键文件

| 层级 | 文件 | 职责 |
|------|------|------|
| 前端入口 | `src/app/ClientHome.tsx` | 页面初始化与状态加载 |
| 状态管理 | `src/store/taskHubStore.ts` | Zustand 状态编排 |
| Daemon | `src/server/daemon.ts` | Socket 事件处理与 Agent 编排 |
| 数据库 | `src/server/db/` | SQLite + Drizzle ORM |
| Repository | `src/server/repositories/` | 业务数据访问层 |
| Agent Backend | `src/server/agent/` | 多 CLI 执行器抽象 |

## 🛠️ 技术栈

| 类别 | 技术 | 用途 |
|------|------|------|
| 框架 | Next.js 16.2 + React 19 | 全栈 Web 应用 |
| 状态管理 | Zustand 5 | 前端运行态缓存与编排 |
| 数据库 | SQLite (better-sqlite3) | 本地持久化 |
| ORM | Drizzle ORM | 类型安全的 SQL |
| 样式 | Tailwind CSS v4 | 原子化 CSS |
| 实时通信 | Socket.io | WebSocket 双向通信 |
| 终端模拟 | xterm.js | Web 终端 |

## 📂 项目结构

```
agent-task-hub/
├── src/
│   ├── app/                    # Next.js App Router
│   ├── components/             # React 组件
│   │   ├── project/           # 项目工作台
│   │   ├── task-hub/          # 聊天、任务、设置
│   │   ├── role-card/         # 角色卡管理
│   │   └── skill/             # Skill 系统
│   ├── store/                  # Zustand 状态管理
│   ├── server/                 # 后端逻辑
│   │   ├── agent/             # Agent Backend 实现
│   │   ├── repositories/      # 数据访问层
│   │   └── db/                # 数据库配置
│   ├── lib/                    # 工具函数
│   └── pages/api/             # API Routes
├── docs/                       # 项目文档
├── specs/                      # 规格文档
├── architecture/               # 架构文档
├── bridge/                     # OpenCode Bridge
├── scripts/                    # 安装脚本
└── setup.sh                    # 一键安装脚本
```

## 🚢 部署指南

### 生产模式部署

```bash
# 构建
pnpm build

# 启动（默认端口 3000）
pnpm start

# 自定义端口
PORT=8080 pnpm start
```

### Docker 部署（示例）

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["pnpm", "start"]
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 服务端口 |
| `NODE_ENV` | production | 运行环境 |
| `ATH_WORKSPACES_ROOT` | .ath/workspaces | 工作目录根路径 |
| `ATH_TMUX_ENABLED` | 0 | 启用 tmux 集成 |
| `CLI_TIMEOUT_MS` | 300000 | CLI 超时时间 (ms) |

## 📚 文档

### 核心文档

- [产品愿景](./VISION.md) - 项目愿景与理念
- [研发路线图](./ROADMAP.md) - 当前进展与计划
- [标准操作程序](./SOP.md) - 开发规范
- [Agent 指南](./AGENTS.md) - Agent 工作约束

### 技术文档

- [整体架构](./docs/wiki/01-architecture.md) - 系统架构详解
- [前端工作台](./docs/wiki/02-frontend.md) - 前端模块说明
- [后端 Daemon](./docs/wiki/04-backend-daemon.md) - 执行链路详解
- [架构图](./docs/wiki/07-architecture-diagrams.md) - 可视化架构

### 规格文档

- [规格目录](./specs/) - 所有规格文档索引
- [文档导航](./docs/README.md) - 文档分类与导航

## 🤝 参与贡献

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交变更 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 开源协议

本项目采用 [MIT 协议](./LICENSE) 开源。

---

<div align="center">
  <p><strong>「领养团队，一起长出世界。」</strong></p>
  <p>
    <sub>Built with ❤️ by Agent Task Hub Team</sub>
  </p>
</div>
