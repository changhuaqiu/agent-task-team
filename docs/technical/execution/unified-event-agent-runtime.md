# 统一事件、身份与 Agent Runtime 架构

> 状态：Target（命令驱动重构中）
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
   A2A、Artifact、Release、Invocation 等 owner。
7. `CommandService` 是领域事实的唯一写内核。Agent 优先通过结构化 MCP 提交命令；`ath` CLI 是
   通用接口与逃生仓；Web/Desktop 通过 Human Command Adapter 接入。三个入口不拥有业务逻辑。
8. Runtime Event 属于观察面。`runtime.completed` 只表示 Invocation 结束，不能直接改变 Task、
   Delivery/Release 或 Project 的完成状态。

## 2. 为什么参考 Buzz

Buzz 最值得复用的不是 Nostr kind 数量，而是四个边界：

- Client、CLI 与 Agent 使用同一种事件身份和过滤语义；
- Relay 接纳事件后再做持久化、订阅和实时 fan-out；
- Agent runtime 把连接、恢复、队列、心跳、去重和事件归一化隐藏在小接口后。
- Agent 的推理与文本不是产品事实；真正的协作结果必须通过结构化产品操作提交，并返回可验证回执。

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

## 4. 命令链、事实链与观察链

```text
structured MCP / ath CLI / Human Command API
                    │
                    ▼
              CommandService
   authorization + idempotency + revision + fencing
                    │
                    ▼
           Domain Owner transaction
                    │
        CommandReceipt + PlatformEvent
                    │
                    ▼
              fact projection

ACP / Runtime ──> RuntimeObservation ──> activity projection
```

`CommandReceipt` 的状态统一为 `applied | duplicate | rejected | conflict | delivery_unknown`。
MCP 是 Agent 主路径：按当前 WorkContract 暴露强类型生命周期工具。CLI 覆盖所有公共命令并作为
MCP 尚未建模、批处理与诊断的逃生仓。二者调用同一 handler，因此成功、拒绝、幂等与冲突语义一致。

### 4.1 事件链

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

这些事件仍然只是运行观察。观察中的“已完成”“测试通过”或 URL 不构成领域证明；必须由
`task_submit_result` 携带精确 `evidence_refs`、或由 `gate_record_decision` 等命令提交并由领域 owner 验证。Artifact Ledger 对成功写入的自动发现只提供导航，不能自行形成完成事实。

Task 文件投影的变化也只通过 `project:view` 进入浏览器。它仍不是 Task 事实源；服务端 Task Authority
的 revision 决定可否覆盖本地投影。

## 5. Agent Runtime 深模块

```text
Invocation Pipeline
        |
        | InvocationDispatchPlan
        v
ManagedAgentRuntimeSupervisor
  - desired/observed lifecycle + generation fencing
  - singleflight wake + backoff + circuit breaker
  - partial-ready AgentWorkerPool
        |
        v
AgentRuntime
  - directed routing / health gate
  - atomic reservation
  - ExecutionEnvelope sent + acknowledged
  - persistent ACP worker/session affinity/permission/cancel
  - AgentEvent -> canonical runtime.*
  - exactly one terminal result and bounded cleanup
        |
        v
ACP native/adapter worker pool
```

公开 Interface 不暴露 ACP launcher、SDK update、session file、socket room、process map 或厂商分支。
生产实现与 deterministic test runtime 是两个真实 Adapter；在出现第二种生产协议前不建立通用插件框架。

目标生产实现按职责拆为：

- `DirectedAgentRuntime`：定向 routing、reservation、send、真实 Runtime setup ACK 与 post-ACK failure settlement；
- `AcpRuntimeDriver`：Catalog、隔离环境、permission policy、backend/options 与 setup cleanup；
- `AgentSessionLifecycle`：Logical Session generation rotation、原子 Invocation acquisition、binding/seal；
- `ManagedAgentRuntimeSupervisor`：按 Agent + Project + Runtime Node 管理期望/观测状态、generation、
  启动单飞、退避、熔断和关闭；
- `AgentWorkerPool`：持久 ACP 进程、部分可用、worker replacement 与有界并发；
- `AgentSessionDirectory`：conversation lane 到 worker/session 的 affinity、恢复和失效；
- `AcpRuntimeEventCoordinator` / `AcpTurnEventNormalizer`：canonical lifecycle、permission、segment/tool correlation 与唯一终态。

