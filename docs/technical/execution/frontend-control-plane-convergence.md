# 前端与控制面收敛架构

> Status: Target architecture（实施中）
> Date: 2026-08-16
> Product decision: `docs/product/ux/2026-08-16-delivery-workspace-refactor.md`
> Active spec: `specs/frontend-architecture-refactor/`

## 1. 重构前基线

本规格启动时的审计基线（完成状态见第 9 节）：

| 表面 | 当前事实 | 架构问题 |
| --- | --- | --- |
| `taskHubStore.ts` | 2671 行、31 个生产消费者 | 同时承担投影、水合、Human Command、任务写入、运行配置和 UI 状态 |
| `taskStore.ts` | 任务 optimistic update 后直接调用 `dispatchToAgent()` | 浏览器把任务变化解释为下一条执行命令 |
| `daemonStore.ts` | 直接计算运行配置、busy 队列并发出 `terminal:start` | 浏览器持有派发 admission 与部分运行生命周期 |
| `daemon.ts` | 1918 行 | transport、执行协调和生命周期仍集中，尚未完成 executor-only 收敛 |
| 页面 | Project/Conversation/Delivery 多套语言并存 | 投影结构泄漏领域历史，用户和代码都难定位 owner |

服务端已经具备 `DispatchGateway`、Task Graph、Agent Inbox、Invocation Pipeline、Process Manager、
Project View Projection 和持久化消息对账。这次重构不新增并行控制面，而是完成浏览器责任回收。

## 2. 架构原则

### 2.1 Deep Module

重构以 Depth 为目标，不以“文件更多”或“行数更平均”为目标。每个 Module 应通过小 Interface 隐藏大量
Implementation 细节，并提高调用方 Leverage：页面只表达用户意图和渲染视图，不重复拼接任务、消息、阻塞、
交付、团队和运行状态。

### 2.2 唯一事实 owner

- Project、Delivery、Task、Gate、Message、Invocation 和 Runtime lifecycle 继续由服务端领域 owner 持有。
- WebUI Store 是可重建的展示投影，不是持久事实或自动化 owner。
- Human Command 通过显式 Command Interface 进入服务端；展示事件只更新投影。
- Socket 断线靠只读快照和持久消息对账恢复，不靠重发命令。

### 2.3 Replace, do not layer

每个迁移步骤必须删除被替代的旧 Implementation。不得在 `taskHubStore` 外再包一个长期共存的“大 façade”，
不得同时保留 `terminal:start` 与新 Command 路径，也不得维护两套任务状态词汇。

## 3. 目标模块

```text
React Delivery Workspace
        |
        | read
        v
DeliveryWorkspaceProjection
        ^
        | snapshots + project:view
ProjectViewAdapter ------------------ canonical service facts

React explicit user action
        |
        v
HumanCommandGateway
        |
        v
server Command owner -> domain event -> Process Manager / Inbox / DispatchGateway
                                                |
                                                v
                                      Directed AgentRuntime
                                                |
                                                v
                                      ACP lifecycle + receipts
```

### 3.1 `DeliveryWorkspaceProjection` Module

Interface：按当前交付返回一个不可写的 `DeliveryWorkspaceView`，并暴露稳定 selector。视图至少包含交付摘要、验收项、
当前工作、需要处理、活动摘要和任务视图输入。

阶段与当前工作属于跨领域展示投影：DeliveryRun 提供自主交付阶段，Task Authority 提供工作项状态。当持久化
DeliveryRun 仍停留在 `planning`/`executing`，但同一交付的权威 Task 已进入 `in_review` 时，投影必须展示
`reviewing`；`in_review` 同时属于当前工作。该校正规则只改变展示，不反向修改 DeliveryRun 或 Task 事实。

终态真相采用单向优先级：`DeliveryRun(completed) + DeliveryBundle` 冻结交付与验收结论，Task 继续作为工作明细投影。
若终态交付下存在非 `done` Task，`DeliveryWorkspaceProjection` 输出 `terminalProjectionConflict`，组件保留真实任务比例并追加
“需核对”，但不得把交付阶段或 Bundle 验收结果降级。前端不声称所有冲突都在自动修复，因为未关联/可选 Task 不一定属于
reconciler 候选；任务完成数和验收通过数必须分别标注。

验收证据同样由投影统一收口。`DeliveryWorkspaceProjection` 只读取冻结 `DeliveryBundle.acceptanceResults` 与
`DeliveryBundle.verification`，按 GoalContract 中的验收标准输出逐条结论、证据引用和验证元数据；缺少冻结结果的标准保持
`pending`。组件不得扫描聊天消息寻找“已通过”等自然语言，也不得直接解析尚未成为 Bundle 的原始 receipt。这样“聊天汇报”
与“正式验收事实”在展示边界上保持分离。证据详情使用原生渐进展开交互，验证方式、验证人、工具、报告、规格、代码版本和
完成时间均可查看，但不在首屏堆叠实现概念。

历史修复由服务端 `DeliveryTaskTruthReconciler` 持有。候选 Task 必须同时满足：关联 completed DeliveryRun、当前非 `done`、
并且在 `completed_at` 之前已经存在包含该 Task 的 `task.review_recorded` 且 payload.status 为 `done`，该 Action 还必须引用同一
Task 的不可变 `gate.passed` 事件与已通过的 `code_review` Gate。owner 使用 Task revision CAS
恢复投影，追加 `task.status_changed` 审计 Action、`task.done` Domain Event 和 Proof Log；重复扫描无副作用。它不根据 Bundle
摘要批量完成任务，也不重新裁决 Gate。

