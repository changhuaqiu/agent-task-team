# 命令驱动的交付内核

> 状态：active
> 日期：2026-08-23
> 事实源：本目录
> 参考：Buzz CLI、buzz-acp、buzz-agent 的本地源码

## 1. 决策

本项目不再把“交付”建模为需要用户预先创建、由 Agent 最后宣告完成的一次 Run。交付是项目中持续形成的一组可验证事实：任务结果、产物、评审、批准、发布与通知。只有经过统一 `CommandService` 接纳并返回 `CommandReceipt` 的操作，才能改变这些事实。

Agent 的推理、计划、文本、工具流、进度、心跳和进程退出属于运行观察，不是交付事实。`runtime.completed` 只表示一次 Invocation 已结束；它不能直接完成 Task、Delivery 或 Project。

不保留历史兼容层。现有 `autonomous_delivery_run` 在新内核中降为可选的执行/编排视图，不再是用户必须创建的顶层产品对象，也不再拥有“交付是否完成”的最终解释权。

## 2. 接口分层

```text
Agent ── structured MCP（主路径） ─┐
Agent / 人 / 脚本 ── ath CLI（逃生仓） ─┼─> CommandService ─> Domain Owner transaction
Desktop / Web ── Human Command API ────┘          │
                                                  └─> CommandReceipt + PlatformEvent

ACP / Agent Runtime ──> RuntimeObservation ──> Activity Projection
```

- `CommandService` 是唯一事实写内核。权限、幂等、revision、fencing、事务、领域事件与回执只实现一次。
- 结构化 MCP 是 Agent 主路径。它暴露与当前 `WorkContract` 相匹配的最小工具集，参数使用 JSON Schema，默认拒绝未授权命令。
- `ath` CLI 是完整通用接口与逃生仓。MCP 尚未建模、排障或批处理场景可以使用 CLI，但不能绕开 CommandService。
- Web/Desktop API 是人类交互 Adapter；它与 MCP/CLI 共用命令，不直接调用 Repository 改状态。
- MCP 与 CLI 的成功结果必须具有同一种 `CommandReceipt`，以便流程不关心入口。

## 3. 事实面与观察面

事实面包含项目、任务、工作合同、结果、产物、质量门、发布及外部动作回执。每次写入必须有稳定 command id、幂等键、actor、scope、trace、预期 revision（适用时）及终态回执。

观察面包含 `thinking`、`text`、`plan`、tool lifecycle、usage、liveness、queue position、runtime lifecycle、日志和诊断。观察可以被投影、过滤、折叠或丢弃，但不得直接调用领域 Repository，也不能作为交付证明。

观察中出现“完成”“已测试”或 URL 只是文本。相应事实必须由 `task_submit_result`（携带精确 `evidence_refs`）、`gate_record_decision` 等命令提交并由 owner 验证；Artifact Ledger 可以自动显示成功写入，但不能替 Outcome owner 登记正式证据。

## 4. 命令与回执

```ts
interface ProductCommand<TName extends string, TInput> {
  commandId: string
  name: TName
  projectId: string
  actor: IdentityRef
  subject?: ObjectRef
  idempotencyKey: string
  expectedRevision?: number
  workAuthority?: {
    contractId: string
    workId: string
    epoch: number
    attemptId: string
    fencingToken: string
  }
  correlationId: string
  causationId?: string
  input: TInput
}

interface CommandReceipt<T = unknown> {
  commandId: string
  status: 'applied' | 'duplicate' | 'rejected' | 'conflict' | 'delivery_unknown'
  reasonCode?: string
  subject?: ObjectRef
  revision?: number
  eventIds: string[]
  evidenceRefs: string[]
  result?: T
  recordedAt: string
}
```

同一幂等键和同一规范化输入返回 `duplicate` 与原回执；相同键不同输入返回 `conflict`。非幂等外部写在网络中断后无法确认时返回 `delivery_unknown`，禁止盲目重试。领域拒绝使用稳定 reason code。Agent 收到 accepted/applied 的工作终态回执后必须结束当前 turn；多次终态提交由内核拒绝。

## 5. Agent 生命周期工具

结构化 MCP 至少提供以下单意图能力，并按 WorkContract 动态裁剪：

- `work_continue`
- `task_propose_graph`
- `task_submit_result`
- `task_request_review`
- `gate_record_decision`
- `work_handoff`
- `work_report_blocked`
- `work_request_human_decision`

公共工具使用单意图名称和单意图 Schema，统一映射到同一 CommandService。旧的聚合 outcome 工具不再暴露；Agent 不需要理解 Delivery Run、Control Action 或 Repository。

