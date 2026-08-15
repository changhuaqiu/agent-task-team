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
- task create/update/updateStatus
- message append
- dispatch enqueue（dispatch 持久化入队）
- ATH breakdown 初始化

Task 取消统一走 `/api/task-graph` 的 `cancelTask` owner command。Session create/bind/seal 与 Invocation create/transition 属于服务端 Runtime owner，不向浏览器 mutation 暴露；前端只读取 `/api/state` 与 runtime projection。

Phase 读取与写入统一由 `/api/phases` 承担；通用 mutation 不再重复暴露 phase upsert/delete。

TeamPack 会话的服务端任务创建会经过 [`src/server/team-runtime/task-assignment.ts`](../../src/server/team-runtime/task-assignment.ts)：

- 如果请求显式提供 `agent_id`，API 保留该选择，不由团队流程覆盖。
- 如果没有显式 `agent_id` 且 conversation 绑定了 `team_pack_id`，API 读取 TeamPack，并从 `TeamRuntime.initialAgentId` 取得初始角色。
- 如果既没有显式 `agent_id`，也无法从 TeamPack workflow 或 runtime roster 解析出负责人，API 返回明确失败，不会写入空字符串 `agent_id`；生产调用链不存在另一套调用方 fallback。
- invocation-scoped Skill/MCP 的 `task_create` 通过 `skill-tool-executor` 写入 SQLite 与 `TASKS.md`；浏览器 mutation 不具备 Agent 工具执行权。
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

数据库包含以下表（migration v2 新增 skill 相关 3 张表，v4-v5 新增 dispatch 追踪列）：

`task` 表新增列：
- `claimed_at`、`started_at`、`completed_at` — dispatch 生命周期时间戳
- `lease_expiry` — claim 过期时间，用于僵尸任务恢复
- `work_dir` — agent 执行工作目录路径

`invocation` 表新增列：
- `dispatch_status` — 内部 dispatch 状态（queued/claimed/running/completed/failed）
- `token_usage` — JSON 格式 token 用量数据（per-model）
- `lease_expiry` — claim 过期时间

- `conversation`、`task`、`chat_message`、`agent_session`、`invocation`、`platform_event` — 当前业务主数据与事件事实
- `agent_event` — 仅保留的历史兼容表，不再承担当前事件读写 owner
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
- `role_cards` 表：`id TEXT PK, data TEXT NOT NULL, is_preset INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`，其中 `data` 列以 JSON 存储完整 RoleCard（含 CapabilityProfile）
- `skillRepo` — skill CRUD、文件管理、agent 绑定（[`skill-repo.ts`](../../src/server/repositories/skill-repo.ts)）

新增模块：
- [`src/server/workdir-manager.ts`](../../src/server/workdir-manager.ts) — WorkdirManager：统一拥有 per-task cwd 解析、GC 元数据与 Worktree GC；路径编码和 GC row 属于内部实现，不生成无人消费的 session/role/team sidecar 文件。逻辑与 runtime session 持久化由 `sessionRepo` 唯一拥有
- [`src/lib/agent-context/layers/toolLayer.ts`](../../src/lib/agent-context/layers/toolLayer.ts) — 从 skill.config.tools 生成 tool 定义注入 prompt
- [`src/server/task-file-service.ts`](../../src/server/task-file-service.ts) — TaskFileService：md 读写解析（ParsedTask + ParsedBlocker + 格式兼容）
- [`src/server/task-file-watcher.ts`](../../src/server/task-file-watcher.ts) — TaskFileWatcher：chokidar 文件监听 + DB 创建/更新 + Socket 广播
- [`src/server/skill-tool-executor.ts`](../../src/server/skill-tool-executor.ts) — Skill Tool 执行器：直接 DB 查询 + 文件双写
- [`src/server/skill-tool-router.ts`](../../src/server/skill-tool-router.ts) — 正式平台 Tool 名称 allowlist

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
- 服务端任务创建使用 [`src/server/team-runtime/task-assignment.ts`](../../src/server/team-runtime/task-assignment.ts) 读取 `TeamRuntime.initialAgentId`，为空时才回退到 runtime roster 首成员。
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
  engine?,
  runtimeId?,
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
- `runtimeId`
- `accountId`
- `force`

