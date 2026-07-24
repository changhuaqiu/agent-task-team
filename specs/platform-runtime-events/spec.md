# 平台 Runtime 事件模型

> 状态：active
> 日期：2026-07-24
> 事实源：本目录
> 依赖：`system-control-plane`、`acp-runtime-integration`、`agent-session-identity`
> 设计文档：`docs/technical/execution/platform-runtime-event-model.md`（顶层设计 + ADR）
>
> 本 spec 是**可实施契约的事实源**。设计动机、OS 中断模型隐喻、ADR 记录、
> 现状差距分析与 A2A 完整时序见设计文档。

## 1. 问题

当前执行链同时使用 `AgentEvent`、`AgentResult`、Socket 事件、`agent_event`、
`control_proof_event` 和 observation span 表达执行事实。`daemon.forwardAgentEvent()`
还同时负责 Session、聊天、A2A、工具、UI 和可观测投影，导致：

- `done`、`error`、进程退出和 `AgentResult.status` 重复表达终态；
- ACP 原始活动与项目业务事实缺少清晰 owner；
- 多 Agent 项目没有持久 Inbox 作为事件到激活之间的协调事实；
- 消费者依赖进程内回调，无法统一重放、去重和恢复；
- 流式文本、生命周期事实和调试数据使用相同处理方式。

## 2. 目标

建立一套统一事件信封，并让**整个平台基于事件驱动**——不仅 Runtime 执行，还包括
协作、任务、交付等所有领域流转。明确四类事件：

1. 领域事件：项目业务事实；
2. 协调事件：工作如何进入某个 ProjectAgent；
3. Runtime 生命周期事件：一次 Invocation 的状态；
4. Runtime 活动事件：Invocation 内的消息、工具、权限和用量活动。

四类事件都是主线，不分先后。第一实现切片先落地通用事件日志和 Runtime 事件发布器，
并由 daemon 对现有 `AgentEvent` 路径做兼容双写；随后按切片 2-6 迁移协调事件、
领域事件、消费者与 Process Manager（见 §9）。

事实源立场：事件 = 协调信号，领域表仍是事实源。详见设计文档 ADR-001。

## 3. 非目标

- 本切片不把项目改造成完整 Event Sourcing 系统。
- 不要求所有现有领域表立即由事件重建。
- 不让 Agent 直接订阅事件总线。
- 不删除现有 `agent_event`、`control_proof_event` 或 Socket 兼容协议。
- 不改变 Task、A2A、Review、Delivery 的事实 owner。
- 不在用户主界面暴露 Event、Runtime、Envelope 等内部术语。

## 4. 事件分类与 owner

| 类别 | 命名示例 | 唯一生产者 | 主要消费者 |
| --- | --- | --- | --- |
| `domain` | `task.assigned`、`review.approved` | 对应领域模块 | 领域投影、Wakeup Router、Process Manager |
| `coordination` | `agent.work.enqueued`、`agent.work.claimed` | Agent Inbox 模块 | Scheduler、Harness、调试投影 |
| `runtime_lifecycle` | `runtime.invocation.started`、`runtime.invocation.terminated` | Platform Runtime | Invocation、Session、Supervisor、Harness |
| `runtime_activity` | `runtime.message.delta`、`runtime.tool.started` | Platform Runtime | Message、UI、Tool、Usage、Observability 投影 |

Adapter、模型进程、工具和权限策略只提供原始信号。Platform Runtime 完成校验、
归一化、排序和持久化后，才形成 canonical `runtime.*` 事件。

Agent 是 Command actor，不是领域事件生产者。Agent 的工具请求必须经过对应领域
模块校验，由领域模块提交业务状态并产生领域事件。

## 5. 统一事件信封

```ts
interface PlatformEvent<TType extends string, TPayload> {
  eventId: string;
  type: TType;
  category:
    | 'domain'
    | 'coordination'
    | 'runtime_lifecycle'
    | 'runtime_activity';
  schemaVersion: 1;

  projectId: string;
  streamKey: string;
  streamSequence: number;

  aggregate: { type: string; id: string; version?: number };
  actor: { type: 'user' | 'agent' | 'system' | 'runtime'; id: string };
  subject?: { type: string; id: string };

  projectAgentId?: string;
  invocationId?: string;
  inboxItemId?: string;

  correlationId: string;
  causationId?: string;
  dedupeKey?: string;

  occurredAt: string;
  recordedAt: string;
  payload: TPayload;
}
```

