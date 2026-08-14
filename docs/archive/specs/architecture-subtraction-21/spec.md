# Architecture Subtraction — Round 21

> Status: implemented
> Date: 2026-08-15

## Goal

删除没有产品入口、没有运行时消费者且依赖不可验证自由文本身份的人工 annotation 公开面，保留历史 SQLite 数据和 retention 兼容。

## Evidence

- `/api/eval/annotations` 没有 UI、脚本或服务端生产调用方，唯一消费者是 endpoint 自测。
- `evaluationLab.annotate()`、`agreement()` 与 `weightedKappa()` 只服务该 route 和同模块自测，不参与 Judge、实验、审核队列或 proposal 发布门。
- 当前 route 将请求体 `reviewerName` 归一化为 `local-reviewer:*`；平台没有可信身份事实源，这种数据不能证明双人独立校准。
- `eval_annotation` 历史表仍被 retention 用于保护有关联的 run，不应在本轮破坏性迁移或删除。

## Contract

1. 当前 Pages API 不再注册 `/api/eval/annotations`。
2. `evaluationLab` 不再暴露 annotation 写入、一致性统计或仅为其存在的 weighted-kappa helper。
3. `eval_annotation` schema 与 retention 引用继续保留，历史行仍可保护其来源 run。
4. 数据集、实验、Judge 分歧审核、proposal 与 evaluation runner 行为不变。
5. 人工校准只有在平台提供可验证操作者身份、独立审核流程和已挂载 UI 后才能重新引入；不得恢复自由文本 reviewer 身份。

## Exit Criteria

- 生产代码中没有 annotation route、writer、agreement 统计或伪审核者身份逻辑。
- 当前事实文档和活动评估规格不再宣称人工 annotation 已实现。
- migration/历史表与 retention 兼容继续存在并有测试覆盖。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向回归：8 files / 121 tests 通过，覆盖 API/数据集/实验、历史 annotation migration、aggregate cleanup、retention、恢复与平台评估工作区。
- `pnpm run build`：通过；构建路由表确认 annotation route 消失，其余评估 routes 保留；仅有既有 Turbopack NFT tracing warning。
- `pnpm test -- --maxWorkers=1`：200 files / 1502 tests 通过，2 files / 2 tests 跳过；唯一失败为基线稳定复现的 `src/server/autonomous-delivery/control-runtime.test.ts:131` human-resume fixture，与本轮无关。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
