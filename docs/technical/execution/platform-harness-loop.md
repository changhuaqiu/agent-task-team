# Platform Harness Loop

> 当前状态：服务端闭环第一阶段已落地（2026-07-14）。ACP Runtime Port 由独立分支接入。
> 文档性质：当前实现说明。目标架构见
> [`Platform Harness 状态机与模块集成设计`](platform-harness-state-machine-design.md)。

## 定位

本文历史上把原 `src/server/harness` 称为 Platform Harness；该模块现已迁为
`src/server/invocation-pipeline`，其实际职责是
**Invocation Pipeline（单次 Agent 激活链）**。完整的 Platform Harness 是整个平台运行时，
包含 Task Graph、A2A、Context Manager、Review & Gate、Agent Inbox、Invocation Pipeline
和 Delivery Control Process Manager。包含不等于吞并事实权威，各模块仍只通过公开命令修改自己的事实。

平台 Agent 是一个项目角色实例。OpenCode、Claude、Codex 或其他 ACP Agent 只是该角色某一轮使用的执行端口。

## 当前落地链路

```text
Task mutation / Autonomy Guard / A2A pass
  -> TaskWakeup or A2A dispatch request
  -> InvocationCoordinator admission
     -> idempotency
     -> runtime busy check
  -> InvocationPlanner
     -> conversation + task
     -> TeamRuntime + enabled account
     -> ExecutionProfileResolver
        -> stage + activated/required Skills
        -> capabilities + exit policy
     -> ContextManager
        -> resolve scenario + role archetype
        -> apply cluster injection policy
  -> AgentRuntime
     -> directed routing + atomic reservation
     -> DispatchGateway / ExecutionEnvelope / Proof
     -> ACP executor
  -> normalized AgentEvent
  -> task tool / A2A response / invocation outcome
  -> next wakeup or terminal state
```

## 模块职责

### InvocationCoordinator

- 接收结构化 trigger；
- 在组装上下文前完成幂等和 busy admission；
- 调用 Planner 和 Runtime Port；
- 记录 accepted、duplicate、deferred、blocked、failed proof；
- 不直接推断 review/done。

### InvocationPlanner

- 从 Conversation、TeamPack、RoleCard、Account、Skill、Task、Message 和 Session 仓库读取本轮事实；
- 通过 TeamRuntime 解析角色与执行 profile；
- 通过 ExecutionProfileResolver 从服务端事实编译本轮 stage、Skill activation、required capability 与唯一出口；
- 通过 ContextManager 组装 server-owned prompt；
- 输出与具体 Runtime SDK 无关的 `InvocationDispatchPlan`。
- 按 trigger source 区分 user turn、A2A handoff 与系统 resume，并把 wakeup reason 和已解析 scenario 透传到执行完成边界。

### AgentRuntime

- 判断当前角色在 conversation 内是否 busy；
- 接收完整 plan 并提交执行；
- 当前 `DirectedAgentRuntime` 拥有定向 envelope、原子占位、ACK 与 ACP turn event normalization；
- Invocation Pipeline 无需知道 ACP、Session、进程或 Socket 细节。
- daemon 执行入口的参数解构、诊断日志和 preflight 校验不得引用浏览器环境全局变量；所有日志字段必须来自已解析 plan，且诊断代码不得位于可捕获错误边界之外而中断执行。
- 用户消息必须先写入聊天事实源，再触发 dispatch；runtime 是否 busy 不能影响消息可见性和持久化。
- 浏览器与 daemon 的 busy 快照可能短暂不一致。人工 Command 如果在服务端 admission
  时遇到 `agent_busy`，页面只展示拒绝原因，由人决定是否重试；不得因收到错误事件自动
  恢复派发。A2A、wakeup、恢复等自动来源必须先写 Agent Inbox，由服务端 Scheduler
  负责 deferred 与重试。
- 角色没有可用账号或执行引擎时，派发必须在启动前终止并向聊天区写入可操作提示；内部 `invocation.aborted` 事件不能替代用户反馈。

