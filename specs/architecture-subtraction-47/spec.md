# Architecture Subtraction — Round 47

> Status: active
> Date: 2026-08-15

## Goal

删除十个全仓没有生产消费者的公共类型/函数，并纠正文档中从未接入生产链的 thinking 采集开关，避免测试专用查询、旧静态角色概念和虚假配置继续扩大正式 interface。

## Evidence

- `WorkflowStepStatus`、`TeamRole`、`A2APass`、`PassBlockPhase`、`getTaskCounter()`、`takeInFlightDispatch()` 在生产、测试、脚本和文档中均无调用方；其中 `TeamRole` 还保留已经废弃的静态 `dev/ux/qa/arch` 分类。
- 删除 `takeInFlightDispatch()` 后可见整条 `inFlightDispatches` 分支只有 set/delete、没有任何 read；`dispatch.receipt` 清理不会影响 pending queue、active run 或正式 receipt projection。
- `nextTaskStatuses()` 只有自身单元测试消费；正式代码通过 `canTransitionTask()` 与 `nextDirectTaskStatuses()` 使用同一私有状态图。
- `listCredentialIds()` 与 `deleteRoleCard()` 只有 repository 自测消费；账户执行只需要单项 credential 的保存、删除和 readiness，RoleCard 正式写/读面只有 upsert/load。
- `isThinkingCaptureEnabled()` 只有自测消费。真实 runtime 链会无条件把 runtime 主动暴露的 thinking summary 投影到 observation payload，因此 `ATH_OBSERVABILITY_CAPTURE_THINKING=false` 从未关闭任何生产采集。

## Contract

1. 删除上述十个公共符号及只为它们存在的自测断言，同时删除不可观察的 in-flight Map、类型、set 与 receipt cleanup。
2. 保留 canonical Task 状态图、浏览器直接动作策略、credential 单项生命周期、RoleCard upsert/load、ACP thinking event 与 observation payload 投影。
3. 文档只陈述当前事实：runtime 主动暴露的 thinking summary 会按现有脱敏与容量限制采集；当前没有关闭开关，隐藏 chain-of-thought 永不采集。
4. 架构守卫扫描全部生产 TS/TSX，阻止这些旧符号和环境变量重新进入正式代码。

## Exit Criteria

- 十个公共符号、in-flight 假状态分支和 `ATH_OBSERVABILITY_CAPTURE_THINKING` 生产/当前事实残留为零。
- Task、Store、Credential、RoleCard、A2A 与 Observability 正式链回归通过。
- install、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：8 files / 67 tests 通过。
- 实现后定向：9 files / 66 tests 通过，覆盖 Task 状态、Credential、RoleCard、Observability payload/API、Runtime Event projection 与架构守卫。
- 完整移除 in-flight 假状态后定向：12 files / 93 tests 通过，补充 Store session scope、project-view isolation 与 dispatch receipt 投影。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 最终非并行全量：205 files / 1508 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：待回填。
