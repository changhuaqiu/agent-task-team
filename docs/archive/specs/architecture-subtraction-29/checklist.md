# Acceptance Checklist

- [x] `with-done-guarantee.ts` 与导出的 `withDoneGuarantee` 不存在。
- [x] daemon 直接消费 `AgentRun.events`，不二次包装或补写终止事件。
- [x] `AcpBackend` 对每条完成/失败/取消路径只发一个 `done`。
- [x] result、session、取消、超时、权限、Invocation 与持久化行为未改变。
- [x] 架构守卫阻止恢复第二个终止归一化 owner。
- [x] 文档、TypeScript、定向测试与构建通过；全量测试结果被精确记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