### 用户入口路由

- 一条普通用户消息只能建立一个团队闭环入口。存在多个角色引用时，首个可解析的 `@Agent` 是本轮入口角色；后续 `@Agent` 只作为任务描述与协作上下文，不得被浏览器并行派发。
- 下游角色必须由当前持有者通过正式 A2A handoff 唤醒，不能因为用户正文提到下游角色而绕过 possession、handoff packet 与通信策略。
- 群发或并行启动属于独立的显式平台动作，必须由无歧义的 UI/协议字段表达；普通聊天正文中的多个 mention 不是群发协议。
- `chat_message.mentions` 仍保留全部引用用于展示和检索，但 dispatch target 与 user→agent pass 只记录入口角色。

### Runtime 工具与平台事实源边界

- 底层 CLI 自带的 `Task`、`Agent`、`SendMessage`、`TodoWrite/TodoRead` 只属于该 runtime 的本地协作能力，不得被解释为平台 Task Graph、A2A possession 或 dispatch receipt。
- 平台自定义工具只有在 runtime 实际暴露精确名称（例如 `task_create`）时才可调用；prompt 中的 schema 文本不等于工具已注册，Agent 不得用相似名称的原生工具替代。
- ACP 通过 invocation-scoped `agent_submit_outcome` 提交结构化 `handoff_to_agent`；
  `idempotencyKey`、目标 Agent、意图、请求动作和证据引用都是协议字段。平台不会扫描最终回复中的
  `@mention` 来创建 Pass，也不得调用 runtime-native `SendMessage` 代替 A2A。
- 当前持有者提交 `handoff_to_agent` 后必须立即结束本轮，不继续替目标角色读取、实现或等待底层子 Agent；
  平台在接纳 Outcome 后，由 A2A owner 原子创建 Pass、HandoffPacket 与下游 AgentInbox item。
- daemon 只把平台工具白名单写入 invocation-scoped Skill/MCP grant；未知或 runtime-native 工具仅做观测，不得异步伪装成平台工具执行。
- WorkContract 的平台工具白名单与实际 MCP grant 会统一裁掉 `task_create`、`task_update_status`、`task_assign` 以及 `collaboration_record_pr/review/merge` 等领域 mutation。Agent 只提交结构化 Outcome，Task/Graph/Gate owner 在接纳后修改权威事实；提示词、Skill 或错误的 grant 参数都不能重新开放这条写路径。
- WorkContract 持久化 ExecutionProfile。真实浏览器验收只在 `browser_verification` capability 存在且 authority 有效时放行本地 Playwright test 命令；普通工作不能借验证名义获得任意 shell、后台进程或外部发布权限。
- `browser-verification` 是阶段路由 Skill：Web E2E/test gate/Task 浏览器强信号会激活它；普通实现不加载其正文。Git 协作 Skill 同理，只在合并策略或 Git/PR 强信号存在时激活。
- Codex ACP 文件修改请求不提供通用 `rawInput.file_path`，路径来自受信适配器元数据 `codex.params.grantRoot`；权限策略对两种形态统一执行 realpath 项目包含校验，缺路径继续拒绝。

### Runtime 工作目录

- `use_worktree=true` 时，runtime cwd 使用 conversation 对应的 Git worktree。
- `use_worktree=false` 且 conversation 配置了有效 `project_path` 时，runtime cwd 使用该真实项目路径，使项目文件和位于其子树内的绝对 TASKS 路径处于同一权限边界。
- 只有 conversation 没有项目路径时才回退到 agent scratch workdir；scratch 不能覆盖一个已配置的真实项目根目录。

### Outcome Reducer

