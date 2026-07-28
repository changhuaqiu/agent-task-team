# Platform Harness 状态机收敛规格

> 状态：active
>
> 日期：2026-07-27
>
> 长期设计：`docs/technical/execution/platform-harness-state-machine-design.md`

## 1. 目标

在不削弱 Agent 自主循环的前提下，把 Platform Harness 收敛为整个平台运行时边界，并完成：

1. 每个领域状态机的 owner、状态、命令和事件唯一化；
2. Inbox、Invocation、Task、Gate、A2A、Delivery 的完成语义分离；
3. Delivery Control Process Manager 汇总权威事实并推进跨领域流程；纯
   Delivery Decision Policy 计算有限、确定性的控制动作；
4. Runtime/CLI 错误归一化后再进入恢复、重试或 Human 决策；
5. 窄义 `src/server/harness` 完整迁入 `src/server/invocation-pipeline`；
6. 从单 Agent Invocation 监督扩展为多 Agent Work Cell 图的可靠协调。

## 2. 非目标

- 不把 Agent 内部 Todo 持久化为平台 Task Graph。
- 不把 Agent 内部工具/步骤重试建模为 Process Manager 的平台重试动作。
- 不让 Harness 使用 LLM 选择确定性控制动作。
- 不建立一个覆盖所有领域的总状态表。
- 不以事件日志替代所有领域表。
- 不在第一切片重写所有目录或删除兼容接口。

## 3. 术语契约

- `Platform Harness` 与 `Platform Runtime` 表示整个运行时环境。
- `Invocation Pipeline` 表示单次 Agent 激活链。
- `Agent Runtime` 表示 OpenCode、Claude、Codex 等实际执行端口。
- `WorkContract` 表示平台交给 Agent 的边界契约，而不是步骤清单。
- `Agent Work Cell` 表示角色、WorkContract、Context、Inbox、Invocation、Session 与 Outcome
  围绕一名 Agent 一次工作的逻辑组合；它不是新的事实源。
- `ControlAction` 只能是
  `initializeGraph | activate | wait | retry | requestGate | integrate | finalize | resume | escalateToHuman | terminate`。
  `initializeGraph` 只在 Delivery 尚无 Task Graph 时出现，由 Task owner 幂等建立首个 Task；
  它不是 Agent Invocation，不占用 Agent 并发 slot，也不替 Agent 生成实施步骤。
  `integrate` 只向 Effect owner 提交 blocking provider Effect；Process Manager 与 Command
  adapter 都不得直接执行 Git、GitHub 或网络 I/O。
  `finalize` 只在 Tasks、required Gates、blocking Effects 与 provider integration 都满足后，
  由 Delivery owner 从权威 receipts/evidence 构造并冻结 DeliveryBundle；下一轮才可 terminate。

Command → Event → AgentInbox → Invocation Pipeline → WorkContract → AgentOutcome 必须保持
同一 correlation。非根 Command/Event 以直接来源 id 作为 causation；Invocation 自身通过
不可变 `work_contract_id` 取得冻结信封，Runtime Event 另带 invocationId。跨模块诊断统一
通过 `listTrace(correlationId)`，不靠 UI 文本拼接。
Delivery start 在 GoalContract 中冻结根 correlation（缺省从稳定 start idempotency key
确定性派生）。ControlDecision、Task、Gate、Inbox 与 A2A 的自身 ID 只能作为 aggregate
identity 或 causation；任何下游 Event/Command 都不得用 decisionId、actionId、inboxId、
chainId 或 passId 替换根 correlation。

## 4. Owner 契约

Task、A2A、Gate、Context、Inbox、Invocation、Delivery、Effect 各自拥有独立状态机。
跨 owner 写入必须使用 Command；owner 在同一事务中修改事实并写 Event Outbox。
Process Manager 消费 Event 和 Query，不可直接改其他 owner 的表。

