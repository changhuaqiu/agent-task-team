# Acceptance Checklist

- [ ] `WorkflowPolicy` 只暴露 `selectInitialAgent(): string | null`。
- [ ] pipeline / parallel / hub_spoke / custom 初始负责人选择语义保持。
- [ ] 无 TeamPack、无 workflow 成员和 roster 不可用时继续返回 `null`。
- [ ] `TeamModeEngine / getNextAgent / getNextRole / Strategy.canCommunicate / TaskAssignment` 死接口残留为零。
- [ ] A2A `CommunicationPolicy` 与 TeamPack communication matrix 保持正式可达。
- [ ] 显式负责人、workflow、runtime roster、fallback 的服务端优先级不变。
- [ ] 测试通过 Team Runtime / mutation 正式 interface 验证，不保留死实现自测。
- [ ] 架构守卫覆盖生产 TS/TSX，禁止宽接口回流。
- [ ] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0 / Minor 0。
