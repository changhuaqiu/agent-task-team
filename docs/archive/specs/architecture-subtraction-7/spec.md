# Architecture Subtraction — Round 7

> Status: implemented
> Date: 2026-08-15

## Goal

删除两个没有正式入口、已被标准真实 runtime smoke 与自动化测试替代的 ACP 手工探针脚本。

## Evidence

- `probe-acp-nosdk.mjs` 没有 package script、文档、CI 或代码消费者，并通过未锁版本的 `npx` 手写旧 JSON-RPC initialize，与 Catalog 的版本事实源冲突。
- `verify-daemon-acp-routing.ts` 仅在自身注释中声明运行方式，没有 package、文档或 CI 入口；其 catalog、runtime setup、capability、done guarantee 已分别有自动化测试。
- `smoke-acp-runtime.ts` 是当前文档化的真实 runtime 验证入口，使用 Catalog 锁定 launcher，并覆盖 `session/new → session/load`。

## Contract

1. 删除两个无消费者手工探针。
2. 保留 `smoke-acp-runtime.ts`、ACP Catalog、runtime setup、backend、capability 与 lifecycle 测试。
3. 不改变 runtime launcher、权限、session 或生产执行行为。
4. 长期架构减法文档记录唯一 smoke 入口。

## Exit Criteria

- 两个旧脚本与名称无当前事实残留。
- 标准 smoke 的代码、文档和自动化支撑仍可达。
- TypeScript、ACP 相关测试、全量测试及生产构建完成。
- 独立复审无 Critical/Important。
