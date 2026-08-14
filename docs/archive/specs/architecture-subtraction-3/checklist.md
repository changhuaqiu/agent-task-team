# Acceptance Checklist

- [x] `src/pages/api/evaluations/` 不存在。
- [x] 当前运行代码、测试和现行接口说明不再引用 `/api/evaluations`；只在本规格与减法决策中保留删除记录。
- [x] 评估 API 与 UI 测试 15/15 通过，其中交互测试精确覆盖 submit 与 replay 的规范 URL 和请求体。
- [x] TypeScript 与生产构建通过。
- [x] 构建路由表只暴露 `/api/eval/*`。
- [x] 全量测试 1468/1472 通过；既有 `control-runtime` human-resume 仍失败，另一次 ACP 子进程超时在隔离重跑时 17/17 通过，确认不是本轮回归。
- [x] 独立复审无 Critical/Important，结论 Ready to merge。