`work_handoff` 的 MCP Schema 必须直接描述 `branches[]` 以及 `toAgentId / intent / title / requestedAction` 等字段，不能只暴露不透明 `payload: object` 让 Agent 猜协议。公共工具只接收一个外层 `idempotency_key`；ACP Adapter 将它映射为 A2A owner 仍需的 payload identity，禁止要求 Agent 在外层与 payload 内重复提交同一幂等键。格式错误返回可纠正的工具回执，不得让 Agent 把 `a2a_outcome_invalid`、重派合同或平台等待策略写进面向用户的最终答复。

`task_propose_graph` 与 `work_continue` 同样必须公开完整字段级 Schema。Task Graph revision 由平台从
WorkContract authority 注入，不要求 Agent 猜测；确定性的 Task Graph commit、standalone Task 派发与
standalone continuation 必须和 accepted outcome 同事务完成。只有领域 owner 已经落账，回执才可使用
accepted/applied；owner 仍须强制 payload revision 等于冻结 authority，不能把安全性只交给 Adapter。
异步事件处理器不能作为首次提交后仍可能失败的隐藏第二阶段。

Task Graph 中每个 WorkItem 的 `intent` 是统一执行模型的一部分，必须从 MCP Schema、Outcome admission、
Task authority 一直保留到 AgentInbox 与 WorkContract。`implement` 进入普通 Task 执行；`review` / `verify`
不得在落库时退化成普通 `issue + planning`，而要把 WorkItem 置于等待 Gate 的权威状态、创建并绑定真实
QualityGate，再以 `review_gate` / `test_gate` 签发只含 `gate_record_decision` 的合同。不得根据标题或自然
语言中的“评审 / gate”临时猜测意图；缺少结构化 intent 时按普通执行处理。Gate identity、目标 Task revision
和 evaluator 必须冻结在同一派发链中，避免“任务要求出 Gate 结论，但合同没有 Gate 工具”的死循环。

## 6. 新交付模型

页面和流程围绕 `Project`、`WorkItem`（当前 Task）、`Artifact`、`Review/Gate` 和可选 `Release` 组织。“交付完成”是投影而不是按钮：所选 Release/目标范围内的必需 WorkItem 已通过、要求的 Artifact 存在、Gate 已通过、外部动作有可验证回执。没有 Release 的日常协作也能持续产出，不要求先创建“交付”。

### 6.1 一等对象与引用

以下对象都拥有稳定 identity、revision、project scope 和可打开的 `ath://` 引用；任何对象都不能用另一个对象的状态或聊天文本代替：

| 对象 | 职责 | 创建时必要字段 |
| --- | --- | --- |
| `Project` | 长期工作与协作边界 | 名称、根目录 |
| `Repository` | Project 内的代码来源与分支上下文 | Project、根目录；可由 Project 默认仓库投影产生 |
| `WorkItem` | 待完成的问题或变更 | Project、Category、标题、可选说明 |
| `Review` | 对明确 Repository/分支或 Artifact revision 的独立判断 | Project、Repository、Base、Compare、标题、可选说明 |
| `ArtifactLedger` | 从 Agent 实际修改和 Outcome 证据派生的最近产物导航 | Project、ref、类型、来源 Agent/Invocation、可选 WorkItem、observed/registered 状态 |
| `Channel` | 围绕对象持续协作的消息空间 | Project、名称；对象归属由消息中的引用推导 |
| `Agent` | 完整且稳定的能力对象：身份、工作指令、Skill、执行偏好与访问策略 | 名称、工作指令；高级运行配置渐进披露 |
| `AgentTeam` | 可重复部署的一组真实 Agent 身份与协作关系 | 名称、成员 AgentRef、协作模式、版本 |
| `Release` | 按需冻结一批已验证 Work/Review 作为对外发布事实 | Project、名称、至少一个 Work/Review 引用 |

`Review` 不是 `WorkItem.status = in_review` 的别名。WorkItem 可以请求或关联多个 Review；Review 自身持有 `open / changes_requested / approved / closed` 生命周期、评审目标和证据。Task 的 `in_review` 仅表示当前 WorkItem 正等待其策略要求的 Review/Gate，不是 Review aggregate。