事件日志为每个 `streamKey` 分配严格递增的 `streamSequence`，不建立项目全局顺序：

- 领域事件：`<aggregate-type>:<aggregate-id>`；
- 协调事件：`agent-work:<project-id>:<project-agent-id>`；
- Runtime 事件：`invocation:<invocation-id>`。

`dedupeKey` 提供至少一次投递下的幂等写入。同一 key 若对应不同事件内容，必须返回
稳定冲突错误，不能静默接受。

## 6. Runtime 最小事件目录

### 生命周期

- `runtime.invocation.accepted`
- `runtime.invocation.started`
- `runtime.session.bound`
- `runtime.session.confirmed`
- `runtime.session.invalidated`
- `runtime.invocation.terminated`

`runtime.invocation.terminated` 是唯一 Runtime 终态，payload 包含
`completed | failed | cancelled | timed_out`、reason code、duration、usage 和
Runtime Session 引用。一个 accepted Invocation 最终必须且只能 terminated 一次。

### 活动

- `runtime.message.segment.completed`
- `runtime.thinking.segment.completed`
- `runtime.plan.updated`
- `runtime.tool.started`
- `runtime.tool.completed`
- `runtime.tool.failed`
- `runtime.permission.requested`
- `runtime.permission.resolved`
- `runtime.usage.updated`
- `runtime.warning.raised`

文本和 thinking delta 只进入实时 transport；Platform Event 在段边界产生
`segment.completed` 并合并持久化。工具、权限、警告和终态逐条持久化。ACP 原始
notification 默认只进入有界诊断。

### 领域事件目录

> 决策 ADR-004：第一阶段全领域转 domain 事件。生产用 inline（同事务发事件）。
> 领域表是事实源，事件是派生协调信号。

| 领域 | 事件类型 | 触发状态迁移 |
| --- | --- | --- |
| task | `task.assigned`、`task.in_progress`、`task.in_review`、`task.rejected`、`task.done`、`task.blocked`、`task.cancelled`、`task.reopened` | `task.status`；来源准事件 `task_action` |
| review | `review.submitted`、`review.approved`、`review.rejected`、`review.merged` | task 进入 `in_review`/`rejected`/`done`；来源 `control_proof_event` |
| delivery | `delivery.run.submitted`、`delivery.run.phase_advanced`、`delivery.run.completed`、`delivery.run.escalated`、`delivery.run.cancelled`、`delivery.action.claimed`、`delivery.action.succeeded`、`delivery.action.failed` | `DeliveryRunStatus` / `DeliveryActionStatus` |
| a2a | `a2a.possession.passed`、`a2a.possession.completed`、`a2a.chain.entry_done`、`a2a.chain.completed`、`a2a.chain.aborted` | possession / chain / worklist 状态机 |
| envelope | `envelope.validated`、`envelope.queued`、`envelope.routed`、`envelope.sent`、`envelope.started`、`envelope.completed`、`envelope.failed`、`envelope.expired` | `ExecutionEnvelopeStatus` 10 态 |
| binding | `binding.started`、`binding.finished`、`binding.error` | `AgentBindingStatus` |
| node | `node.stale`、`node.unreachable` | `RuntimeNodeStatus`（`recordMiss`） |
| invocation | `invocation.queued`、`invocation.claimed`、`invocation.succeeded`、`invocation.failed` | `invocation.status` |
| session | `session.sealed` | `agent_session.status`（`active→sealed`） |

具体 payload 形状在各切片落地前定义，不在此顶层锁定。`task_action`、
`control_proof_event`、`a2a_audit_log`、`agent_event` 是已存在的 append-only
准事件源，加 fan-out 即可复用。

### 协调事件目录

| 事件类型 | 生产者 | 触发 |
| --- | --- | --- |
| `agent.work.enqueued` | Agent Inbox 模块 | Router 消费 domain 事件后创建 Inbox item |
| `agent.work.claimed` | Agent Inbox 模块 | Scheduler claim Inbox item |
| `agent.work.recovered` | Agent Inbox 模块 | Inbox 恢复未完成 item |

