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
- ACP 统一通路：经 Agent Catalog 查表 → `AcpBackend` → ACP JSON-RPC over stdio 驱动运行时（见 4.6）
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
  opencodeBridgeUrl?, // ⚠️ legacy：Bridge 执行路径已移除（见 §4.8），字段保留但不再驱动执行
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

[`src/server/a2a/orchestrator.ts`](../../src/server/a2a/orchestrator.ts) 当前进入 possession migration：链式 A2A 不再只按消息路由理解，而是按“active holder → 显式交接 → 一个或多个 branch holder”的控制转移模型推进。

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
- 当持久数据库已经升级为 acknowledgement-only envelope schema（存在 `revision`、`settled_at`）而 daemon 仍使用兼容控制面时，repository 会按实际表契约映射生命周期：先补齐 `drafted → validated → routed`，把 `started/completed` 收敛为 `acknowledged`，并让 acknowledgement 后的执行失败只更新 binding/proof；Gateway 只在合法的前置状态上产生 send/start/finish 副作用并返回是否实际应用，daemon 仅为已应用的转换广播 receipt，对 `blocked/rejected` 都立即停止；autonomy guard 同时以非终态 Invocation 判断真实执行是否仍活跃，bridge/backend 的成功、失败、超时与 setup failure 都会终结 Invocation，daemon 启动也会回收上次进程遗留的孤儿 Invocation，避免重复唤醒或永久抑制恢复。该兼容路径避免旧 daemon 触发 `invalid_execution_envelope_transition`，并在所有支持分支统一到新状态机后删除。
- 若共享开发数据库的 Invocation 表已升级为 managed lifecycle（存在 `outcome`、`started_at`、`terminated_at`、`revision`），兼容 repository 会把旧 daemon 的 `queued/running/succeeded/failed` 映射为 `planned/starting/running/terminated` 及对应 outcome；Session 确认只补充活动 Invocation 的 runtime identity，不提前终结或覆盖已终结结果。这样切回旧分支时，`@` 派发不会被数据库触发器以 `invalid_invocation_status` 拒绝。

尚未完成的部分是彻底移除兼容广播 transport，并让 executor 只消费 `ExecutionEnvelope`。

持球模型的持久化表包括：

- `a2a_possession_chain`：一次协作 episode，记录兼容 UI 使用的最新持球者
- `a2a_possession`：某个 holder 的连续控制期
- `a2a_pass`：一次显式交接，记录 offer/start/run 等阶段状态和失败原因
- `a2a_handoff_packet`：发送给下一 holder 的紧凑交接包
- `a2a_delivery`：迁移期 server-originated dispatch outbox，记录 payload、attempts、last_error 和 sent/deferred/started/failed 状态

兼容迁移期间，旧的 `invocation_chain` 与 `chain_worklist` 仍保留为执行队列和历史可读结构；新 possession 表记录协作语义，旧 worklist 负责兼容现有客户端执行路径。

前端在用户消息进入 store 后会先尝试直接派发命中的 runtime agent。只有目标 agent 已经被 `dispatchToAgent()` 成功启动或接收后，前端才通过 `a2a:user-turn-created` 通知 daemon 创建 A2A chain，并把这些已由前端直接派发的初始 agent 登记为已开始的 pass；如果用户一次命中多个 agent，daemon 会为每个成功目标登记独立 pass 和 open possession，而不是只承认第一个 holder。旧的 `a2a:user-message` socket 输入仍作为兼容入口保留。若新用户消息没有命中 agent，或命中但没有任何目标成功启动，daemon 会终止同会话旧 active chain，避免旧链路的延迟回复继续触发转交，也避免把未执行的目标误标为 `executing` 后产生假超时。