在独立 Review 聚合完全替换现有 Task Gate 前，`task.in_review` 必须由 durable router 收敛为当前 Task revision 唯一的 `code_review` Gate。处理器重放先核对 Task 当前仍处于 `in_review`，再按当前 revision 幂等补建 Gate；历史事件的旧 revision 不能阻止补偿，因为进入评审后描述等 Task 元数据仍可能合法更新。评审期间新的 `task.updated` 会取消旧 revision 的开放 Gate、待派发 reviewer work 与活动 reviewer authority，再为当前 revision 创建新 Gate。旧 reviewer authority 的清理与当前 revision Gate 的查找/创建必须处于同一数据库写事务，且每次重放都要重新收敛旧 authority；WorkContract 签发必须在同一签发事务内确认 Task 仍为 `in_review`、Gate 非终态且 artifact revision 等于 Task 当前 revision。Gate outcome admission 还必须原子校验当前 artifact revision、禁止自评与 authorized evaluator policy，不能把这些约束只保存在 metadata。普通 Project 直接把 Gate 工作写入 AgentInbox，仍由 active Delivery 编排的 Project则只发布 Gate 事实，由 Delivery control plane 统一派发。处理器版本升级必须允许历史 `in_review` 事件重新投递，以修复旧版本已进入评审但漏建 Gate 的 Task。

公共 `ObjectReference` 采用严格 canonical parser/builder。未知参数、空 identity、非法路径片段和跨 Project 引用默认拒绝。协作消息中的引用进入 `ObjectReferenceIndex`，由它派生 Project/Channel 的相关 WorkItem、Review、Artifact 和 Contributor；UI 不维护第二份手工挂接关系。

#### Clowder 式 Artifact Ledger

产物首先是导航与上下文，不是要求 Agent 额外维护的一套业务表单。平台从已成功的 Runtime 写工具、PR/Review 事实和 `task_submit_result` 的 evidence refs 自动派生 `ArtifactLedger`，按 ref 合并最近版本；Agent 不需要记得再调用一个 `artifact_attach` 才能让页面看见真实工作。

- Runtime 写工具成功后产生 `working` 产物观察；只保留 Project 根目录内的路径，忽略 tool 日志本身、读取操作、失败操作、构建目录和越界路径。
- Agent 用 `task_submit_result` / `task_request_review` 提交 evidence refs，或 reviewer 用 `gate_record_decision` 提交验证证据后，对应已接纳的 `agent_outcome` 与既有 Task owner 将相同 ref 提升为 `registered`；规划、继续工作、交接、阻塞和待人工决定 outcome 中的上下文引用不是交付登记，不能进入 Artifact Ledger 抢占生产者归属。因此 A2A/直接协作和传统 Task 走同一模型。`registered` 是正式结果事实，`working` 只是可导航观察，两者不能混同为完成。
- Artifact Ledger 是纯投影：同一 ref 在 Project 内只有一条当前卡片，保留来源 Agent、Invocation、Work 和操作类型；不再读取 Task 的旧 `artifacts` JSON。
- Project“产物”页以贡献角色作为一级信息架构：按 Project Agent 顺序展示实际有产物的角色列，未知或系统来源收敛到对应来源列，不预渲染无产物空列。每个角色列只展示当前筛选结果中实际存在的语义类别，并固定归为“实现”“设计与文档”“验证与评审”“外部交付”“其他”；状态、引用、关联 Work 和操作历史属于选中产物详情，不与角色/类别混成同一级平铺列表。
- Artifact ref 的 identity 是可导航对象，不是证据文本原句。`file://`、Project 绝对路径、行号/行范围和逗号分隔的多个引用必须先拆分、去掉定位信息并归一到 canonical Project ref；同一文件的多个定位只形成一张当前卡片。命令、E2E、trace 与 live-db 等非文件验证回执归入 proof，不得伪装成文件路径。
- 每次 Agent 唤醒时，最近产物、活跃 Work 与来源关系自动进入 context briefing。Agent 应继续修改已有 ref，并在终态 outcome 中引用精确 ref；这条规则由平台注入，不依赖模型记忆。
- Project 与 Workspace“产物”页、Project 卡片计数和侧栏总数都读取同一 Ledger，展示自动发现与已登记两种状态，不提供重复的“创建产物”表单；`.ath` 内部状态文件与历史根目录 `TASKS.md` 控制投影不进入用户产物面。Release/Gate 仍只能消费 registered evidence，不能消费 working observation。
- Evidence ref 不是天然产物。命令输出、健康检查、PID、带说明文字的 URL 和源码行号区间只属于 Gate/Outcome 证据；Ledger 只接纳可规范化的 Project 内文件、显式 artifact ref 或真实外部对象，并把同一文件的 `file:12-34` / `file:12:34` 引用折叠为一个对象。

