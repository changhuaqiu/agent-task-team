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

## 6. 状态机契约

实现必须遵守长期设计 §5 的状态和完成语义。所有迁移由 owner 暴露的显式 transition API
执行，并同时校验前态、actor、幂等键和必要证据。禁止直接写任意状态字符串。

目标和所有新写入使用可恢复的 `DeliveryRun.waiting_human`，不得再创建 `escalated`。
legacy `escalated` 在完成明确分类迁移前仍是只读终态，禁止直接恢复；可恢复记录迁为
`waiting_human`，不可恢复记录迁为 `failed`。

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
资格，Pass 表示转换尝试。`invocation_chain / chain_worklist` 仅作为迁移期只读投影。

fan-out pass group 采用 best-effort：已启动分支不可回滚；失败分支为原 holder 建立 recovery
possession。source、child、recovery 的变更必须在同一聚合事务提交。

## 9. Effect 收口

Effect Command 创建时冻结 `criticality`、`deliveryRunId`、`appliesFromRevision` 和
`sourceActionId`。它持续适用，直至 `succeeded / cancelled / superseded`；后两者必须由
显式 Command 记录原因、`supersededAtRevision` 和可选 successor。Closure 检查所有对当前
revision 仍适用的 blocking Effect，dead-letter 后进入 waiting_human 或 failed；
non-blocking Effect 可在完成后重放但不能修改完成结果。

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