### 输出事件

- `project:view` — 带版本和 `projectId` 的 Runtime/ACP 展示信封，只向项目 room 投递
- `task.sync` — 任务文件变更同步（来自 TaskFileWatcher，含 tasks + blockers + conversationId）
- `task.state` / `task.notification` / `task.wakeup` — 项目任务展示事件；浏览器不负责自动 dispatch
- `a2a:*` / `dispatch.receipt` — 项目协作展示事件；执行和失败处理留在服务端

除系统级 `runtimes:update` 外，项目事实不得使用全局 `io.emit`；必须携带 `projectId` 并投递到同名 room。

## 4.5 A2A 编排与团队协作规则

当前 A2A 只保留 `A2ACollaborationRepository` 这一套权威聚合，不再处于双写迁移期：

- `a2a_possession_chain` 表示一次 Human turn 或 Agent outcome 发起的协作；
- `a2a_possession` 表示某个 holder 的连续控制权；
- `a2a_pass_group` 表示单分支 transfer 或多分支 fan-out 的原子提交与 join；
- `a2a_pass` 表示每条交接分支；
- `a2a_handoff_packet` 保存目标、动作、决策、证据、约束和开放问题。

Human 在 WebUI 的行为可以主动触发事件，但浏览器不是控制面。消息先持久化，再由
`HumanA2ACommandService` 校验 roster，必要时终止上一 Human turn，并原子创建 Chain、
Pass Group、Pass、HandoffPacket 与 AgentInbox Command。UI 只提交 Human Command 和显示
`a2a.snapshot`，不发送 Runtime started/failed/completed 回执，也不自行重派。

Agent 不能靠最终文本或 `@mention` 创建平台协作。WorkContract Agent 只能提交结构化
`handoff_to_agent` Outcome；Outcome admission 通过后，durable
`A2AOutcomeProcessManager` 调用 A2A owner。`A2ACommandGuard` 在写入前统一校验当前
conversation roster 和 `TeamRuntime.explainHandoffBlock()` 的单次准入结果，显式 Human Command 只豁免 agent-to-agent
矩阵，不豁免 roster。

所有下游执行先进入持久 `AgentInbox`。Inbox admission 只把 Pass 推进到 `starting`；
`runtime.invocation.started` 才创建 receiver Possession 并把 Pass 置为 `started`。
Runtime 终止、Inbox expired/cancelled 由 `A2ALifecycleProcessManager` 按 start/run 阶段
失败 Pass。receiver 的成功型结构化 Outcome 才完成 Possession；`report_blocked` 与
`request_human_decision` 会把父 Pass 置为 `blocked`、撤销 receiver Possession，并为
source holder 创建 recovery Possession 与恢复 Inbox，绝不按成功分支汇合。

Pass Group 只有在全部分支产生真实终结结果后才结算。全成功进入 `completed`；任一
`blocked/rejected/timeout/error` 则进入 `recovering`，成功分支事实保留。hop budget、
祖先 holder 循环、source revision、幂等内容漂移和非法 holder 都由聚合拒绝。

整条链继承触发它的根 correlation。Chain/Group/Pass/Possession/Inbox ID 只作为 aggregate
identity 或 causation，不能替换 trace。所有 A2A domain event 与下游 Inbox Command 因而
可以和 Delivery、Invocation、WorkContract、Outcome 一起通过
`PlatformEventLog.listTrace(correlationId)` 查询。