`agent_team.create/update/delete/deploy` 是 Agent Team 写入的唯一主路径。Web、Desktop、MCP 与 CLI 只构造相同命令；创建/更新 receipt 返回完整 AgentTeam，删除 receipt 返回冻结 identity，部署 receipt 返回 Team、Project Channel 和成员身份。更新与删除使用 revision，所有命令拒绝空 command/idempotency identity；幂等检查必须先于当前 Agent、Team、Catalog 或 Channel 读取及任何写入，并从原事件恢复冻结 receipt，迟到重放不得覆盖后续 Team 部署。旧事件若缺少 Project identity，只能从其冻结 Channel 的权威归属恢复；无法恢复必须失败关闭，禁止采用重放请求中的 Project。幂等身份覆盖 expected revision 和完整规范化输入。任何兼容 API 都必须委托 CommandService 或明确返回已停用，不能直接写 `team_pack` 或 `conversation.team_pack_id`。

`RoleCard` / “角色素材”不再是产品对象，也不是 Agent 创建的依赖。职责、行动边界、证据要求与人格指令直接保存在 Agent Definition；Skills 作为共享可安装资源被 Agent 引用。Agent Team 只能引用已存在的 Agent identity，不能持有 RoleCard、账号、Skill 或执行配置快照，Runtime 必须以当前 Agent Definition 为唯一成员能力来源。

Agent Team 的 workflow step/state role、communication matrix key 及所有 send/receive/escalate edge 必须构成成员 AgentRef 集合内的闭包。历史孤儿成员可以保留在迁移存储中，但不得被当前 API 投影为有效 AgentRef；当前投影必须只包含仍存在的 Agent，并清除所有指向缺失 Agent 的拓扑边。

旧的 RoleCard 导入、编辑和 Team 成员能力覆盖接口必须删除；当前 Team 写 DTO 只接受 `AgentRef + required` 与协作拓扑。历史存储字段只可用于一次性迁移读取，不得出现在可写 HTTP 路由、Runtime Profile、Prompt、Mention、任务分配、Evaluation 在线 provenance 或页面投影中。

### 6.2 统一操作注册表

Command Kernel 以声明式 registry 暴露所有公共写操作。UI、typed MCP 与 CLI 只做输入适配和回执呈现；不得各自重写校验或直接写 Repository。首个端到端操作集为：

- `project.create`
- `project.agent.add` / `project.agent.remove`
- `work.create`
- `review.create`
- `review.record_decision`
- `channel.create`
- `channel.post_message`
- `agent.create` / `agent.update`
- `agent_team.create` / `agent_team.update` / `agent_team.delete` / `agent_team.deploy`
- `work.submit_outcome`

每个 registry entry 必须定义 schema、authorization、canonical input、transaction handler、事件类型、receipt subject 与 CLI/MCP 名称。未在 registry 中注册的命令返回 `command_not_supported`，不能降级到旧 mutation API。

### 6.3 统一执行准入

聊天消息、A2A 交接、Task wakeup、Automation 和质量门不得分别决定是否启动实现。所有入口在写入 `AgentInbox` 后、签发 `WorkContract` 前必须经过同一个 `DispatchAdmission` Module；它以触发类型、可选 Task/Delivery subject、目标 Agent Definition 和请求动作为输入，只返回以下一种决定：

- `notify_only`：记录知会，不产生 Invocation；
- `planning`：允许理解、拆解、分派和结构化汇报，不授权修改代码；
- `execution`：只对明确的独立请求，或已绑定且由目标 Agent 持有的 Task 签发实现合同；
- `review` / `verification`：只由对应 Gate 或具备该职责的 Agent 接纳；
- `rejected(reasonCode)`：对象、归属、职责或权限不明确时失败关闭。

Agent Definition 是准入职责和能力的唯一来源。结构化 `responsibility`、`instructions`、`canModifyCode`、`canReview` 与 revision 必须冻结进 WorkContract 的 role/permissions；自由文本只描述工作方式，不能推断或扩大责任类型。Team、A2A packet 或 Prompt 不能覆盖这些事实。协调型 Agent 即使被用户直接 `@`，也只能获得 `planning` 合同；只有显式的 Agent Definition 变更才能扩大职责，普通自然语言不得隐式升级权限。