server-originated handoff 现在先生成 `a2a_pass` 与 `a2a_handoff_packet`，再写入 `a2a_delivery` 并发出 `a2a:pass-offer`。现有客户端仍通过兼容 `a2a:dispatch` 启动 agent；客户端启动成功后回发 `a2a:agent-started`，daemon 才会把 worklist entry 标为 `executing` 并为目标 agent 打开 possession。兼容字段 `currentHolderId` 只表示最新启动的 holder，真正的持球资格由 open possession 判断，因此 fan-out 后多个 branch holder 可以独立完成或继续传球。客户端启动失败会回发 `a2a:dispatch-failed`，对应 pass 被标为 start 阶段 rejected，不再留下“看起来已执行但实际没人响应”的状态。

daemon 会把 `AcpBackend` 的 `done` 事件视为 agent 完成信号。完成信号会先把 `agentResponseBuffer` 中的文本交给 A2A scanner，再清理缓存；因此 agent 输出可以触发后续 `@mention` 转交。所有运行时（opencode / claude / codex）现在统一经 ACP 产出 `AgentEvent`，不再有 per-engine 私有 stdout 解析。

ACP 文本事件是增量流。daemon 继续把每个 chunk 实时广播给浏览器，但同一 Invocation 内连续的文本只持久化为一条 `chat_message`；工具、错误和完成事件会关闭当前文本段。这样实时体验不受影响，历史消息也不会按单字或 token 碎片化。

agent 输出中的 `@mention` 不再自动变成转交。A2A 只接受带明确行动意图的交接，例如“@reviewer 请审查…”、“交给 @coder 实现…”。普通引用、通知、前置或后置明确否定（包括“不要”“不用/不必执行”“请勿/切勿”）以及代码块中的 `@agent` 不会唤醒目标 agent。非 active holder 的输出即使包含交接语义也会被拦截；fan-out branch holder 的输出则合法，即使兼容 UI 的最新 holder 指向另一个 branch。

“派发 / 分配 / 指派 @agent”这类状态总结也属于明确交接意图。对于 Mario 这类上游 agent 输出的 compact table，例如“TASK-001 @toad 运行中”，只要上下文明确说明正在派发，parser 会把它转换成 handoff intent，而不是当作普通提及忽略。同一个 holder 响应中产生的多个 idle 目标会在同一轮 dispatch cycle 中发出执行请求，以支持批量交接和并行唤醒。

如果 agent 输出提到的 `@agent` 不属于当前团队 roster，daemon 会把它记录为 A2A block 并向会话发送“当前团队没有可接收 @agent 的角色”。这类问题代表团队配置不匹配，不应被解读为消息投递超时。

`a2a:pass-offer` 是新的 server → client 交接请求；`a2a:dispatch` 是迁移期兼容事件。A2A server → client 事件必须发往对应 `conversationId` room，客户端在连接和切换会话时加入当前 conversation room，避免跨会话广播泄露任务内容。服务端会在发出兼容 dispatch 前写入 `a2a_delivery`，客户端重连或切换回会话时，daemon 会重发仍处于 active chain 且 worklist 仍在 `dispatching` 的 sent delivery。客户端收到兼容事件后调用 `dispatchToAgent()`；如果缺少可执行 runtime / 账号 / 会话上下文，会回发 `a2a:dispatch-failed`，daemon 将对应 worklist entry 标记为 error 并继续推进或完成 chain。若目标 agent 只是忙碌，客户端回发 `a2a:dispatch-deferred`，daemon 将 worklist entry 放回 queued、delivery 标记 deferred，并在目标 agent 变回 idle/done 后重试，避免忙碌目标被错误标记为失败或 `executing`。

客户端组装 prompt 时必须保留 A2A 语义：`a2a:dispatch` 的 `fromAgentId` 会被包装成“跨角色协作消息”信封，再注入给目标 agent。该信封明确说明触发来源、上游指令与回声防护规则；A2A dispatch 不再追加普通用户消息层，避免目标 agent 把协作触发误判为用户输入或重复上下文。