Implementation：隐藏 Conversation 兼容映射、Task/Blocker/Delivery/Message 合并、排序、空态、状态文案和项目隔离。
组件不得自行重复过滤同一领域数据。

测试：直接对纯投影 Interface 做表驱动测试；不 mock React 组件内部细节。

### 3.2 `HumanCommandGateway` Module

Interface：`submit(command) -> CommandReceipt`。命令必须包含稳定幂等键、项目、交付、actor 和明确来源。

第一条落地命令为 `delivery.requirement.submit`：

```ts
interface SubmitDeliveryRequirementCommand {
  type: 'delivery.requirement.submit';
  idempotencyKey: string;
  projectPath: string;
  deliveryId: string;
  actor: { type: 'user'; id: string };
  content: string;
  targetAgentIds: string[];
  taskId?: string;
  issuedAt: string;
}

interface CommandReceipt {
  idempotencyKey: string;
  commandType: SubmitDeliveryRequirementCommand['type'];
  projectPath: string;
  deliveryId: string;
  status: 'accepted' | 'rejected';
  duplicate: boolean;
  messageId?: string;
  targetAgentIds: string[];
  reasonCode?: string;
  userMessage?: string;
  recordedAt: string;
}
```

Implementation：Web API Adapter 只负责把 Command 传到同源 `/api/human-commands` 并还原 receipt；内存 Adapter
为调用方测试提供同一 Interface。服务端 Human Command owner 在一个 SQLite 事务内完成：

1. 校验 idempotency key、actor、Delivery、Project 路径和可选 Task 范围；
2. 通过 Team Runtime 校验显式目标，或选择 `initialAgentId -> roster[0]` 默认接手人；
3. 持久化 `chat_message`；
4. 建立 A2A possession、handoff packet 和 Agent Inbox 工作；
5. 写入 `human_command_receipt` 并返回权威 message id 与接手人。

相同 key + 相同请求返回同一 receipt 且 `duplicate=true`；相同 key + 不同请求返回
`human_command_idempotency_conflict`；项目/任务范围不匹配不产生消息或执行事实；没有可用成员返回持久化的 rejected
receipt。网络失败由 Web Adapter 作为 transport error 抛出，领域拒绝必须返回 receipt，调用方不得从 HTTP `ok`
自行猜测命令是否被接受。

交付已删除时 receipt 的 `conversation_id` 允许为空，但 receipt 仍保留原命令中的 `deliveryId`；项目范围不匹配和
handoff 未接纳同样持久化 rejected receipt。handoff 未接纳使用嵌套 savepoint 回滚消息、A2A 与 Inbox，再在外层
事务写拒绝 receipt，避免“有消息但没有团队工作”的半成品。

`message.append -> a2a.human_handoff` 两次浏览器 mutation 在迁移后删除。浏览器只在 accepted/duplicate receipt
返回后把权威消息加入本地投影；提交中状态属于 UI-only pending command，不预写领域消息。

第二条落地命令为 `delivery.plan.request`。它复用相同的项目/交付/actor/幂等契约，不携带浏览器选择的 runtime、账号
或 session。服务端通过 Team Runtime 选择 `initialAgentId -> roster[0]`，在同一事务内写入 Agent Inbox 与
`human_command_receipt`；Invocation Pipeline 的 planning scenario 消费 Inbox。新建交付的首次规划使用按 Delivery
稳定的幂等键，人工重新规划使用新的显式命令。浏览器只在 accepted receipt 后把 `breakdownStatus` 投影为 proposal。

Task 创建、改派和显式开始仍由既有 Task Command Service 持有事实。需要执行时，API 发布 `owner_ready` Task Wakeup，
经服务端 Invocation Pipeline/Inbox 推进；`platform-harness` 对 accepted Wakeup 的 `in_progress` 投影不得再次产生 Wakeup。
因此删除 `taskStore` 中 task create/reassign/status change 后直接调用 `dispatchToAgent()` 的实现，不另包一层客户端 façade。
浏览器不得先写 Task 领域状态：创建、编辑和状态命令等待服务端返回带 `revision` 的权威 Task 后再更新投影，请求携带
`expectedTaskRevision`。`GET /api/state` 和统一 `project:view(type=task.state)` 投影都必须携带该 revision；rehydrate 按
`(conversationId, taskId)` 与当前 Store 合并，旧快照不能覆盖更高 revision 的 Socket 投影，只有实际接纳的投影才推进
本地 epoch。HTTP 响应也只有 revision 不落后于当前投影时才能提交。服务端在证据 Gate、恢复 Wakeup 等副作用之前完成
revision admission；证据不足的拒绝把恢复 Inbox Command 与 `task_command_rejection_receipt` 放入同一事务。仅已经持久化的
同一幂等命令允许按冻结结果重放，重试不会再次触发恢复工作。

任务详情中的人工“请求进度”使用 `task.progress.request` Human Command。服务端校验 Project/Delivery/Task 范围和任务 owner，
再原子写入 Agent Inbox 与 receipt；它不允许浏览器选择 engine/account/session，也不把按钮伪装成 `simulateCliExecution`。
该命令落地后删除浏览器 pending dispatch 队列、强制发送、`dispatch.enqueue/cancel` 兼容 API 和所有
`terminal:start` emitter；队列展示若仍需要，应改读服务端 Inbox 的只读调试投影，而不是在浏览器持有可变副本。

浏览器不选择 runtime、账号、agent session、busy queue 或重试策略。

这是一个真实 Seam：生产 Adapter 使用 Web API，测试 Adapter 使用内存 receipt。出现第二个真实远端 transport 前，
不得扩展为通用 transport framework。