## 7. 消费方式

| 方式 | 用途 | 约束 |
| --- | --- | --- |
| Reducer | Invocation、Session、Task、Inbox 状态 | 幂等并拒绝非法迁移 |
| Router | 领域事件到 Agent Inbox | 只发送 Command，不直接启动 Runtime |
| Process Manager | 跨领域闭环 | 只调用目标模块 interface，不越权写表 |
| Projection | UI、聊天、span、统计 | 可重建，不是事实源 |

Agent 不直接订阅 Event Bus。领域事件经 Wakeup Router 生成持久 Inbox Item，
Scheduler claim 后由 Harness 编译 `ContextSnapshot`，再启动 Agent Invocation。

Agent 可经两种合法方式消费事件信息（pull，非订阅）：① claim Inbox item；② 调用
只读 eventHistory 工具查询事件流。详见设计文档 ADR-003。

## 7b. 消费架构：Dispatcher 与 handler 注册

> 决策：补一个 Dispatcher（中断向量表）作为事件分发的唯一枢纽。详见设计文档
> §1.2 OS 中断模型与 §5 四角色 handler stereotype。

### Dispatcher 契约

```text
Dispatcher
  register(type | pattern, handler, { id, stereotype, reliability })
  recover()
  drain()
```

- `register`：按事件 type（或匹配 pattern）注册下半部 handler，标注稳定 `id`、
  stereotype（router/reducer/process_manager/projection）与 reliability
  （durable/best_effort）。
- `recover`：启动时从事件日志回补 durable handler 缺失的持久投递事实、回收过期 lease，
  并建立 handler cursor；运行期按 cursor 增量发现新事件，不轮询全量历史。
- `drain`：claim 可执行投递并调用 handler；成功后记录 receipt，失败按策略重试。

### Handler stereotype 约束（同 §7 四角色）

| stereotype | 输入 | 动作 | 约束 | 错误语义 |
| --- | --- | --- | --- | --- |
| router | domain 事件 | 给 ProjectAgent 创建 Inbox item | 只发 Command，不直接启动 Runtime | 入队失败重试，幂等（按 eventId） |
| reducer | 事件流 | 重建聚合当前态 | 幂等，拒绝非法迁移 | 非法迁移拒绝并记录 |
| process_manager | domain 事件 | 跨领域协调闭环 | 只调目标模块 interface，不越权写表 | interface 调用失败重试 |
| projection | 事件 | 刷新 UI/socket/统计 | 可重建，不是事实源 | durable 投影重试；best-effort 实时推送可丢 |

### Dispatcher 实现要求

- **持久投递**：durable handler 使用 event × handler 投递事实、attempt、lease、
  next-attempt 与 terminal receipt；append 后崩溃必须可由 `recover()` 回补。
- **错误隔离**：一个 handler 抛错或挂起，不得影响其他 handler。
- **顺序保证**：同一 handler 的同一 stream 按 `streamSequence` 局部有序分发；
  跨 stream 用 `correlationId`/`causationId` 关联，不保证全局顺序。
- **重试**：durable handler 按 at-least-once 重试，消费者按 `eventId` 幂等；
  best-effort handler 不承诺重试。
- **取消与串行**：handler 接收 `AbortSignal`。durable handler 超时后必须先协作停止并
  释放本次执行，Dispatcher 才能把同 stream 投递交给下一 attempt；执行期间按 claim token
  续租，进程退出后才由 lease recovery 接管。每个 production durable handler 必须有取消测试。
- **上半部不是 Dispatcher handler**：producer-local invariant 在领域事务内同步执行
  （见 §7c）；Dispatcher 只运行事务提交后的下半部。

## 7c. Runtime Core 边界：上半部/下半部

> 决策 ADR-002：上半部/下半部分离。

### 上半部（同步，在 append/UPDATE 事务内，进入 Runtime Core）

只做"拒绝非法"和"保证唯一"，不做 I/O、不 fan-out：

