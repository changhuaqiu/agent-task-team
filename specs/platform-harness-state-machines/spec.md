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
3. Delivery Supervisor 只依据权威事实计算有限的确定性控制动作；
4. Runtime/CLI 错误归一化后再进入恢复、重试或 Human 决策；
5. 当前窄义 `src/server/harness` 迁入 Invocation Pipeline 语义；
6. 从单 Agent Invocation 监督扩展为多 Agent Work Cell 图的可靠协调。

## 2. 非目标

- 不把 Agent 内部 Todo 持久化为平台 Task Graph。
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
- `ControlAction` 只能是 `activate | wait | retry | requestGate | resume | escalateToHuman | terminate`。

## 4. Owner 契约

Task、A2A、Gate、Context、Inbox、Invocation、Delivery、Effect 各自拥有独立状态机。
跨 owner 写入必须使用 Command；owner 在同一事务中修改事实并写 Event Outbox。
Process Manager 消费 Event 和 Query，不可直接改其他 owner 的表。

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

## 6. 状态机契约

实现必须遵守长期设计 §5 的状态和完成语义。所有迁移由 owner 暴露的显式 transition API
执行，并同时校验前态、actor、幂等键和必要证据。禁止直接写任意状态字符串。

DeliveryRun 的生命周期状态与协作阶段必须分开：生命周期只允许
`active / waiting_gate / waiting_human / retrying / completed / failed / cancelled`，
阶段只允许 `planning / executing / reviewing / verifying / integrating / delivering`。
所有新写入使用可恢复的 `waiting_human`，不得再创建 `escalated`。migration 58 已将历史
`escalated` 归一化为带明确 reason 的 `waiting_human`，将 `recovering` 归一化为
`retrying`；只有 Human Command `manual_resume` 可以恢复人工等待。

## 7. Supervisor 决策契约

一次 reconcile 返回一个 `ControlDecision`，其中包含按资源容量排序的 `actions[]`；
不是 Delivery 全局单动作。每个 target Work Cell / slot 最多一个动作。action id 由
run、snapshot revision、policy revision、type 和 target 确定性派生。

某个运行中 Work Cell 的 `wait` 不得阻止剩余容量激活其他 Work Cell。重复读取相同
snapshot/policy 必须生成相同 action ids，不得追加重复 wait/action。
`wait` 不持久化为 DeliveryAction 或 Effect；有副作用动作在 claim 时重新校验 snapshot
revision、slot capacity 和 work epoch。

## 8. A2A 聚合

目标只保留 `A2ACollaboration` 权威聚合：Chain 为根且状态派生，Possession 拥有 holder
资格，Pass 表示转换尝试。所有新写入、运行控制和观测关系都必须从
`a2a_possession_chain / a2a_possession / a2a_pass_group / a2a_pass / handoff_packet`
派生；`invocation_chain / chain_worklist / a2a_audit_log / a2a_delivery` 不再充当兼容读模型，
待删除表迁移完成后从 schema 与源码一并退役。

fan-out pass group 采用 best-effort：已启动分支不可回滚；失败分支为原 holder 建立 recovery
possession。source、child、recovery 的变更必须在同一聚合事务提交。

Agent 发起协作必须提交结构化 `handoff_to_agent` Outcome。durable A2A Outcome Process
Manager 只把已接纳 Outcome 翻译为 A2A owner Command；Pass、HandoffPacket 与每个下游
AgentInbox item 必须在同一 SQLite 事务创建。Outcome 重放通过 pass group 语义幂等键返回
同一结果，内容漂移必须拒绝。

生命周期映射冻结为：

- `AgentInbox.enqueued/claimed/released` 不改变 Pass；
- `AgentInbox.admitted` 推进 `Pass.offered -> accepted -> starting`；
- `runtime.invocation.started` 才推进 `Pass.started` 并创建 receiver Possession；
- Inbox `expired/cancelled` 或 started 前 Runtime 终止，以 phase-specific reason 失败 Pass；
- receiver 的非 `continue_work` 结构化 Outcome 收口其 Possession；
- WorkContract Invocation 的最终自然语言不得触发 A2A。

`handoff_to_agent.payload` 必须提供 `idempotencyKey` 与非空 `branches[]`。每个 branch
必须明确 `toAgentId / intent / title / requestedAction`；packet 的决策、证据、约束、
开放问题和禁止行为为结构化可选字段，不得用整段最终回复代替。

WebUI Human turn 使用 `a2a.human_handoff` Command：先持久化 chat message，再由服务端
A2A owner 创建/中断协作与持久 Inbox 工作。浏览器不得先发 `terminal:start` 再通过
Socket 补登记 Chain。没有目标的 Human turn 表示显式中断当前 collaboration；尚未 claim
的 Inbox item 同事务取消，已 claim/running 工作留给 Supervisor 执行受 fencing 保护的
停止策略。

## 9. Effect 收口

Effect Command 创建时冻结 `criticality`、`deliveryRunId`、`appliesFromRevision` 和
`sourceActionId`。它持续适用，直至 `succeeded / cancelled / superseded`；后两者必须由
显式 Command 记录原因、`supersededAtRevision` 和可选 successor。Closure 检查所有对当前
revision 仍适用的 blocking Effect，dead-letter 后进入 waiting_human 或 failed；
non-blocking Effect 可在完成后重放但不能修改完成结果。

## 9.1 QualityGate 聚合契约

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

## 11. 兼容迁移

旧 `HarnessCoordinator`、`RepositoryHarnessPlanner`、`HarnessRuntimePort`、`HarnessTrigger`
先提供到目标名的兼容映射。所有调用者迁移并通过验证后才能删除旧名。

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