当项目提供 Team Runtime `CommunicationPolicy` 时，A2A mention handoff 在写入 worklist 前检查协作规则：

- `fromAgentId === 'user'` 的直接用户派发不受该规则拦截。
- agent 发起的 `@mention` 如果被规则阻止，会写入 `a2a_audit_log` 的 `dispatch_blocked` 记录，并通过现有 `agent:event` system 事件提示“团队协作规则阻止了这次转交”。
- 未提供 policy provider 时，保持原有默认行为，不阻止已有 A2A dispatch。

policy 通过 `AgentMessenger` 的 `KanbanSnapshotProvider.getCommunicationPolicy(conversationId)` 可选边界注入；mention 扫描通过同一边界的 `getAgentMentionConfigs(conversationId)` 读取当前会话 roster。生产 daemon 使用 server-side runtime provider：读取 `conversation.team_pack_id`，通过 `teamPackRepo.getById()` 取得 TeamPack，再用 `resolveTeamRuntime()` 生成 TeamPack role roster 与协作规则。A2A server 代码只依赖 `src/lib/team-runtime` 的中立契约类型，不导入前端 store，也不直接解释 TeamPack 细节。

server-side runtime provider 会把预设 RoleCard 与数据库自定义 RoleCard 一起传入 runtime resolver。这样 TeamPack role 只有 `roleCardId` 时也能得到正确角色边界，避免后端/实现者被合成为“只能提出建议”的顾问角色。默认团队的 `toad` 绑定 `preset-backend`，工程三件套的 `coder` 绑定实现类 RoleCard；启动 seed 会修正旧 TeamPack 中缺失或陈旧的预设 role snapshot。

TeamPack 会话的 A2A mention pattern 来自 runtime role id 和 displayName（例如 `@planner` 与 `@Planner`）；没有 TeamPack 的会话回退到 DB `agents` roster。协作规则检查在 breadth/dedup 之前执行，因此被 TeamPack 规则阻止的 agent-to-agent handoff 不会被链路宽度限制掩盖；`fromAgentId === 'user'` 的直接用户派发仍保持原有行为。

A2A v2 当前使用 invocation chain 作为一次用户触发内的临时协作边界。新用户消息会中止同会话旧 active chain；dispatch prompt 只注入当前 chain 内 cursor 之后的协作消息，不会把旧用户触发的完成项带入新上下文。链路超时、重复内容、重复目标、ping-pong、持球者违规和通信规则阻断都会写入 `a2a_audit_log`；审计写入失败会输出 daemon warning，但不会阻塞用户流程。面向用户的超时文案不再使用笼统的“A2A 链超时终止 (120s)”，而是说明 offer、run 或 holder idle 阶段超时；start 阶段超时配置已保留给 accepted/start 拆分后的协议。

Possession 迁移期仍双写 `invocation_chain` / `chain_worklist` 与 `a2a_possession_*` 表。跨 possession chain、possession、pass、handoff packet 的状态转换必须包在 SQLite transaction 中；daemon 启动时会从 SQLite 重建 active agent 状态、entry/pass 映射、task handoff 映射、accepted pass 去重集合和 dedup/ripple 内存状态，避免重启后重复 dispatch 或链路状态分叉。stale chain 清理使用每条 chain 自己的 `maxDurationMs`，不再使用固定 5 分钟或旧 120 秒阈值。

## 4.6 Agent Backend 抽象（ACP 统一通路）

当前 daemon 已将多运行时逻辑收敛为 **ACP 单一通路**。历史上按引擎分别实现的 `OpenCodeBackend` / `ClaudeBackend` / `CodexBackend`、`factory.ts` 的 engine `switch`、以及 `gemini` / `mock` 回退路径已全部移除（spec §8 退出条件）。

核心文件：

