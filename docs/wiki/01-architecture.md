# 01 — 整体架构

## 1.1 形态与边界

本仓库是一个“前端可视化协作看板 + Daemon（终端/事件桥接器）”的组合：

- 前端：Next.js（App Router）+ React，用于展示任务看板、全局聊天室、任务详情、质量视图与设置页。
- Daemon：Socket.io 服务端 + CLI 执行器，用于：
  - 接收前端发起的执行请求（terminal:start）
  - 通过本地不同的 CLI（如 opencode, claude-cli）或 Bridge（本机转发）执行任务
  - 将 stdout/stderr 流式转发为 Web 终端输出，并从 NDJSON 中解析结构化事件（agent:event / agent:session）

关键文件（以当前默认路径为准）：

- 前端入口：[`src/app/page.tsx`](../../src/app/page.tsx)、[`src/app/layout.tsx`](../../src/app/layout.tsx)
- UI 容器：[`src/app/ClientHome.tsx`](../../src/app/ClientHome.tsx)
- 状态与事件中枢：[`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)
- Daemon 实现：[`src/server/daemon.ts`](../../src/server/daemon.ts)
- Daemon 初始化路由：[`src/pages/api/daemon/init.ts`](../../src/pages/api/daemon/init.ts)
- Socket.io 路由：[`src/pages/api/socketio.ts`](../../src/pages/api/socketio.ts)
- 设置页（配置入口）：[`src/components/task-hub/SettingsDrawer.tsx`](../../src/components/task-hub/SettingsDrawer.tsx)
- Bridge（本机转发）：[`bridge/opencode-bridge.mjs`](../../bridge/opencode-bridge.mjs) 与 [`scripts/*`](../../scripts/)

历史/可选路径（非默认）：

- 独立后端（Express + Socket.io）：[`backend/server.js`](../../backend/server.js)（用于单独部署 daemon 的场景，文档需明确其为可选）

## 1.2 运行时拓扑（Ports / Paths）

默认开发模式下（`pnpm dev`），Next.js 同时承载 Web UI 与 Socket.io daemon：

- Web：`http://localhost:3000`（端口可由环境变量覆盖）
- Daemon 初始化：`GET /api/daemon/init`
- Socket.io path：`/api/socketio`（同源连接）

Opencode Bridge（本机转发）是“本机进程”，默认监听：

- Bridge：`http://localhost:8787`（可通过 `BRIDGE_PORT` 覆盖）

## 1.3 核心数据流

### A) 任务/聊天的“黑板式”数据流

1. UI 组件通过 `useTaskHubStore()` 读取 `tasks / chatMessages / terminalLogs / eventsByConversation` 等状态。
2. UI 触发的操作（新建会话/新建任务/改状态/发聊天/邀请 Agent）调用 store 中的 mutation（如 `createConversation`、`addTask`、`updateTaskStatus`、`addChatMessage`）。
3. 所有组件共享同一个 Zustand store：状态写入 → 视图自动更新（Blackboard 风格）。

### B) 终端与 Agent 事件流（Socket.io）

1. 前端启动时会先 `fetch('/api/daemon/init')` 确保 daemon 初始化，再 `socket.connect()` 建立同源 Socket 连接（见 `taskHubStore.ts` 的 `connectDaemon()`）。
2. 当用户在任务详情中触发“运行 Agent”时，前端通过 Socket 发送 `terminal:start`，核心字段已扩展为包含多运行时上下文：
   - `taskId / agentId / prompt / sessionId`
   - `runtimeId / providerProfileId / channel / authContextId`
   - `allowMockRunner`（调试开关）
3. Daemon 收到 `terminal:start` 后根据 `runtimeId` 和 `authContextId` 按需路由并执行：
   - 若命中 Bridge（如 opencodeBridgeUrl）：HTTP 调用 `{bridge}/run` 并流式转发
   - 否则：通过本地 CLI（如 `opencode`, `claude-cli`）衍生子进程并执行任务
4. Daemon 对输出做两类处理：
   - 原样（换行适配）转发为 `terminal:data` 用于 xterm 渲染
   - 逐行解析 NDJSON：抽取 `sessionId`（发 `agent:session`），以及 `text/tool_use/step_*`（发 `agent:event`）
5. 执行结束后发 `terminal:exit`，前端将 agent 标记为 idle 并记录退出码。

## 1.4 领域状态机（TaskStatus）

任务状态机在 `taskHubStore.ts` 以联合类型表达：

- `pending | in_progress | in_review | done | rejected | blocked`

UI 侧：

- 任务卡片/详情通过 `StatusBadge` 渲染状态
- `TaskDetailPanel` 提供状态跳转（开始 / 提交评审 / 通过 / 拒绝 / 阻塞 / 重置）

## 1.5 代码组织约定（本项目实际做法）

- 业务中枢在 store：任务/聊天/终端/事件等核心状态集中在 `src/store/taskHubStore.ts`
- 视图组件尽量薄：`src/components/*` 以渲染 + 调用 store actions 为主
- daemon 只做桥接：执行进程/转发流/解析事件，不维护业务实体（会话/任务仍由前端维护与持久化）
- 配置入口在设置页：环境探测、daemon 连接、bridge URL、调试开关、清空本地数据

## 1.6 配置体系（UI / env / scripts）

配置分三层：

- UI（localStorage，面向使用者）：
  - Opencode Bridge URL、启用状态与检测结果
  - Mock Runner 开关
  - 一键清空本地持久化数据（重置到从 0 开始）
- 环境变量（面向部署/运行时）：
  - `ENABLE_MOCK_RUNNER=1`：允许在找不到 `opencode` 时回退到内置模拟执行器
  - Bridge 进程：`BRIDGE_PORT / OPENCODE_MODE / OPENCODE_ATTACH_URL`
- 脚本（面向安装/启动）：
  - `scripts/opencode-bridge-install.*`：安装检查/可选安装 opencode
  - `scripts/opencode-bridge-start.*`：启动 bridge（run/attach）

## 1.7 核心业务模型与演进抽象

### A) 统一集成配置中心 (Unified Integration Config Center)
随着多 CLI 和多渠道的接入，架构从“硬编码依赖单一 `opencode` 运行时”向“配置化路由”演进。
核心抽象模型包括：
- `CliRuntime`: 本地 CLI 或远程 Daemon 执行器（如 `opencode`, `claude-cli`, `mock`）。
- `Credential`: 凭证模型，区分 API Key、OAuth 和 Web Session。
- `ProviderProfile`: 厂商能力描述（模型提供商等）。
- `ChannelConfig`: 渠道接入配置。
- `RoutingPolicy`: 用于绑定 Channel 到默认的 Runtime 与 Provider。

### B) 工程型角色卡机制 (Engineering Role Card Schema)
为摆脱“泛化助手”模式，引入了针对软件工程场景的结构化角色卡：
- **Identity (身份边界)**: 定义 Agent 的代号、名称、头像。
- **Responsibility (核心职责)**: 描述 Agent 在工作流中的专注领域（如架构师、开发、测试）。
- **Behavior (行为准则)**: 设定交互偏好、交付物格式要求及协作口吻。
- **CapabilityPolicy (能力权限)**: 绑定到具体的 MCP / Tools 或 Runtime。
- 角色卡的数据模型与前端组件（`RoleCardListPage`, `RoleCardEditor` 等）已经解耦并在持续演进。

## 1.8 架构演进路线（里程碑）

### M0：可执行链路（现状）
- 目标：通过设置页配置 Bridge，让远程环境调用本机真实 opencode；并在 UI 中可观察输出与事件。
- 验证：创建任务 → 运行 Opencode → 终端输出可见；Bridge/Daemon 状态可见。

### M1：统一“派发到 Agent”的语义（部分完成）
- 目标：把“激活 session / 任务执行 / @mention 对话”统一为单一动作，并形成稳定的会话复用策略与角色卡分配机制。
- 验证：工程型角色卡能稳定约束各 Agent 的回答边界，通过统一的调度中心派发任务。

### M1.5：多引擎执行链路（进行中）
- 目标：完成统一集成配置中心（Unified Integration Config Center），解耦 Runtime、Provider、Channel 和 Credentials。
- 验证：系统能同时并存 `opencode` 和其他 CLI 工具执行环境，不同 Auth 方式逻辑隔离。

### M2：生产化安全与权限（规划）
- 目标：为 daemon 与 bridge 增加最小认证（token / allowlist），收敛 CORS，避免公网暴露风险。
- 验证：无 token 无法调用关键执行接口；安全配置有文档与自测步骤。

## 1.8 关联设计文档（仓库内）

- 需求与愿景：[`VISION.md`](../../VISION.md)、[`ROADMAP.md`](../../ROADMAP.md)
- 设计与决策记录：[`decisions/`](../../decisions/)
