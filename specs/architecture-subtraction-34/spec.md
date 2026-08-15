# Architecture Subtraction — Round 34

> Status: active
> Date: 2026-08-15

## Goal

把 Team Runtime 的 A2A 通信策略从三个浅方法收敛为一个真实准入结果：调用方一次读取即可得到“允许”或用户可读的阻止原因。删除零生产消费者的 escalation resolver 与公共 helper/type export，同时保留 TeamPack communication matrix、prompt 中的收发/升级说明以及 A2A roster 校验。

## Evidence

- 唯一生产消费者 `src/server/a2a/command-guard.ts` 先调用 `communicationPolicy.canSend()`，被拒绝后再调用 `explainBlock()`；`explainBlock()` 内部又调用一次 `canSend()`，同一矩阵判断重复执行。
- `CommunicationPolicy.getEscalationTarget()`、`getEscalationTargetFromMatrix()` 没有生产消费者；唯一读取位于 Team Runtime 自测。
- `resolveCommunicationPolicy` 与 `CommunicationPolicy` 虽由 Team Runtime barrel 公开，但全仓没有调用方从 barrel 直接消费；生产只通过 `TeamRuntime.communicationPolicy` 使用策略。
- `TeamPackCommunicationMatrix.canReceiveFrom / canEscalateTo` 仍被 `buildTeamPackLayer()` 注入 Agent prompt，不属于本轮删除范围。
- A2A Command Guard 仍必须先校验 conversation runtime、source roster 与 target roster；显式 Human Command 只豁免 agent-to-agent matrix，不豁免 target roster。

## Contract

1. `CommunicationPolicy` 只暴露 `explainBlock(fromAgentId, toAgentId): string | undefined`；`undefined` 表示允许，字符串表示阻止原因。
2. `A2ACommandGuard` 对每个 agent handoff 只调用一次该方法，并沿用 `a2a_communication_policy_blocked` 与既有用户可读原因。
3. 无 TeamPack 时继续允许 agent-to-agent handoff；有 TeamPack 时继续读取 `canSendTo`，并保留 default-team 四人矩阵的兼容补全。
4. 删除 `canSend()`、`getEscalationTarget()`、内部 escalation resolver，以及 Team Runtime barrel 对 `resolveCommunicationPolicy` / `CommunicationPolicy` 的公开导出。
5. 保留 TeamPack `canSendTo / canReceiveFrom / canEscalateTo` 数据、持久化/API、Context prompt 与 A2A roster/possession/delivery 行为。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在 `communicationPolicy.canSend`、`getEscalationTarget` 或 `getEscalationTargetFromMatrix`。
- Team Runtime barrel 不再公开策略构造 helper 或独立 `CommunicationPolicy` 类型；调用方只通过 `TeamRuntime` 使用单方法策略。
- 行为测试通过 Team Runtime 与真实 A2A Command Guard interface 覆盖允许、矩阵拒绝、默认团队兼容、无 TeamPack、Human 豁免与 roster 拒绝。
- 架构守卫禁止被删浅接口与 public export 回流，并证明 TeamPack prompt 的 `canReceiveFrom / canEscalateTo` 保留。
- 当前技术 wiki 与架构图只描述一次返回阻止原因的 A2A 准入，不宣称存在自动 escalation resolver。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- 基线 `pnpm exec vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/server/a2a/command-guard.test.ts src/__tests__/api/state/mutations.test.ts src/__tests__/architecture/runtime-ownership.test.ts --reporter=dot`：4 files / 93 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- 实现后同一定向命令：4 files / 94 tests 通过。
- `pnpm build`：通过；保留既有 Next.js NFT tracing warning。
- `pnpm test -- --run --reporter=dot`：执行完成；205 files / 1515 tests 通过，2 files / 2 tests skipped，1 file / 1 test failed。唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，本轮定向链与生产构建均通过，不将全量 suite 误记为全绿。
- 第一次独立复审：Critical 0 / Important 0 / Minor 3；运行时语义与调用图通过，要求补强旧 escalation helper 的架构正则、三条互不重名的 TeamPack prompt 权限断言，以及 Command Guard 的精确错误、空原因 fallback 与 source-before-policy 顺序门禁。
- 修复后 `pnpm exec tsc --noEmit`：通过；同一定向命令 4 files / 96 tests 通过。
- 最终独立复审待执行。