Task 的唯一写入口是 `TaskCommandService / TaskGraphRepository` owner command。WebUI mutation、
Agent Skill Tool、Engineering receipt 与 ControlAction 都必须携带幂等身份并冻结 graph/Task revision；
改派同时关闭旧 WorkAuthority，删除命令落为 `cancelled`，禁止绕过 owner 直接写 `taskRepo`。

## 5. WorkContract

每次 Agent 激活必须绑定不可变 WorkContract：

```ts
type WorkContract = {
  workId: string
  workEpoch: number
  attemptId: string
  fencingToken: string
  projectId: string
  goal: string
  acceptanceCriteria: string[]
  role: string
  permissions: string[]
  authoritativeRefs: string[]
  authoritativeRevisions: Record<string, string | number>
  contextSnapshotRef: string
  allowedOutcomeTypes: AgentOutcomeType[]
  deadline?: string
  budget?: { turns?: number; durationMs?: number }
  correlationId: string
  causationId: string
}
```

AgentOutcomeType 至少覆盖：

```text
continue_work
propose_task_graph
submit_task_result
request_review
record_gate_decision
handoff_to_agent
report_blocked
request_human_decision
```

`propose_task_graph` 必须携带 `expectedRevision` 与完整 `tasks[]`；每项明确稳定 task id、
owner 和 dependencies。durable Task Graph Outcome Process Manager 只负责把已接纳 Outcome
翻译为 Task owner 的一次原子 `commit`。owner 在同一事务内验证引用与 DAG、创建 Tasks/
depends_on edges/action、CAS graph revision，并以源 event id 语义幂等；失败不得留下半张图。
Human WebUI、Harness `initializeGraph` 与历史 group-chat task flow 也必须调用同一个
`mutate(expectedRevision, idempotencyKey, operation, request)` owner 边界；禁止任何入口绕过
graph revision。精确重放返回首次提交的完整结果，同一 key 内容漂移返回
`task_graph_idempotency_conflict`，陈旧 revision 返回 `stale_task_graph_revision` 且不得留下
Task、Edge、Action 或 Binding 的部分写入。

所有 AgentOutcome 使用同一信封：

```ts
type AgentOutcome = {
  outcomeId: string
  idempotencyKey: string
  outcomeType: AgentOutcomeType
  payload: unknown
  evidenceRefs: string[]
  projectId: string
  workId: string
  workEpoch: number
  attemptId: string
  fencingToken: string
  authoritativeRevisions: Record<string, string | number>
  correlationId: string
  causationId: string
  occurredAt: string
}
```

接纳时必须校验 outcome allowlist、当前 epoch/token、幂等键和关键权威版本。迟到 Outcome
只写诊断，禁止改变领域事实。

实施约束：

- WorkContract、WorkAuthority、AgentOutcome 分表持久化；Contract 与 Outcome 不可改写。
- Harness 成功编译 Context 后签发 Contract；Invocation 必须复用其 `attemptId` 并完整绑定
  `contractId/workId/workEpoch/fencingToken`。
- WorkAuthority 更新使用期望 epoch 的 CAS；新 Contract 使旧 token 永久失效。
- `continue_work` 可重复追加；每个 Contract 最多接纳一个非 `continue_work` Outcome。
- 同一幂等键只能绑定同一语义内容；内容不同返回
  `agent_outcome_idempotency_conflict`。
- 不存在的 Contract、过期 authority、错误 token、越出 allowlist 或权威版本漂移都形成
  rejected 诊断；accepted/rejected 都不直接改写其他领域事实。
- ACP 使用 invocation-scoped `agent_submit_outcome` 平台工具，由 grant 注入安全信封；
  其他 Runtime 使用 `POST /api/agent-outcomes` 的完整信封入口。

Gate Agent 必须提交结构化 `record_gate_decision` Outcome：