历史 `A2AOrchestrator`、`invocation_chain`、`chain_worklist`、`a2a_delivery`、
`a2a_work_item`、`a2a_work_cursor`、mention parser、运行时文本 A2A completion 和
`a2a:user-turn-created` 兼容协议均已移除。当前长期契约见
[`platform-harness-state-machine-design.md`](../technical/execution/platform-harness-state-machine-design.md)
与[已归档实施规格](../archive/specs/platform-harness-state-machines/spec.md)。

## 4.6 Agent Backend 抽象（ACP 统一通路）

当前 daemon 已将多运行时逻辑收敛为 **ACP 单一通路**。历史上按引擎分别实现的 `OpenCodeBackend` / `ClaudeBackend` / `CodexBackend`、`factory.ts` 的 engine `switch`、以及 `gemini` / `mock` 回退路径已全部移除（spec §8 退出条件）。

核心文件：

- [`src/server/agent/types.ts`](../../src/server/agent/types.ts) — `AgentBackend` 契约、`AgentEvent`、`AgentRun`
- [`src/server/agent/acp/acpBackend.ts`](../../src/server/agent/acp/acpBackend.ts) — **唯一** `AgentBackend` 实现，通过 ACP JSON-RPC over stdio 驱动运行时
- [`src/server/agent/acp/catalog.ts`](../../src/server/agent/acp/catalog.ts) — `loadCatalog()` + `createBackend(entry)`
- [`src/server/agent/acp/agentCatalog.seed.json`](../../src/server/agent/acp/agentCatalog.seed.json) — Catalog 启动事实源
- [`src/server/agent/acp/agentEventMapper.ts`](../../src/server/agent/acp/agentEventMapper.ts) — ACP `SessionUpdate` → `AgentEvent`
- [`src/server/agent/acp/runtimeSetup.ts`](../../src/server/agent/acp/runtimeSetup.ts) — `prepareAcpRuntime()` 每运行时文件系统 / 环境准备

当前模式（catalog-driven，无 engine switch）：

1. daemon ingress 先拒绝未知或不匹配的显式 engine/runtime（完全省略时才默认 OpenCode），再根据 `engine` 在 Catalog 中查表；找不到条目直接抛错，不构造平行 backend。Google/Gemini 账号解析为 `opencode`，由显式 Google provider/model 配置和 Catalog 条目执行。
2. `prepareAcpRuntime(entry, ...)` 做每运行时准备：opencode 在隔离临时目录写 fallback config 并通过 `OPENCODE_CONFIG` 注入，不修改项目文件；codex 隔离 `CODEX_HOME`（复制必要配置到收紧权限的临时目录，turn 后幂等清理）；claude passthrough（认证来自主机）。
3. `createAcpBackend(entry, ...)` 构造 `AcpBackend`——由该唯一 backend 直接经 `cross-spawn`（Windows `.cmd/.bat` 安全）启动进程，完成 `initialize` → `session/new` → `prompt`，把 `session/update` 映射为统一 `AgentEvent`；不保留单调用者透传 spawn 模块。
   `AcpBackend` 同时是终止事件的唯一归一化 owner：每个事件流恰好包含一个 `done`，daemon 不再对返回流做第二次包装或补写。
4. daemon 通过 `AcpRuntimeEventCoordinator` 驱动 canonical 生命周期，并由其内部
   `RuntimeAgentEventBridge` 将 `AgentEvent` 归一化为 `runtime.*` Platform Event。
   Socket、消息、Invocation、A2A outcome 与 observation 均从该事件流消费；原始
   text/thinking delta 仅作为低延迟瞬态传输，不是持久事实。

### 4.6.1 Platform Event Runtime

`platform_event` 是新的统一事件日志。事件使用 `stream_key + stream_sequence` 做局部
严格排序，使用 `dedupe_key` 做幂等写入，并保留 project、ProjectAgent、Invocation、
aggregate、actor、correlation 和 causation 引用。migration 按 `_schema_version`
实际已记录集合判断缺失版本，不再只依赖最大版本号，避免隔离分支先合入高版本后永久
跳过较低 migration。

