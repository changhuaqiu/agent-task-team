# Acceptance Checklist

- [x] daemon 直接把单一 ExecOptions 交给 AcpBackend。
- [x] session load、system prompt、cwd/env 与 timeout 行为保持。
- [x] 手工 CapabilitySet、恒等 router 与合成测试已删除。
- [x] EngineId 仍是三种受支持 runtime 的唯一类型。
- [x] 当前事实文档不再声称 resume 被丢弃或 session/load 未接线。
- [x] TypeScript、定向测试、构建和全量测试已记录。
- [x] 独立复审无 Critical/Important。