```ts
{
  gateId: string
  decision: 'passed' | 'changes_requested' | 'rejected'
  reason?: string
  evidenceType: string
  evidence: unknown
  receipt?: AcceptanceReviewReceipt | AcceptanceVerificationReceipt
}
```

durable Gate Outcome Process Manager 校验 Contract 的 project、agent、task/delivery target，
再依次调用 Gate owner 的 evidence/evaluating/decision Command。Delivery Gate 的 passed
决定必须携带可校验 receipt；该 receipt 作为 Delivery 证据保存，但 Gate 仍是唯一 pass/fail owner。

Task 必须持久化单调整数 `revision`。Task WorkContract 的
`authoritativeRevisions.task`、Task Gate 的 `artifactRevision` 和 Task owner transition CAS
均使用该版本，不得使用 `updated_at`。Git provider 的 head SHA、PR URL 和 review ID
只作为 Gate evidence；provider adapter 不得用 SHA 建立第二套 Gate 版本轴，也不得在
Gate decision 前后直接写 Task 状态。`submit_task_result / request_review` 的 durable
Process Manager 只能把 Task 从 `in_progress` 推进 `in_review` 并登记 evidence；随后
Control Process Manager 请求 `code_review` Gate，并为非实现者 Reviewer 创建独立
Work Cell。`record_gate_decision` 经 Gate owner 后：

- `passed`：Task owner CAS `in_review -> done`，关闭执行与 Reviewer authority；
- `changes_requested / rejected`：Task owner CAS `in_review -> in_progress`，只关闭 Reviewer
  authority，返工沿原 execution workId 签发新 epoch；
- Reviewer 缺失：产生 Human escalation，不允许实现 Agent 隐式自审；
- 旧 artifactRevision 的 Gate 不得满足新 Task revision，也不得阻止新一轮 Gate 创建。

## 6. 状态机契约

实现必须遵守长期设计 §5 的状态和完成语义。所有迁移由 owner 暴露的显式 transition API
执行，并同时校验前态、actor、幂等键和必要证据。禁止直接写任意状态字符串。

DeliveryRun 的生命周期状态与协作阶段必须分开：生命周期只允许
`active / waiting_gate / waiting_human / retrying / completed / failed / cancelled`，
阶段只允许 `planning / executing / reviewing / verifying / integrating / delivering`。
所有新写入使用可恢复的 `waiting_human`，不得再创建 `escalated`。migration 58 已将历史
`escalated` 归一化为带明确 reason 的 `waiting_human`，将 `recovering` 归一化为
`retrying`；只有 Human Command `manual_resume` 可以恢复人工等待。

`manual_resume` 必须携带稳定 `idempotencyKey` 和 Human actor。Delivery owner 在同一事务中先记录
`human.manual_resume` receipt，再以 receipt event 作为 Run 恢复事件的 causation；精确重放不得
增加 Run revision 或再次计算控制动作。
本地单用户 WebUI 的 actor 由服务端 ingress 固定为 `webui:local-user`，API 不信任客户端提交的
actorId；多用户版本必须改用认证 principal。

创建 DeliveryRun 的 `GoalContract` 必须携带稳定 `idempotencyKey`。仓储在一个立即事务内
同时保证：相同 key + 相同规范化 Goal 返回原 Run；相同 key + 不同内容报语义冲突；同一
conversation 不允许并存两个非终态 Run。API 不得以 check-then-insert 代替该约束。

## 7. Delivery Control Process Manager 与 Decision Policy 契约

Process Manager 负责消费触发事件、查询各 owner、组装 `DeliveryControlSnapshot`、
调用纯 Decision Policy、持久化决定并把动作交给 owner Command adapter。它不是新的领域
owner，也不自行推断或执行副作用。Decision Policy 才负责从冻结的 snapshot、policy
revision 与 capacity 输入计算 `ControlDecision`。

