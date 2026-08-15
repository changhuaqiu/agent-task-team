# Architecture Subtraction — Round 53

> Status: implemented
> Date: 2026-08-15

## Goal

删除 ACP 生产模块为内部步骤保留的五个 test-only public helpers，并把测试迁到正式 `AcpBackend`、turn-scoped event mapper 与 WorkContract permission interface。运行时映射、会话恢复、诊断脱敏和权限行为保持不变。

## Evidence

- `mapAcpUpdate` 的唯一生产消费者是同文件 `createTurnScopedAcpEventMapper`；模块外只有 mapper 单测直接导入。
- `createAutonomousWorkPermissionPolicy` 的唯一生产消费者是同文件 `createWorkContractPermissionPolicy`；daemon 只消费后者，模块外只有测试直接导入前者。
- `sanitizeAcpDiagnostic`、`isAcpResourceNotFound`、`describeAcpSessionLoadFailure` 只在 `AcpBackend` 内部调用；模块外引用全部来自直接 helper 测试。
- 正式 AcpBackend 集成测试已经覆盖 session/load 失败与 stderr bearer 脱敏；缺失 session 的 reason code 可通过真实 mock ACP subprocess 补齐。
- 定向基线 6 files / 124 tests 全部通过。

## Contract

1. `createTurnScopedAcpEventMapper` 是 ACP update 映射的唯一公共 interface；纯映射 helper 留在模块内部。
2. `createWorkContractPermissionPolicy` 是自主 WorkContract 授权的公共 interface；authority/epoch/contract 复核不可绕过。
3. Session load 分类与 diagnostic sanitizer 属于 `AcpBackend` implementation，不作为独立公共 interface。
4. 测试必须通过正式 interface 观察 AgentEvent、AgentResult、reason code、visible error 与脱敏结果，不再直接测试内部 helper。
5. smoke 真正消费的 `getActiveAcpRunCount`、正式 permission handler 与 correlated MCP policy 保持公开，不在删除范围。

## Exit Criteria

- 五个 test-only helper 不再出现在 production export surface。
- 缺失 session、普通 load failure、stderr 脱敏、tool correlation 与 WorkContract permission 均有正式 interface 回归。
- 定向测试、tsc、build、全量测试和独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile` 通过，安装 719 个冻结依赖包。
- 实现前定向基线：6 files / 124 tests 全部通过。
- 实现后定向回归：6 files / 124 tests 全部通过；另含真实 Claude runtime smoke 的完整影响面为 6 files / 124 tests 通过、1 file / 1 test 按环境条件跳过。
- Missing-session 测试通过真实 mock ACP subprocess 抛出 SDK `RequestError.resourceNotFound`，从 `AcpBackend` 的 AgentResult 与可见 error event 验证 `acp_session_not_found`。
- Permission 测试与真实 Claude smoke 均改走 `createWorkContractPermissionPolicy`，不再绕过 authority/epoch/contract 复核。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm build` 通过；仅保留既有 whole-project NFT tracing warning。
- 非并行全量测试执行完成：206 files / 1519 tests 通过，2 files / 2 tests 跳过；唯一失败仍为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，该文件不在本轮 diff。
- 独立复审：Critical 0 / Important 0 / Minor 0，独立 6 files / 124 tests 与 tsc 通过；真实 Claude smoke 1 file / 1 test 按环境条件跳过，Ready: Yes。
