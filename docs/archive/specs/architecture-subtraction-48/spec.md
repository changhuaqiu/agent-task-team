# Architecture Subtraction — Round 48

> Status: active
> Date: 2026-08-15

## Goal

删除生产模块中零消费者或仅供测试使用的浅接口，把测试数据构造移出正式 SkillRuntime，并把 TASKS.md watcher 的清理能力绑定到创建动作，继续收窄 ACP、Project Context、Skill 与文件 watcher 的公共面。

## Evidence

- `HOST_THOUGHT_ONLY_OPENCODE_MODEL` 与 `fingerprintCurrentInputs()` 在生产、测试、脚本和文档中均只有定义、没有消费者。
- `createCodeChangePermissionPolicy()` 只有自身单元测试调用。它允许任意 ACP edit，正式执行已由 `createAutonomousWorkPermissionPolicy()` / `createWorkContractPermissionPolicy()` 按 cwd、authority 与命令白名单失败关闭。
- `packageFromLegacyInput()` 只被 unit/integration/E2E fixture 调用，却位于生产 `skill-runtime.ts`，扩大了活动规格明确限定为 `install()` / `compile()` 的 SkillRuntime 公共面。
- `stopTaskWatcher()` 只有 watcher 测试 teardown 调用；生产只调用 `startTaskWatcher()`。清理属于 watcher 创建所得资源的生命周期，不需要第二个按路径重新查找的公共命令。

## Contract

1. 删除两个零消费者符号和宽权限策略；保留 ACP fallback model 行为、正式 WorkContract 权限策略与 Project Context freshness 计算。
2. 删除生产 `packageFromLegacyInput()`；测试通过 test-helper 构造同形 `SkillPackageInput`，正式 SkillRuntime 只保留安装与编译能力。
3. `startTaskWatcher()` 返回幂等 cleanup；只有本次真实创建 watcher 的调用获得其所有权，重复 start 返回 no-op，不得让后来的调用者关闭先前 owner 的 watcher。
4. 架构守卫扫描全部生产 TS/TSX，阻止退休符号、测试 fixture 与独立 watcher stop 接口回流。

## Exit Criteria

- 五个浅接口在生产源码中零残留，测试 fixture 只存在于 test-helper。
- ACP permission、runtime setup、Project Context、Skill Runtime、Skill API/Planner/E2E 与 TASKS.md watcher 回归通过。
- install、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：8 files / 114 tests 通过。
- 实现后定向：8 files / 114 tests 通过；删除一个宽权限自证测试，新增一个 watcher ownership 回归。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 最终非并行全量：205 files / 1508 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：待记录。