### 3.3 `ProjectViewAdapter` Module

Interface：订阅项目展示信封、读取当前项目快照、合并持久消息。

Implementation：复用 `consumeProjectViewEvent`、项目 room 和消息快照契约；校验版本与 `projectId` 后才更新投影。
它不能导入 `HumanCommandGateway`，静态架构测试必须阻止展示事件产生网络写入或执行命令。

项目活动的读侧投影遵守以下消息身份规则：

1. `invocationId` 是一次 Agent 回复的稳定身份；同一 Invocation 的文本、工具事件和最终消息即使被并行 Agent 事件穿插，也投影到同一个回复实体。实时 stream message、delta buffer、watchdog 和完成动作同样按 Invocation 定域，同一 Agent 的并发 Invocation 不能共享活动消息；正常完成、超时和 setup failure fallback 发布的 Runtime Project View 事件都必须携带已经取得的 Invocation subject。
2. 没有 `invocationId` 的人工消息按持久消息 ID 独立展示；不同 Invocation 绝不按 `agentId` 合并。
3. `task_status` 和 system sender 投影为活动提示，不进入 Agent 气泡分组；原始通知正文只作为可展开的审计详情。
4. 活跃的 provisional 回复与同 Invocation 的 durable 消息重叠时只显示 provisional；完成并对账后只显示 durable，避免刷新前后裂成两个回复。
5. Runtime thinking 与最终自然语言答复是回复主线；thinking 使用低权重 disclosure，最终答复直接可读。工具事件只投影为 Invocation 级操作回执（进行中/已完成、操作数、执行问题数），工具名、参数和逐条结果只进入观察详情；`tool.completed` / `tool.failed` 作为 Runtime 观察消息持久化，使刷新后的回执与实时状态一致，但不会发布用户消息领域事件。最终回复超过阅读阈值时只收起正文容器，不得收起结构化证据、任务引用或阻塞事实。

这些规则由纯时间线投影函数持有，`GlobalChatRoom` 只渲染投影结果，不再按连续发送者临时分组。

### 3.4 `AgentRuntime` Module

Interface：消费已裁决的 Execution Envelope，报告 started/completed/failed/cancelled lifecycle。

Implementation：`src/server/agent-runtime/` 通过 `DirectedAgentRuntime`、`AcpRuntimeDriver`、
`AgentSessionLifecycle`、`AgentProcessRegistry` 和 `AcpRuntimeEventCoordinator` 隐藏定向 envelope、
占位/ACK、ACP Catalog/permission/backend、Session generation、进程清理和 turn event normalization。
Daemon 不再从 socket payload 重做业务 policy，
不把 UI 在线状态当执行条件。

对 Invocation Pipeline 暴露的最小端口固定为 `isBusy(agentId, deliveryId)` 与
`execute(InvocationDispatchPlan)`。`DirectedAgentRuntime` 对本地 agent + project 先做原子进程占位；占位失败时在创建 envelope 之前
返回 `agent_busy`。占位成功后才按 Agent Binding 创建定向 Execution Envelope，并依次完成
`sent -> acknowledged`，随后把 Plan 和 envelope context 交给慢速 ACP setup。这样并发 activation 不会 ACK 一个最终
未获准启动的进程。指向其他节点但当前进程没有对应 executor 的命令以
`runtime_executor_not_connected` 拒绝，绝不在本地降级执行。
Adapter 只接受 Planner 已完成 Team、Skill、Context、WorkContract 与 runtime
裁决后的 Plan；Daemon 内部执行函数负责 ACP 生命周期，不再接受浏览器塑形的 `TerminalStartPayload`。原
`terminal:start` / `terminal:kill` Socket 命令没有合法生产消费者，删除而不提供兼容转发；只读
`daemon:status` 暂留作运行投影水合，不具备派发或恢复写权限。

Control Runtime 的 Command Adapter、Agent Inbox、Delivery Repository 与 Effect Outbox 必须共享同一个注入时钟。
否则测试、恢复重放或节点时钟校正时，新入队工作的 `availableAt` 可能晚于调度器的权威时间，表现为已经显示“执行中”
却没有可领取工作。时钟是 Adapter 组合根的一部分，不允许内部依赖自行回退到墙上时钟。

Execution Envelope 必须定向到唯一 `toNodeId`，节点只能读取自己的 runnable envelope。目标节点在路由前已不可达时
以 `runtime_unreachable` 拒绝；进入 `sent` 后超过 TTL 仍未 ACK 的 envelope 由 daemon 周期扫描为 `expired`，记录
`ack_timeout`，不得由浏览器重发或改派。已 ACK 的 envelope 即使 backend setup 延迟也不再参与 no-ACK 过期；setup
失败转为执行失败 proof，不会失去活进程追踪。

本次发布的生产执行器是**单 daemon、本地执行**：定向 envelope、ACK、no-ACK 与不可达语义已经落地，但尚未提供跨节点
transport consumer。非本地 `toNodeId` 一律 fail closed；多节点远端执行属于目标架构，不计入本次已完成能力。

任务图恢复、closure wakeup 和归档扫描由 `AutonomyGuardOwner` 持有。它可以与本地 executor 同进程部署，但不在
Agent Runtime 内执行；daemon transport 只启动/停止该服务端 owner，不再读取 Task/Envelope/Gate 来决定恢复动作。

## 4. Locality 规则

- 交付页面需要的派生数据集中在 `DeliveryWorkspaceProjection` 与 `ProjectWorkItemProjection`，不散落于 `ProjectWorkItemsWorkspace`、`ProjectRightPanel`、
  `ProjectSidebar` 和各个卡片。
