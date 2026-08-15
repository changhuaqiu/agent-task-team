# Architecture Subtraction — Round 45

> Status: implemented
> Date: 2026-08-15

## Goal

删除 Task Graph repository 中 `listActions(conversationId)` 与 `listArtifacts(conversationId)` 两个只暴露聚合内部细节的浅 interface，让 conversation 级读取统一穿过 `TaskGraphView`。

## Evidence

- `taskGraphRepo.listActions(conversationId)` 没有外部生产或测试消费者，只被同 repository 的 `getGraph()` 调用。
- `taskGraphRepo.listArtifacts(conversationId)` 除 `getGraph()` 外只有工程协作与 outcome 测试消费者；正式 Pages API、Observation projection 与任务流读取均使用 `getGraph()`。
- `listActionsForTask(taskId)` 承载 evidence policy、协作、watcher 与 autonomous delivery 的真实 task-scoped 查询，不属于本轮删除范围。

## Contract

1. 删除 `listActions(conversationId)` 与 `listArtifacts(conversationId)` 公共方法。
2. `getGraph(conversationId)` 在自身实现内按既有 SQL、排序与 row shape 组装 actions/artifacts。
3. 测试改为通过 `getGraph().artifacts` 验证正式 conversation 聚合，不直接读取内部表面。
4. 保留 `listActionsForTask`、`listEdges`、`getActionById`、revision、commit、artifact write 与 message binding 行为。
5. 架构守卫阻止两个旧 qualified method 与 repository 声明回流。

## Exit Criteria

- 两个旧方法在生产源码零残留，防回流守卫通过。
- Task Graph API、Observation projection、工程协作 artifact/evidence 与 task-scoped action 定向回归通过。
- install、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：7 files / 73 tests 通过。
- 实现后定向：7 files / 73 tests 通过，覆盖 Task Graph repository/API、工程协作、Outcome、Observation projection 与架构守卫。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 最终全量：205 files / 1511 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready: Yes；独立复跑定向 7 files / 73 tests，status 与 base→HEAD diff-check clean。
