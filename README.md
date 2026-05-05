<div align="center">
  <h1>🐈 Agent Task Hub (Agent Task Hub)</h1>
  <p>基于 Next.js 构建的去中心化多智能体（Multi-Agent）研发协作平台。</p>
  
  <p>
    <b>“想法和产品之间，隔着的不是程序员，而是实现力。”</b>
  </p>
</div>

---

## 📖 项目简介

`agent-task-hub`（内部代号 **Agent Task Hub**，核心愿景为 *"Agents & U"*）突破了将 AI 仅作为单体辅助工具的传统模式。旨在为用户分配一支具备“对等协作、共享记忆”能力的虚拟研发团队（“Agent团队”）。人类负责提供愿景和判断，多个 AI Agent 负责拆解、编码、审查和交付，共同把想法变成实际能运行的产品。

当前版本已经从早期的“任务板 + 聊天室”演进为一个**项目工作台**：

- 左侧：项目列表与项目切换
- 中间：作战指挥室，展示项目目标、拆解状态、Agent 条带与对话
- 右侧：Mini Kanban、下一步代办、风险与阻塞
- 底层：SQLite 持久化、API rehydrate、Socket.io daemon、多 CLI backend

## 🏗️ 核心架构

系统当前采用四层结构：

- **前端工作台**：项目、聊天、任务、阻塞、设置等统一 UI
- **状态与编排层**：Zustand 负责运行态缓存、API rehydrate 和 socket 事件接入
- **应用后端层**：Next.js API + SQLite / Drizzle / Repository
- **执行层**：Socket.io daemon + Agent Backend 抽象 + CLI / Bridge

*详见 [统一规格目录](./specs/README.md)、[整体架构文档](./docs/wiki/01-architecture.md) 和 [产品愿景](./VISION.md)*。

## 🛠️ 技术栈

本项目是一个现代化的 Web 应用：

- **框架**: [Next.js 16.2](https://nextjs.org/) + [React 19](https://react.dev/)
- **状态管理**: [Zustand 5](https://github.com/pmndrs/zustand)
- **持久化**: `better-sqlite3` + `drizzle-orm`
- **样式**: [Tailwind CSS v4](https://tailwindcss.com/)
- **组件/功能集成**: 
  - `xterm.js` (Web 终端模拟)
  - `lucide-react` (图标系统)

## 🚀 快速开始

### 环境要求

- **Node.js** 18+ (推荐 20 LTS)
- **pnpm** (自动安装)

### 一键安装

```bash
# 克隆项目
git clone <your-repo-url> agent-task-hub
cd agent-task-hub

# 运行安装脚本（自动安装依赖 + 构建）
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

# 启动
pnpm start
```

### 开发模式（带热更新）

```bash
pnpm dev
```

启动后，在浏览器中访问 [http://localhost:3000](http://localhost:3000) 即可预览项目。

## 🧭 当前使用路径

1. 启动项目：`pnpm dev`
2. 打开 Web
3. 在左侧项目栏创建一个项目
4. 在右上角设置中进入 `模型账号`
5. 添加并验证账号，必要时在 `角色卡` 中完成账号绑定
6. 在项目内创建任务并打开任务详情执行 CLI

## 🔌 连接 Opencode（真实执行）

本项目仍支持 **Opencode Bridge（本机转发）**，用于远程环境间接调用你本机安装的 `opencode`：

- 本机运行一个轻量 HTTP 服务，将 `opencode run/attach` 的输出流式转发给 Web。
- 当前前端没有完整的 Bridge 管理界面；Bridge 更适合作为开发链路或定制集成能力使用。

### 1) 本机准备（macOS / Linux）

安装检查（可选：自动安装 opencode）：

```bash
bash scripts/opencode-bridge-install.sh
# 或：bash scripts/opencode-bridge-install.sh --install-opencode
```

启动（run 模式）：

```bash
bash scripts/opencode-bridge-start.sh --port=8787 --mode=run
```

启动（attach 模式，可连接本机已运行的 opencode 服务）：

```bash
bash scripts/opencode-bridge-start.sh --port=8787 --mode=attach --attach-url=http://localhost:4096
```

### 2) 本机准备（Windows）

安装检查（可选：自动安装 opencode）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1
# 或：powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1 -InstallOpencode -Method scoop
```

启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-start.ps1 -Port 8787 -Mode run
```

### 3) 接入说明

1. 把本机 `http://localhost:8787` 暴露成公网可访问 URL（推荐 https）
2. 将该 URL 作为执行环境配置的一部分接入 daemon 或本地调试链路

说明：

- Bridge 协议与启动方式仍有效
- 当前产品主流配置入口已经转向“模型账号 / 角色卡”
- 不应再把“设置里直接填 Bridge URL”视为当前默认用户路径

更多细节见 [bridge/README.md](./bridge/README.md)

## 🗄️ 持久化说明

当前项目已经接入 SQLite 持久化：

- 页面初始状态通过 `/api/state` 加载
- conversation / task / message / session / invocation / event 会写入本地数据库
- Zustand 主要承担前端运行态缓存与编排，不再是唯一数据源

## 📚 文档导读

在开始深入开发前，建议您阅读以下文档以了解本项目的规范和计划：

- [产品愿景 (VISION.md)](./VISION.md)
- [研发路线图 (ROADMAP.md)](./ROADMAP.md)
- [标准操作程序 (SOP.md)](./SOP.md)
- [Agent 指南 (AGENTS.md)](./AGENTS.md)
- [统一规格目录 (specs/)](./specs/)
- [项目文档导航 (docs/README.md)](./docs/README.md)

---

<div align="center">
  <p><i>「领养团队，一起长出世界。」</i></p>
</div>