- UI-only 状态（面板开合、当前视图、草稿）靠近所属组件；只有跨路由且必须保留的 UI 状态进入小型 UI Store。
- 领域类型来自 `src/shared/` 或服务端只读契约；组件不定义第二套 Task/Delivery vocabulary。
- 运行诊断数据只在调试功能目录消费，不扩散到主视图。

## 5. 迁移切片

### Phase 1：对象语言与页面投影

- 新增纯 `DeliveryWorkspaceProjection` 和测试。
- 侧栏从“Conversation 即项目”改为“Project -> Delivery”展示。
- 交付摘要成为中心主视图；聊天降为活动区。
- 团队活动按 Invocation 合并消息：工具事件始终直接展示，中间自然语言过程说明默认折叠，最后一段正文和结构化任务/交接卡保持可见。
- 右面板完成 5 -> 2 的既有 IA 决策。

本阶段不改变服务端 schema，可用兼容映射读取现有 Conversation；映射只存在于投影 Module，并注明退出条件。

### Phase 2：Human Command 单入口

- 建立 `HumanCommandGateway` 及 receipt。
- 先把交付补充要求迁到原子 Human Command；再迁移任务动作和交付动作。
- 删除浏览器任务 mutation 后自动 `dispatchToAgent()` 的行为。
- optimistic UI 只表现 pending command；服务端投影确认后才成为领域事实。

### Phase 3：浏览器退出派发控制

- 删除 `daemonStore.dispatchToAgent`、浏览器 busy queue、`forceSendDispatch` 和 `terminal:start` emitter。
- 所有用户派发由服务端 Command owner 经 Inbox / DispatchGateway 推进。
- Store 只保留运行展示状态和明确的人类命令提交状态。

### Phase 4：Daemon executor-only 与删除兼容

- Daemon transport 只归一化 envelope/cancel 命令并调用 AgentRuntime。
- 业务 policy、任务状态推进、自动恢复和重试只在服务端 owner。
- 删除零消费者类型、旧事件、兼容测试和失效文档，更新当前架构图与 wiki。

## 6. 架构门禁

1. `src/components/**` 不得发出 `terminal:start`、A2A ACK 或 Runtime lifecycle mutation。
2. Project View / Socket 展示消费者不得 import 或调用 Human Command Interface。
3. `taskStore` 的任务写方法不得调用 `dispatchToAgent`。
4. 主视图组件只消费 `DeliveryWorkspaceView` 和局部 UI 状态，不直接拼装跨领域对象。
5. UI 中的 TaskStatus 只来自 `src/shared/task-status.ts`。
6. 生产代码中自动执行只有 Agent Inbox / Harness / Process Manager / DispatchGateway / Effect Worker owner。
7. 每删除一条旧路径，同步删除其类型、测试和事实文档；兼容映射必须有明确退出条件。

## 7. 验证与度量

- 静态依赖测试：验证上述禁止 import/call 关系。
- Interface 测试：投影合并、项目隔离、命令幂等 receipt、失败回滚和消息对账。
- 组件测试：Project -> Delivery 导航、任务/调试二级结构、需要处理、草稿保持。
- 浏览器 E2E：新建交付、补充要求、查看验收、处理异常、切换任务视图、进入调试。
- 运行验证：浏览器离线时服务端自动任务继续；多标签页不会重复启动 Agent。

退出度量不以单纯 LOC 为准，但必须同时满足：

- `useTaskHubStore` 的主工作区生产消费者从 31 个持续下降，跨领域 selector 归入投影 Interface；
- React/store 生产代码中 `terminal:start` emitter 为 0；
- `taskStore` 中自动 `dispatchToAgent` 调用为 0；
- 右面板一级 tab 为 2；
- 主视图内部实现词扫描为 0；
- 关键 E2E 和架构门禁全部通过。

## 8. 风险与回退

- **对象迁移风险**：现有 Conversation 同时承载旧项目和交付语义。Phase 1 只做只读兼容映射；引入独立 Delivery schema
  必须另行冻结数据迁移契约。
- **双写风险**：optimistic Store 与服务端回执可能产生短暂重复。通过幂等键和投影对账解决，不新增客户端事实。
- **大爆炸风险**：页面重构和控制链收敛按四个 Phase 独立验证；任一 Phase 回退时恢复该 Phase 的提交，不恢复已确认
  无生产价值的旧 owner。
- **外部参考风险**：禁止复制源码和品牌资产；评审增加命名、视觉和依赖来源检查。

## 8.1 统一 Renderer 壳层边界（2026-08-23）

Web 与桌面不得形成两套前端应用。`ClientHome` 是应用级 Renderer 入口，`ProjectWorkspace` 是交付工作台入口；Tauri Host 加载同一个生产构建，并仅通过 Host Adapter 提供平台能力。

页面模块边界固定为：

- `WorkspaceAppChrome`：窗口级轻量 Chrome，持有全局创建与设置入口，可声明 Tauri drag region；不消费交付事实。
- `ProjectSidebar`：消费完整 `ProjectNavigationGroup[]`，提供跨项目交付总览入口，并按命名 Project 分组 Delivery；选择只回调页面 owner，删除交付必须继续通过 `WorkspaceCommandGateway`。
- `ProjectsOverview`：只消费同一导航投影，提供组合指标、最近可继续 Delivery（进行中 + 已暂停）与命名 Project 进度，并从具体 Delivery 进入详情；顶部、继续工作与 Project 卡片必须使用同一可继续口径。`openBlockerCount` 明确表示所有开放阻塞，不冒充只属于用户的 Attention。不直接读取 Store，不建立第二套统计事实。
- `ProjectWorkspace`：一次计算导航与 `DeliveryWorkspaceView`，持有 overview / delivery / evaluation 等局部页面状态，并把统一 View 下发给总览、详情与检查器。
- `ProjectOverviewSurface`：Project 默认只展示权威汇总，不挂载聊天输入。
- `ProjectWorkItemsWorkspace`：选中工作项后才挂载该 workstream 的活动和输入；Project workspace 历史讨论不混入新工作项。
- `ProjectRightPanel`：仅在已选 Delivery 时可用；关系图与调试继续按用户意图加载。