- `runtime.invocation` 终态唯一性、状态机非法迁移拒绝（`RuntimeEventPublisher` guard 已示范）。
- domain 表的状态校验（task status 合法迁移、delivery phase 不回退）。
- dedupe 冲突检测（`PlatformEventLog` 已实现）。

### 下半部（异步，append 提交后 fan-out，不进入 Core）

可失败、可重试、可延迟：

- ①Router：domain→Inbox（触发 Scheduler，重）。
- ②Reducer：重建聚合态（读多写少）。
- ③Process Manager：跨域协调（调 interface，可能跨进程）。
- ④Projection：UI/socket/统计（可重建，可丢）。

### 边界判据

凡"拒绝非法迁移"和"保证唯一终态"属上半部，必须在 producer-local 事务内同步执行，
不得通过 Dispatcher 注册。凡 I/O、跨模块
调用、fan-out 属下半部，必须在事务外异步执行。把下半部逻辑塞进事务会破坏 Core
轻量与可测；把上半部校验放到事后异步会错过难纠正。

## 8. 一致性与投递

- 事件先持久化，再向 Socket 或其他消费者发布。
- durable handler 投递语义为 at-least-once，消费者按 `eventId` 幂等；
  best-effort 实时投影允许丢失且必须可重建。
- 同一 stream 局部有序；跨 stream 用 `correlationId` 和 `causationId` 关联。
- Runtime 终态后禁止产生新的 Runtime 活动事件。
- Runtime completed 只表示本轮执行结束，不得直接推出 Task done。
- 兼容双写期间，`platform_event` 是新事实流；旧投影仍保持现有用户行为。

## 9. 迁移策略

迁移分 6 切片，每切片满足 §10 的某个退出条件，且不破坏兼容。各切片在落地前另起 plan，
不在本 spec 锁定实现细节。排期见 `tasks.md`。

| 切片 | 内容 | 依赖 | 退出条件（对应 §10） |
| --- | --- | --- | --- |
| 1 接入 daemon | `AcpRuntimeEventCoordinator` 接进 daemon.execute 路径，双写 fail-open（已接入，补边界回归） | 切片 0（platform_event 表 + 日志 + publisher，已就位） | daemon ACP 路径产生可查询 Runtime 事件 |
| 2 Durable Dispatcher + 第一个 Projection | 先建立持久投递/恢复，再让 UI/Message 投影从读 AgentEvent 改为读 runtime 事件 | 切片 1 | Dispatcher 可恢复；至少一个投影从 Runtime Event 重建 |
| 3 Inbox + coordination | 建立持久 Agent Inbox + coordination 事件，替换浏览器内存队列 | 切片 1 | Agent Inbox 能由领域事件幂等产生、claim、恢复 |
| 4 domain inline seam | 9 领域状态变更 inline 发 domain 事件，从 task 开始 | 切片 3（Inbox 消费 domain） | 四类事件契约和 owner 有自动化测试 |
| 5 PM 触发迁移 | delivery 阶段推进抽成 Process Manager handler，复用 `AutonomousDeliverySupervisor.advance()` 深模块（ADR-005） | 切片 4（delivery domain 事件） | delivery 协调不再依赖 task-notification-publisher 尾部硬编码 |
| 6 退出双写 | 删除 forwardAgentEvent 业务副作用 + 旧 agent_event 写入 | 切片 2/3/4/5 全部完成 | 长期设计与 wiki 已同步，兼容双写已删除 |

兼容双写必须在代码与长期文档中标记退出条件，不得形成永久双事实源。切片 6 是双写的
唯一删除点，在 2/3/4/5 全部完成前不得提前删除旧路径。

## 10. 退出条件

- 四类事件契约和 owner 有自动化测试。
- 事件日志验证 stream 顺序、dedupe 幂等和冲突。
- Runtime 发布器验证唯一终态、终态后拒绝活动。
- daemon 的 ACP 路径产生可查询的 Runtime 事件。
- 至少一个投影从 Runtime Event 重建，而非读取 ACP/`AgentEvent` 原始信号。
- Agent Inbox 能由领域事件幂等产生、claim 和恢复。
- 现有 Runtime、Session、A2A、Task 和 observability 测试无回归。
- 长期设计与 wiki 已同步，兼容双写已删除。
