# Agent Completion Reliability

> Status: implemented
> Date: 2026-08-30
> Related: `command-driven-delivery`, `system-control-plane`, `agent-eval-system`

## Problem

Task `done` 已有 Gate 与 revision 保护，但真实桌面数据仍存在三类不可收敛路径：

- Runtime 租约过期或启动失败后，Invocation 已失败而 WorkAuthority 仍为 active；
- A2A Pass 已 completed/error/rejected/blocked，而 `a2a-pass:*` WorkAuthority 仍为 active；
- Task 已终态但 `completed_at` 为空，评估与运营无法可靠计算耗时和完成窗口。

这些缺陷使“任务完成率”与“任务可完成性”混在一起：Task 没有被错误标为 done，
但失败路径可能永久停留在进行中，导致后续唤醒、重试、人工处理和评估分母失真。

## Success model

Agent 任务评估分为三层：

1. **Result success**：Task 为 `done`，且当前 artifact revision 的 Gate 与交付证据有效。
2. **Path convergence**：成功、失败或取消后，Invocation、Inbox、A2A Pass 与 WorkAuthority 均能收敛到一致终态。
3. **Execution efficiency**：用调用失败率、结构化 Outcome 接纳率、重复 Attempt 与重复 Handoff 衡量路径放大。

Result success 不能由 Runtime 成功替代；Path convergence 也不能把失败伪装成完成。

## Scope

- 建立一个深的 `WorkLifecycleReconciler` Module，在同一 Interface 后处理事件驱动收尾和启动恢复。
- 过期的非终态 Invocation 以 CAS 语义终止，并记录稳定原因 `orphaned_runtime_owner_lease_expired`。
- 当前 Attempt 已失败、A2A Pass 已终态或 Task 已终态时，关闭对应 WorkAuthority 并取消残留 Inbox Work。
- 关闭 Authority 后由现有 Task Wakeup / Delivery Control 决定是否重试；本 Module 不盲目执行外部副作用。
- 失败队列人工重试必须重建已经终结的 Human A2A Pass/WorkAuthority，不得只释放旧 Inbox；非 Human A2A 由原 source owner 恢复，不能伪造成用户请求。
- Task 进入 `done|cancelled` 时写入 `completed_at`；migration 对历史终态 Task 用 `updated_at` 回填。
- EvalSnapshot 冻结相关 WorkAuthority 与 AgentOutcome，Deterministic Evaluator 输出完成率、路径收敛率和 Outcome 接纳率。
- 正式交付件不再把 `cmd/test/trace/proof/live-db/disk/e2e` 引用渲染为独立产物卡。
- 已退役的持久 handler 队列必须有明确终态，不允许无限 queued。

## Invariants

1. `Task.status = done` 仍只由当前 Gate 的 `gate.passed` 证据驱动。
2. `Invocation.status = terminated AND outcome != completed` 后，匹配当前 Contract Attempt 的 Authority 最终必须 closed。
3. `A2A Pass` 进入 completed/blocked/rejected/timeout/error 后，`a2a-pass:<id>` Authority 最终必须 closed。
4. `Task` 进入 done/cancelled 后，Task-owned Authority 最终必须 closed；Delivery-owned Authority 仍由 Delivery 终态控制。
5. 启动恢复可重复执行，重复运行不增加 epoch、不重复创建 Task、不把失败改成成功。
6. Evaluation cutoff 后变化不能改写旧快照；无法冻结的 Authority 状态标为 late fact。
7. 完成率、路径收敛率、Outcome 接纳率分别呈现，不用单一平均分掩盖失败。
8. 终态 A2A Pass 的旧 Inbox 不可再次执行；人工重试创建可追溯到原消息的新 Chain/Pass/Inbox，并将旧失败项标记为已替代。相同失败 Inbox 的重复或并发重试返回同一替代 Inbox，不增加第二套协作聚合。
9. active chain、成员/运行配置变化、Inbox 幂等冲突与容量耗尽必须返回稳定的 409/422/429 领域响应，不得退化为无法行动的通用 500。

## Non-goals

- 本迭代不声称真实 Agent 任务成功率提升；该结论仍需固定 TestSuiteRevision 和 baseline/candidate ApplicationSnapshot 的 E 级成对实验。
- 不在启动恢复中自动执行 Git push、发布、支付或其他外部非幂等写入。
- 不重写 Delivery Control、A2A 协作语义或 Gate 事实源。
- Task 所有历史写入口完全收口到 CommandService 继续由 `command-driven-delivery` 规格跟踪，本迭代只禁止新增旁路。

## Exit conditions

- 固定集成场景覆盖正常完成、Runtime 租约过期、Runtime 启动失败、A2A 完成、A2A 失败和重复启动恢复。
- 所有场景的 Path convergence 为 100%，且失败场景不会被记为 Result success。
- 相关测试、类型检查、生产构建通过。
- 真实桌面数据库升级后不存在可自动判定的过期 Invocation、终态 A2A active Authority 或终态 Task 空完成时间。
- C 级前后对比记录完成；E 级未执行风险被明确保留。
