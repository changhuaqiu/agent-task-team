# Architecture Subtraction — Round 29

> Status: implemented
> Date: 2026-08-15

## Goal

删除 daemon 对 `AgentRun.events` 的第二次终止事件包装，并把 `done` 保证内聚到唯一 `AgentBackend` 实现 `AcpBackend`，从而让运行时事件归一化只有一个 owner。

## Evidence

当前正式调用图为：

```text
AcpBackend.execute()
  -> withDoneGuarantee(raw ACP events, result)
  -> daemon
  -> withDoneGuarantee(the already-normalized events, the same result)
  -> RuntimeEventCoordinator
```

第二层包装不产生新事件：只要 `AcpBackend` 履行现有契约，它必然观察到已有的 `done` 并原样透传。仓库中 `AcpBackend` 是 `AgentBackend` 唯一实现；独立 `with-done-guarantee.ts` 也没有第二个 backend 或领域消费者，因此额外 module 与 daemon 包装只会制造两个看似平级的终止语义 owner。

## Contract

1. `AgentBackend.execute()` 返回的事件流必须恰好包含一个终止 `done`；该归一化由 backend 实现负责，daemon 只消费统一事件。
2. `AcpBackend` 内部保留现有语义：底层已有 `done` 时不重复；失败、取消、超时或底层流未发 `done` 时，根据同一 `AgentResult` 补发一个 `done`。
3. 删除 `src/server/agent/with-done-guarantee.ts`；终止保证成为 `AcpBackend` 私有实现细节，不再作为通用扩展点导出。
4. daemon 直接消费 `backend.execute()` 返回的 `events`，不重新解释、补写或包装 runtime 事件。
5. 不改 ACP 协议映射、result/finalize、session、Invocation、socket、持久化、权限、取消、超时、UI 或数据库 schema。

## Exit Criteria

- 生产源码不存在 `withDoneGuarantee` 或 `with-done-guarantee`。
- `AcpBackend` 的成功、失败、取消与底层无 `done` 路径都继续产生且只产生一个终止事件。
- 架构守卫阻止 daemon 恢复事件流包装，并锁定终止归一化属于 `AcpBackend`。
- ACP 活动规格、CLI 架构、daemon wiki 与长期减法决策同步当前 owner。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- `pnpm exec vitest run src/__tests__/architecture/runtime-ownership.test.ts src/server/agent/acp/acpBackend.test.ts src/server/agent/acp/acpBackend.compat.test.ts src/server/agent/acp/acpBackend.hardening.test.ts --reporter=verbose`：4 files / 52 tests 通过，覆盖正常完成、启动失败、取消、idle/hard timeout、异常退出、事件/输出上限、session 与架构 owner。
- `pnpm build`：通过；仅保留既有 Turbopack NFT 动态路径 warning。
- 全量测试已执行：204 files / 1516 tests passed，2 files / 2 tests skipped，1 test failed；唯一失败为既有稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，不经过 AgentBackend/ACP 事件流。
- 独立复审：初审 Critical 0 / Important 1 / Minor 1；补强 daemon 真实事件绑定守卫、修正规格编号并增加终止位置断言后，最终复审 Critical 0 / Important 0 / Minor 0，Ready Yes。审查者在 base 与 head 均复现同一全量基线失败，并确认失败测试及其直接实现文件 blob 未变化。