- runtime accepted 可以把 ready owner 的 Task 推进到 in_progress；
- runtime success 只代表本轮执行结束，不代表实现证据或交付证据通过；
- in_review/done 只能由 accepted AgentOutcome 驱动对应 owner 进入；WorkContract 内的 Agent 不能直接写 Task revision。
- 首个 accepted Outcome（包括 `continue_work`）消费当前 WorkContract 的唯一退出槽；继续执行必须由 ContinueGate 签发新 epoch，不能在同一合同内再交 terminal Outcome。
- TASKS.md watcher 必须同时消费文件首次创建的 `add` 和后续更新的 `change`；watcher 先启动、Agent 后创建看板是新项目的正常路径，首个事件不能丢失。
- Agent 完成边界仍执行一次 TASKS.md → DB 同步，作为 watcher 的一致性屏障；
  A2A 只消费已接纳的结构化 Outcome，不再依赖该轮自然语言输出顺序。

### Context Policy 与闭环观测

- `ContextManager` 以 `scenario × archetype` 选择六类信息簇，场景包括 init、iterate、handoff、wakeup、closure；
- handoff/wakeup 默认省略 dialog，使用 possession packet 或任务卡作为本轮 focus；
- daemon 在完整输出聚合后先同步 `TASKS.md`；首次出现的非默认任务状态也必须经过 Task Notification/Wakeup 决策，使 `review` 能立即进入 quality gate。随后执行合法出口观测，失败只写 `no_valid_exit` proof，不重试、不阻断；
- TeamPack workflow state is the gate-routing authority: ordinary `quality_gate` work starts its configured owner once; advisory reviewers are not fanned out unless a risk-specific transition requests them.
- Entering `review` / `in_review` is itself the quality-gate dispatch request. After writing that state, the implementer must end the turn without a manual `@reviewer` A2A handoff; only an explicit platform wakeup failure or a separately justified specialist review may create another pass.
- Browser auto-proposal is only a human first-turn convenience. Agent, system, tool, and error messages cannot trigger it. Daemon process-start admission reserves `(conversation, agent)` before asynchronous setup so duplicate browser tabs cannot race-start the same role.
- Browser execution transport has been removed. `delivery.plan.request` reaches Invocation Coordinator through the durable Inbox; Invocation Planner alone checks the authoritative DeliveryRun and rejects conflicting legacy proposal planning.
- Workdir names encode project/agent/task IDs as safe path segments; raw business IDs, including scoped task IDs, are never concatenated directly into a Windows path.
- autonomy guard 按 `subtask_of` 的 child → parent 边递归判断完整子树，终态后唤醒 planner 收敛；
- closure dispatch 写持久 proof，后续扫描以 `(conversationId, rootTaskId, reasonCode)` 去重。

### Team Log Projection

- `chat_message` 与协作型 `control_proof_event` 保持事实源地位，TeamLogProjection 将其物化为 active workdir 内的只读 `.ath/team-log.md`；
- ContextManager 不再推送群聊正文，只在 situation 簇注入 ≤150 token 的未消费摘要信封；handoff/wakeup 按当前 task 过滤；
- Harness plan 携带本轮 envelope 的 `upToEntryId`，daemon 仅在本轮完成后推进 `agent_log_cursor`，不会误消费执行期间新到的消息；
- hot 视图受 50 条、24 小时和 5KB 三重上限控制；7 天内溢出按日归档，更早内容进入 INDEX 摘要并继续以 DB 为 cold source；
- 所有执行计划由 Harness 携带 context/team-log snapshot；daemon 只对服务端 Plan 做有界的 team-log 补位。

## 兼容机制

服务端接受 wakeup/A2A 后只发布展示事件，不再发送任何浏览器 fallback 标记。
浏览器始终只展示，不调用 `dispatchToAgent`。

- Agent busy：Agent Inbox 重新排队并由 Scheduler 重试。
- 缑少 runtime profile、上下文组装失败或 Runtime Port 拒绝：Harness 返回结构化失败，
  服务端发布 warning / wakeup 展示投影并记录 proof。
- 不存在回退到旧客户端执行、ACK、失败回报或恢复派发的路径。

## 状态权威

