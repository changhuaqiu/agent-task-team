# Architecture Subtraction — Round 26

> Status: implemented
> Date: 2026-08-15

## Goal

删除验收回执模块中零生产消费者的旧 Proof Log 二次解析链，让 `GateOutcomeProcessManager` 对结构化 `record_gate_decision` outcome 的校验成为唯一真实入口；仍被正式证据契约要求的项目内 report/spec 文件校验迁入该真实 seam，避免自测继续把未接线的旁路伪装成生产安全能力。

## Evidence

生产调用图只有一条回执 admission 链：

```text
record_gate_decision outcome
  -> GateOutcomeProcessManager.deliveryReceipt()
  -> validateAcceptanceVerificationReceipt(payload.receipt, deliverySnapshot)
  -> contract agent / decision consistency checks
  -> QualityGate evidence + decision + Delivery receipt atomic commit
```

`verificationReceiptFromProof()`、`VerificationProofPolicy` 和 `failedVerificationReceipt()` 在生产代码没有任何调用方。前者只被同文件测试用于模拟从 `task_graph.gate_evidence.accepted` Proof Event 再解析 `delivery_evidence`、校验 verifier allowlist 和本地 report/spec 文件；后者连测试消费者也没有。当前 Delivery Bundle 从 Delivery repository receipt 投影读取结果，不从 Proof Log 恢复验收事实。正式 Agent 工具契约仍要求真实 report/spec 引用，因此文件存在性与 junction 越界检查不能随旧入口消失，必须由真实 validator 执行。当前没有可信 provider/attachment receipt 模型，HTTP(S) 字符串不能证明远端验收物存在，必须拒绝。

旧链还独占 `ProofEventRow`、`node:fs`、`node:path` 与 JSON metadata 解析 helper。保留它会制造三项错误认知：

- Proof Log 可以重新授予验收结论；
- 当前生产会执行独立 verifier allowlist；
- 旧 Proof-derived 旁路才是本地 report/spec 校验的正式入口。

verifier 身份由已签发 Work Contract 的 agent 约束；本地 artifact 引用则在 receipt validator 内以冻结 Delivery project path 校验。Proof Log 不参与重新授权。

## Contract

1. 删除 `verificationReceiptFromProof()`、`failedVerificationReceipt()`、`VerificationProofPolicy` 及其只服务旧 Proof 解析的 imports/helpers。
2. 删除只验证旧 Proof Log 解析、allowlist 和本地 junction 检查的自测。
3. 保留 `validateAcceptanceVerificationReceipt()` 与其真实结构、criteria、Web E2E 约束，并让它在唯一 live seam 只接受冻结 Delivery project path 内真实存在的 report/spec 普通文件；拒绝缺失、junction 越界及未绑定可信来源的 HTTP(S) 引用。
4. 保留 QualityGate outcome manager 的 project/agent/target、decision 一致性与事务原子提交。
5. 不改变数据库 schema、Proof Log 格式、Outcome contract、Delivery receipt 或 UI。

## Exit Criteria

- 生产与测试源码无旧 proof-derived receipt helper、policy 和专属 reason code。
- 回执 validator 只保留 QualityGate owner 真实消费的结构校验与项目内 artifact 校验。
- 架构守卫锁定唯一生产调用点，避免旧 proof-derived admission 回流。
- 长期 Platform Harness 文档明确 Proof Log 只作审计/投影，不重新授予 Gate 结论。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 初始定向回归：3 files / 23 tests 通过；两轮复审修复后，最终定向回归 3 files / 25 tests 通过，覆盖真实 receipt validator、项目内 artifact 校验、未受信远端引用拒绝、QualityGate outcome 正反路径原子推进与架构守卫。
- `pnpm build`：通过；仅保留既有 Next.js NFT tracing warning。
- 全量：204 files / 1513 tests 通过，2 files / 2 tests 跳过；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：最终 Critical 0 / Important 0 / Minor 0，Ready: Yes；确认远端引用绕过已关闭、项目内真实文件与 junction 边界有效、唯一 manager admission seam 与长期文档一致。
