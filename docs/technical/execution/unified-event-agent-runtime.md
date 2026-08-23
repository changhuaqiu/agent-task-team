# 统一事件、身份与 Agent Runtime 架构

> 状态：Implemented（当前架构）
> 日期：2026-08-23
> Archived spec：`docs/archive/specs/unified-event-agent-runtime/`
> 参考实现：Buzz `desktop-v0.5.18` / 下载快照 `C:\Users\qiufa\Downloads\buzz-main\buzz-main`

## 1. 决策

本轮直接替换现有相邻模型，不建立迁移兼容层：

1. 所有跨模块事件共享一个 `EventEnvelope` 语义核：事件身份、项目范围、actor、subject、
   correlation/causation、发生时间和 payload。
2. `PlatformEvent` 是该信封的 durable 形态，额外持有 stream cursor、aggregate 和 recordedAt；
   `ProjectViewEnvelope` 是 presentation 形态，显式标记 `durable` 或 `transient`，并保留 source event identity。
3. 人、Agent、Runtime Node、Invocation 和 System 使用同一个 `IdentityRef`，不再用散落的
   `actorId`、`agentId`、`nodeId` 猜身份类型。
4. 浏览器只订阅一个 `project:view` 通道。`task.state`、`task.notification`、`task.wakeup`、
   `task.sync`、`task.sync_error`、`dispatch.receipt` 和 `command:error` 不再作为平行协议存在。
5. `AgentRuntime` 是执行平面的深 Module。Invocation Pipeline 只调用
   `isBusy(scope)` 与 `execute(plan)`；Runtime 内部拥有定向 envelope、原子占位、ACP run、
   session 绑定、permission、规范化 Runtime Event、取消和资源回收。
6. 不改变领域事实立场：领域表仍是事实源，事件仍是协调信号；统一信封不吞并 Task、Gate、
   A2A、Delivery、Invocation 等 owner。

## 2. 为什么参考 Buzz

Buzz 最值得复用的不是 Nostr kind 数量，而是三个边界：

- Client、CLI 与 Agent 使用同一种事件身份和过滤语义；
- Relay 接纳事件后再做持久化、订阅和实时 fan-out；
- Agent runtime 把连接、恢复、队列、心跳、去重和事件归一化隐藏在小接口后。

本项目保留自身更强的 Durable Dispatcher 与 Effect Outbox，不复制 Buzz 的巨型 kind registry、
单文件 ingress 或 best-effort durable effect 语义。

## 3. 统一数据与身份模型

```ts
type IdentityKind = 'user' | 'agent' | 'system' | 'runtime' | 'invocation' | 'task' | /* domain identities */ string

interface IdentityRef {
  type: IdentityKind
  id: string
}

// actor/agent 使用封闭的 canonical identity；subject 使用开放的 domain ObjectRef。

interface EventEnvelope<TType extends string, TPayload> {
  eventId: string
  type: TType
  projectId: string
  actor: IdentityRef
  agent?: IdentityRef<'agent'> // presentation target; never replaces actor
  subject?: IdentityRef
  correlationId: string
  causationId?: string
  occurredAt: string
  payload: TPayload
}
```

约束：

- `id` 是稳定事件身份，投影不得用 `Date.now()` 重新发明领域 identity；
- `projectId` 是项目隔离的唯一字段；room 选择和浏览器消费都读取它；
- `actor` 表示谁造成事实，`subject` 表示事实作用对象；Runtime Node 与 Invocation 不冒充 Agent；
- Runtime presentation 需要定位 Agent 时使用独立 typed `agent` reference，不能覆盖 canonical `actor`；
- 有上游 command/event 的事件必须继承 `correlationId` 并携带 `causationId`；根事件可以用自身
  `eventId` 自关联；
- Presentation event 必须带 `delivery: durable | transient`。durable 事件可由快照对账，transient
  delta 允许丢失，二者不能互相冒充。

领域 payload catalog 保持 owner-local，通过 TypeScript map 组合，而不是建立一个所有团队都要修改的
中央巨型 kind 文件。

## 4. 事件链

```text
Owner transaction
  -> PlatformEvent (durable envelope + stream cursor)
  -> Durable Dispatcher
     -> Router / Reducer / Process Manager / Projection
  -> ProjectViewPublisher
     -> ProjectViewEnvelope (presentation envelope)
  -> browser ProjectViewAdapter
     -> read-only delivery workspace projection
```