本边界借鉴 Buzz 的不是 CommunityRail，而是它的三项深层约束：Project 一级总览和侧栏快捷列表共用同一 read model；Project 只组织长期上下文，不吞并成员对象的业务权威；Agent 上下文必须由明确选择形成，而不是靠页面猜测。对应到本系统，Project 由 `projectPath` 投影，Delivery 是拥有目标、验收和工作闭环的聚合；当前 Agent 请求已显式绑定 Project path 与 Delivery identity，Task 只在用户显式引用时进入请求，页面 surface / mode 尚未扩展为 Command 上下文字段。统一事件包络只统一 identity / scope / cause / reply / idempotency，不把这些领域对象合并为万能 Event 实体。

交付总览选择和 Project 展开是纯 UI 状态，不新增 Project 事实 Store，也不经 Command Gateway。Delivery selection 继续复用现有选择状态以保持草稿隔离和历史兼容；外部创建流程改变权威 selection 后，页面 owner 必须同步打开该 Delivery，避免 Store 已选择而页面仍停留在总览。Renderer 组件不得根据 `window.__TAURI__` 分叉业务 IA；平台能力只能由 Host Adapter 或无害的 DOM 属性增强。

本轮验证证据：

- 总览投影、Project 分组、跨 Project/外部创建选择、详情和零数据空态回归：6 个测试文件、23/23 通过；仓库全量回归：237 个测试文件通过、2 个跳过，1769 个用例通过、2 个跳过；
- `pnpm exec tsc --noEmit`、受影响文件 ESLint 与 `pnpm build` 通过；构建只保留主线既有的 `worktree-manager` NFT 动态路径告警；
- 真实生产页面在 1280×720 和 800×600 下均无文档级横向/纵向溢出，全局创建入口唯一；工作区侧栏可从 260px 收至 56px 后恢复；
- 桌面 Renderer 已由同一前端产物重新准备；本轮活动交互更新后的构建标识为 `desktop-build-99e062c8844600c0c1fc9e0e16215584`。

## 8.2 Delivery Activity Surface（2026-08-23）

本节的 Delivery 局部 surface 已由 2026-08-31 的 Project/WorkItem 分层替代。`ProjectObjectWorkspace` 持有 Project surface，
`ProjectWorkItemsWorkspace` 持有工作项详情 surface；活动时间线只消费当前 workstream 的 `ChatMessage` 投影，用户发送继续通过 `WorkspaceCommandGateway`。

活动交互的 Module / Interface 固定为：

- `GlobalChatRoom`：给定 Store 中的当前 WorkItem workstream selection，提供连续时间线、引用回复、常驻 Composer、历史加载和回到最新；不解释 Task/Delivery 生命周期。
- `useDeliveryRequirementDraft`：以内部 workstream identity 为唯一 Interface，隐藏本地持久化格式和读写异常；返回当前草稿、更新和清除能力，不成为消息事实源。
- `useAutoScroll`：隐藏 ResizeObserver / MutationObserver 与底部阈值，返回 `isAtBottom` 和显式 `scrollToBottom`；只有用户仍在底部时自动跟随内容增长。

引用回复在当前阶段只生成明确可见的引用文本；Command、Message repository 和 Agent Context 尚无 reply relation，因此 UI 不得展示线程计数、跳转锚点或“已建立回复关系”等语义。未读/已读也尚无服务端 Projection，本轮只提供当前已打开时间线内的瞬时“新增活动”提示，不写入 Store 或数据库。

## 9. 当前实施状态（2026-08-16）

- Phase 1 已建立 `DeliveryWorkspaceProjection`，首批消费者为交付主视图和右侧工作面板；投影统一给出阶段、验收进度、
  当前工作和需要关注。
- 终态交付真相已冻结为 DeliveryRun + DeliveryBundle，Task 仅作为可校准的工作明细；任务完成与验收通过采用独立标签和计数。
- `DeliveryTaskTruthReconciler` 在 daemon 启动时及周期扫描 completed Delivery 的 Task 明细。它用 WorkContract 绑定、
  `task.review_recorded`、不可变 `gate.passed`、通过的 code-review Gate、Task stream sequence 与完成时间共同裁定候选；
  keyset 分页不会被不可修复旧行饿死，多实例通过 Task/Graph CAS 幂等收敛。合法状态路径、Action、Proof 与最终 `task.done`
  在同一 SQLite 事务提交。未关联或缺少冻结证据的 Task 不会被自动改写，页面只显示通用“需核对”。
- 顶栏、侧栏、创建弹窗和活动输入已统一为 Project -> Delivery 用户语言；全局手工“新建任务”入口已删除。
- 右面板已从五个一级 tab 收敛为任务/调试，待办与风险统一为“需要关注”，关系图下沉为任务视图模式。
- “需要关注”只接受人工 blocker 和自主交付 `waiting_human` 升级事实；普通 ready/review、自动 gate 失败和 timeout
  仍属于团队工作状态，不再误报为用户待办。`DeliveryRunSnapshot` 通过工作区局部状态进入只读投影，不进入全局事实 Store。