一次 reconcile 返回一个 `ControlDecision`，其中包含按资源容量排序的 `actions[]`；
不是 Delivery 全局单动作。每个 target Work Cell / slot 最多一个动作。action id 由
run、snapshot revision、policy revision、type 和 target 确定性派生。

输入 `DeliveryControlSnapshot` 必须显式携带 `workCells[] / waitForEdges[] / closure`。
`waitForEdges` 是 Task、A2A、Gate owner facts 的只读投影，不允许夹带 policy 派生的容量边。

某个运行中 Work Cell 的 `wait` 不得阻止剩余容量激活其他 Work Cell。重复读取相同
snapshot/policy 必须生成相同 action ids，不得追加重复 wait/action。
`wait` 不持久化为 DeliveryAction 或 Effect；有副作用动作在 claim 时重新校验 snapshot
revision、slot capacity 和 work epoch。

`activate` 与 `retry` 都是会启动新 Invocation 的容量动作，必须使用同一全局/角色容量
计算、持久 slot reservation 和释放协议。`retry` 不能因为已有 WorkAuthority 就绕过容量。
Runtime `started / terminated` 以及启动前 `runtime.invocation.blocked /
context.snapshot.rejected` 都必须释放该 attempt 的 slot。

持久 ControlAction 使用独立基础设施执行预算：每次 claim 增加 `attemptCount`，异常或
owner rejection 在 `maxAttempts=3` 内回到 `ready`；claim lease 过期必须在 reconcile
开头恢复并以新 token 重领同一 actionId。owner Command 必须以 actionId 幂等。预算耗尽
发布唯一 `control.action.failed` coordination fact；对应 Work 或 Delivery 进入 Human
恢复路径，不能永久停在 `claimed` 或静默停在 `failed`。

## 8. A2A 聚合

目标只保留 `A2ACollaboration` 权威聚合：Chain 为根且状态派生，Possession 拥有 holder
资格，Pass 表示转换尝试。所有新写入、运行控制和观测关系都必须从
`a2a_possession_chain / a2a_possession / a2a_pass_group / a2a_pass / handoff_packet`
派生。migration 62 已删除 `invocation_chain / chain_worklist / delivery_cursor /
a2a_audit_log / a2a_delivery`；源码、schema、测试与 conversation cleanup 不再保留第二套状态机。

fan-out pass group 采用 best-effort：已启动分支不可回滚；失败分支为原 holder 建立 recovery
possession。source、child、recovery 的变更必须在同一聚合事务提交。

Pass Group 的 join 语义以分支工作结果为准，不以 Runtime start 为准：

- `started` 只把 Group 推进为 `active`，不得关闭 source Possession 或完成 Group；
- receiver Possession 完成后，父 Pass 才进入 `completed`；
- Possession、Pass、Group 的终结转换必须在同一事务内发布对应 domain event，禁止只改表而
  让下游通过轮询猜测汇合完成；
- 所有 Pass 进入 `completed / blocked / rejected / timeout / error` 后，Group 才完成或进入
  `recovering`；
- Group 持久保存 `sourceWorkId / deliveryRunId`。每个分支 Inbox 继承 DeliveryRun，分支
  WorkContract 使用 `a2a-pass:<passId>` 作为 workId；
- Control snapshot 为未解决 Group 投影 `sourceWorkId -> a2a-pass:<passId>` wait-for 边；
- 失败分支终止旧边，并为 recovery Possession 向原 holder写持久 Inbox；该 Inbox 复用
  `sourceWorkId`、签发新 epoch，属于可安全自动打破的恢复边，而不是 Invocation 盲重试。

wait-for graph 只承载有稳定 blocker identity 的持久依赖：Task、A2A 和已创建的 Gate
Work Cell。容量不足由 Decision Policy 根据 policy revision 计算 wait 动作，不持久化为
依赖边；slot 释放与公平 aging 是其解除机制。

