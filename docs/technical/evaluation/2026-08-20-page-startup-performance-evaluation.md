# Page Startup Performance Evaluation

- Change ID: `page-startup-performance-2026-08-20`
- Evaluation level: C
- Status: accepted
- Code/spec revision: baseline `65326f8`; candidate `codex/page-performance` working tree
- Evaluator/benchmark revision: `docs/technical/evaluation/data/page-startup-performance-2026-08-20.json`

## Why

真实 3000 页面打开和交付切换存在明显等待与卡顿。冻结快照只有 7 个交付和 14 个任务，但包含 2,054 条消息，基线主状态还携带
50 条完整 Invocation，开发态首屏脚本合计 27,101,450 bytes。若继续随历史线性增长，JSON 传输/解析、React 时间线渲染和未使用模块
执行会共同放大。

## What changed

候选实现将按以下边界收敛，完成后回写最终 revision：

1. 主状态响应删除首屏未消费的 recent Invocation，消息按交付只带最近 200 条；当前交付可交互后后台对账消息快照。
2. 时间线首次渲染最近 120 个聚合项，用户显式加载更早内容。
3. 设置、任务详情、成员/创建弹窗、评估与调试模块按用户意图加载。
4. 关系图只有在面板、任务 tab 和关系图视图同时打开时才请求。

不改变消息、Invocation、Task 或 Delivery 的服务端事实源，不引入新依赖。

## Industry evidence

本仓库 Next.js 16.2.4 指南 `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` 要求用动态 import 推迟非首屏
Client Component；`production-checklist.md` 要求缩小 `use client` 边界、避免网络瀑布并按需加载；`package-bundling.md` 建议先量化
bundle，再拆分重型客户端工作。这里迁移的是这些抽象原则，不把开发态绝对字节数当作生产 Core Web Vitals。

## Method

- 数据集：从用户当前 `ATH_DATA_DIR` 通过 SQLite backup API 创建的一致性快照，7 个交付、14 个任务、2,054 条消息、50 条 recent Invocation；基线和候选读取同一快照。
- 环境：Windows / Next.js 16.2.4 / `next dev --webpack` / localhost:3000，同一机器同一数据目录。
- 状态指标：连续 5 次 `/api/state` 的响应 bytes、平均和最大耗时。
- 脚本指标：根 HTML 直接引用的初始 `<script src>` 响应 bytes 合计；开发态仅用于同环境前后比较。
- 请求指标：默认任务视图首次渲染时 `/api/task-graph` 调用次数。
- 原始 5 次样本、每个 script URL/bytes 与测量步骤记录在 JSON 数据文件；测试前各预热一次 `/` 与 `/api/state`。
- 成功阈值：`/api/state` bytes 至少下降 50%；业务页初始 `app/page.js` bytes 至少下降 15%；默认视图 task-graph 请求为 0；相关行为测试通过。

## Baseline vs candidate

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| `/api/state` bytes | 3,249,278 | 1,130,900 (-65.2%) |
| `/api/state` warm avg (5) | 189.9 ms | 64.7 ms (-66.0%) |
| initial script bytes | 27,101,450 | 20,606,629 (-24.0%) |
| initial `app/page.js` bytes | 14,512,729 | 8,015,775 (-44.8%) |
| bootstrap messages | 2,054 | 1,289 |
| bootstrap recent invocations | 50 | 0 |
| default `/api/task-graph` requests | 1 | 0 |

## Decision

Accept. All three quantitative gates passed on the same data directory and development runtime: state bytes fell more than the 50% gate,
the initial page script fell more than the 15% gate, and the default task view no longer requests the relationship graph. The state contract test
also proves each conversation is capped independently and retains the newest records.

Production Core Web Vitals and low-end-device main-thread time remain unmeasured; this record therefore claims a smaller startup payload,
smaller initial development bundle and less eager work, not a production LCP/INP guarantee.