daemon 仍是 composition root 和领域结果协调者，但不再直接 import ACP backend/setup/permission、
Session repository 或 process-start guard。

Runtime 失败语义分层：

- envelope 未 ACK：`runtime_unreachable` / `runtime_executor_not_connected` / `runtime_start_failed` / `ack_timeout`；
- ACP setup 或执行失败：终结 Invocation，并发布明确 reason code；
- Runtime 正常结束不等于 Task 完成；只有 CommandService 接纳的结构化 Outcome/Artifact/Gate 命令
  才能推进事实。没有终态 receipt 的正常退出标记为 `ended_without_outcome` 并进入恢复策略。

## 6. 命令驱动的交付

交付不再是必须先创建的顶层 Run，而是 Project 中 WorkItem、Artifact、Review/Gate 与可选 Release
持续形成的事实集合。Release 完成是由 receipt、artifact revision、gate 和 policy 计算的投影，
不是 Agent 或用户点击一个“完成”按钮。完整契约见 `specs/command-driven-delivery/spec.md`。

### 6.1 深模块边界

端到端产品写入收敛为三个深模块，避免继续在 UI、store、MCP、CLI 和 daemon 之间复制规则：

- `ProductCommandKernel.execute(command) -> CommandReceipt`：拥有 registry、authorization、幂等、revision、事务和事件 append。UI、MCP、CLI 只依赖这一个接口。
- `ObjectReferenceIndex.project(event)`：拥有 canonical reference parser/builder 与引用派生关系；Channel/Project/Contributor 投影只查询它，不手工维护对象归属。
- `ManagedAgentRuntime.accept(event) -> AdmissionHandle`：拥有 Durable EventQueue、first-match subscription filter、AgentPool、session affinity、steer/cancel merge、retry、dead-letter 和 observed snapshot。

测试以这些公共接口为主，不直接绑定 queue map、ACP SDK update 或 SQLite 语句。替换实现时只要契约保持，调用方与测试无需跟着内部算法变化。

### 6.2 EventQueue 与订阅稳定性契约

参考 Buzz `buzz-acp` 的真实实现，目标 EventQueue 必须满足：

- 每个 Channel/lane 同时最多一个 in-flight batch，lane 内 FIFO，跨 lane 选择最老 head 保证公平；
- batch、lane 深度、全局深度、in-flight deadline、retry 次数与退避均有上限；
- application failure 归还健康 worker 并按策略重排，transport/protocol failure 才替换 worker；
- 原生 steer 先 withholding 原事件，ACK 后移除，失败时释放并回退到 cancel + merge，不能重复投递；
- retry 保留原时间戳，超过上限进入 dead-letter，并向对应 Channel 产生可见失败事实；
- subscription rule 按有序 first-match 执行，表达式有长度、并发、超时和连续超时熔断；异常 fail closed。

AgentPool slot 持有长生命周期 ACP client，每个 Channel 持有独立 session；claim 优先 session-affine worker。并行度属于 Agent 定义并受 Harness Catalog 上限约束，不能由 UI 保存另一份能力常量。

## 7. 删除规则

本轮不保留双协议：

- 删除浏览器对旧 Socket 事件的 listener；
- 删除服务器对旧 Socket 事件的 emitter；
- 删除 `RuntimeAgentEventBridge` 的 compatibility 定位，由 Agent Runtime 正式拥有 turn-local normalization；
- 删除旧 `DaemonExecutionAdapter` / `AgentRuntimePort` 命名，统一从 `agent-runtime` 模块导入；
- 同步删除旧类型、测试断言和“迁移期间”文案。

## 8. 架构门禁

1. `src/store/**` 只允许订阅 `project:view` 作为项目运行展示通道。
2. 项目展示 publisher 必须生成稳定 event id、显式 identity 和 delivery class。
3. `PlatformEvent` 与 `ProjectViewEnvelope` 必须复用共享 envelope/identity 类型。
4. Invocation Pipeline 不得 import ACP、process、session repository 或 Socket。
5. ACP update normalization 只存在于 Agent Runtime 模块树。
6. `AgentRuntime.execute()` 对每个 accepted plan 只产生一个 terminal lifecycle。
7. Inbox 只在 Runtime ACK 后记为 `admitted`；ACK 前 claim 续租，繁忙 Lane 使用有上限的指数退避。
8. Runtime、API 和 Process Manager 不得绕过 CommandService 直接完成领域对象。
9. MCP 与 CLI 的公共命令必须共享 handler 和 receipt 类型。

