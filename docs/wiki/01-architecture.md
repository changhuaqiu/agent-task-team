# 01 — 整体架构

## 1.1 形态与边界

当前仓库已经从“纯前端黑板 + 单一 opencode 执行器”演进为四层结构：

- 前端工作台：Next.js + React，负责项目切换、作战指挥室、任务详情、风险面板与设置入口
- 前端编排层：Zustand store，负责 UI 状态、Socket 连接、API rehydrate 与用户操作编排
- 应用 API 与持久化层：Next.js API Routes + SQLite/Drizzle + Repository
- 执行层：Socket.io daemon + Agent Backend 抽象 + Bridge / 本地 CLI

关键文件：

- 前端主入口：[`src/app/ClientHome.tsx`](../../src/app/ClientHome.tsx)
- 工作台容器：[`src/components/project/ProjectWorkspace.tsx`](../../src/components/project/ProjectWorkspace.tsx)
- 状态仓库：[`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)
- 状态加载 API：[`src/pages/api/state.ts`](../../src/pages/api/state.ts)
- 变更写入 API：[`src/pages/api/mutations.ts`](../../src/pages/api/mutations.ts)
- Daemon：[`src/server/daemon.ts`](../../src/server/daemon.ts)
- Agent Backend 工厂：[`src/server/agent/factory.ts`](../../src/server/agent/factory.ts)
- 数据库层：[`src/server/db`](../../src/server/db)
- Repository 层：[`src/server/repositories`](../../src/server/repositories)

## 1.2 运行时拓扑

默认开发模式下，`pnpm dev` 同时承载前端页面、API 与 Socket.io：

- Web：`http://localhost:3000`
- 状态初始化：`GET /api/state`
- 持久化 mutation：`POST /api/mutations`
- Daemon 初始化：`GET /api/daemon/init`
- Socket.io：`/api/socketio`

本机 Bridge 仍然是可选外部进程：

- Bridge：`http://localhost:8787`

SQLite 作为默认数据源，数据库文件位于项目工作目录下的 `.ath/`。

## 1.3 核心数据流

### A) 页面初始化与 Rehydrate

1. 前端启动后，[`ClientHome.tsx`](../../src/app/ClientHome.tsx) 先调用 `loadFromServer()`
2. `GET /api/state` 从 SQLite 读取：
   - conversations
   - tasks
   - recentMessages
   - activeSessions
   - recentInvocations
3. store 将后端真相源映射为前端运行态，然后再调用 `connectDaemon()`

### B) 用户操作与持久化

1. 用户在工作台中创建项目、任务、消息或状态流转
2. store 先更新本地状态，再通过 `POST /api/mutations` 写入 Repository
3. Repository 统一落 SQLite，保证刷新后可恢复

### C) 执行链路

1. 任务执行时，前端通过 Socket 发送 `terminal:start`
2. daemon 根据 `engine / runtimeId / accountId / opencodeBridgeUrl` 解析执行路径
3. daemon 通过 Agent Backend 工厂选择对应执行器，例如 `opencode / claude / codex`
4. 执行输出被统一归一化为 `AgentEvent`
5. daemon 将事件：
   - 广播给前端（`agent:event` / `agent:session` / `terminal:data` / `terminal:exit`）
   - 同步写入 `messageRepo / eventRepo / invocationRepo / sessionRepo`

## 1.4 当前 UI 信息架构

当前主界面不是旧的双栏任务看板，而是三栏工作台：

- 左栏：项目列表与项目切换
- 中栏：作战指挥室，显示当前项目目标、拆解状态、Agent 条带和嵌入式聊天
- 右栏：Mini Kanban、下一步代办、风险与阻塞

辅助层：

- 任务详情抽屉：任务信息、状态流转、终端输出
- 新建任务弹窗
- Agent roster 弹窗
- 设置抽屉：当前已落地的账号与角色卡配置入口

## 1.5 当前后端主链路

后端不再只是“桥接 stdout”，而是承担三部分职责：

- API 真相源：
  - `/api/state` 负责加载当前项目状态
  - `/api/mutations` 负责写入 conversation/task/message/session/invocation/event
- SQLite 持久化：
  - `better-sqlite3` + `drizzle-orm`
  - repo 负责业务语义读写
- Daemon 编排：
  - 会话查找 / 创建 / seal
  - invocation 跟踪
  - account credential 注入
  - Agent Backend 选择

## 1.6 核心业务对象

当前主业务对象包括：

- `Conversation`：项目 / 战役级上下文
- `Task`：具体执行任务，带 `conversationId`、`phaseId`、`agentId`
- `ChatMessage`：对话消息，支持 streaming/tool/progress/artifact preview
- `Blocker`：风险与阻塞项
- `Account`：账号与执行认证入口
- `RoleCard`：工程型角色卡
- `AgentSession`：conversation 级或任务级执行会话
- `Invocation`：每次实际执行记录

## 1.7 架构演进主线

### A) 项目工作台化

从旧的任务板视图演进到“项目 > 指挥室 > 风险面板”三栏工作流，项目切换成为第一层上下文。

### B) SQLite 真相源

从 localStorage 主导演进到 SQLite 主导，前端 store 变成运行时缓存与编排层，而不是唯一数据源。

### C) Agent Backend 抽象

从 daemon 内部硬编码多引擎分支，演进到统一的 Backend 接口：

- [`src/server/agent/types.ts`](../../src/server/agent/types.ts) — `AgentBackend` 接口 + `AgentRun` / `AgentEvent` / `AgentResult` 类型
- [`src/server/agent/factory.ts`](../../src/server/agent/factory.ts) — `createBackend(engine, config)` 工厂
- 独立 backend 实现：`opencode.ts` / `claude.ts` / `codex.ts`

核心设计：
- `execute(prompt, opts)` → `{ events: AsyncGenerator<AgentEvent>, result: Promise<AgentResult>, kill }`
- 各引擎私有协议归一化为统一的 `AgentEvent` 流（text / thinking / tool_use / error / done）
- Daemon 通过 `for await (const event of events)` 消费，统一处理 session/invocation/socket 广播
- 新增引擎只需实现 `AgentBackend` 接口，不改动 daemon 主流程

**OpenCode 跨平台 Spawn 策略**：OpenCode 的 Go 二进制检测到非 TTY stdout 时抑制输出（上游 bug `anomalyco/opencode#14948`）。采用三级 fallback：
1. 直接 spawn Go 二进制（`.opencode`），绕过 Node.js wrapper 的 `spawnSync({ stdio: "inherit" })`
2. `script -q /dev/null` PTY 包装（Unix，提供真实 TTY）
3. 直接 pipe 兜底（Windows / 无 script 命令时）

详见 [`docs/technical/execution/opencode-integration-executable-chain.md`](../technical/execution/opencode-integration-executable-chain.md)。

### D) 账号绑定与多运行时参数通路

系统正在从“单一 opencode”演进到“账号绑定 + 多 CLI 执行”的模型。

当前事实是：

- 账号管理已落地
- 角色卡与账号绑定已落地
- 多运行时参数通路已部分落地
- 独立配置中心与完整 runtime center 尚未完成

## 1.8 当前状态判断

- 已完成：
  - 项目工作台 UI
  - SQLite repo 与 API rehydrate
  - Agent Backend 抽象
  - 基础账号模型与执行绑定
- 部分完成：
  - 统一集成配置中心
  - 多 runtime 的完整信息架构
  - 独立配置中心页面
- 仍在规划：
  - 更强的安全与权限边界
  - 更完整的渠道、provider、routing policy

## 1.9 关联文档

- 需求与愿景：[`VISION.md`](../../VISION.md)、[`ROADMAP.md`](../../ROADMAP.md)
- 规格目录：[`specs/`](../../specs/)
- 文档导航：[`docs/README.md`](../README.md)
- 架构图：[`07-architecture-diagrams.md`](./07-architecture-diagrams.md)
- 决策记录：[`decisions/`](../../decisions/)
