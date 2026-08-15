# Architecture Subtraction — Round 41

> Status: active
> Date: 2026-08-15

## Goal

收窄 Session、Invocation 与 Agent Binding repository 的公开表面，删除 10 个没有生产消费者、不承担恢复或校验语义的查询/封装方法。

## Evidence

- Session：`findByAgentAndTask` 仅被同样无消费者的 `sealByTask` 调用；`updateCliSessionId`、`sealByTask`、`listActiveByAgent` 只有 repository 自测；`sealByConversation`、`countByAgentAndConversation`、`findLatestActiveByAgent` 连自测也没有。
- Invocation：`getActive` 只有 repository 自测；`findLatestCompletedForAgent` 无任何代码消费者。
- Agent Binding：`listByNode` 无任何代码消费者。
- 当前 Session 恢复与封存走 `getOrCreateActive`、runtime session identity bind/confirm/release、execution-profile/load-failure 边界；State API 使用 `listAllActive`；Invocation 生命周期使用 create/transition/listRecent/updateDispatchStatus。

## Contract

1. 删除 Session repository 的 `findByAgentAndTask`、`updateCliSessionId`、`sealByTask`、`sealByConversation`、`countByAgentAndConversation`、`listActiveByAgent`、`findLatestActiveByAgent`。
2. 删除 Invocation repository 的 `getActive`、`findLatestCompletedForAgent`。
3. 删除 Agent Binding repository 的 `listByNode`。
4. 删除只验证上述死表面的 repository 测试，添加扫描生产 TS/TSX 的架构防回流门禁。
5. 保留 Session identity、profile change/load failure 封存、message count、State API active-session 投影、Invocation transition/recent/dispatch status 与 Binding lifecycle。

## Exit Criteria

- 10 个旧方法在生产代码中零残留，架构守卫阻止回流。
- 正式 Session/Invocation/Binding 路径的 repository、daemon、State API 与架构测试通过。
- 冻结安装、TypeScript、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：3 files / 99 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- 实现后定向：3 files / 96 tests 通过，覆盖 runtime repositories、State API 与全生产源码架构守卫。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 全量测试执行完成：205 files / 1516 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：待执行。