## 9. 验证

- 共享信封与身份的运行时校验测试；
- Platform Event append/dedupe/trace 回归；
- Project View 项目隔离、durable/transient、旧通道缺失的架构测试；
- Agent Runtime reservation、directed routing、ACK、event normalization、single terminal 测试；
- TypeScript、相关 Vitest、全量测试与生产 build。

## 10. 桌面承载边界

统一内核允许未来由桌面 Host 承载，但不把 WebView 变成新的事实 owner。目标形态采用 Tauri 管理 OS
生命周期，并监管现有 Node Service sidecar；Renderer 仍只通过 Human Command 与 `project:view` 工作。
详见 `docs/technical/execution/desktop-host-target-architecture.md`。桌面壳、打包和签名尚未在本轮实现。

## 11. Agent 运行配置控制面

ACP 执行内核与设置控制面使用同一事实源，但职责分层：

1. `AcpRuntimeCatalog` 拥有 launcher、交付方式和已验证能力；Discovery 只判断当前设备是否具备启动条件，UI 不运行 `which` 或按 Agent 名称猜测。
2. `AgentDefinition` 是稳定聚合根，持久化身份、结构化主要职责、完整工作指令、Skill 引用、ACP runtime id、模型账号/模型、权限和执行偏好。RoleCard 不再参与 Agent 定义；Team 与 Project 只保存 Agent identity 和协作关系，不覆盖 execution profile。
3. RoleCard 导入/编辑、Team 成员能力覆盖和 Agent Skill 独立写端点已经移除；ContextManager 也不再获取或编译 RoleCard layer，而是只编译 Agent instructions、permissions、Skills 与工作合同。历史列只属于兼容迁移，不能进入运行时 Profile、Prompt、在线 Evaluation provenance 或当前产品路由。Agent Team 的 create/update/delete/deploy 全部进入 CommandService，其中 update/delete 用 aggregate revision 防止覆盖。
4. `AgentBinding` / Invocation lifecycle 仍是“执行中、空闲、错误”的权威事实。设置只投影现有状态，不新增第二个进程 owner。
5. 目标 ACP backend 由 `ManagedAgentRuntimeSupervisor` 管理长生命周期 worker pool。设置页只展示 supervisor 的
   observed state；启动/停止只有在 supervisor 成为唯一 lifecycle owner 后才能开放。

这复用了 Buzz 的 Agent Definition → managed instance/status 分层。Agent 的 persona 与工作边界直接属于 Definition；Skill 保持可安装引用资源；同时保留 Durable Inbox、WorkContract 和按 Invocation 执行语义。

## 12. 本地 Buzz Runtime 复核后的生产约束（2026-08-24）

本节来自本地 Buzz Desktop v0.5.18 及同版本 `buzz-acp`、Desktop managed runtime、`buzz-cli` 与 dev MCP 源码复核。它补足“使用 ACP”之外真正决定稳定性的运行边界。

```text
Desktop Runtime Catalog / Readiness
        │
        ▼
ManagedRuntimeSupervisor
  receipt + generation + process-tree ownership
        │
        ▼
EventQueue ──> AgentWorkerPool ──> ACP worker/session
  lane         affinity/replacement     │
  fairness                              ▼
  retry/dead-letter              structured MCP / ath CLI
                                         │
                                         ▼
                                  CommandService
```

### 12.1 进程与就绪

- Runtime Catalog 解析 launcher、依赖、能力与 readiness；Supervisor 是进程生命周期唯一 owner，Renderer 和设置页不得直接启动厂商命令。
- Runtime key 为 `agentId + projectId + runtimeNodeId`。每次启动持有 generation fencing；旧进程、旧回执和旧 Invocation 不得写入新 generation。
- 启动成功必须先写入可验证 runtime receipt，再注册为可路由实例。桌面 Host 必须拥有整个 ACP、vendor worker 与 MCP 子进程树；Windows 目标使用 Job Object 或等价树级终止语义，不能只杀父 PID。
- “可用”表示依赖发现通过；“在线”只在所需事件订阅建立并可消费后成立；“就绪”还要求至少一个 worker 可接受工作。进程存在不等于就绪。

