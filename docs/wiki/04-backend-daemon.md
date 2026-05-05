# 04 — 后端执行链路（API + SQLite + Daemon）

本项目当前后端链路由三部分组成：

- API 层：加载状态与写入 mutation
- SQLite / Repository 层：持久化业务数据
- Daemon 层：执行 CLI、跟踪会话、转发事件

## 4.1 API 层

### `/api/state`

[`src/pages/api/state.ts`](../../src/pages/api/state.ts) 负责页面初始化时的状态加载。

当前返回：

- `conversations`
- `tasks`
- `recentMessages`
- `activeSessions`
- `recentInvocations`
- `skills`
- `agentSkillIds`（每个 agent 绑定的 skill ID 列表）

这条接口已经是页面 hydrate 的主要真相源。

### `/api/mutations`

[`src/pages/api/mutations.ts`](../../src/pages/api/mutations.ts) 提供统一 mutation 入口。

当前支持的 mutation 包括：

- conversation create/update/delete
- task create/update/updateStatus/delete
- message append
- session create/update/seal
- invocation create/updateStatus
- dispatch enqueue（dispatch 持久化入队）
- tool invoke（skill 定义的自定义 tool 路由）
- event append

这意味着前端大部分结构化写操作都已经可以写入 SQLite，而不是停留在本地 store。

### Skill API 路由

[`src/pages/api/skills/`](../../src/pages/api/skills/) 提供 skill 的 CRUD 与导入：

- `GET /api/skills` — 列出所有 skill
- `GET /api/skills/:id` — 获取 skill 详情（含配套文件）
- `POST /api/skills` — 创建 skill
- `PATCH /api/skills/:id` — 更新 skill（含文件替换）
- `DELETE /api/skills/:id` — 删除 skill（级联删除文件与 agent 绑定）
- `POST /api/skills/import` — 从 Git 仓库或 URL 导入 skill
- `GET /api/agents/:agentId/skills` — 列出 agent 绑定的 skill
- `POST /api/agents/:agentId/skills` — 替换 agent 的 skill 绑定（clear-then-add）

## 4.2 SQLite 与 Repository 层

当前数据库技术栈：

- `better-sqlite3`
- `drizzle-orm`
- `drizzle-kit`

数据库包含以下表（migration v2 新增 skill 相关 3 张表，v4-v5 新增 dispatch 追踪列）：

`task` 表新增列：
- `claimed_at`、`started_at`、`completed_at` — dispatch 生命周期时间戳
- `lease_expiry` — claim 过期时间，用于僵尸任务恢复
- `work_dir` — agent 执行工作目录路径

`invocation` 表新增列：
- `dispatch_status` — 内部 dispatch 状态（queued/claimed/running/completed/failed）
- `token_usage` — JSON 格式 token 用量数据（per-model）
- `lease_expiry` — claim 过期时间

- `conversation`、`task`、`chat_message`、`agent_session`、`invocation`、`agent_event` — 业务主数据
- `skill` — 能力模块核心表（name 唯一约束）
- `skill_file` — skill 配套文件（FK → skill.id，CASCADE）
- `agent_skill` — agent-skill 多对多关联（agent_id + skill_id 联合主键）

核心目录：

- [`src/server/db`](../../src/server/db)
- [`src/server/repositories`](../../src/server/repositories)

Repository 当前覆盖的核心对象：

- `conversationRepo`
- `taskRepo`
- `messageRepo`
- `sessionRepo`
- `invocationRepo`
- `eventRepo`
- `dispatchRepo` — dispatch 队列管理（操作 invocation 表的 dispatch_status 列，提供原子 claim、僵尸恢复、pending 查询）
- `role_cards` 表：`id TEXT PK, data TEXT NOT NULL, is_preset INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`，其中 `data` 列以 JSON 存储完整 RoleCard（含 CapabilityProfile）
- `skillRepo` — skill CRUD、文件管理、agent 绑定（[`skill-repo.ts`](../../src/server/repositories/skill-repo.ts)）
- `dispatchRepo` — dispatch 状态管理（基于 invocation 表扩展列，[`dispatch-repo.ts`](../../src/server/repositories/dispatch-repo.ts)）

新增模块：
- [`src/server/workdir-manager.ts`](../../src/server/workdir-manager.ts) — WorkdirManager：per-task 工作目录创建、session 元数据读写、GC
- [`src/lib/agent-context/layers/toolLayer.ts`](../../src/lib/agent-context/layers/toolLayer.ts) — 从 skill.config.tools 生成 tool 定义注入 prompt
- [`src/server/task-file-service.ts`](../../src/server/task-file-service.ts) — TaskFileService：md 读写解析（ParsedTask + ParsedBlocker + 格式兼容）
- [`src/server/task-file-watcher.ts`](../../src/server/task-file-watcher.ts) — TaskFileWatcher：chokidar 文件监听 + DB 创建/更新 + Socket 广播
- [`src/server/skill-tool-executor.ts`](../../src/server/skill-tool-executor.ts) — Skill Tool 执行器：直接 DB 查询 + 文件双写
- [`src/server/skill-tool-router.ts`](../../src/server/skill-tool-router.ts) — Tool 名称路由映射（api:// → toolName）