- 未选择交付时活动输入被禁用，Store 不再隐式创建或选择 Conversation，避免要求跨项目落入任意交付。
- `delivery.requirement.submit` 已成为交付补充要求的单入口。浏览器通过 `HumanCommandGateway` 一次提交，服务端在同一
  SQLite 事务内写入消息、A2A possession、handoff packet、Agent Inbox 与 `human_command_receipt`；默认接手人由
  Team Runtime 的 `initialAgentId -> roster[0]` 决定。
- 浏览器已删除 `message.append -> a2a.human_handoff` 双调用和补充要求的乐观领域写入；accepted/duplicate receipt
  返回后才投影权威 message id。领域拒绝保留草稿，传输失败可使用同一幂等键和 issuedAt 重试。
- 关系图请求在交付切换时取消并按 request sequence 拒绝迟到响应，面板还会校验返回的 `conversationId`。
- 首屏性能边界采用“有界水合 + 意图加载”。`/api/state` 不再返回没有主工作区消费者的 recent Invocation 调试对象，
  每个交付只投影最近 200 条消息；当前交付在 `hasHydrated=true` 后异步对账最新消息快照，并通过 `(createdAt,id)` 游标继续读取
  更早历史。活动时间线首次渲染最近 120 个聚合项，用户可逐批显示更早内容。设置、任务详情、成员/创建弹窗、评估工作区、
  关系图组件与 Agent 调用详情均使用客户端动态 import；右侧关系图数据和调试组件只有在对应视图实际打开时才加载。该收敛
  不改变服务端消息、Invocation 或 Task 的事实源。
- `delivery.plan.request` 与 `task.progress.request` 已进入同一 Human Command owner；Task 创建、改派、显式开始由
  Task Command Service 写事实，并由服务端 Task Wakeup 触发执行。浏览器等待带 revision 的 Task 回执后再投影，
  不再乐观写入领域状态。水合按任务 revision 合并，不允许迟到的 `/api/state` 覆盖较新的 Socket 事实。
- Task 证据 Gate 的拒绝采用 Task revision CAS，并在同一 SQLite 事务写入恢复 `AgentInbox` Command 与
  `task_command_rejection_receipt`。migration v82 将交付/任务 ID 固化为审计标识，使聚合删除后相同幂等键仍返回冻结
  403 receipt，不会重复产生恢复工作。
- `record_gate_decision` 在 `WorkContractRepository` 的 admission 事务内校验 decision、显式 evidence、Gate 存在性，
  以及 Gate target 与 Contract 的 Task/Delivery 绑定。失败只记录 rejected outcome，不占用 Contract 唯一终态名额，
  修正后的 outcome 仍可重新提交；异步 Gate Process Manager 不承担第一道完整性校验。
- Gate 评审/验收的 Work identity 必须包含精确 `gateId`。同一任务与 reviewer 的下一轮 Gate 是新工作，不得复用上一轮
  已关闭的 Work Authority；旧 authority 只作为历史证据。Work identity 的构造、解析、purpose/agent/target 提取统一由
  一个深模块持有，Snapshot Builder、Control Command Adapter 与 Gate Lifecycle 不再各自解析字符串。
- Work Cell 投影或调度语义变化必须同步提升 Delivery control policy revision；旧版本已持久化的确定性 Decision 保持不可变，
  新版本即使观察到相同 owner-fact revision，也会以新的 Decision identity 完成部署后收敛。Gate-scoped Work、Task owner-event 与 Durable Inbox liveness 投影使用 revision 5；正式 continuation 投影使用 revision 6。
- Task 已进入 `in_review` 后，最新 requested/evaluating Gate 由精确 `gateId` 持有生命周期；执行人清空或其他非制品字段导致的
  Task revision 变化不得取消本轮评审。Reviewer Work 独立于 implementer assignment 调度，避免卡片元数据操作吞掉已提交制品。
- Task 的语义更新与 `task.updated` owner event 必须同事务提交。Control Snapshot 读取的 Task revision 变化必须同步推进
  project snapshot revision，避免同一 deterministic Decision identity 绑定两份不同内容。
- Gate Command Adapter 从结构化 Work identity 解析 reviewer/verifier；Task 只提供目标制品与上下文。只有 execution Work
  依赖 Task 当前 implementer assignment，独立 Gate Work 不得因 owner 清空而拒绝。
- `task.done/cancelled` 清理只取消执行/返工 Inbox；Delivery-scoped review/verification 本来就在 Task done 后运行，必须保留。
  `agent.work.cancelled/expired` 事件按 command Work id 释放 applied Control slot，避免预检失败造成永久容量泄漏。
  `recoverExpired()` 同时扫描 applied action 对应的 terminal Inbox，覆盖处理器升级后旧事件不重放的部署恢复场景。
- Delivery Gate 的 review/verification receipt 使用同一深校验模块，WorkContract admission 与 Gate Process Manager 不再各自
  解释 schema。缺失/非法顶层 `payload.receipt` 在占用终态 Outcome 前拒绝；Prompt 明示完整 receipt schema 与验收标准。
- Control Snapshot 将 Durable Inbox 的 `enqueued/released/claimed` 投影为 Work Cell `queued`；Decision 只输出
  `dispatch_pending`，不重复 activate。Inbox admitted 后由 WorkAuthority/Invocation 接管，终态 Invocation 仍能投影 retry/completed。
- Gate Agent 已 accepted 的 `request_human_decision/report_blocked` 直接投影 `waiting_human` 并升级 Delivery；权限或外部依赖
  未解除前不再重复启动同一 evaluator，也不允许用伪造回执绕过质量策略。
