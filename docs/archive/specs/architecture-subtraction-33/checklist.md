# Acceptance Checklist

- [x] `WorkflowPolicy` 只暴露 `selectInitialAgent(): string | null`。
- [x] pipeline / parallel / hub_spoke / custom 初始负责人选择语义保持。
- [x] 无 TeamPack、无 workflow 成员和 roster 不可用时继续返回 `null`。
- [x] `TeamModeEngine / getNextAgent / getNextRole / Strategy.canCommunicate` 与 Team Runtime `TaskAssignment` 伪结果接口残留为零。
- [x] A2A `CommunicationPolicy` 与 TeamPack communication matrix 保持正式可达。
- [x] 显式负责人、workflow、runtime roster 的服务端优先级不变；零调用者 fallback 参数已删除。
- [x] 测试通过 Team Runtime / mutation 正式 interface 验证，不保留死实现自测。
- [x] 架构守卫覆盖生产 TS/TSX，禁止宽接口回流。
- [x] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