- [`src/server/agent/types.ts`](../../src/server/agent/types.ts) — `AgentBackend` 契约、`AgentEvent`、`AgentRun`
- [`src/server/agent/acp/acpBackend.ts`](../../src/server/agent/acp/acpBackend.ts) — **唯一** `AgentBackend` 实现，通过 ACP JSON-RPC over stdio 驱动运行时
- [`src/server/agent/acp/catalog.ts`](../../src/server/agent/acp/catalog.ts) — `loadCatalog()` + `createBackend(entry)`
- [`src/server/agent/acp/agentCatalog.seed.json`](../../src/server/agent/acp/agentCatalog.seed.json) — Catalog 启动事实源
- [`src/server/agent/acp/agentEventMapper.ts`](../../src/server/agent/acp/agentEventMapper.ts) — ACP `SessionUpdate` → `AgentEvent`
- [`src/server/agent/acp/runtimeSetup.ts`](../../src/server/agent/acp/runtimeSetup.ts) — `prepareAcpRuntime()` 每运行时文件系统 / 环境准备
- [`src/server/agent/capabilityRouter.ts`](../../src/server/agent/capabilityRouter.ts) — 按能力降级

当前模式（catalog-driven，无 engine switch）：

1. daemon 根据 `engine` 在 Catalog 中查表（`loadCatalog().find(e => e.id === engine)`）；**找不到条目直接抛错**，不静默回退（`gemini` / `mock` 无条目，无法经 ACP 执行）。
2. `prepareAcpRuntime(entry, ...)` 做每运行时准备：opencode 在隔离临时目录写 fallback config 并通过 `OPENCODE_CONFIG` 注入，不修改项目文件；codex 隔离 `CODEX_HOME`（复制必要配置到收紧权限的临时目录，turn 后幂等清理）；claude passthrough（认证来自主机）。
3. `createAcpBackend(entry, ...)` 构造 `AcpBackend`——经 `spawnCli`（cross-spawn，Windows .cmd/.bat 安全）spawn，完成 `initialize` → `session/new` → `prompt`，把 `session/update` 映射为统一 `AgentEvent`。
4. daemon 将 `AgentEvent`：转为 socket 事件、写入 repo、更新 session / invocation。

Catalog 三个条目（spec §2 / §5.1）：

| id | delivery | launcher | 认证 |
| --- | --- | --- | --- |
| `opencode` | 原生 | `opencode acp` | 主机 provider 配置 |
| `claude` | 适配器 | `npx -y @agentclientprotocol/claude-agent-acp@0.59.0` | Claude Code OAuth（非 API key） |
| `codex` | 适配器 | `npx -y @agentclientprotocol/codex-acp@1.1.2` | ChatGPT OAuth + 隔离 `CODEX_HOME` |

适配器属于额外依赖（ACP 组织维护），不能描述成厂商 CLI 的原生 ACP 能力。适配器版本锁定。新增运行时只需在 Catalog 加条目并验证，不再写 per-engine 解析 backend。

运行时监督当前已落地：Catalog 运行时校验与实际 launcher 精确锁版本；权限默认 fail-closed，通过 `ACP_PERMISSION_MODE=allow_once` 可由运维显式开放单次授权；自主交付另可把仍有效的 `GoalContract.authorization.allowCodeChanges=true` 收敛映射为 ACP `edit` 类项目文件修改的 `allow_once`，不扩散到命令执行、删除、移动或 Provider 动作；取消采用 ACP cancel → TERM → KILL；result 不依赖 child `close` 才能解析；全局并发、事件队列、单事件、累计输出和 stderr tail 均有上限；stderr 只保留脱敏后的有界尾部；daemon shutdown 会终止全部活跃 run。

ACP timeout 分为两层：平台配置的 `CLI_TIMEOUT_MS` 是 idle timeout，任意 ACP session update 都会续期；AcpBackend 另有独立 hard max turn timeout，限制持续产生更新但始终不结束的异常进程。daemon 对 runtime 原生工具采用大小写无关判断，避免 OpenCode 的小写 `read/write/bash` 被当成平台自定义工具重复执行。