当前生产链路：

- `AcpRuntimeEventCoordinator` 是 daemon 的 canonical 接缝，覆盖 Invocation
  accepted、started、Session binding/confirm、活动、正常终态与启动失败终态；
- `RuntimeEventPublisher` 在 SQLite immediate transaction 内按持久事件校验状态，
  即使多个 publisher 实例竞争，也不会在 terminated 后追加活动；
- `RuntimeAgentEventBridge` 把现有 text/thinking/plan/tool/error/usage 信号归一化为
  Runtime 活动事件，并维护 turn-scoped segment 与 legacy tool call 关联；文本和
  thinking delta 只实时广播，事件日志仅写完成的合并段；ACP 工具中间状态不生成
  终态，`failed` 与 `completed` 分别写入失败和完成事实；
- Runtime publisher 拒绝 accepted 前的活动和 terminated 后的新活动；
- canonical append 失败会终止当前执行路径；Socket live projection 失败仍与事实写入隔离。

daemon 启动时同时启动 `PlatformEventRuntimeWorker`。worker 注册稳定 handler id，启动时
从 `platform_event` 回补缺失 delivery、回收过期 lease并建立基于 AUTOINCREMENT ingestion
offset 的 handler cursor；运行期只发现 cursor 之后的新事件，再以 generation-fenced
单一自调度循环 drain durable handler，不重复全表扫描或叠加 poll。启动 recovery 失败会在
后续 tick 重试，成功前不进入增量模式。
`RuntimeInvocationProjection` 只消费
`runtime.invocation.accepted/started/terminated`，维护可查询的 Invocation 生命周期视图；
该表可清空后完全从 `platform_event` 重建，不是新的事实源。handler 执行以 attempt token
fencing，活跃期间续租，超时通过 `AbortSignal` 协作取消后才允许同 stream 重试。
`RuntimeMessageProjection` 与 `RuntimeObservabilityProjection` 也是 durable、按 event id
幂等的可重建读模型。migration 51 为切换前已由旧链路处理的 Runtime Event 回填 projection
receipt，避免首次启动时重复生成历史消息或 span；切换后的新事件由 Dispatcher 投影。
该 cutover 以升级时现有消息/span 读模型为权威快照；它不会自动猜测旧链路曾被
best-effort catch 掩盖的单条副作用缺口。若审计发现这类遗留缺口，应在受控 rebuild 中
删除对应 receipt/读模型后重放，而不是在正常启动时全量补写。
`RuntimeSocketProjection` 从 canonical 事件产生 plan/tool/warning/usage/terminal UI 事件；
实时 text/thinking delta 也使用项目级 `project:view` 信封，完成段仍以
`runtime.*.segment.completed` 持久化。

daemon 还启动持久 `AgentInboxScheduler`。`agent_inbox_item` 是 Agent Command 的服务端
事实源：按 project + ProjectAgent 保证同一 Agent 同时最多一个 claim，并禁止延迟的队首
被后续 item 超车；使用 lease token 隔离过期 worker，Harness 异步接管期间持续 heartbeat，
在 lease 过期或 Harness 返回 busy 时重新排队。不同 Agent 的 settlement 可并发。enqueue、claim 和恢复
分别与 `agent.work.enqueued/claimed/recovered` coordination 事件同事务写入。
`AgentInboxRouter` 只把 domain event 解析为幂等 Inbox Command，不直接启动 Runtime；
Scheduler claim 后才通过 Harness 提交执行。`dispatch.enqueue` API 已改为写 Inbox，
不再伪造空引擎 invocation；浏览器 `pendingDispatches` 仅是按项目从服务端恢复的显示投影，
写入使用稳定 idempotency key 确认并重试；请求失败只表示提交结果未知，不被当成服务端未写入，
未确认项不会因 Runtime 终态被移除。移除、清空和强制发送均先按 project + ProjectAgent +
idempotency key 由服务端确认取消并重新查询；终态后浏览器也以 scoped 查询刷新，不再按本地
FIFO 猜测或自行重派发。

