# Architecture Subtraction — Round 44

> Status: active
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

- 待执行。