### 12.2 队列、会话与失败

- Event Queue 按 conversation/project lane 串行、lane 间并行；全局调度采用最老 head 公平性。每 lane 批次、总量、等待时间和重试次数必须有界。
- 所有 Human、A2A、Workflow 与 Gate 入口在签发 WorkContract 前必须经过同一个 `DispatchAdmission` Module。该 Module 只读取触发事实、可选 Task 归属和当前 Agent Definition，返回规划、执行、评审、验证或拒绝；A2A 文案、Team 成员关系和 Prompt 都不能自行把一次触达升级为实现授权。
- Agent Definition 的 revision、结构化 `responsibility` 及写/评审能力冻结进 WorkContract；自由文本 instructions 不参与权限角色推断。协调者收到普通 `@` 请求时只获得 planning grant；未分配 Task 不会因“开始处理”隐式选中最近工作，普通 Human/A2A 消息也不能制造 ad-hoc execution subject。可信 Automation/Adapter 以稳定 id 签发 subject，经 WorkRequest、Durable Inbox 和 Scheduler 原样传递，并派生独立 Work authority。
- Task execution grant 冻结 owner 与 revision。WorkContract 签发事务在最后一刻重读 Task；Project、owner、status 或 revision 与准入快照不一致时失败关闭，避免改派竞态下旧 Agent 先修改仓库。
- Claude ACP 每个 turn 都显式重置 Session Mode：规划合同强制 `plan`，其他合同强制 `default`，从而清除用户会话可能遗留的 `bypassPermissions`。`session/setMode` 失败时 Runtime 失败关闭，不发送 prompt；规划不能依赖模型自觉或只靠 permission callback 隔离写操作。
- 同一事件按稳定 id 去重。运行中的会话优先原生 steer；不支持或竞争失败时执行 cancel + merge，避免并发 prompt 破坏会话状态。
- Worker Pool 优先复用 session-affine worker，再使用任意空闲 worker；worker ownership 以 lease 移出、完成后归还，防止同一 worker 被双重调度。
- 失败必须分类：认证失败关闭并等待配置；传输/协议失败替换 worker；近期有活动的 hard timeout 可重试；panic/进程退出恢复 slot；超过上限进入 dead-letter 并产生用户可见事实。不得把所有错误统一成“Agent 没响应”。
- 过滤器按有序 first-match 执行，并受长度、并发与超时限制；超时连续达到阈值后禁用有问题的表达式。无法判断时 fail closed，默认只接收显式提及或已授权触发。
- Runtime 重配置按逻辑 owner 串行化；新 runtime id 与 generation 必须在等待旧 handle 关闭前发布。startup promise 必须绑定 generation，任何并发配置的最终 observed state 只能指向最后一个 desired runtime。
- Outcome 幂等重放复用持久化 admission 决定：曾被拒绝的结果再次提交仍是 rejected，保留原 reason code，绝不能转换成可结束 Agent turn 的 accepted duplicate。
- `work.create` 与 Project 页面“创建工作”必须进入同一个 Product Command handler；旧 Workspace Command 只允许作为该 handler 的兼容 Adapter，不能继续拥有另一套 task create receipt、幂等和事件写入。
- Runtime 的 stop、restart 与 reconfigure 共享同一个逻辑 owner 串行队列。stop 的 desired generation 一旦对调用方返回，任何更早的 start/reconfigure promise 都不得再次把它改回 running。
- Invocation MCP grant 必须携带 Runtime generation，并在 restart/reconfigure 发布新 generation 时先失效旧 generation grant；只终止进程而继续接受旧 token 的领域命令不构成 fencing。
- Project identity 使用去尾分隔符并大小写折叠的根路径。历史碰撞必须确定性合并到一个 Project，并保证恰好一个 `project_workspace`；相同幂等键若输入名称或规范化路径变化则返回 conflict。
- `project.create` 是 Project aggregate 的原子创建边界：同一回执必须携带 `Project` 与唯一 `project_workspace` 的权威快照。Desktop/Web Adapter 在两者进入本地投影前不得导航到项目页，后续 Work/Review/Channel 命令也不得依赖一次竞态后台刷新来补齐 scope identity。

### 12.3 CLI、MCP 与工作目录

