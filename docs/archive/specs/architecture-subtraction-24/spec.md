# Architecture Subtraction — Round 24

> Status: implemented
> Date: 2026-08-15

## Goal

删除 ContextManager 中只有 NoOp 实现的 `MemoryHook` 专用 seam，让已经落地并被多个业务来源使用的 `ContextContributor` 成为上下文扩展的唯一入口。

## Evidence

- `MemoryHook` 只有 `noOpMemoryHook` 一个实现；生产代码没有 durable memory adapter，也没有 `write()` 调用。
- Context Planner 每次显式注入 NoOp，ContextManager 每次又把恒为空的 recall 包装成 `memory-hook` Contributor，增加构造参数和执行分支却不产生 Artifact。
- `ContextReport.recalledArtifacts` 只统计 `memory-hook` 产物，当前恒为 `0`，没有生产消费者。
- `ContextContributor` 已承担 project context、autonomous delivery 等真实来源，具备 producer、scope、visibility、freshness、required 与 failure isolation 契约；未来 memory recall 可在真实 owner 存在时实现同一 interface。
- 预先冻结 recall/write 签名没有真实 adapter 验证，反而提前承诺 scope、kind、evidence 与生命周期模型，违反一个 adapter 只是臆想 seam 的设计纪律。

## Contract

1. `ContextManager` 构造函数只接收 `ContextProviders` 与可选 `ContextManagerOptions`，不再接收专用 memory 参数。
2. 删除 `MemoryHook.ts`、NoOp 实现、内建 memory Contributor 和恒为零的 `recalledArtifacts`。
3. 外部 `ContextContributor` interface、Registry、Artifact、Snapshot、预算与 Runtime transport 不变。
4. 本轮不实现 durable memory，也不声明 recall/write 协议；未来 memory 功能必须先确定真实 owner、持久化与恢复契约，再以 `ContextContributor` 接入读取侧。
5. 历史 observation-span attributes 中的 ContextReport 是开放 JSON 对象；投影读取方不依赖 `recalledArtifacts`，因此新报告停止写入该冗余键而无需迁移。`agent_session.context_health/usage_snapshot` 仍未接线，不作为兼容理由。

## Exit Criteria

- 生产代码无 `MemoryHook`、`noOpMemoryHook`、`memory-hook` 或 `recalledArtifacts`。
- Context Planner 与全部测试使用收窄后的两参数构造契约。
- 架构守卫阻止专用 memory seam 与假指标回流。
- 活动 ContextManager 规格与长期技术文档只把 `ContextContributor` 描述为未来上下文来源的扩展入口。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向回归：21 files / 150 tests 通过。
- `pnpm build`：通过；仅保留既有 Next.js NFT tracing warning。
- 全量：204 files / 1514 tests 通过，2 files / 2 tests 跳过；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 修复复审发现的 observation-span/session 字段事实偏差并扩大 guard 到 TSX 后，最终聚焦回归 3 files / 42 tests 通过。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
