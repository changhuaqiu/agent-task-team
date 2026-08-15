# Architecture Subtraction — Round 51

> Status: active
> Date: 2026-08-15

## Goal

删除严格 TypeScript 未使用检查确认的生产残留：不可达 daemon helper、无效 UI props、无消费 interface，以及只被 import/参数占位但从未读取的依赖；不改变正式运行路径和用户行为。

## Evidence

- `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters` 在排除测试文件后精确报告 21 个生产未使用声明。
- `publishTerminalOutput`、`runtimeStartedAtMs`、daemon 的 `autonomousDeliveryRepo` import 与 `UpdateInput` 没有任何消费者。
- `RoleCardListPage.onClose`、`AgentBindingPanel.agentName`、`buildRoleLayer.agent` 从未参与渲染或决策；调用方只是在传递无效数据。
- 其余命中是 import、回调参数或内部 method 参数残留；删除后正式 owner、返回值、事件、持久化与 UI 呈现保持不变。

## Contract

1. 删除不可达 helper、变量、interface、import 与无效 props，不新增替代 wrapper。
2. 对正式函数签名中无语义的参数同步收窄调用方；框架固定签名仅使用 `_` 前缀明确忽略。
3. Durable Effect 失败路径移除未读取的 registration 参数，保留重试、dead-letter、fencing 与 fact 发布语义。
4. 架构守卫锁定关键死 helper/interface/prop 不回流，并把生产严格未使用检查纳入验证。
5. 相关长期架构文档记录生产代码必须保持严格未使用声明清零。

## Exit Criteria

- 生产源码的 TS6133/TS6196 命中从 21 降为 0。
- 定向测试、常规 tsc、build、全量测试与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile` 通过，安装 719 个冻结依赖包。
- 实现前严格未使用检查：生产源码 21 个 TS6133/TS6196 命中。
- 实现后同一严格检查仅剩 2 个既有测试文件诊断；过滤 `src/__tests__/` 与 `*.test.*` 后，生产源码 0 个 TS6133/TS6196 命中。
- 定向回归：实现前 7 files / 110 tests，通过；实现后 7 files / 111 tests，通过。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm build` 通过；仅保留既有 whole-project NFT tracing warning。
- 非并行全量执行完成：205 files / 1511 tests 通过，2 files / 2 tests 跳过；唯一失败仍为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，该文件不在本轮 diff。
- 首轮独立复审：Critical 0 / Important 1 / Minor 0；代码与调用图无回归，发现 canonical tasks/checklist 未同步已完成事实。
- 修复后独立复审待回填。