Buzz 当前的真实实现是 JSON-first CLI 覆盖产品读写，通用 dev MCP 主要通过受控 shell 暴露该 CLI，并由 Skill 告诉 Agent 使用精确命令；并非所有产品动作都已经是独立的 typed MCP tool。我们在此基础上进一步收敛：生命周期关键命令优先提供结构化 MCP，同时 `ath` CLI 覆盖完整公共命令、批处理、自动化和诊断；两者必须调用同一 CommandService handler，返回同一种 CommandReceipt。

Agent 的中间工作保存在 Project/Nest 风格的工作目录（计划、研究、工作日志、临时文件）；平台从成功写入自动形成 Artifact Ledger，正式共享产物则随 Outcome 的精确 evidence refs 由 owner 登记；任务、评审、Gate、Release 与 Project 元数据只能经 CommandService 改变。这样 CLI 成为通用接口和逃生仓，而文件系统不会成为第二套交付事实源。

自定义 ACP Catalog 只保存可公开的 launcher 元数据。Renderer 不提交秘密值，Catalog 文件不得保存 token/API key，也不得把 Service 的完整 `process.env` 传给任意 Harness。子进程环境由显式安全基线（路径、临时目录、区域设置等）与该 Runtime 经凭据服务解析出的最小变量集合组成；桌面 bootstrap/session secret 永不进入 Agent 子进程。

成功 CLI 输出为单行 JSON `CommandReceipt`；错误写 stderr，包含稳定 `error`、`message`、`retryable`，退出码区分输入、网络、认证、其他与冲突。只有 `applied/duplicate` 回执可以附带 canonical `ath://` 对象引用；拒绝时不得输出一个从未落库的假链接。网络中断后无法判断非幂等外部写是否已执行时必须返回 `delivery_unknown`，禁止 Agent 自动重放。

Agent 创建/更新属于 owner-reviewed command：对话中的 Agent 可以生成草稿，但回执必须明确 `saved=false`，直到所有者在桌面确认；不能把“草稿已发送”描述成 Agent 已创建。

### 12.3.1 Automation Module

Automation 是统一事件内核上的持久订阅，不是页面内定时器或 Agent Prompt 模板。Definition 以权威 `project.id` 归属；Module 在内部把仍携带 workspace conversation id 的 PlatformEvent 归一为同一个 Project。`automation.create/update/set_enabled/trigger/retry` 由 CommandService 接纳并产生 CommandReceipt 与 `automation.*` 领域事件，Web/Desktop 只调用命令和读取投影。幂等比较覆盖 Project、subject、expected revision 与规范化 input，不能用同一个 key 跨对象或反向启停。

事件、手动和 schedule 触发都先以唯一 claim 创建 `AutomationRun`，并在 claim 内冻结 Definition revision、Trigger 与 Action snapshot，再由同一个执行器顺序推进 step trace。Definition 自身与 Run 分离；事件去重键是 `automationId + sourceEventId`，schedule 去重键是 `automationId + UTC fire window`。Event Definition 另存 activation watermark 和逐 revision 历史，延迟事件按 `recordedAt` 选取当时有效版本；普通编辑不会移动激活水位。执行器永远不把 `automation.*` 当成用户触发事件，并限制每个 Definition 最多 20 个动作。

“触发 Agent”只以 `source=workflow` 和稳定 step 幂等键写入现有 AgentInbox；Agent worker pool 决定何时启动 ACP Runtime。“发布项目通知”原子产生带 Automation/Run 元数据的系统消息、step trace 与专用持久事件。AgentInbox 容量和 SQLite contention 被分类为可重试错误并抛回 durable dispatcher；handler context 携带 attempt budget，最终 attempt 会原子把 Run/step 转为 `automation_retry_exhausted` 失败并写失败事件，避免 dead-letter 后仍显示 running。页面可展开逐步 trace 并通过 `automation.retry` 恢复同一个冻结 Run。任何会改变 Work、Review、Artifact、Gate 或 Release 的动作仍必须回到注册的 Product Command handler，Automation Repository 无权直接改这些领域表。

Automation Action Registry 是闭集：每个 action descriptor 固定用户文案、输入 schema、目标 Product Command、Project/subject 规则与结果分类，Definition 不能携带任意命令名或任意命令信封。首个 `work.create` action 在执行时构造 system actor 的 Project-scoped ProductCommand，并以 `automation:<runId>:<stepId>` 作为稳定 command/idempotency identity。Registry 只把 receipt 的 status、subject、revision、event/evidence refs 写入 trace，不把任意 handler 内部对象泄漏到 Automation 状态；`delivery_unknown` 永不自动重放。

