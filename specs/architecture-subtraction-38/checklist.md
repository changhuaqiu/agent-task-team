# Acceptance Checklist

- [x] `RuntimeCliEngine` 是生产 Agent engine 的唯一类型身份。
- [x] `CliEngine` 声明、imports 与二次重导出生产残留为零。
- [x] daemon、Invocation Pipeline、Agent Store 与 Daemon Store 直接消费共享类型。
- [x] `DetectedRuntime` list/update、Store 投影与任务详情可用性判断保持。
- [x] Catalog、runtimeId/provider 映射、历史迁移、持久化与 socket 数据未改变。
- [x] 架构守卫阻止 engine 同义别名回流。
- [x] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0。