| 状态 | 权威 |
| --- | --- |
| Task 生命周期 | Task Repository / Task Graph |
| Agent 角色和协作策略 | Conversation Team Runtime |
| Context | ContextManager + repository providers |
| Dispatch 生命周期 | ExecutionEnvelope / DispatchGateway |
| 进程与会话 | AgentRuntime / Session / Invocation |
| A2A 持有权 | A2A possession/pass |
| UI busy、流式内容和 A2A 时间线 | 服务端状态投影；A2A 使用完整 `a2a.snapshot` |

## 已知迁移边界

- 用户点击、输入或 @Agent 属于显式 Human Command，可以由 WebUI 首发。
- Task Wakeup、Autonomy Guard、A2A、busy 重排、恢复和重试全部由服务端
  Agent Inbox / Harness 推进；浏览器队列只是服务端事实的项目投影。
- WebUI 自动事件消费者不再含执行 ACK、失败兜底或终态恢复派发。
- Runtime 输出统一经带 `projectId` 的 `project:view` 项目信封展示。

## 测试策略

- Coordinator：accepted、duplicate、busy、blocked。
- Planner：真实 repository role/account/context 解析与缺配置错误。
- Registry：无浏览器提交与显式 fallback。
- Reducer：只允许 ready -> in_progress，不越过质量门禁。
- File projection：当该任务已有已确认且尚未终止的 invocation 时，TASKS.md 中尚未来得及改写的 `todo/pending` 是 stale snapshot，不得把 reducer 已确认的 `in_progress` 回滚；invocation 终止后文件重新取得业务状态权威。
- A2A：结构化 `handoff_to_agent`、A2A owner 原子建模、AgentInbox admission、
  Harness/runtime 启动确认以及无浏览器 fallback。
- A2A possession：当前 holder 的终态 Outcome 先关闭当前 possession；交接 Outcome 同事务创建
  Pass group、HandoffPacket 与下游 Inbox，后续超时不得反向污染已启动的上游 Pass。
- A2A payload：缺少目标、意图、动作或稳定幂等键必须被拒绝；可见文本中的动作词、
  `@mention` 和否定句均不得形成控制意图。
- Store：展示事件没有 fallback 开关，旧控制事件无法重新接入。
- Mention dispatch：多 mention 消息只派发首个有效入口角色；busy-before-send 与 client/server busy race 都必须保持用户消息和 dispatch 请求不丢失；恢复入队后只在真正启动时登记 A2A chain。
- Tool boundary：runtime-native 协作工具不触发平台 Skill Tool executor；平台 A2A 只接受
  invocation-scoped `agent_submit_outcome`，工具不可用时必须报告结构化阻塞，不能回退为可见 A2A 文本。
- Workdir：worktree、真实非 worktree 项目路径、无项目 scratch 三种决策分别覆盖；另覆盖 Windows 保留字符与 scoped task ID 的安全路径编码。
- Dispatch admission：非 human 消息不触发 proposal；同一 `(conversation, agent)` 的并发 start 只有一个能进入异步 runtime setup。
- Gate routing：默认团队普通 review 只启动 Peach，DK 保持按需。
- Gate de-duplication：实现角色进入 review 后不得再手工 @ 默认 reviewer；Task Wakeup 是普通质量门的唯一启动事实。
- Dependency de-duplication：Task Notification Publisher 同时理解 task edges 与 TASKS.md dependencies，并且是 dependency_resolved / unblocked_unassigned 的唯一 wakeup 生产者；watcher 不保留前端直发兼容分支。
- Daemon smoke：使用隔离数据目录和已安装的 ACP test runtime 从服务端 Activation Command 跑到
  AgentEvent/`project:view:terminal.exited`，覆盖 Plan 解构、preflight 日志和协议适配。

## 验证结果

- Vitest：110 个测试文件、1004 个测试全部通过；
- TypeScript：`pnpm exec tsc --noEmit` 通过；
- Production build：Next.js 16.2.4 `pnpm build` 通过；
- Windows 测试夹具已统一处理路径分隔符、默认分支和 POSIX 权限差异。