人工等待由 `AutomationDecision` 持久对象拥有，不借用 Artifact QualityGate。后者要求评审目标、artifact revision 和 evidence，语义上不能充当通用工作流暂停按钮。Decision 以 `runId + stepId` 唯一，状态为 pending/approved/denied，保存 prompt、请求者、决定者、note 与时间。创建 Decision、将 step/Run 置为 `waiting_decision` 与发布 requested event 同事务；`automation.decide` 在同一事务中裁决并批准后追加新的 `automation.run.requested`，拒绝后写 cancelled terminal。Runtime 只从 `currentStep + 1` 恢复，不能重放等待步骤。

Definition 交换文档与数据库对象分离。文档只含 `schemaVersion=1`、name、description、trigger、actions；Project id、Automation id、revision、activation watermark、Run、Decision 和凭据从不导出。导入先解析再调用同一 `validateAutomationDefinition`，进入现有编辑器草稿，最终仍走 `automation.create` 且默认 disabled。稳定 step id 必须保留，未知字段与未知 action fail closed。

### 12.3.2 Release Module

Release 是按需的 Project aggregate，不是 Runtime/Delivery 状态机。`project_release` 只保存名称、说明、不可跨 Project 的正式 target refs、draft/published、revision 与 publishedAt；Web/Desktop 通过 `/api/releases` 读取投影，通过 `release.create/publish` 写入。创建与发布事件分别为 `release.created` / `release.published`，CLI 和页面得到同一种 receipt 与 `ath://release` identity。

发布判定留在 Repository/Command handler 内：每次 publish 都重新读取 target 权威状态，要求 Work=`done`、Review=`approved|closed`，并校验 expected revision。首批不把 Task 内嵌的 artifact JSON 当成独立 Artifact target；待 Artifact owner 接入后再扩展 target registry。Automation、Runtime、Renderer 和消息投影均无权直接推进 Release。

### 12.3.3 Artifact Ledger Projection

参考 Clowder 的 artifact tracking，Artifact Ledger 是只读深模块而不是第二个写内核。它从 `runtime.tool.started/completed` 的成功配对中确定性提取 Project 根目录内的写入路径，并与已接纳 `agent_outcome.evidence_refs_json` 及 Task owner 的 `task_artifact_ref` 按 ref 合并。前者状态为 `working`，后两者状态为 `registered`；因此直接 A2A 与传统 Task 不分叉，Runtime 观察也永远不能自行升级为正式完成证据。

Ledger 对外只有 `list(projectId)` / `listAll()`，内部负责路径归一、越界拒绝、`.ath`/构建目录过滤、工具输入差异适配、来源 Agent/Invocation/Work 关联与同 ref 去重。Project 页面、Workspace 全局镜头/计数和 `ArtifactLedgerContextContributor` 共用该接口；每次 Agent 唤醒自动收到最近产物导航，并被要求在终态 outcome 中使用精确 evidence ref。Task 旧 `artifacts` JSON 不再进入这些页面或 context。

### 12.4 Harness Catalog 与 Agent Team

Harness 能力只有一个事实源：服务端 `AcpRuntimeCatalog`。Catalog 同时包含内建运行时、预置 ACP harness 与用户自定义 harness，记录 command/args、availability、认证状态、安装指引、能力描述、并行上限与来源。自定义 harness 只允许命令与参数，不允许持有凭据环境变量或携带自动安装脚本；保存时校验 id 冲突与参数 transport，更新后原子刷新运行注册表，未知 runtime 不得静默回退到另一个 Agent。

AgentTeam 是 Agent identity 的可复用集合，不持有第二份 runtime/model/skill。“部署到 Project”只建立 Team 与协作空间的权威关联，并逐成员解析当前 Agent 定义和 Catalog；回执使用 `assignedAgentIds` 和 `runtimeReadiness=pending_first_trigger`，不得把关联成功描述成 Runtime 已启动或已认证。可执行文件、认证和 Supervisor readiness 在首次事件触发/显式预检时产生逐成员事实，失败进入运行诊断，不能用 Team 关联回执伪装成功。

