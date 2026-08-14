# Architecture Subtraction — Round 27

> Status: implemented
> Date: 2026-08-15

## Goal

删除 `terminal:start` socket transport 在 `InvocationCoordinator` 之前重复执行的 legacy proposal policy 与专属 Proof 写入，让 `InvocationPlanner` 成为普通项目 proposal 与自主交付规划互斥规则的唯一 admission owner。

## Evidence

`legacyProposal` 仍是普通项目自动方案派发的真实意图标记，不能删除；它会经浏览器 dispatch、`/api/mutations`、Agent Inbox 和 Scheduler 持久传入 `AgentActivationCommand`。自主项目必须继续依据持久化 `DeliveryRun` 拒绝该意图。

当前却存在两次相同判断：

```text
terminal:start
  -> submitSocketTerminalStart() 查询 DeliveryRun、写 legacy_proposal.suppressed Proof、提前返回 blocked
  -> InvocationCoordinator（被绕过）

Agent Inbox / 非 socket / 未被 transport 提前返回的路径
  -> InvocationCoordinator
  -> InvocationPlanner.prepare() 查询 DeliveryRun、返回 autonomous_delivery_owns_planning
```

socket 分支只是 transport 私有的重复 policy：它没有独立业务语义，专属 `legacy_proposal.suppressed` 事件也没有生产消费者；更重要的是，它让同一 Human Command 因 transport 不同而可能绕过 Coordinator 的幂等、busy、completion 与统一观测链。Planner 已覆盖 socket、持久化 Inbox、重试和重启恢复，是能够维持单一规划权威的共同 seam。

## Contract

1. `submitSocketTerminalStart()` 只验证/归一化 transport payload，并无条件提交给 `InvocationCoordinator`。
2. 保留 `legacyProposal` 在浏览器、mutation、Inbox、Scheduler 与 `AgentActivationCommand` 上的持久传递。
3. 保留 `InvocationPlanner.prepare()` 对持久化 `DeliveryRun` 的 `autonomous_delivery_owns_planning` admission。
4. 删除 socket 私有的 `legacy_proposal.suppressed` Proof 写入和只证明 transport 提前返回的测试。
5. 用真实 Coordinator + Planner 测试证明 stale-tab socket command 仍被拒绝，且 Runtime 不执行。
6. 不改变普通非自主项目 proposal、DeliveryRun、ExecutionEnvelope、Task Graph、A2A、UI 或数据库 schema。

## Exit Criteria

- daemon socket transport 不读取 `autonomousDeliveryRepo` 来决定 proposal policy，也不写 `legacy_proposal.suppressed`。
- `autonomous_delivery_owns_planning` 只由 Invocation Planner admission 产生。
- stale-tab socket、Agent Inbox 和普通 proposal 都通过同一 Invocation Pipeline seam。
- 架构守卫阻止 transport 层重新引入 legacy proposal policy。
- 活动 System Control Plane 与长期 Platform Harness 文档同步真实 owner。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过，锁文件未变。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向测试：4 files / 43 tests 通过。
- `pnpm build`：通过；仅保留既有 Turbopack NFT 动态路径 warning。
- 全量测试已执行：204 files / 1514 tests passed，2 files / 2 tests skipped，1 test failed；唯一失败为基线既有的 `src/server/autonomous-delivery/control-runtime.test.ts:131`，不经过本轮修改的 socket/Planner 路径。
- 复审修复后验证：TypeScript 通过；2 files / 30 tests 通过，包含普通项目真实 Coordinator → Planner → Runtime 正向链。
- 独立复审：初审发现 1 Important（验证措辞）与 1 建议（普通项目真实链）；修复后复审 Critical 0 / Important 0 / Minor 0，Ready Yes。