9 个领域 owner 现已在领域表写入事务内同步追加 typed domain event：task、review、
autonomous delivery、A2A、execution envelope、agent binding、runtime node、
invocation 与 session。inline seam 只做状态守护和事件 append，不做网络 I/O 或 fan-out；
`DomainEventPublisher` 失败会回滚对应领域写入。Dispatcher 下半部注册
`task-wakeup-router:v1` 以及 task/review 两个稳定的 delivery Process Manager handler：
Router 只创建 Inbox Command，并在恢复历史事件时核对当前 task 状态；终态事实会取消尚未
claim 的旧命令。Process Manager 只调用 delivery advancement port；该 port 以 source
event 幂等持久接纳请求，delivery worker 在 `DeliveryControlRuntime.advance()`
真正成功前不确认完成，失败会重新排队。内部 `DeliveryControlProcessManager` 依据权威
快照计算动作；Control Plane 持久层统一封装 claim、lease、fencing 与恢复规则。
`task-notification-publisher` 尾部的 delivery 直接 reconcile 已删除，startup/periodic
reconcile 仅保留为 crash/retry 恢复触发器。

兼容双写已经退出：daemon 不再持久化 `agent_event`，`event.append` mutation 已删除，
`forwardAgentEvent()` 的消息、UI、observability 与 A2A 缓冲副作用已由 canonical 消费者
替代。A2A completion 从该 Invocation 的完成消息段重建输出，不再读取进程内文本缓冲。
长期契约见
[`platform-runtime-event-model.md`](../technical/execution/platform-runtime-event-model.md)。

Catalog 三个条目（spec §2 / §5.1）：

| id | delivery | launcher | 认证 |
| --- | --- | --- | --- |
| `opencode` | 原生 | `opencode acp` | 主机 provider 配置 |
| `claude` | 适配器 | `npx -y @agentclientprotocol/claude-agent-acp@0.59.0` | Claude Code OAuth（非 API key） |
| `codex` | 适配器 | `npx -y @agentclientprotocol/codex-acp@1.1.2` | ChatGPT OAuth + 隔离 `CODEX_HOME` |

适配器属于额外依赖（ACP 组织维护），不能描述成厂商 CLI 的原生 ACP 能力。适配器版本锁定。新增运行时只需在 Catalog 加条目并验证，不再写 per-engine 解析 backend。

运行时监督当前已落地：Catalog 运行时校验与实际 launcher 精确锁版本；权限默认 fail-closed，通过 `ACP_PERMISSION_MODE=allow_once` 才允许单次授权；取消采用 ACP cancel → TERM → KILL；result 不依赖 child `close` 才能解析；全局并发、事件队列、单事件、累计输出和 stderr tail 均有上限；stderr 只保留脱敏后的有界尾部；daemon shutdown 会终止全部活跃 run。

ACP timeout 分为两层：平台配置的 `CLI_TIMEOUT_MS` 是 idle timeout，任意 ACP session update 都会续期；AcpBackend 另有独立 hard max turn timeout，限制持续产生更新但始终不结束的异常进程。daemon 对 runtime 原生工具采用大小写无关判断，避免 OpenCode 的小写 `read/write/bash` 被当成平台自定义工具重复执行。

会话恢复已通过 ACP `session/load` 接线；已有 runtime session id 时必须由 initialize 握手声明 `loadSession`，否则失败关闭，不静默新建会话或重放 prompt。延迟项只剩需要人工交互的 confirm profile与跨运行时模型规范化。平台 MCP 已由 daemon 按 Invocation 注入 loopback-only、短期 bearer grant，并在 turn 完成后撤销；权限边界见 `docs/technical/execution/four-agent-pr-review-loop.md`。其余 ACP 约束详见 `architecture/cli-integration.md` 与 `specs/acp-runtime-integration/spec.md`。

