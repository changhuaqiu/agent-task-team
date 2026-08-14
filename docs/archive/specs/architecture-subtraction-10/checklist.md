# Acceptance Checklist

- [x] `/api/eval/triggers` 已删除，`POST /api/eval/runs` 是唯一提交入口。
- [x] `/api/eval/pairwise` 已删除，内部 pairwise 行为仍保留测试。
- [x] 构建路由和当前文档无两条旧公开入口。
- [x] TypeScript、评估定向测试、全量测试和生产构建已记录。
- [x] 独立复审无 Critical/Important。