延迟项（坦诚记录）：会话恢复（`session/load` 未接线，`supportsResume:false`）；需要人工交互的 confirm profile；跨运行时模型规范化；MCP 桥接（`mcpServers:[]` 当前为空）。CapabilityRouter 丢弃 resume 时 daemon 不再执行 fresh-session 自动重放，避免失败后重复副作用。详见 `architecture/cli-integration.md` 与 `specs/acp-runtime-integration/spec.md`。

Claude ACP 会话保留运行时原生的 `Task` / `Agent` 子代理能力，并通过 `_meta.claudeCode.options.forwardSubagentText` 把子代理输出送回父会话。ACP adapter 负责在 turn 内等待原生子代理收敛；Daemon 以 `toolCallId` 配对开始和结果事件，只在尚有未配对调用时显示 `run.background_waiting`，配对完成后恢复前台运行。平台 Task Graph、Harness 与 A2A 继续管理跨角色的业务交付，运行时原生子代理则作为 Invocation 内部执行能力被兼容。

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

## 4.8 执行通路（ACP-only）

当前 agent 执行只有一条通路：**ACP**。daemon 经 Catalog 查表 → `AcpBackend` → ACP JSON-RPC over stdio 驱动运行时（opencode 原生 / claude、codex 适配器）。具体职责见 4.6。

历史上曾存在 Bridge（`opencodeBridgeUrl`）、本地 CLI per-engine 解析、`mock` / `gemini` 回退等并行路径；这些 bespoke backend 与 `factory.ts` 的 engine `switch` 已在 ACP 迁移中移除（spec §7 / §8）。`tmux` 作为可选观察/执行模式仍可接入 daemon，但 ACP 是 agent 执行的唯一 backend 通路。

补充说明：

- `gemini` / `mock` 没有 Catalog 条目，无法经 ACP 路径执行（不再是“回退到 OpenCodeBackend”，而是直接抛错）。
- 适配器（claude / codex）的进程树是两层（`npx` → node 适配器 → 运行时），因此 `AcpBackend` 使用 `tree-kill` 清理，而非裸 `child.kill()`。

## 4.9 当前判断

当前后端应被理解为：

- 一个基于 Next.js API 的轻量应用后端
- 一个以 SQLite 为中心的数据持久化层
- 一个支持多引擎执行的 daemon 编排层

不再是旧文档中“前端维护业务，daemon 只负责桥接”的简单结构。

## 4.10 Skill 包与运行时编译

Skill 执行当前不再直接依赖 runtime 原生目录发现。`src/server/skills/skill-runtime.ts` 是统一入口：安装时校验 `<name>/SKILL.md`、生成稳定 content hash、写入受管不可变目录并记录 revision；执行时根据 `agent_skill` 绑定编译固定版本。

每轮 dispatch 在 runtime 选择之前完成 Skill 编译。浏览器 Socket 派发也只提交原始输入并统一进入服务端 Harness，不能直接调用 runtime。`SKILL.md` 正文进入 capability context，`references/`、`scripts/`、`assets/` 只成为按需路径索引。ContextReport 记录 eligible、activated、loaded、revision、hash、reason 和 token；必需 Skill 未实际进入最终 Prompt 时阻断执行。OpenCode 项目原生 skillPaths 会过滤掉与平台本轮托管 Skill 重名的目录，非重名原生 Skill 保持可发现。

旧 `skill.content + skill_file` 仍是兼容编辑入口；名称、描述、正文、config 或文件变化会使活动 revision 失效，并在下一次使用时生成新版本。旧名称迁移使用稳定、防碰撞的 package slug，不改变 Skill ID、显示名或绑定。工具 config 纳入 revision hash并随 revision 固化。包校验失败会写入有界失败 span/proof、阻断执行并返回稳定 reason code，失败 decision 已可从观测投影和调试页查看。长期设计与错误码见 `docs/technical/execution/skill-package-progressive-loading.md`。