## 4.7 会话与调用追踪

daemon 当前已经具备会话级跟踪：

- `sessionRepo.getOrCreateActive()`
- `sessionRepo.bindRuntimeSessionId()` / `confirmRuntimeSessionId()` / `releaseUnconfirmedRuntimeSessionId()`
- `sessionRepo.sealIfLatestInvocationLoadFailed()` / `sealIfExecutionProfileChanged()`
- `sessionRepo.incrementMessageCount()` / `seal()`

调用级跟踪：

- `invocationRepo.create()`
- `invocationRepo.transition()`
- `invocationRepo.updateDispatchStatus()` — 更新 dispatch 状态和 token 用量
- `invocationRepo.listRecent()` — 为 State API 提供最近调用投影

Invocation 状态校验、合法迁移矩阵和错误构造是 repository 内部实现；调用方只提交 lifecycle transition 并消费 row/result，不导入第二套状态机 helper。

同样，Autonomous Delivery / Execution Envelope 的内部错误类、Inbox/runtime event 集合、Evaluation 默认 ID 与 Git/Webhook 校验常量不属于跨模块 interface；调用方只消费 owner 的稳定结果、reason code 与持久化生命周期。ACP/GitHub 测试 double 统一位于 `src/test-helpers/`，不进入生产 server 模块树。

这使系统能记录：

- 某个项目下某个 agent 的会话链
- 每次执行的输入、状态和退出结果

## 4.8 执行通路（ACP-only）

当前 agent 执行只有一条通路：**ACP**。daemon 经 Catalog 查表 → `AcpBackend` → ACP JSON-RPC over stdio 驱动运行时（opencode 原生 / claude、codex 适配器）。具体职责见 4.6。

历史上曾存在 HTTP Bridge、本地 CLI per-engine 解析、`mock` / `gemini` 回退和 tmux 直跑厂商 CLI 等并行路径；这些 bespoke backend、`factory.ts` 的 engine `switch` 与 tmux 执行旁路均已在 ACP 迁移和架构减法中移除。ACP 是 agent 执行的唯一 backend 通路。

补充说明：

- 正式 Agent engine 只接受 `opencode` / `claude` / `codex`。Google、Kimi、OpenCode、Other API Key 账号映射为 `opencode`，连接验证和正式执行共用确定性的 OpenCode provider/model/env 配置；不再保留 Gemini/Kimi 私有 CLI 或空 echo 验证。上述 provider 的 OAuth 不进入执行解析；历史浏览器对象与不可变评估快照中的 Gemini runtime 标识在各自读取边界迁移，其他未知输入失败关闭。
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

Runtime Session 还绑定创建它的执行 Profile：`engine + runtimeId + accountId`。daemon 在创建
Invocation 前比较本次解析出的 Profile；任一字段变化都先把旧 generation 封存为
`runtime_profile_changed`，再创建新 generation 并走 `session/new`。历史 Session 的 Profile
由最近一次成功 Invocation 的 engine/account 安全回填；不匹配时不尝试 `session/load`。这避免
把 Codex 创建的 session id 交给 Claude（或把一个账号的 session id 交给另一个账号）后才收到
`Resource not found`。

前端 `agentSessions` 是服务端状态的显示缓存：hydrate 时以 `/api/state.activeSessions` 整体替换，不与 localStorage 合并，也不在 `terminal:start` 中回传 session id。

首次 `session/new` 的 resource 可能直到 prompt 成功结束才由 adapter 持久化。因此新 binding 在首个 Invocation 成功前属于 unconfirmed：若该轮取消、超时或失败，daemon 清除该 binding；若 daemon 在清理前异常退出，下一次 dispatch 会根据“存在 Invocation 记录但从未成功”的证据做同样的预检修复。已经成功使用过的 confirmed binding 不执行此恢复，load 失败时保留原 identity 并向用户报告错误。