这层的职责是：

- 提供业务语义的读写接口
- 隔离 SQL / schema 细节
- 作为 API 与 daemon 的共同数据访问层

## 4.3 Daemon 当前职责

[`src/server/daemon.ts`](../../src/server/daemon.ts) 不再只是 stdout 转发器，而是执行编排中心：

- 接收 `terminal:start`
- 解析 engine / runtime / account 上下文
- 查找或创建 agent session
- 创建 invocation 记录
- 选择 Agent Backend
- 转发与持久化执行事件

关键能力：

- session 跟踪
- invocation 跟踪
- account credential 注入
- timeout 管理
- bridge / tmux / 本地 CLI 多路径支持
- 任务创建经过 DispatchAdvisor 步骤，以编程式匹配将任务分配到 agent（基于 capability profiles、当前负载和 forbidden actions）
- Dispatch 持久化：入队时写入 SQLite invocation 表，崩溃后可恢复；同 agent+task 的 dispatch 自动合并（coalescing）
- Workdir 隔离：每次执行分配独立 `cwd`（`.ath/workspaces/{projectId}/{agentId}/task-{taskId}/workdir/`），跨 task 共享 `base/` 基础环境
- Session resume 降级：resume 失败时自动以 fresh session 重试，保持同一 workdir
- Token 追踪：从 CLI 流式输出提取 token 用量，按 invocation 持久化
- Tool 拦截：识别 skill 定义的自定义 tool_use（非原生 tool），路由到内部 API
- GC：启动时清理过期 task 工作目录（24h TTL），active root 引用计数保护

## 4.4 Socket 事件协议

### 输入事件：`terminal:start`

当前 payload 已明显扩展：

```ts
{
  projectId?,
  taskId?,
  agentId,
  prompt,
  systemPrompt?,
  sessionId?,
  conversationId?,
  allowMockRunner?,
  opencodeBridgeUrl?,
  engine?,
  runtimeId?,
  providerProfileId?,
  channel?,
  authContextId?,
  accountIds?,
  accountId?,
  force?,
  projectSlug?
}
```

其中当前实际起主要作用的字段是：

- `agentId`
- `prompt`
- `taskId`
- `conversationId`
- `engine`
- `accountId`
- `opencodeBridgeUrl`
- `force`

### 输出事件

- `terminal:data`
- `agent:event`
- `agent:session`
- `terminal:exit`
- `agent:error`
- `task.sync` — 任务文件变更同步（来自 TaskFileWatcher，含 tasks + blockers + conversationId）
- `task.assigned` — 任务分配通知（来自 task_assign 工具，触发 dispatchToAgent）
- `task.ready` — 依赖满足通知（来自 TaskFileWatcher 依赖解析，触发自动 dispatch）

## 4.5 Agent Backend 抽象

当前 daemon 已将多引擎逻辑从单体 if/else 中抽离。

核心文件：

- [`src/server/agent/types.ts`](../../src/server/agent/types.ts)
- [`src/server/agent/factory.ts`](../../src/server/agent/factory.ts)
- [`src/server/agent/opencode.ts`](../../src/server/agent/opencode.ts)
- [`src/server/agent/claude.ts`](../../src/server/agent/claude.ts)
- [`src/server/agent/codex.ts`](../../src/server/agent/codex.ts)

当前模式：

1. daemon 根据 `engine` 调用 `createBackend()`
2. backend 输出统一 `AgentEvent`
3. daemon 将 `AgentEvent`：
   - 转为 socket 事件
   - 写入 repo
   - 更新 session / invocation

这样新增引擎只需要：

- 增加一个 backend 文件
- 在 factory 里注册

## 4.6 会话与调用追踪

daemon 当前已经具备会话级跟踪：

- `sessionRepo.findActiveByConversation()`
- `sessionRepo.create()`
- `sessionRepo.updateCliSessionId()`
- `sessionRepo.sealByConversation()`

调用级跟踪：

- `invocationRepo.create()`
- `invocationRepo.updateStatus()`
- `invocationRepo.updateDispatchStatus()` — 更新 dispatch 状态和 token 用量
- `invocationRepo.findLatestCompletedForAgent()` — 查找 agent 最近完成的 invocation（用于 workdir 复用）

这使系统能记录：

- 某个项目下某个 agent 的会话链
- 每次执行的输入、状态和退出结果

## 4.7 Bridge / 本地 CLI / Mock

当前执行策略仍保留三类路径：

1. Bridge
   - 当 `opencodeBridgeUrl` 存在时优先使用
2. 本地 CLI
   - 通过不同命令执行 `opencode / claude / codex`
3. Mock
   - 用于开发演示与降级路径

`tmux` 也已经作为可选观察/执行模式接入 daemon。

补充说明：

- `gemini` 当前在工厂中仍回退到 `OpenCodeBackend`
- 它不能被视为与 `opencode / claude / codex` 同等级的独立 backend

## 4.8 当前判断

当前后端应被理解为：

- 一个基于 Next.js API 的轻量应用后端
- 一个以 SQLite 为中心的数据持久化层
- 一个支持多引擎执行的 daemon 编排层

不再是旧文档中“前端维护业务，daemon 只负责桥接”的简单结构。