## 4.4 Agent Session 身份边界

Daemon 不接受浏览器缓存作为会话恢复依据。正式 dispatch 必须携带 `conversationId` 或 `projectId`；缺失 scope 时返回 `session_scope_missing`，不再落入共享的 `default` scope。

每次 dispatch 先取得或原子创建 `(conversation_id, agent_id)` 唯一的 active Logical Agent Session，再创建引用它的 Invocation。Logical Session 尚未绑定 runtime id 时，ACP 使用 `session/new`，首个返回 id 通过 compare-and-set 写入；已经绑定时使用 `session/load`。任何不同 id 都视为 `session_identity_changed`，不会覆盖数据库状态。timeout、cancel 或 adapter 退出不会自动 seal Session，下一轮仍恢复原 id。

Runtime Session 的 cwd 也必须稳定：无 taskId 的同项目同 Agent 使用固定 `task-adhoc/workdir`，不能按 dispatch 时间戳换目录。ACP 明确返回 `Resource not found` 时使用 `acp_session_not_found`，daemon 将失效 generation 封存为 `runtime_resource_not_found`。若 adapter 只返回普通 `acp_session_load_failed`，当前 Invocation 仍失败关闭且不重放 prompt；下一次独立 dispatch 发现该持久失败后封存旧 generation 为 `runtime_session_load_failed`，再创建新 generation，避免永久重复加载已失效绑定。

前端 `agentSessions` 是服务端状态的显示缓存：hydrate 时以 `/api/state.activeSessions` 整体替换，不与 localStorage 合并，也不在 `terminal:start` 中回传 session id。

首次 `session/new` 的 resource 可能直到 prompt 成功结束才由 adapter 持久化。因此新 binding 在首个 Invocation 成功前属于 unconfirmed：若该轮取消、超时或失败，daemon 清除该 binding；若 daemon 在清理前异常退出，下一次 dispatch 会根据“存在 Invocation 记录但从未成功”的证据做同样的预检修复。已经成功使用过的 confirmed binding 不执行此恢复，load 失败时保留原 identity 并向用户报告错误。

角色可以显式配置有序的多个执行账号。Harness 默认选择第一个可用账号，并对 active Session 已成功确认的账号保持跨任务粘性；如果最近的独立执行以 `acp_empty_completion` 且没有可见副作用结束，则下一次 dispatch 在同一 conversation 内跳过连续空响应的账号，即使恢复动作切换到了另一条 task。只有带实际 `runtime_id`、账号和成功 outcome 的真实执行才会清除此前失败窗口；A2A 占位、兼容投影等没有 runtime 身份的合成 Invocation 不得冒充成功 checkpoint。工具已经活动但缺少最终文本时使用 `acp_tool_completion_missing` 并失败关闭，不进行账号重放。Invocation 记录实际 `runtime_id`；daemon 发现新 profile 与旧 Session 最近一次 Invocation 的 runtime/engine/account 不一致时，会以 `runtime_profile_changed` 封存旧 generation 后再 provision，避免跨 runtime 恢复错误。该机制不读取或借用角色配置外的全局账号。

并行 A2A 派发的恢复归属按 `(taskId, agentId)` 计算。Execution envelope 的 `acknowledged` 只代表 admission 成功；真正的失败、完成和账号回退依据 Invocation 终态。若同一任务的实现者失败而评审者随后完成，评审者的完成不能覆盖实现者的失败，Supervisor 应优先恢复失败的实现者，并让下一次独立 dispatch 选择其备用账号。协调者 Invocation 期间新建或推进其他 Task Graph 节点同样属于权威进展，不能把已经成功拆分并运行子任务的根协调者误判为“完成但无进展”。`in_review` 节点若没有活跃 review dispatch，autonomy guard 会立即补发 `review_requested`；超过停滞阈值后才使用 `stale_review_gate`。
