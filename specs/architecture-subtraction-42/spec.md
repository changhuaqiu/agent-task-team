# Architecture Subtraction — Round 42

> Status: active
> Date: 2026-08-15

## Goal

删除 Message、Observation Span、Span Payload 与 Proof Log repository 中 6 个只有自身实现/自测消费者的标量读方法，让测试与生产调用方共用真正的聚合/投影 interface。

## Evidence

- `messageRepo.getByTask`、`getByAgent`、`countByConversation` 各只有一个 repository 自测，没有 API、daemon、Context、Store、UI 或脚本消费者。
- `observationSpanRepo.listByTrace` 只有 repository 自测；正式 `ProjectObservationProjection` 使用 `listByConversation`，API 再按 trace/invocation/agent 过滤。
- `spanPayloadRepo.get` 只被 `put` 用于写后回读，另有一个自测；正式 scoped endpoint 使用 `listBySpan`。
- `proofLogRepo.getById` 只被 `append` 写后回读和一个自测使用；正式读面是 envelope、conversation 和 domain-key `findByType`。

## Contract

1. 删除 Message repository 的 `getByTask`、`getByAgent`、`countByConversation`。
2. 删除 Observation Span 的 `listByTrace`、Span Payload 的 `get`、Proof Log 的 `getById`。
3. `spanPayloadRepo.put` 直接返回已规范化并持久化的 row；`proofLogRepo.append` 用本次写入的完整 row 投影 Team Log，不增加第二次 SELECT。
4. 删除只验证死 interface 的测试；保留 start/finish、redaction/truncation、Proof projection 与正式查询的可观测结果断言。
5. 架构守卫阻止六个旧 method 在对应 repository 或 qualified owner 上回流。

## Exit Criteria

- 六个旧方法生产零残留，防回流守卫通过。
- Message 正式 history/context 读取、Observability projection/payload endpoint、Proof query/projection 保持。
- 冻结安装、TypeScript、定向、build、全量与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：7 files / 107 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- 实现后定向：7 files / 105 tests 通过，覆盖 Message/Observation/Payload/Proof repositories、scoped payload endpoint、Project Observation Projection 与架构守卫。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 全量测试执行完成：205 files / 1514 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes；独立复跑 7 files / 105 tests 与 `tsc` 通过，status 与 base→HEAD diff-check 清洁。
