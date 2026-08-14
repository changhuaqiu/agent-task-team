# Acceptance Checklist

- [x] 八个零生产消费者 action 已从 interface 与实现删除。
- [x] 无 producer 的 `progressData` 类型与 `ProgressMessageCard` UI 尾巴已删除。
- [x] `hasHydrated` 真实水合状态与后台刷新行为不变。
- [x] 消息快照/实时对账不依赖旧聊天迁移 action。
- [x] 项目删除失败仍恢复完整本地聚合。
- [x] blocker 与 dispatch receipt 的现有展示投影保持。
- [x] localStorage version、API、Socket 与 UI 契约不变。
- [x] 架构守卫阻止死 action 回流。
- [x] 文档、TypeScript、定向测试、构建与全量测试已记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
