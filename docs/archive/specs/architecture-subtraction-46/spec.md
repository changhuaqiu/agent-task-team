# Architecture Subtraction — Round 46

> Status: implemented
> Date: 2026-08-15

## Goal

收窄 `WorkContractRepository` 的公共 interface：删除零消费者的 domain getter，并把只服务 repository 实现的 row/authority 查询收为 private helper。

## Evidence

- `getContract(contractId)` 全仓没有生产、测试、脚本或动态消费者。
- `getContractRow(contractId)` 只被同一个 class 的 issue、domain 转换与 outcome admission 使用。
- `listActiveAuthoritiesForTask(projectId, taskId)` 只被同一个 class 的 `closeActiveForTask()` 使用。
- 正式执行依赖 `issue`、`getAuthority`、`closeActiveForTask`、`close` 与 `admitOutcome`，这些 interface 不属于本轮删除范围。

## Contract

1. 删除 `getContract(contractId)`。
2. 将 `getContractRow` 与 `listActiveAuthoritiesForTask` 标记为 private，不改变 SQL、排序、row shape 或调用位置。
3. 保留 WorkContract issue/idempotency、authority epoch fencing、task close 与 Outcome admission 行为。
4. 架构守卫阻止 `getContract` 公共方法回流，并确认两个 helper 只能以 private 形式存在。

## Exit Criteria

- `getContract` 公共方法零残留，两个内部 helper 不再进入公共 interface。
- WorkContract repository、permission policy、dispatch contract、Task/QualityGate/A2A outcome 定向回归通过。
- install、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：7 files / 69 tests 通过。
- 实现后定向：7 files / 70 tests 通过，覆盖 WorkContract、Permission Policy、A2A/Task/TaskGraph/QualityGate Outcome 与架构守卫。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 最终全量：205 files / 1512 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：首轮 Critical 0 / Important 0 / Minor 1；补强声明级 guard 后 Critical 0 / Important 0 / Minor 0，Ready: Yes。修复后定向 7 files / 70 tests、独立架构守卫 1 file / 31 tests 通过，status 与 base→HEAD diff-check clean。