创建未分配 WorkItem 不启动 Agent。用户随后要求协调者“开始处理”时，协调者获得规划合同并通过结构化命令完成拆解/分派。实现型 Agent 只有在自己是当前 Task owner，或可信服务端 Adapter 显式签发 `executionSubject.kind=ad_hoc_execution` 时才能获得 `execution` 合同；普通 Human/A2A 消息不能制造该 subject。subject id 必须非空、随 WorkRequest/AgentInbox 持久化，并优先派生稳定 Work authority；Automation 使用 `runId + stepId` 签发。无 subject 的模糊“开始处理”不得自动关联最近任务或签发实现权限。

WorkContract 必须保存准入决定、Agent revision、Task owner/revision 快照和可执行能力。签约事务必须重新读取 Task 的 Project、owner、status 与 revision；准入后发生改派或 revision 变化时失败关闭，不能让旧 owner 先写仓库、再等 Outcome fencing 拒绝结果。`allowCodeChanges` 同时受 Agent Definition 与上层授权约束；`planning`、`review` 以及 `canModifyCode=false` 必须强制为 false。ACP permission handler 继续 fail closed；不产生权限请求的 Runtime Adapter 不能被视为提供了写权限隔离，因此准入层必须先阻止不应实现的 Invocation 获得实现合同。

## 7. 页面行为

- Workspace 默认打开跨 Project 的 Inbox/Activity；Project 默认进入概览。只有选中 WorkItem 后才进入绑定该 workstream identity 的协作流；消息、Agent 运行观察和正式事实共享工作项作用域与因果身份，但仍是不同事件类别。
- Runtime observation 使用轻量、可折叠的活动表现，不与正式产物混排为同等事实。聊天主线只展示 thinking 摘要、最终答复和一个操作回执；逐条工具调用只属于 Invocation 观察详情。
- Task 的 `blocked / in_progress / in_review / done` 变化必须从同一 DomainEvent 实时投影到桌面；页面不能等下一次全量刷新才修正状态，也不能把数据库已阻塞的 WorkItem 继续显示为“进行中”。
- 回复使用持久 `replyToMessageId` 和由服务端校验/派生的 `threadRootId`；客户端不得靠引用文本解析 Thread。Inbox 与消息流必须按同一 root 聚合。
- 重复 Runtime/同步活动在产品时间线按稳定语义键折叠，保留次数和最后时间；正式 Command Fact 不参与噪声折叠。
- `CommandReceipt` 投影成任务提交评审、产物登记、评审要求修改、发布确认等事实卡片。
- Project 是可创建的长期目录与协作边界；Delivery 不是创建对象。右侧详情由选中对象决定，展示 WorkItem、Artifact、Review 或 Agent，而不是常驻“创建交付”表单。
- 全局唯一主创建动作是“添加项目”；进入 Project 后，创建 WorkItem、Review 或可选 Release 的动作就近出现，不重复询问已经确定的 Project。
- `project.create` 的单次事务与回执必须同时返回 `Project` 和它唯一的 `project_workspace`。Human Adapter 只有在两个权威对象都已投影到客户端后才能进入 Project；禁止只显示 Project 卡片、再等待后台刷新补齐 workspace 的“半创建”状态。
- WorkItem 输入框面向协作；Project 聚合活动只读。结构化操作通过上下文 action 或命令面板触发，并调用同一 Human Command Adapter。Agent 也可在当前授权下通过 typed MCP 提议或创建同一种对象。
- Project 页至少保留 `概览 / 工作项 / 交付件 / 评审 / 发布 / 活动` 事实镜头；评估、调试、设置和任务拆解作为可到达的次级意图保留。
- 用户不需要接触 runtime、bridge、channel、fencing 等实现术语。
- “创建工作”只询问 Category、标题和可选说明；在 Project 内不重复询问 Project，也不强制先选 Agent。
- “发起评审”创建独立 Review，询问 Repository、Base、Compare、标题和可选说明，并在提交前校验分支不同、目标可定位和重复开放评审。
- Agent 与 Agent Team 位于同一对象页；Team 可创建、导入、复制、编辑、分享和部署到协作空间。部署只建立成员身份与 Project 的关联，回执明确 Runtime readiness 要等首次触发/预检；不得把 Team 关联成功写成成员 Runtime 已启动或已认证。

## 7.1 Buzz CLI / MCP 参考边界

本地 Buzz v0.5.18 的产品操作主要由 JSON-first CLI 覆盖，通用 dev MCP 通过受控 shell 暴露 CLI；不是每个产品操作都已有独立 MCP 工具。我们的目标不是复制这项实现限制，而是保留其“唯一公共命令语义”原则：生命周期关键操作使用 typed MCP 作为 Agent 主路径，`ath` CLI 作为完整公共接口和逃生仓，Human API 作为界面 Adapter；三者共享 handler、幂等、权限、事务与回执。

