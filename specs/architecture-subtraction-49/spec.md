# Architecture Subtraction — Round 49

> Status: active
> Date: 2026-08-15

## Goal

删除真正无消费者的数据库/Invocation helper，并把只供模块内部写后回读、状态校验和编排的实现细节从公共 interface 收回，避免调用方绕过正式 repository、Pages route 与调度入口。

## Evidence

- `closeDb()` 与 `assertInvocationOutcome()` 在生产、测试、脚本和 E2E 中均只有定义，没有消费者。
- `deletePhasesByConversation()` 只有自身 query 测试消费；Conversation aggregate 已在同一删除事务内按依赖顺序直接清理 phase，不调用该 helper。
- `getPhaseById()` 只服务 `upsertPhase()` 写后回读及测试；正式 Phase transport 只需要 list/upsert/delete。
- `getAgentById()` 只服务 Agent upsert/delete 内部读回与 query 自测；正式 Agent transport 只需要 list/upsert/delete。
- Invocation transition constants、transition input、四个 error class、status assertion 与 transition predicate 均只在 `invocation-repo.ts` 内使用；正式调用方只消费 `invocationRepo` lifecycle 和公开 row/input/output 类型。
- `acpSessionMeta()`、`deriveWorkId()`、`emitTaskState()`、`resolveTaskStorageIds()`、`runWorktreeGC()` 与 `submitAgentActivation()` 也只有定义模块内部调用，无测试、脚本、barrel 或其他生产消费者。

## Contract

1. 直接删除 `closeDb()`、`assertInvocationOutcome()` 与 `deletePhasesByConversation()` 及只为它们存在的测试。
2. `getPhaseById()`、`getAgentById()`、Invocation 状态机实现细节和六个同文件 helper 保留行为但不再导出。
3. Phase 测试通过 list/upsert/delete 正式 interface 验证；Agent 测试通过 list/upsert/delete 验证，不从模块外读取私有标量 helper。
4. 保留 Invocation managed lifecycle、reason code、Domain Event 事务、Phase/Agent Pages API、Conversation aggregate cleanup、ACP session metadata、Task notification/watcher、WorkContract dispatch、worktree GC scheduler 与 Invocation registry 行为。
5. 架构守卫扫描全部生产 TS/TSX，阻止三个删除符号回流，并锁定十七个内部 helper 不得重新导出。

## Exit Criteria

- 三个死 helper 全仓生产残留为零；十七个模块内部符号不再属于公共 interface。
- Invocation、Phase、Agent、ACP、Task notification/watcher、WorkContract、worktree GC 与 Invocation registry 回归通过。
- install、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile` 通过，复用冻结 lockfile 安装 719 个依赖包。
- 实现前定向回归：10 files / 170 tests 通过。
- 首次实现后定向回归：10 files / 170 tests 通过；删除 1 个死接口自测并新增 1 个架构守卫，测试总数净零变化。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm build` 通过；仅保留 `next.config.ts` 已知 NFT tracing warning。
- 首轮独立复审：Critical 0 / Important 0 / Minor 2；要求用 AST 锁完整 export surface，并补真实 Conversation aggregate Phase cleanup 回归。
- 修复后聚焦回归：2 files / 86 tests 通过，`pnpm exec tsc --noEmit` 再次通过；完整定向回归为 10 files / 171 tests 通过。
- 第二轮独立复审：Critical 0 / Important 0 / Minor 1；发现 exported object 的改名属性仍可暴露内部 helper。
- 最终 guard 同时记录 exported object 的属性名与 identifier initializer，并以 synthetic alias/default-object 回归锁定；完整定向 10 files / 171 tests 与 `pnpm exec tsc --noEmit` 再次通过。
- 最终非并行全量执行完成：205 files / 1509 tests 通过，2 files / 2 tests 跳过；唯一失败仍为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，该文件不在本轮 diff。
- 最终独立复审待回填。