Agent 发起协作必须提交结构化 `handoff_to_agent` Outcome。durable A2A Outcome Process
Manager 只把已接纳 Outcome 翻译为 A2A owner Command；Pass、HandoffPacket 与每个下游
AgentInbox item 必须在同一 SQLite 事务创建。Outcome 重放通过 pass group 语义幂等键返回
同一结果，内容漂移必须拒绝。
所有 Command 在进入聚合前必须通过 Team Runtime guard：目标属于当前 conversation roster；
Agent source 本身也在 roster 内且 `communicationPolicy.canSend(source,target)` 为真。
显式 Human Command 可以绕过 agent-to-agent communication matrix，但不能绕过项目 roster。

生命周期映射冻结为：

- `AgentInbox.enqueued/claimed/released` 不改变 Pass；
- `AgentInbox.admitted` 推进 `Pass.offered -> accepted -> starting`；
- `AgentInbox.admitted` 是 admission receipt 终态，不得在控制快照中覆盖后续
  Invocation 的失败或重试事实；
- `runtime.invocation.started` 才推进 `Pass.started` 并创建 receiver Possession；
- Inbox `expired/cancelled` 或 started 前 Runtime 终止，以 phase-specific reason 失败 Pass；
- receiver 的成功型非 `continue_work` 结构化 Outcome 才完成其 Possession；
- `report_blocked` 与 `request_human_decision` 必须把父 Pass 置为 `blocked`、撤销 receiver
  Possession，并按失败分支汇合规则打开原 holder 的 recovery Possession；二者不得计作
  `completed`，也不得满足成功 join；
- WorkContract Invocation 的最终自然语言不得触发 A2A。

Delivery-level Gate 的 `changes_requested / rejected` 不能通过重跑 Reviewer 来复活同一个
terminal Gate。当前没有新的 Delivery artifact revision 时必须升级给 Human/Lead 重新规划；
新产物产生新 revision 后再创建新 Gate。

`handoff_to_agent.payload` 必须提供 `idempotencyKey` 与非空 `branches[]`。每个 branch
必须明确 `toAgentId / intent / title / requestedAction`；packet 的决策、证据、约束、
开放问题和禁止行为为结构化可选字段，不得用整段最终回复代替。

WebUI Human turn 使用 `a2a.human_handoff` Command：先持久化 chat message，再由服务端
A2A owner 创建/中断协作与持久 Inbox 工作。浏览器不得先发 `terminal:start` 再通过
Socket 补登记 Chain。没有目标的 Human turn 表示显式中断当前 collaboration；尚未 claim
的 Inbox item 同事务取消，已 claim/running 工作留给 Control Process Manager 执行受 fencing 保护的
停止策略。

## 9. Effect 收口

Effect Command 创建时冻结 `criticality`、`deliveryRunId`、`appliesFromRevision` 和
`sourceActionId`。它持续适用，直至 `succeeded / cancelled / superseded`；后两者必须由
显式 Command 记录原因、`supersededAtRevision` 和可选 successor。Closure 检查所有对当前
revision 仍适用的 blocking Effect，dead-letter 后进入 waiting_human 或 failed；
non-blocking Effect 可在完成后重放但不能修改完成结果。

Effect 的 enqueue、retry、success、dead-letter、cancel、supersede 必须与 Effect 表变化
原子发布 `effect.*` coordination fact，并继承 source Event correlation。Delivery Process
Manager 订阅这些事实，使 Effect 写入和终态都会推进 snapshot revision；禁止只改
`platform_effect_outbox` 后等待外部轮询。

## 9.1 QualityGate 聚合契约

Gate evidence、Gate terminal decision 与 Delivery acceptance receipt 必须原子提交；receipt 同时
发布 `delivery.receipt.recorded` 并继承 outcome 的根 correlation。Receipt 冲突或写入失败时，
Gate evidence 与 decision 必须一起回滚。