计划、研究、工具输出和工作日志可以保存在 Project 工作目录；正式 Artifact 必须登记后才成为共享事实。任何文件落盘、Agent 文本或 CLI 进程成功退出都不得隐式改变 WorkItem、Gate 或 Release。

## 7.2 Buzz v0.5.18 创建与交互复核边界

本地 EXE 与同版本源码共同确认：Buzz 的 Project 创建先写 Repository addressable event，再写引用 Repository 的 Project event；Project 详情从引用关系投影 Repository、Task、Review、Channel 与 Contributor。Task 与 Review 是 Project 内可独立创建的正式对象，Channel 归属由实际引用推导；不存在要求用户先创建的 Delivery form。桌面、CLI 与 Agent 最终写入相同对象事件。

本产品学习这一“统一命令语义 + 可寻址对象 + 引用投影”的机制，不复制 Nostr kind 或 Buzz 视觉。我们的 Project 直接绑定本地根目录并持有稳定 identity；WorkItem、Artifact、Review/Gate 与可选 Release 通过显式 project/object reference 聚合。创建成功必须返回可打开的对象引用和 CommandReceipt，不能仅在聊天中宣称完成。

Buzz Workflow 当前后端已经持久化 Approval，并实现 pending/expired/approver 校验、原子 grant/deny、批准后从下一 step 恢复和拒绝后取消 Run；但 Desktop 的 Approval 卡仍明确显示操作尚不可用。我们学习其后端的持久恢复语义，同时要求 Renderer 也能真正作出决定，不能复制“后端已接通、桌面只能看”的断点。`send_dm` 和 topic 等尚未闭环的动作仍不作为实现依据。

## 7.3 Agent 创建协议与 Definition / Instance 分层

Agent 创建不是一张运行参数表。创建协议先形成可复用的 `Agent Definition`，再由 Project 触发按需物化受管 `Agent Instance`：

1. 基础层只收集头像、名称、结构化主要职责和工作指令；主要职责决定协调、实现、评审或专业支持，工作指令不能替代这一权限边界。角色卡不再是产品对象，也不参与 Agent Prompt 编译。
2. AI 配置默认继承本机 Agent 默认值；只有选择“单独配置”时才显示 Harness 与模型。Harness 选项与可用性只读取 Runtime Catalog，页面不得维护第二份列表。
3. 高级层承载谁可以发送指令、并行度、实例命名池、Skills 和工作权限。`Run on` 只在存在可选 Compute Provider 时出现；仅有本机时不展示无意义的单选项。
4. Agent Definition 持有 `responsibility`、`runtimeMode`、`runtimeId`、`model`、`audiencePolicy`、`parallelism`、`instanceNamePool`、Skills 与权限；运行状态、worker、session、generation 和项目作用域属于 Instance 观察，不能写回 Definition 冒充配置。
5. `parallelism` 为空时继承应用默认值；显式值必须进入真实受管 ACP worker pool，而不是只保存在 UI。修改会使下一次触发或显式重启按新配置建立 generation。
6. 创建和更新分别使用 `agent.create` 与 `agent.update` Product Command。创建回执返回稳定 Agent identity；更新必须携带 `expectedRevision`，过期更新返回 conflict 并保留草稿。
7. 关闭有改动的创建/编辑器必须先进入“保留编辑 / 放弃改动”确认；服务端拒绝、冲突和网络失败都保留当前草稿与原位错误。
8. 导入只是创建草稿的一种来源。导入数据必须先通过本地 schema 校验并呈现在同一编辑器中，未经用户点击最终创建不得写入 Agent Definition 或启动 Runtime。

## 7.4 统一对象创建协议

Project、Work、Review、Agent、Automation 和 Release 的创建器必须遵循同一种交互/命令协议，而不是共用一个万能表单：

1. 有可复用对象的入口先浏览和搜索，已有对象可直接打开；无精确匹配时保留创建行；
2. 进入创建器时继承搜索词与父级作用域，Project 内创建 Work/Review 不重复询问 Project；
3. 默认值必须形成可提交的最短路径，高级字段按对象能力渐进披露；
4. 关闭脏草稿必须确认，网络/校验/revision 冲突保留草稿和当前上下文；
5. 所有提交使用稳定 idempotency key，只有 `CommandReceipt(applied|duplicate)` 且权威投影可读后才关闭并打开真实对象；
6. 创建后的 Inbox、列表、Context 与消息事实卡从同一事件/对象投影刷新，不允许页面本地制造第二身份。

