# Architecture Subtraction — Round 17

> Status: implemented
> Date: 2026-08-15

## Goal

删除 ACP-only 执行链中已经恒等化的 `CapabilityRouter`、手工 `CapabilitySet` 与合成能力测试，让 daemon 直接把已验证的 ACP 执行参数交给唯一 `AcpBackend`。

## Evidence

- `AcpBackend` 是 `AgentBackend` 的唯一生产实现；三种 runtime 都走同一 ACP 协议链。
- 当前 `ACP_CAPS_BASE` 对所有 runtime 完全相同：resume/system prompt 支持、无需 PTY，且 daemon 从不提交 maxTurns。
- `checkCapabilities()` 的唯一生产调用位于 daemon；在当前输入与唯一 backend 下不会修改 prompt 或 options，也不会产生 warning。
- `AgentBackend.capabilities`、`CapabilitySet` 和 `AcpBackend.capabilities` 除该恒等 router 外没有生产消费者。
- router 测试只构造已删除 bespoke backend 的合成能力矩阵，证明的是当前生产不可达的降级分支。
- 当前代码已实际接线 ACP `session/load`，但长期文档仍声称 CapabilityRouter 会丢弃 resume，与运行事实相反。

## Contract

1. `AgentBackend` 只保留稳定的 `execute(prompt, opts)` 契约。
2. daemon 直接构造一次 `ExecOptions`，同一份参数用于观测与 `backend.execute()`，不得再经过合成能力降级。
3. runtime 能力事实来自 Catalog 的 `verifiedCapabilities`、ACP initialize 握手和真实兼容测试；不再维护第二套手工布尔矩阵。
4. `EngineId` 作为执行身份留在 agent types 中，不以保留空 capability 模块为代价。
5. 当前架构文档、ACP 活动规格与 daemon wiki 必须准确描述 session/load 和唯一执行链。

## Exit Criteria

- 全仓无 `CapabilitySet`、`checkCapabilities`、`capabilityRouter` 或 `backend.capabilities` 生产契约。
- session/system prompt/cwd/env/timeout 继续原样进入 `AcpBackend.execute()`。
- ACP backend、daemon/socket、session identity 与 architecture guard 测试通过。
- 冻结安装、类型、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- 定向测试：8 files / 63 tests 通过，覆盖参数构造、Catalog、ACP mock、session、socket 与架构边界。
- `pnpm run build`：通过（仅保留既有 Turbopack 动态路径追踪 warning）。
- `pnpm test`：1500 passed / 2 skipped / 1 failed；唯一失败为基线同样复现的 `src/server/autonomous-delivery/control-runtime.test.ts:131` human-resume fixture，与本轮无关。
- 独立复审：Critical 0 / Important 0；参数保真测试和最后文档 Minor 均已修正。
