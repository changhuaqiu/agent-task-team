# Architecture Subtraction — Round 50

> Status: active
> Date: 2026-08-15

## Goal

把只供测试使用的 ACP/GitHub fixture 从生产 `src/server` 树迁入统一 test-helper 区，并收回只在定义文件内部消费的常量、错误类、Store buffer helper 与渲染 helper，确保生产模块树和公共 interface 只表达正式能力。

## Evidence

- 基于 TypeScript import 图扫描，排除 Next entry 与测试文件后，`src/server/agent/acp/mockAcpAgent.ts` 和 `src/server/github-issue-hook/test-fixtures.ts` 是 `src/server` 中仅有的两个零生产入边模块；所有消费者都是自动化测试。
- ACP mock 必须保留 importable 与 spawnable 两种测试 Adapter 能力，但不属于 `AcpBackend` 生产实现；GitHub payload/config factory 同样只构造测试输入。
- Daemon Store 的浏览器 node-id、buffer schedule/flush/append helper，Token summary 子卡和自主交付 Context Contributor class 仅在定义文件内部使用。
- Inbox/runtime event 常量、Webhook 上限、Evaluation 默认 ID、错误消息表、Project Context digest，以及 Autonomous Delivery / Execution Envelope / Git verifier 的错误类均没有模块外消费者；正式调用方只消费 owner function/class 的结果与稳定 reason code。

## Contract

1. 将 ACP mock agent 与其测试迁到 `src/test-helpers/acp/`，所有 AcpBackend subprocess 测试从该路径启动，不改变 scripted scenario 或 stdio 行为。
2. 将 GitHub Issue config/payload fixture 迁到 `src/test-helpers/github-issue-hook.ts`，route/compiler/ingress 测试共用该唯一测试 seam。
3. 收回二十三个同文件-only export；保留实现、错误类型、reason code、默认值与调用顺序，不新增替代 wrapper。
4. 正式 `src/server` 不再包含测试 double/fixture；`AcpBackend`、GitHub ingress、Daemon Store、Context contributor、repository lifecycle 和 UI TokenBadge 行为保持。
5. 架构守卫锁定旧生产 fixture 路径不存在、测试 helper 无生产 import，并用 AST 锁定内部符号不重新进入公共 surface。

## Exit Criteria

- `src/server` 中零生产入边的测试 fixture 清零；测试 helper 位于统一测试目录。
- 二十三个实现细节不再导出，正式 interface 与运行行为保持。
- install、定向测试、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile` 通过，安装 719 个冻结依赖包。
- 实现前定向回归：8 files / 84 tests 通过。
- 实现后影响面回归：16 files / 195 tests 通过；最终架构守卫独立复跑 1 file / 34 tests 通过。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm build` 通过；仅保留 `next.config.ts` 既有整项目 NFT tracing warning。实际 `.next/server/**/*.js` 中没有 mock agent、测试 secret 或 test-helper 路径。
- 非并行全量执行完成：205 files / 1510 tests 通过，2 files / 2 tests 跳过；唯一失败仍为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，该文件不在本轮 diff。
- 独立复审待回填。