- `ContinueGateLite` 成为 `continue_work` 的唯一解释者：admission 先校验 versioned checkpoint；终态 Invocation 将 Work 投影为
  `continuation_pending`，Decision 输出独立 `continue`，Adapter 把摘要、精确下一动作、剩余步骤和证据带入新 WorkContract epoch。
  执行、Task 评审、Delivery 评审和验收验证 WorkContract 均可使用同一有界续作出口；续作拥有独立有界预算，不再被计作
  `invocation_completed_without_outcome`，也不消耗真正的 runtime failure retry budget。
  migration v83 将 `continue` 纳入 Control Action schema、唯一 slot 索引、claim/release 和 terminal Inbox 回收；活动 Inbox 会把
  `continuation_pending` 投影为带 slot 的 `queued`，同一 checkpoint 不能重复派发或绕过 role/global capacity。升级前已 accepted
  但不满足 v1 schema 的历史 `continue_work` 继续走原 Invocation retry，不会被新 Adapter 错误接管。
- `ContinueGateLite` 只拥有 Delivery Control Plane 内的 continuation。没有 `delivery_run_id` 的 standalone/A2A Work 在 admission
  接纳 `continue_work` 时，必须在同一事务内写入稳定的 continuation Inbox command，保留 Work identity、A2A chain/Possession
  authority、execution mode/subject、由冻结 execution profile 推导的 planning/review/verify/recovery/closure stage 与 checkpoint；Runtime 消费该命令时再签发新的 fenced epoch。每个 standalone Work 最多三次 continuation，第四次在
  占用 Contract 退出槽前返回 `continuation_budget_exhausted`。因此 accepted 不再只是事件记录，重复提交或重启也不会重复排队。
- `propose_task_graph` 同样改为 admission 原子提交：planning Contract 冻结 Task Graph revision，MCP Adapter 注入该 revision；共享
  parser/owner 校验 canonical tasks、Project 成员、已有 WorkItem 状态和 DAG。accepted/applied 回执返回前，Task Graph commit、负责人、
  依赖与所有可运行 standalone Task 的 Inbox command 已存在；owner 强制 payload revision 等于 Contract 冻结值。异步 handler 仅恢复
  历史 accepted outcome（包括缺 graph authority、缺冻结 result 的 v1 event-id commit），不能再作为首次业务写入。尚未 commit 的旧 accepted
  proposal 只允许沿旧 payload revision 做一次 stale-fenced 恢复。依赖完成和延迟 Outcome 重放都只认触达该 Task 的最新 graph commit；若最新
  owner 是 Delivery 或其他写入路径，不得回看旧 standalone proposal 重复派发。
- `handoff_to_agent` 是终态、事件驱动的协作出口，不是统筹 Agent 的轮询检查点。WorkContract admission 与 A2A Process Manager
  复用同一解析/标准化模块：字符串证据引用兼容归一为结构化引用，非法 branch 在占用终态 Outcome 前拒绝。已接纳交接直接投影为
  `waiting_dependency`，无论单人派工还是多人协作，接收者全部收口后都由 durable A2A result callback 为原持有者开启新 fenced epoch；统筹角色不得用
  `continue_work` 查询接收者是否完成。
  Team Workflow 使用的 `quality_gate` 在边界归一为 A2A 的 canonical `verify` intent，避免业务阶段词与协议词不一致造成异步死信。
  admission 与 PassGroup/Possession/receiver Inbox 创建处于同一个 SQLite transaction；重复目标、source revision、cycle、hop budget
  或路由策略失败会整体回滚并记录 rejected outcome。durable outcome handler 只做已创建 group 的幂等恢复，不再承担首次确定性校验。
  handler revision v3 会恢复未被后续 Work epoch 覆盖的 v2 历史死信；已有 group 必须匹配完整 normalized request digest 和最初创建它的
  accepted outcome/Work epoch。同一 epoch 的重复投递安全幂等，后续回调 epoch 即使复用完全相同的 key/packet 也同步拒绝为
  `a2a_idempotency_conflict`，不会错误等待旧 group。v85 之前没有 origin 字段的历史 group 只允许同一 Work 下最早使用该 handoff key 的
  accepted outcome 原子补绑定；任何后续 epoch 都不能认领历史 group。v87 会再次执行同一幂等 schema repair，覆盖开发数据库曾由
  隔离分支占用 v85/v86、但实际没有 origin columns 的迁移编号碰撞。历史已 accepted、但旧 admission 未要求 `idempotencyKey` 的 handoff
  仅在 durable v3 handler 内使用 `legacy-outcome:<outcomeId>` 恢复；当前同步 admission 仍严格拒绝缺 key 的新请求。
- `invocation_completed_without_outcome` 等内部协议故障只消耗系统自动恢复预算，预算耗尽后进入可诊断失败，不得伪装成需要用户判断
  Agent lane 是否可用的业务决策。`waiting_human` 仅保留给 Agent 显式上报的阻塞、授权/配置缺失和真正的外部业务选择；界面展示可执行的
  人话说明，不暴露 ControlAction id。
  正常完成但未提交 Outcome 时，自动恢复不是重跑原任务，而是最多一次 outcome-only fenced epoch：保留上一轮持久回复与权威上下文，
  只暴露 `agent_submit_outcome`，拒绝原生 edit/execute 与 Skill 工具。恢复轮次仍无 accepted Outcome 或 Runtime 失败时直接以内部系统故障
  终止，不再重复实现、重复验收或打扰用户。
  Command Adapter 对失败终止的权威性校验同时接受目标 Work epoch 上“预算已耗尽且 reasonCode 精确一致”的内部故障；不能要求该
  `retry_pending` Cell 预先变成另一种 `failed` 状态，否则控制器会自相矛盾并把内部拒绝错误升级给用户。
  单条 ACP session update 超过展示上限时在边界截断并保留 `[truncated]` 标记，不再终止整个 turn；累计输出、队列和并发预算仍保持硬限制，
  避免一次超长工具结果让聊天气泡永远停在“思考中”且丢失后续最终回复。
  这次 outcome recovery 的 Work Cell 语义变更使用 control policy revision 8，避免与 revision 7 的持久化决策 identity 冲突。