唯一 Gate owner 保存 `kind / target / artifactRevision / criteria / policy / status / revision`，
证据以 immutable `GateEvidence` 追加，终态判定以一对一 `GateDecision` 保存。状态只允许
`requested -> evaluating -> passed / changes_requested / rejected`，开放状态可以
`cancelled`；终态不可改写。

`passed` 必须引用至少一条属于当前 Gate 的 evidence。相同 kind、target 和
artifactRevision 的请求幂等；artifactRevision 改变必须创建新 Gate，旧 decision 不得满足
新 revision。Git Review、Task evidence、Delivery review/verification receipt 都必须通过
该 owner 接纳，不得各自保存另一份权威 pass/fail 状态。

## 10. 错误归一化

至少支持：

- `runtime_profile_missing` -> `runtime.invocation.blocked`
- ACP resource not found -> `runtime.session.resume_failed`
- transport reconnect/fallback -> `runtime.transport.degraded|recovered`
- CLI error trace -> `runtime.diagnostic.observed`
- `required_context_missing` -> `context.snapshot.rejected`

原始诊断必须作为 evidence 保留，但不得直接成为状态迁移触发器。

`runtime.invocation.blocked / context.snapshot.rejected` 必须带 `workId /
deliveryRunId`，使 Control slot 可以精确释放且 Process Manager 能把当前 Work 投影为
Human 可恢复失败。显式 `manual_resume` 后，旧阻塞事实不得再次压过新的 active 状态。

所有 Inbox lease 结算（renew/release/admit/expire）必须同时校验 lease token 与未过期条件，
不能依赖异步 recovery sweep 才 fence 掉 stale worker。Task Graph mutation 的精确重放必须返回
首次提交冻结的 revision/result，不能随当前 Graph 漂移。

ControlAction 在执行 owner Command 前以及 complete/fail 时都必须校验 claim 未过期；数据库约束
保证 claimed 行拥有完整 token/owner/expiry。迁移前没有冻结 `result_json` 的历史 Task Graph commit
必须 fail closed，不得从当前 Task 行伪造旧响应。

Group-chat split 必须同时维护 `depends_on` edge 与 `task.dependencies`，并使用相同方向语义。
所有支持 DB 注入的 Process Manager 必须把同一 DB 注入其 owner repositories，保证原子边界真实成立。

## 11. 命名迁移

旧 `HarnessCoordinator`、`RepositoryHarnessPlanner`、`HarnessRuntimePort`、`HarnessTrigger`
已分别替换为 `InvocationCoordinator`、`InvocationPlanner`、`AgentRuntimePort`、
`AgentActivationCommand`。源码目录已迁至 `src/server/invocation-pipeline`，不保留旧导出或兼容别名。

## 12. 验证

- 状态转移表测试：合法迁移通过，非法迁移拒绝。
- 决策表测试：同一事实/策略快照产生同一个有序 ControlAction 集；运行中 + 可运行工作
  会在剩余容量继续激活。
- 契约测试：Command/Event/Effect 的 correlation、causation、idempotency 不丢失。
- 恢复测试：进程崩溃、lease 过期、session 丢失、transport 降级、Human 补配置。
- 语义测试：Invocation 终止不会自动把 Task、Gate 或 Delivery 标记完成。
- 多 Agent 测试：并发 claim、冲突写入、分支汇合、wait-for deadlock、A2A 循环传球。
- 自主性测试：Agent 可以提出未预编排的合法 handoff；Harness 校验后投递，但不生成其实施步骤。
- 收口竞态测试：blocking Effect append/dead-letter 与 Delivery completion 不能同时获胜。

## 13. 退出条件

1. S0–S6 全部完成；
2. 目标命名替代旧窄义 Harness 命名；
3. Gate 与 A2A 各只有一个权威状态机；
4. 所有错误场景存在结构化事实、控制动作和 UI 投影；
5. 设计文档、架构图、实现和测试一致；
6. 兼容分支与无读者的死代码/文件已完成清理。