Project 添加器的首个实现切片固定为：`浏览/搜索已有 Project -> 进入新建 -> 搜索词预填名称 -> 选择目录 -> project.create -> 刷新并打开 Project`。

## 8. 完成判定

### 7.5 Automation 定义与运行

- `automation.create/update/set_enabled/trigger/retry` 进入 Command Kernel；Definition 必须属于一个 Project，并以 revision 防止覆盖编辑。幂等重放比较完整命令信封（command name、Project、subject、expected revision 与规范化 input），空 command identity 直接拒绝。
- Trigger 首批覆盖 domain event、Project message 与 schedule；Condition 只读取标准化 trigger context，不执行任意代码。Project message 只接受正式 text 消息事实，Runtime thinking/tool 观察即使来自兼容历史 `chat.message.persisted` 事件也必须在 Automation 边界过滤。
- Action 是有序、带稳定 step id 的单意图列表；首批动作覆盖发送 Project 通知、触发 Agent 和调用已注册 Product Command。
- Event trigger 使用 PlatformEventDispatcher 的 durable process manager；自身 `automation.*` 事件永不匹配，`automationId + sourceEventId` 唯一。
- Schedule 使用持久 fire claim；多进程 tick 竞争只有一个执行者获得 Run，进程重启后仍可恢复。
- 每个 Run 在 claim 时冻结 Definition revision、Trigger 与有序 Action snapshot，并持久保存状态、current step、trace、错误与 causation；后续编辑不能改变排队中或恢复中的 Run。失败可安全重试的步骤由幂等键重放，不确定外部结果进入 `delivery_unknown`，禁止盲重试。
- Event Definition 使用独立 activation watermark 与版本历史；普通编辑不会吞掉已记录的事件，延迟处理按事件记录时刻选择当时有效的 Trigger/Action revision。页面可选事件与条件必须来自生产 emitter 共用的事件注册表。
- Request approval 不复制 Buzz 当前的不可恢复 suspended 状态；人工等待必须映射为持久 Gate/Decision 并能在重启后恢复。

第二个端到端切片进一步冻结：

- `product_command` action 不是任意 JSON 命令执行器。它只能选择 Automation Action Registry 中显式注册、Project-scoped、可幂等的命令；首个开放命令是 `work.create`，运行时用 `automation:<runId>:<stepId>` 同时作为 command id 与幂等键，通过 CommandService 获得正式 receipt。`applied/duplicate` 继续；`rejected/conflict` 以永久 step failure 结束；`delivery_unknown` 保持不确定状态并禁止自动重放。
- `request_decision` action 创建独立 `AutomationDecision`，冻结 prompt、run、step、Project 与过期策略，把 Run 和 step 置为 `waiting_decision`。`automation.decide` 是唯一决定入口：批准原子完成等待 step 并从下一 step 追加 durable run request；拒绝原子取消 step 与 Run。重复相同决定返回 duplicate，相反决定返回 conflict；Daemon 重启不能丢失 pending Decision。
- Automation Definition 采用可移植文档格式，包含 schema version、name、description、trigger 与稳定 step id。表单和定义代码是同一草稿的两个视图；导入必须先解析、校验并默认关闭，不能携带 Automation id、Project id、revision、运行历史、凭据或任意代码。导出只包含 Definition，不导出 Run/Decision。
- Project 页面必须在 Run trace 原位显示 pending Decision，并提供真正可调用 `automation.decide` 的批准/拒绝操作；不能只显示“等待决定”。

首个端到端切片进一步冻结以下接口与归属：

- Definition 的 `projectId` 始终是权威 `project.id`；PlatformEvent 中历史上使用 workspace conversation id 的 `projectId` 在 Automation Module 内部归一，不能把双重身份暴露给页面或命令调用者。
- Command Kernel 首批接受 `automation.create`、`automation.update`、`automation.set_enabled`、`automation.trigger` 与 `automation.retry`。创建永远默认关闭；更新和启用必须携带当前 revision；手动触发与人工重试只创建/恢复同一个 Run 的请求事件，不在 API 请求内直接启动 Runtime。
- Automation Module 对外只提供 Definition/Run 查询、处理一个 PlatformEvent、领取到期 schedule 三类接口；条件解析、事件去重、因果深度、逐步 trace、失败终态和 AgentInbox 投递都留在该 Module 内部。
- 首批用户动作是“发布项目通知”和“触发 Agent”。通知进入 Project 的系统消息流并带 Automation/Run 元数据，同时写入专用持久事件；Agent 动作以 `source=workflow`、稳定 step 幂等键写入既有 AgentInbox，运行调度仍由 Agent worker pool 负责。AgentInbox 容量/SQLite contention 等可重试失败必须抛回 durable dispatcher，同一个 Run/step 重放；达到 dispatcher 最终 attempt 时必须原子转为带稳定错误码的失败终态，不能永久停在 running，随后可人工重试同一 Run。
- `automation.*` 事件可驱动已存在 Run 的执行，但永远不能再次匹配用户 Definition 的 event trigger；每个 Run 最多 20 个动作，阻止自激与无界工作流。

