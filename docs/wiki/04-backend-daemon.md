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

TeamPack 会话的服务端任务创建会经过 [`src/server/team-runtime/task-assignment.ts`](../../src/server/team-runtime/task-assignment.ts)：

- 如果请求显式提供 `agent_id`，API 保留该选择，不由团队流程覆盖。
- 如果没有显式 `agent_id` 且 conversation 绑定了 `team_pack_id`，API 读取 TeamPack 并通过 `WorkflowPolicy.assignInitialTask()` 选择初始角色。
- 如果既没有显式 `agent_id`，也无法从 TeamPack workflow、runtime roster 或调用方 fallback 解析出负责人，API 返回明确失败，不会写入空字符串 `agent_id`。
- `tool.invoke` 的 `task_create` 复用同一分配逻辑，并把最终 agent 同步写入 SQLite 与 `TASKS.md`。
- 该服务端路径只依赖 repository 与 `src/lib/team-runtime`，不导入前端 store。

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

Daemon 的边界是执行编排，不是团队规则解释器：

- 前端 dispatch 已经把 `RuntimeAgentProfile` 解析成 `terminal:start` payload 中的 `agentId`、`engine`、`accountId`、prompt 上下文。
- A2A 使用 [`src/server/a2a/runtime-snapshot-provider.ts`](../../src/server/a2a/runtime-snapshot-provider.ts) 从 repository 和 Team Runtime Contract 读取当前会话 roster 与通信规则。
- 服务端任务创建使用 [`src/server/team-runtime/task-assignment.ts`](../../src/server/team-runtime/task-assignment.ts) 调用 `WorkflowPolicy.assignInitialTask()`。
- Daemon 不直接读取前端 store，也不在执行循环中手写 TeamPack workflow 或通信矩阵判断。

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

## 4.5 A2A 编排与团队协作规则

[`src/server/a2a/orchestrator.ts`](../../src/server/a2a/orchestrator.ts) 当前进入 possession migration：链式 A2A 不再只按消息路由理解，而是按“当前持球者 → 显式交接 → 下一持球者”的控制转移模型推进。

系统级控制平面规格见 [`specs/system-control-plane/spec.md`](../../specs/system-control-plane/spec.md)。A2A possession 是协作语义层，不应长期承担完整 runtime delivery。目标架构中：

- A2A 产生 pass intent 和 handoff packet。
- Dispatch Gateway 负责 policy、health、dedup、budget、secret gate 与 envelope 创建。
- Runtime Router 负责按 `toNodeId` 定向投递，而不是依赖广播式 socket 事件。
- daemon 作为 execution plane 只消费 execution envelope，并回报 `started`、`failed`、`completed`。
- Proof Log 记录 pass request、dispatch route、send、ACK、failure 和 completion。

兼容迁移期间，当前 `a2a:pass-offer` / `a2a:dispatch` / `a2a:agent-started` / `a2a:dispatch-failed` 事件仍保留，但它们应被视为 transport adapter，而不是最终的投递事实模型。

控制平面 P0 持久化已落地：

- `control_proof_event`：控制平面 proof timeline，关联 conversation、task、chain、pass、envelope、node、agent 和 actor。
- `runtime_node`：跨实例 runtime node 身份、能力、信任级别、心跳和可达状态。
- `agent_binding`：会话内 agent 到 runtime node 的绑定、忙闲状态和 active envelope。
- `execution_envelope`：统一执行信封，记录 source、intent、route、payload、TTL、nonce、生命周期状态和失败原因。

这些表当前先作为事实源基础和测试覆盖存在；direct user dispatch 与 A2A dispatch 迁入 `DispatchGateway` 是下一阶段。

当前兼容实现已经把现有执行入口接到轻量 `DispatchGateway`：

- daemon 启动时注册本地 runtime node `daemon:local`。
- browser socket 连接时通过 `runtime:hello` 注册 browser runtime node，并每 5 秒发送 `runtime:heartbeat`。
- daemon 每 5 秒检查 runtime node 心跳，2 次 miss 标记 `stale`，3 次 miss 标记 `unreachable`。
- `terminal:start` 会创建 `execution_envelope` 并记录 `dispatch.requested`、`dispatch.routed`、`dispatch.sent`、`dispatch.started`、`dispatch.completed/failed`。
- A2A 兼容路径会把 `chainId` 与 `passId` 传入 envelope，便于 proof timeline 串起 pass 与执行生命周期。
- 轻量 `SecretGate` 会阻止包含 API key、bearer token、private key、database URL 等明显敏感内容的 envelope。

尚未完成的部分是彻底移除兼容广播 transport，并让 executor 只消费 `ExecutionEnvelope`。

持球模型的持久化表包括：

- `a2a_possession_chain`：一次协作 episode，记录当前持球者
- `a2a_possession`：某个 holder 的连续控制期
- `a2a_pass`：一次显式交接，记录 offer/start/run 等阶段状态和失败原因
- `a2a_handoff_packet`：发送给下一 holder 的紧凑交接包

兼容迁移期间，旧的 `invocation_chain` 与 `chain_worklist` 仍保留为执行队列和历史可读结构；新 possession 表记录协作语义，旧 worklist 负责兼容现有客户端执行路径。

前端在用户消息进入 store 后会先尝试直接派发命中的 runtime agent。只有目标 agent 已经被 `dispatchToAgent()` 成功启动或接收后，前端才通过 `a2a:user-turn-created` 通知 daemon 创建 A2A chain，并把这些已由前端直接派发的初始 agent 登记为已开始的 pass；旧的 `a2a:user-message` socket 输入仍作为兼容入口保留。若新用户消息没有命中 agent，或命中但没有任何目标成功启动，daemon 会终止同会话旧 active chain，避免旧链路的延迟回复继续触发转交，也避免把未执行的目标误标为 `executing` 后产生假超时。

