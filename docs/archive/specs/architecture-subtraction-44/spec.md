# Architecture Subtraction — Round 44

> Status: implemented
> Date: 2026-08-15

## Goal

删除 Session、Invocation 与 Skill repository 中 3 个只有自测消费者的重复读 interface，让调用方只面对正式 runtime/session 与 Skill assignment 读模型。

## Evidence

- `invocationRepo.getByAgent` 只被一个 repository 自测调用；正式查询使用 conversation、recent list 与 dispatch lifecycle。
- `sessionRepo.findActive(agentId, taskId)` 只被 repository 自测调用；正式 runtime、Context Planner 与恢复链统一使用带 conversation/isolation 语义的 `findActiveByConversation`。
- `skillRepo.getSkillIdsForAgent` 只被 Skill repository/seed 自测调用；正式 API 使用 `getSkillsForAgent`，State、Invocation 与 Evaluation 使用 `getAllAgentSkillIds`。

## Contract

1. 删除 `invocationRepo.getByAgent`、`sessionRepo.findActive`、`skillRepo.getSkillIdsForAgent` 及只验证这些浅 interface 的测试。
2. 保留 Invocation conversation/recent/transition/dispatch status 正式读写面。
3. 保留 Session conversation+isolation identity、runtime bind/confirm/release、seal 与 message count 生命周期。
4. Skill assignment 测试改为穿过 `getSkillsForAgent` 或 `getAllAgentSkillIds` 验证正式读面，不降低 preset/seed 幂等覆盖。
5. 架构守卫阻止三个旧 qualified method 与 repository 声明回流。

## Exit Criteria

- 三个旧方法在生产源码零残留，防回流守卫通过。
- Session runtime identity、Invocation dispatch、Skill assignment/seed/runtime 定向回归通过。
- install、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：4 files / 94 tests 通过。
- 实现后定向：4 files / 93 tests 通过，覆盖 repositories、Skill assignment/seed、Context Planner 与 Dispatch Gateway。
- 架构守卫：`runtime-ownership.test.ts` 1 file / 30 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 最终全量：205 files / 1511 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：首轮 Critical 0 / Important 0 / Minor 1，修正验证证据后 Critical 0 / Important 0 / Minor 0，Ready: Yes；独立复跑定向 4 files / 93 tests、架构守卫 1 file / 30 tests 与 `pnpm exec tsc --noEmit` 均通过，status 与 base→HEAD diff-check clean。