### 7.6 可选 Release

- Release 不是协作前置，也不是 Delivery Run 改名。只有需要对外冻结一个结果批次时，用户才在 Project 的“发布”页创建它；没有 Release 不影响 Work、Artifact 与 Review 持续推进。
- `release.create` 只接受当前 Project 内的正式 `work` / `review` 引用，创建 `draft` 并返回稳定 `ath://release` reference。创建器不重复填写工作过程，也不能导入聊天消息、Invocation 或 Runtime 状态。
- `release.publish` 必须携带 `expectedRevision`，并在命令事务中重新验证每个 Work 为 `done`、每个 Review 为 `approved/closed`。任一引用缺失、跨 Project 或未验证均拒绝；Renderer 的绿色状态不能替代该检查。
- 发布后冻结 targets、revision 与 publishedAt，并产生 `release.published` 正式事件/CommandReceipt。`runtime.completed`、Agent 文本、Automation step 成功和文件落盘都不能自动创建或发布 Release。
- 首批 Release 聚合 Work 与 Review；Artifact 在独立 Artifact owner/Command 接入后扩展为第三类 target，不读取 Task JSON artifacts 冒充独立 Artifact identity。

一次 Agent Invocation 成功只表示运行基础设施正常结束。工作完成必须存在当前 WorkContract 接纳的终态 CommandReceipt，authority epoch、attempt、fencing 与当前 owner 一致，结果证据已注册且对应 artifact revision 的 Gate 已通过，最终交付/Release 投影满足策略。

缺少终态命令时，Runtime 将 Invocation 标记为 `ended_without_outcome`，工作仍保持可恢复状态并按策略重排队；不得根据 final text 猜测 outcome。

ACP Adapter 可以为 MCP 工具增加 server namespace。每轮 MCP grant 必须把 canonical 名称和该轮随机 server name 形成的精确 adapter alias 一起登记；终态命令只做 exact-set matching，不接受任意前缀的后缀匹配。只有同时解析到 `applied | duplicate` 且 `result.exitAccepted = true` 的结构化回执才算终态成功，名称匹配本身不能绕过回执校验。

## 9. 删除与替换

- 删除页面“先创建交付再开始协作”的强制流程。
- 禁止 API、Process Manager、Runtime 直接调用 Repository 完成 Task/Delivery；全部经 CommandService。
- 将分散的 `taskCommandService`、`ProductionControlCommandAdapter`、agent outcome admission 和 Human Command 写路径收拢为 Command Kernel 的内部 handler。
- 为 `ath` CLI 建立 JSON stdin/stdout、稳定退出码与 `delivery_unknown` 语义。
- 结构化 MCP 调用 Command Kernel，不再持有独立的 outcome 写实现。
- `autonomous_delivery_run` 只在编排投影仍有价值时保留；完成新投影后删除其用户级创建概念与重复状态机。
- 删除 `ProjectObjectCreateDialog` 中通过 `updateTaskStatus(..., 'in_review')` 伪造 Review 的路径；替换为 `review.create`。
- 删除 UI 对 Project/WorkItem/Review 的直接 store mutation；Adapter 只接收 CommandReceipt 后刷新权威投影。
- 删除 Settings 中与 Agent 对象重复的 Team 创建入口；AgentTeam 回到 Agents 对象页，Settings 只保留全局账号和默认值。

## 10. 退出条件

- Agent 主路径能只通过结构化 MCP 完成任务生命周期与最终兜底交互。
- CLI 与 MCP 对同一命令返回等价 receipt，且幂等重放一致。
- Runtime 文本或 `runtime.completed` 无法直接完成 Task、Delivery/Release。
- 页面不要求创建 Delivery Run，并能区分活动、产物、评审与已确认结果。
- 所有写 API 均经过 CommandService；架构测试阻止新的 Repository 绕过。
- Task/Artifact/Gate/Release 的端到端真实流程、类型检查、测试和构建通过。
