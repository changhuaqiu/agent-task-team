# Acceptance Checklist

- [x] `/api/phases` 是唯一 phase 持久化 transport。
- [x] Store 的 phase 写入不再经过通用 mutation。
- [x] `/api/mutations` 拒绝两个旧 phase action。
- [x] Phase 本地 optimistic 行为与数据库模型未改变。
- [x] 当前事实文档和架构图只描述唯一 owner。
- [x] TypeScript、定向测试、构建和全量测试已记录。
- [x] 独立复审无 Critical/Important。