Runtime 的低延迟 text/thinking 属于 transient presentation；完成 segment、tool、permission、
invocation lifecycle 先成为 canonical `runtime.*` PlatformEvent，再由 Projection 产生 presentation。

Task 文件投影的变化也只通过 `project:view` 进入浏览器。它仍不是 Task 事实源；服务端 Task Authority
的 revision 决定可否覆盖本地投影。

## 5. Agent Runtime 深模块

```text
Invocation Pipeline
        |
        | InvocationDispatchPlan
        v
AgentRuntime
  - directed routing / health gate
  - atomic reservation
  - ExecutionEnvelope sent + acknowledged
  - ACP process/session/permission/cancel
  - AgentEvent -> canonical runtime.*
  - exactly one terminal result and bounded cleanup
        |
        v
ACP native/adapter process
```

公开 Interface 不暴露 ACP launcher、SDK update、session file、socket room、process map 或厂商分支。
生产实现与 deterministic test runtime 是两个真实 Adapter；在出现第二种生产协议前不建立通用插件框架。

当前生产实现按职责拆为：

- `DirectedAgentRuntime`：定向 routing、reservation、send、真实 Runtime setup ACK 与 post-ACK failure settlement；
- `AcpRuntimeDriver`：Catalog、隔离环境、permission policy、backend/options 与 setup cleanup；
- `AgentSessionLifecycle`：Logical Session generation rotation、原子 Invocation acquisition、binding/seal；
- `AgentProcessRegistry`：setup serialization、active process identity、kill 与 shutdown cleanup；
- `AcpRuntimeEventCoordinator` / `AcpTurnEventNormalizer`：canonical lifecycle、permission、segment/tool correlation 与唯一终态。

daemon 仍是 composition root 和领域结果协调者，但不再直接 import ACP backend/setup/permission、
Session repository 或 process-start guard。

Runtime 失败语义分层：

- envelope 未 ACK：`runtime_unreachable` / `runtime_executor_not_connected` / `runtime_start_failed` / `ack_timeout`；
- ACP setup 或执行失败：终结 Invocation，并发布明确 reason code；
- Runtime 正常结束不等于 Task 完成；结构化 Outcome 仍由 WorkContract admission 与领域 owner 裁决。

## 6. 删除规则

本轮不保留双协议：

- 删除浏览器对旧 Socket 事件的 listener；
- 删除服务器对旧 Socket 事件的 emitter；
- 删除 `RuntimeAgentEventBridge` 的 compatibility 定位，由 Agent Runtime 正式拥有 turn-local normalization；
- 删除旧 `DaemonExecutionAdapter` / `AgentRuntimePort` 命名，统一从 `agent-runtime` 模块导入；
- 同步删除旧类型、测试断言和“迁移期间”文案。

## 7. 架构门禁

1. `src/store/**` 只允许订阅 `project:view` 作为项目运行展示通道。
2. 项目展示 publisher 必须生成稳定 event id、显式 identity 和 delivery class。
3. `PlatformEvent` 与 `ProjectViewEnvelope` 必须复用共享 envelope/identity 类型。
4. Invocation Pipeline 不得 import ACP、process、session repository 或 Socket。
5. ACP update normalization 只存在于 Agent Runtime 模块树。
6. `AgentRuntime.execute()` 对每个 accepted plan 只产生一个 terminal lifecycle。
7. Inbox 只在 Runtime ACK 后记为 `admitted`；ACK 前 claim 续租，繁忙 Lane 使用有上限的指数退避。

## 8. 验证

- 共享信封与身份的运行时校验测试；
- Platform Event append/dedupe/trace 回归；
- Project View 项目隔离、durable/transient、旧通道缺失的架构测试；
- Agent Runtime reservation、directed routing、ACK、event normalization、single terminal 测试；
- TypeScript、相关 Vitest、全量测试与生产 build。

## 9. 桌面承载边界

统一内核允许未来由桌面 Host 承载，但不把 WebView 变成新的事实 owner。目标形态采用 Tauri 管理 OS
生命周期，并监管现有 Node Service sidecar；Renderer 仍只通过 Human Command 与 `project:view` 工作。
详见 `docs/technical/execution/desktop-host-target-architecture.md`。桌面壳、打包和签名尚未在本轮实现。