Project 的实际协作成员由 `project_agent_membership` 关系拥有。Team 部署会原子替换该 Project 的初始成员集合；之后 `project.agent.add/remove` 只修改 Project membership，并产生 `project.agent_added/removed` 领域事件。Conversation Runtime、无显式 mention 的初始负责人解析、Renderer `@` 候选和项目上下文都必须通过同一个 membership repository 读取成员；`conversation.team_pack_id` 只保留协作拓扑和 Team 身份，不能再单独决定可触达 roster。为兼容已有 Project，迁移按已部署 Team 回填成员；无 Team 的已有 Project 按迁移前默认可协作 Agent 回填。

### 12.6 持久 ACP Worker 的实际接线（2026-08-25）

daemon composition root 现在长期持有 `AcpRuntimeDriver`。它按 Agent + Project + Runtime Node 注册 `ManagedAgentRuntimeSupervisor`，由 `AgentWorkerPool` 租用 `PersistentAcpWorker`；健康 stdio transport 和 ACP initialize 跨 Invocation 复用，每次 Invocation 仅创建/加载 Session、绑定 lane、签发最小 MCP grant 与 permission policy。application failure 释放 Worker，transport failure 才替换进程；daemon shutdown 统一回收全部进程。

Runtime 控制面通过 daemon registry 暴露脱敏 snapshot、`stop` 与 `restart`，并复用 Supervisor 的 generation fencing。`stop(agentId, projectId)` 先取消 AgentProcessRegistry 中同 scope 的活动 Invocation，再停止 Supervisor owner；`restart` 只对已经注册过的逻辑 owner 有效，沿用 Catalog 配置并执行 reconfigure。API 不接触进程句柄、命令参数或环境值，Renderer 不自行推断运行状态。

MCP grant 是 turn-scoped：每次 `prepareTurn` 都使用当前 WorkContract 重新生成 server/token/tool list，所有终态、异常与 ownership loss 路径撤销，持久 Worker 的下一 Session 不继承上一 Invocation 的 server。WorkContract turn 还要求观察到 `exitAccepted=true` 的结构化 lifecycle receipt；仅有 final text 或正常 `end_turn` 会产生 `ended_without_outcome`，进入失败/恢复策略而不触发领域完成。

OpenCode 等 ACP Adapter 会把 MCP tool 投影成 `<server>_<tool>`。Persistent Worker 因此用 separator-bound suffix 将该名称归一到 WorkContract 配置的 canonical lifecycle tool；仍必须从嵌套 tool result 中解析到 `applied | duplicate` 与 `result.exitAccepted=true`，不能仅凭工具名把 Invocation 判为成功。

任何环境变量、凭据、授权令牌和进程参数都必须在日志、事件、诊断 API 与 UI 中按值完全隐藏，只展示“已配置”和来源。Runtime receipt、进程探测和错误对象同样不得携带秘密值。

Runtime generation 变化时必须先完成旧进程/旧 grant fencing，再保留或签发本 Invocation 的 MCP grant；不得用 Agent+Project 粗粒度撤销把刚创建的本轮 token 一并删除。daemon shutdown 与 stop/reconfigure 使用同一 transition 队列，并进入不可逆 closing 状态，shutdown 返回后任何迟到 transition 都不能重新启动 Runtime。Stop/Restart 必须重新执行 runtime preparation，不能复用已由旧 Runtime cleanup 删除的临时认证目录。

Runtime registration 明确记录 prepared config 是否仍可用。任何 stop、startup failure 或未达到 `acceptingWork` 的重启都会把当前配置标记为不可用；下一次 prepare 即使 launcher fingerprint 未变，也必须重新创建认证/临时目录并通过 reconfigure 提升 generation。启动失败后禁止回滚到已被旧 handle cleanup 删除的配置。
`stop` / `restart` 必须在等待 Supervisor transition 之前同步 fence config reuse；否则并发 prepare 仍可能捕获即将 cleanup 的目录。

Custom Runtime 的 `args` 只用于包名、子命令和非秘密启动选项。Catalog 保存层必须拒绝 API key、token、password、secret、authorization、bearer 等秘密参数模式；秘密只来自模型账号/凭据存储。Review 命令重放返回原事件对应的 revision、状态、summary 与 recordedAt，不读取已被后续决定推进的当前 Review 来拼接伪原始回执。

