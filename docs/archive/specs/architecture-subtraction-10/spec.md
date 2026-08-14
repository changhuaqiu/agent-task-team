# Architecture Subtraction — Round 10

> Status: implemented
> Date: 2026-08-15

## Goal

删除评估模块中重复或永远不可用的公开 HTTP interface，使构建路由只暴露真实可调用能力。

## Evidence

- `/api/eval/triggers` 没有生产、UI、脚本或测试消费者，只把 POST 原样转发到 `/api/eval/runs`。
- `/api/eval/pairwise` 没有消费者，所有请求固定返回 409；内部 pairwise 算法不依赖该 route。
- 当前 UI 已直接通过 `POST /api/eval/runs` 提交评估。
- 活动规格明确要求统一身份与可信隔离完成后才开放 pairwise；当前固定失败 route 不提供能力。

## Contract

1. 删除 `/api/eval/triggers`，以 `POST /api/eval/runs` 作为唯一手动提交入口。
2. 删除固定失败的 `/api/eval/pairwise`；保留内部排序、裁决算法与未来开放条件。
3. 删除只证明固定 409 的自嗨 route 测试，保留内部 pairwise 行为测试。
4. 同步评估长期文档和活动规格，不宣称尚未开放的公开能力。

## Exit Criteria

- 构建路由不再包含 `triggers` 或 `pairwise`。
- 当前文档与活动规格只声明真实公开 interface。
- 类型、评估定向测试、全量测试和生产构建完成。
- 独立复审无 Critical/Important。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- 评估/数据库/UI 定向测试：58/58 通过。
- `pnpm build`：通过，构建 route 清单不再包含 `triggers` 或 `pairwise`。
- 全量测试：1470 通过、2 跳过、1 个与基线一致的既有 `control-runtime` 人工恢复用例失败；净减少的 1 条是固定断言 409 的旧 route 测试。
- 独立复审：Critical 0、Important 0、Minor 0，Ready。
