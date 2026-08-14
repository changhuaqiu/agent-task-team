# Architecture Subtraction — Round 28

> Status: implemented
> Date: 2026-08-15

## Goal

删除只有一个生产调用者、实现仅透传 `cross-spawn` 的 `cliBridge` 浅模块，让唯一 `AgentBackend` 实现 `AcpBackend` 直接拥有跨平台子进程启动与其失败语义。

## Evidence

生产调用图只有一条：

```text
AcpBackend.execute()
  -> spawnCli(command, args, options)
  -> cross-spawn(command, args, options)
```

`spawnCli` 不校验 Catalog、不改变参数、不归一化错误、不管理进程，也没有第二个生产 adapter；删除后所有复杂度不会扩散到其他调用者。Windows `.cmd/.bat` 兼容由保留的 `cross-spawn` 直接提供，ACP 的 initialize/session/prompt、取消、TERM→KILL、并发和资源上限仍全部留在 `AcpBackend`。

旧文件还引用已归档且已被 `acp-runtime-integration` 替代的 `cli-bridge-layer` 规格，使一个已不存在的多-backend 时代 seam 继续冒充当前架构。

## Contract

1. `AcpBackend` 直接 import 并调用 `cross-spawn`，调用参数与现状逐项保持。
2. 删除 `src/server/agent/cliBridge.ts` 及针对该浅模块的自证断言。
3. 架构守卫改为锁定唯一 `AcpBackend` 的 direct spawn owner，并继续禁止把 probe 塞入执行模块。
4. 保留 `cross-spawn` 与 `@types/cross-spawn` 依赖、Windows shim 解析、spawn error reason code 和所有 ACP 生命周期行为。
5. 不改 Catalog、daemon、runtime selection、账号、session、permission、事件、UI 或数据库 schema。

## Exit Criteria

- 生产源码中不存在 `cliBridge` / `spawnCli`。
- `cross-spawn` 的正式执行消费者只有 `AcpBackend`。
- AcpBackend spawn 失败、stdio 连接、取消和真实 mock ACP 兼容测试继续通过。
- ACP 活动规格、CLI 架构、daemon wiki 与长期减法决策同步当前 owner。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过，719 packages，锁文件未变。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向测试：`pnpm exec vitest run src/__tests__/architecture/account-runtime-reachability.test.ts src/__tests__/architecture/runtime-ownership.test.ts src/server/agent/acp/acpBackend.test.ts src/server/agent/acp/acpBackend.compat.test.ts src/server/agent/acp/acpBackend.hardening.test.ts`；5 files / 54 tests 通过，覆盖架构 owner、Windows shim、spawn failure、stdio、取消、资源上限与 mock ACP adapter。
- `pnpm build`：通过；仅保留既有 Turbopack NFT 动态路径 warning。
- 全量测试已执行：204 files / 1515 tests passed，2 files / 2 tests skipped，1 test failed；唯一失败为基线既有的 `src/server/autonomous-delivery/control-runtime.test.ts:131`，不经过 ACP spawn 模块。
- 独立复审：初审 Critical 0 / Important 0 / Minor 2；两项验证证据维护问题修复后，最终复审 Critical 0 / Important 0 / Minor 0，Ready Yes。
