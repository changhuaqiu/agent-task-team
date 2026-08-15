# Architecture Subtraction — Round 54

> Status: active
> Date: 2026-08-15

## Goal

收窄工作目录与 Git Worktree 模块的正式 interface：删除完全不可达的 context sidecar 写入和只写不读的活动目录假状态，把路径编码、元数据 DTO、分支前缀及 Worktree row 收回 owner 内部，并让测试只穿过 `WorkdirManager` / `WorktreeManager` 的正式行为。

## Evidence

- `WorkdirManager.refreshContextFiles()` 全仓没有调用方；它是 `.ath-role.md` 与 `.ath-team.md` 的唯一 producer，这两个文件也没有任何 reader、watcher、迁移或文档契约。
- `WorkdirManager.activeDirs` 只有 `add/delete`，没有任何 read、GC、调度、诊断或序列化消费者。
- `resolveProjectWorkdir()` 只由同类 `resolveWorkdir()` 调用；模块外没有独立消费者。
- `safeWorkdirSegment()` 只被 owner 和一条直接 helper 测试引用；真实可观察结果已经由 `resolveWorkdir()` 返回路径覆盖。
- `SessionMeta`、`GCMeta` 只在 `workdir-manager.ts` 内部使用；`BRANCH_PREFIX`、server `WorktreeInfo` 只在 `worktree-manager.ts` 与其直接测试中出现。
- daemon 仍真实消费 `WorkdirManager.resolveWorkdir()`、session/GC 元数据方法和 `WorktreeManager` CRUD；App route 仍真实消费 Worktree create/list/exists/remove。
- 修改前定向基线：3 files / 76 tests 通过。

## Contract

1. `WorkdirManager` 的正式 interface 保留 runtime cwd 解析、session 元数据、GC 元数据、task directory GC、Worktree GC 与底层 manager 访问。
2. `resolveProjectWorkdir()` 是 `resolveWorkdir()` 的 implementation，不作为平行入口。
3. 外部业务标识的 portable path 编码由 owner 内部执行；测试从最终路径验证，不导入编码 helper。
4. `.ath-role.md` / `.ath-team.md` 无正式 producer 或 consumer，本轮直接删除其唯一写入方法，不建立兼容层。
5. `activeDirs` 不表达任何可观察状态，本轮连同无效写入一起删除。
6. `WorktreeManager` 保留 create/list/remove/exists/path/branch 正式行为；分支前缀与返回 row 类型属于 implementation。
7. 架构守卫扫描生产 TS/TSX，阻止删除功能、假状态与内部符号重新进入公共 interface。

## Exit Criteria

- `refreshContextFiles`、`.ath-role.md`、`.ath-team.md` 与 `activeDirs` 在生产源码中零残留。
- `resolveProjectWorkdir` 为 private；五个内部符号不在 owner export surface。
- Workdir/Worktree 真实路径、metadata、GC、外部 repo、migration 与 API 所依赖行为保持。
- 定向测试、TypeScript、build、全量测试与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages。
- 修改前定向：3 files / 76 tests 通过。
- 修改后定向：3 files / 77 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；仅保留既有 whole-project NFT tracing warning。
- 非并行全量：206 files / 1520 tests 通过，2 files / 2 tests skipped；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，该文件不在本轮 diff。
- 独立复审：Critical 0 / Important 0 / Minor 0；独立 3 files / 77 tests 与 `tsc --noEmit` 通过，Ready: Yes。
