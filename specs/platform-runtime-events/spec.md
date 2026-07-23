# 平台 Runtime 事件模型

> 状态：active
> 日期：2026-07-24
> 事实源：本目录
> 依赖：`system-control-plane`、`acp-runtime-integration`、`agent-session-identity`

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

建立一套统一事件信封，并明确四类事件：

1. 领域事件：项目业务事实；
2. 协调事件：工作如何进入某个 ProjectAgent；
3. Runtime 生命周期事件：一次 Invocation 的状态；
4. Runtime 活动事件：Invocation 内的消息、工具、权限和用量活动。

第一实现切片先落地通用事件日志和 Runtime 事件发布器，并由 daemon 对现有
`AgentEvent` 路径做兼容双写。后续再迁移协调事件、领域事件和消费者。

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

## 7. 消费方式

| 方式 | 用途 | 约束 |
| --- | --- | --- |
| Reducer | Invocation、Session、Task、Inbox 状态 | 幂等并拒绝非法迁移 |
| Router | 领域事件到 Agent Inbox | 只发送 Command，不直接启动 Runtime |
| Process Manager | 跨领域闭环 | 只调用目标模块 interface，不越权写表 |
| Projection | UI、聊天、span、统计 | 可重建，不是事实源 |

Agent 不直接订阅 Event Bus。领域事件经 Wakeup Router 生成持久 Inbox Item，
Scheduler claim 后由 Harness 编译 `ContextSnapshot`，再启动 Agent Invocation。

## 8. 一致性与投递

- 事件先持久化，再向 Socket 或其他消费者发布。
- 投递语义为 at-least-once，消费者按 `eventId` 幂等。
- 同一 stream 局部有序；跨 stream 用 `correlationId` 和 `causationId` 关联。
- Runtime 终态后禁止产生新的 Runtime 活动事件。
- Runtime completed 只表示本轮执行结束，不得直接推出 Task done。
- 兼容双写期间，`platform_event` 是新事实流；旧投影仍保持现有用户行为。

## 9. 迁移策略

1. 建立 `platform_event` 表、事件日志和 Runtime 发布器。
2. daemon 将现有 Runtime 活动和终态兼容双写到新事件流。
3. 将 UI、Message、Observability 逐个迁移为 Runtime Event projection。
4. 建立 Agent Inbox 和 coordination 事件，替换浏览器内存队列。
5. 各领域模块按 owner 逐步产生 domain 事件。
6. 所有消费者迁移完成后删除 `forwardAgentEvent()` 的业务副作用和旧 `agent_event` 写入。

兼容双写必须在代码与长期文档中标记退出条件，不得形成永久双事实源。

## 10. 退出条件

- 四类事件契约和 owner 有自动化测试。
- 事件日志验证 stream 顺序、dedupe 幂等和冲突。
- Runtime 发布器验证唯一终态、终态后拒绝活动。
- daemon 的 ACP 路径产生可查询的 Runtime 事件。
- 至少一个投影从 Runtime Event 重建，而非读取 ACP/`AgentEvent` 原始信号。
- Agent Inbox 能由领域事件幂等产生、claim 和恢复。
- 现有 Runtime、Session、A2A、Task 和 observability 测试无回归。
- 长期设计与 wiki 已同步，兼容双写已删除。
