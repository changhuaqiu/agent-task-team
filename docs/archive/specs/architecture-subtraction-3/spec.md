# Architecture Subtraction — Round 3

> Status: implemented
> Date: 2026-08-14

## Goal

把评估 Pages API 从 `/api/eval/*` 与 `/api/evaluations/*` 两套公开入口收敛到唯一规范入口 `/api/eval/*`，删除单行转发 Module 与永久兼容路径。

## Current Evidence

- 长期设计与活动评估规格均声明 `/api/eval/*` 为规范入口；
- `src/pages/api/eval/` 的 10 个平面路由和 3 个 runs 路由只是对 `/api/evaluations/*` 的转发；
- 当前 UI 同时调用两套路径，兼容层没有外部迁移期限；
- Next.js Pages Router 会把 `pages/api` 每个文件直接暴露为公开端点，因此两套文件就是两套 Interface。

## Contract

1. 所有实现放在 `src/pages/api/eval/`；
2. run 列表、详情、重放分别使用 `/api/eval/runs`、`/api/eval/runs/:id`、`/api/eval/runs/:id/replay`；
3. UI、测试和当前文档只引用 `/api/eval/*`；
4. 删除 `src/pages/api/evaluations/`，不保留转发或重定向层。

## Exit Criteria

- 全仓当前事实中没有 `/api/evaluations` 或 `pages/api/evaluations` 引用；
- 类型检查、评估相关测试与生产构建通过；
- Next 构建路由表只出现 `/api/eval/*`；
- 独立复审无 Critical/Important。