- AutonomyGuard 只有在存在可持久化 `waiting_human` 的活动 Delivery owner 时才启用失败预算抑制。普通 Task 没有该
  owner 时继续保留恢复 wakeup，避免任务停在 ready/in_progress/in_review 且没有任何用户可见升级事实。
- `taskStore` 的任务变化后自动派发已删除；`daemonStore` 的浏览器 runtime 注册、busy queue、强制发送、自动重试、
  `terminal:start` emitter 与 `dispatch.enqueue/cancel` 兼容 API 已删除。React/store 仅保留运行展示状态和只读水合。
- Phase 3 浏览器控制面收缩和核心回归已完成；Phase 4 已让 daemon 通过定向 `AgentRuntime` 接受已裁决 Plan，
  在 envelope 前原子占位、在 ACP setup 前 ACK，并把自主恢复 policy 移到 `AutonomyGuardOwner`。当前只接通本地单 daemon；
  更细的进程生命周期拆分、取消命令、远端 transport 和重启恢复仍保留在活动规格中。

### 验证证据

- `pnpm exec tsc --noEmit`：本轮改动文件无新增类型错误；仓库级检查仍被既有 `.next/types/validator.ts`
  过期路由引用、`e2e/autonomous-delivery-closure.spec.ts` 的旧 API 引用和 Quality Gate Process Manager 的既有
  nullable 类型错误阻断，不将其误记为本轮通过。
- Human Command service/API/Adapter 原子性、回滚、幂等与拒绝语义：18/18 通过；相关 Store、组件、API 和架构
  定向回归：125/125 通过。
- 审查后新增的项目隔离、用户关注、关系图竞态、活动输入、默认接手人与自主交付组件回归：64/64 通过。
- `/api/mutations` 集成测试覆盖任务 revision admission、拒绝回执重放、证据恢复时序、Team Pack roster 和无接手人冲突；
  本轮相关控制面定向回归全部通过。
- ACP backend 因全量并发时序抖动的两个测试文件单 worker 重跑：22/22 通过。
- `pnpm build`：通过；保留主线既有 `worktree-manager` NFT 动态路径告警。
- 自主续作完成时的全量测试（`--maxWorkers=4`）：1600 通过、2 跳过、0 失败。追加团队活动渐进展开后再次全量运行：1599 通过、2 跳过、2 个 ACP 时序用例失败；失败文件单 worker 重跑全部通过，未发现触及本轮 UI/Prompt/Control 变更的失败。
- 本轮新增模块与组件的定向 ESLint 通过；仓库级 lint 仍保留既有 `no-explicit-any` 等基线债务，不将其误记为本轮清零。
- 真实浏览器回归：在 Next.js 16.2.4 开发服务中新建非自主交付，切换任务看板/关系图，通过 Human Command
  提交补充要求并看到权威活动；最终刷新后阶段/验收/当前工作/需关注与任务/调试层级正确，交付与活动只出现一次，
  控制台错误为 0。
- 历史基线曾在收起态直接投影最近工具名称/目标；现行交互已由统一 Agent response presentation 替代：thinking 与最终答复为主线，Trace 在聊天中只保留操作回执，完整工具详情从 Invocation 观察入口查看。
- 自主链路实跑：Delivery `delivery-0001786897386331-006536-140198c5` 在无人代写 Gate 结论的前提下完成 Task Review
  与 Delivery Review；Acceptance Verification 因目标明确要求 Web UI E2E、而 Playwright 权限被拒绝，稳定收敛到
  `waiting_human`。该结果验证了 evaluator 工具调用、Gate-scoped Work、严格 receipt admission、下一阶段自动推进，
  以及真实外部权限边界上的停止语义；系统没有继续空转或伪造验收回执。
- 自主控制面定向回归：14 个测试文件、94/94 通过，覆盖 Work identity、Gate outcome admission、Delivery receipt、
  Durable Inbox、Control slot 回收、Snapshot/Decision/Command Adapter 与 Runtime。
- 自主续作与协作决策回归覆盖 checkpoint admission 与单轮幂等、`continuation_pending`/durable queued 投影、独立预算、
  `continue` Command、容量与 slot 回收、执行/Task 评审/Delivery 评审/验收验证恢复提示、历史格式兼容、A2A 生命周期和
  四出口协作协议；最终仓库全量回归 1609 通过、2 跳过，受影响文件 ESLint 通过。
- 终态交付 Task 投影校准定向回归 14/14 通过；连同 Task Command、Gate/Delivery Process Manager 与 Wakeup Router 的扩大回归
  33/33 通过，受影响文件 ESLint 通过，独立代码复审无 Critical/Important。仓库全量运行 1631 通过、2 跳过，唯一失败为既有
  `evaluation/recovery.test.ts` 仍断言 migration 83、实际主线已为 84；`tsc`/build 仍仅被既有
  `quality-gate/outcome-process-manager.ts:87` 的 nullable `runId` 类型错误阻断。