Custom Catalog 文件属于不可信持久输入，每次读取都必须重新执行当前 id、command、args 与秘密模式校验；旧版本写入的 `--key`、credential/private-key、拆分或单参数 `Authorization:` / `X-API-Key:` header（含 `--header=` 与 `-H`）或常见 token 前缀不能进入 Runtime Catalog，更不能被 Supervisor 启动。`review.create` 的 duplicate receipt 同样从原 `review.created` event 重建 `open / revision 1 / recordedAt` 投影，后续决定不改变历史命令结果。

Agent Definition 当前直接持有结构化主要职责、工作指令、runtime、账号、模型、Skill 与工作权限；Agent Team 只按 Agent id 选择成员并保留协作矩阵/工作流。运行时解析和在线 Evaluation 不得读取 Team role 的 persona、账号、Skill 或任何素材快照来覆盖已有 Agent，也不得为缺失成员构造 fallback Agent。`agent_team.create/update/deploy` 首次执行时重新解析当前 Agent Definition 与 Catalog；任一成员缺失或 runtime id 无效时整个命令拒绝，不产生部分事实。Team workflow 和 communication matrix 的所有 Agent 引用必须闭合于成员集合；历史孤儿只留在迁移存储，当前投影过滤孤儿成员及其拓扑边。所有 Team 命令拒绝空 command/idempotency identity；dedupe lookup 必须早于当前状态读取和写入，duplicate receipt 从原事件中的冻结结果恢复，不读取后续已变化的 Team，也不得把旧部署重放到当前 Channel。旧 deploy event 缺 Project identity 时只允许从冻结 channel 的权威 `conversation.project_id` 恢复并比较；关系缺失时拒绝重放，不能信任本次请求回填。

Custom Catalog 更新/删除是 runtime 注册表失效边界：服务端保存新 launcher 后停止匹配 runtime id 的所有 Supervisor owner、撤销 turn grant、清理旧配置并删除注册；进程继续运行但 Catalog 已变化属于一致性错误。`restartAgent` 还必须重新读取动态 Catalog，防止绕过 API 修改 Catalog 文件后继续沿用缓存 launcher。

`work.create` 写入的 Work 必须满足与任务投影相同的数据契约：`dependencies` 与 `artifacts` 始终是 JSON 数组。客户端反序列化还要把历史或损坏的非数组值收敛为空数组，不能让一个错误字段击穿整个桌面渲染进程。

## 13. 原生 Agent 触发闭环与实现真实性门禁（2026-08-24）

原生客户端复核确认稳定触发不是一个 `execute()` 函数，而是一个由同一 owner 管理的长生命周期闭环：

```text
Project EventQueue
  -> ManagedAgentRuntime.accept(event)
  -> session-affine worker lease
  -> ACP prompt/update/control
  -> RuntimeObservation projection
  -> structured MCP / ath CLI
  -> CommandReceipt + durable PlatformEvent
  -> same Project stream
```

`ManagedAgentRuntime` 是该闭环的唯一生产 Module。它的公开 Interface 只接受带身份、scope、causation 和 WorkContract 的事件，返回 admission/terminal handle，并暴露脱敏 observed snapshot。EventQueue、AgentWorkerPool、ACP process、session affinity、cancel/steer、permission grant 和 replacement 都是该 Module 的内部机制，daemon 只负责组合与领域协调。

当前仓库中的实现不能因存在同名类和单元测试就宣称完成。以下任一条件成立，ACP runtime 都仍视为 legacy：

- production daemon 没有持有 `ManagedAgentRuntimeSupervisor` 和 `AgentWorkerPool` 实例；
- `AcpBackend.execute()` 在每个 Invocation 内 spawn/initialize/kill 进程；
- worker/session affinity 只存在于逻辑 session repository，没有真实 ACP 连接复用；
- EventQueue 在 Runtime 未就绪时不能持久等待、恢复、去重、公平调度和 dead-letter；
- Runtime UI 的状态来自 Agent 配置或浏览器猜测，而非 supervisor observed snapshot。

替换完成后，健康 turn 只归还 worker lease，不关闭 ACP transport；只有配置 generation 变化、协议/传输失败、进程退出、hard timeout 或 shutdown 才回收进程树。Windows 桌面 Host 必须以 Job Object 或等价机制拥有所有后代进程。所有 observed snapshot 先在服务端删除秘密值，再允许投影到 Renderer。