server-originated handoff 现在先生成 `a2a_pass` 与 `a2a_handoff_packet`，再发出 `a2a:pass-offer`。现有客户端仍通过兼容 `a2a:dispatch` 启动 agent；客户端启动成功后回发 `a2a:agent-started`，daemon 才会把 worklist entry 标为 `executing` 并把 possession 的当前持球者转移给目标 agent。客户端启动失败会回发 `a2a:dispatch-failed`，对应 pass 被标为 start 阶段 rejected，不再留下“看起来已执行但实际没人响应”的状态。

daemon 会把本地 backend 的 `done` 事件和 OpenCode bridge 的流结束统一视为 agent 完成信号。完成信号会先把 `agentResponseBuffer` 中的文本交给 A2A scanner，再清理缓存；因此 bridge 模式下的 agent 输出同样可以触发后续 `@mention` 转交。OpenCode bridge 必须用与本地 backend 一致的参数顺序调用 `opencode run --format json <prompt>`，并保留 system prompt override envelope；如果 bridge 输出没有成功解析出结构化 text 事件，daemon 才使用清理后的原始输出作为 A2A 扫描兜底。

agent 输出中的 `@mention` 不再自动变成转交。A2A 只接受带明确行动意图的交接，例如“@reviewer 请审查…”、“交给 @coder 实现…”。普通引用、否定句、代码块中的 `@agent` 不会唤醒目标 agent。非当前持球者的输出即使包含交接语义也会被拦截，因为只有当前 holder 可以传球。

“派发 / 分配 / 指派 @agent”这类状态总结也属于明确交接意图。对于 Mario 这类上游 agent 输出的 compact table，例如“TASK-001 @toad 运行中”，只要上下文明确说明正在派发，parser 会把它转换成 handoff intent，而不是当作普通提及忽略。同一个 holder 响应中产生的多个 idle 目标会在同一轮 dispatch cycle 中发出执行请求，以支持批量交接和并行唤醒。

如果 agent 输出提到的 `@agent` 不属于当前团队 roster，daemon 会把它记录为 A2A block 并向会话发送“当前团队没有可接收 @agent 的角色”。这类问题代表团队配置不匹配，不应被解读为消息投递超时。

`a2a:pass-offer` 是新的 server → client 交接请求；`a2a:dispatch` 是迁移期兼容事件。客户端收到兼容事件后调用 `dispatchToAgent()`；如果缺少可执行 runtime / 账号 / 会话上下文导致无法启动，会回发 `a2a:dispatch-failed`，daemon 将对应 worklist entry 标记为 error 并继续推进或完成 chain，避免“看起来已派发但目标 agent 永远不响应”的悬挂状态。

客户端组装 prompt 时必须保留 A2A 语义：`a2a:dispatch` 的 `fromAgentId` 会被包装成“跨角色协作消息”信封，再注入给目标 agent。该信封明确说明触发来源、上游指令与回声防护规则；A2A dispatch 不再追加普通用户消息层，避免目标 agent 把协作触发误判为用户输入或重复上下文。

当项目提供 Team Runtime `CommunicationPolicy` 时，A2A mention handoff 在写入 worklist 前检查协作规则：

- `fromAgentId === 'user'` 的直接用户派发不受该规则拦截。
- agent 发起的 `@mention` 如果被规则阻止，会写入 `a2a_audit_log` 的 `dispatch_blocked` 记录，并通过现有 `agent:event` system 事件提示“团队协作规则阻止了这次转交”。
- 未提供 policy provider 时，保持原有默认行为，不阻止已有 A2A dispatch。

policy 通过 `AgentMessenger` 的 `KanbanSnapshotProvider.getCommunicationPolicy(conversationId)` 可选边界注入；mention 扫描通过同一边界的 `getAgentMentionConfigs(conversationId)` 读取当前会话 roster。生产 daemon 使用 server-side runtime provider：读取 `conversation.team_pack_id`，通过 `teamPackRepo.getById()` 取得 TeamPack，再用 `resolveTeamRuntime()` 生成 TeamPack role roster 与协作规则。A2A server 代码只依赖 `src/lib/team-runtime` 的中立契约类型，不导入前端 store，也不直接解释 TeamPack 细节。

TeamPack 会话的 A2A mention pattern 来自 runtime role id 和 displayName（例如 `@planner` 与 `@Planner`）；没有 TeamPack 的会话回退到 DB `agents` roster。协作规则检查在 breadth/dedup 之前执行，因此被 TeamPack 规则阻止的 agent-to-agent handoff 不会被链路宽度限制掩盖；`fromAgentId === 'user'` 的直接用户派发仍保持原有行为。

A2A v2 当前使用 invocation chain 作为一次用户触发内的临时协作边界。新用户消息会中止同会话旧 active chain；dispatch prompt 只注入当前 chain 内 cursor 之后的协作消息，不会把旧用户触发的完成项带入新上下文。链路超时、重复内容、重复目标、ping-pong、持球者违规和通信规则阻断都会写入 `a2a_audit_log`。面向用户的超时文案不再使用笼统的“A2A 链超时终止 (120s)”，而是说明执行阶段或持球阶段超时。

## 4.6 Agent Backend 抽象

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

## 4.7 会话与调用追踪

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

## 4.8 Bridge / 本地 CLI / Mock

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

## 4.9 当前判断

当前后端应被理解为：

- 一个基于 Next.js API 的轻量应用后端
- 一个以 SQLite 为中心的数据持久化层
- 一个支持多引擎执行的 daemon 编排层

不再是旧文档中“前端维护业务，daemon 只负责桥接”的简单结构。
