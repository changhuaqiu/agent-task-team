# Acceptance Checklist

- [x] `CommunicationPolicy` 只暴露 `explainBlock(): string | undefined`。
- [x] Agent handoff 对矩阵只做一次准入判断，拒绝 reason code 与用户可读说明不变。
- [x] 无 TeamPack、default-team compatibility、普通 TeamPack matrix 语义保持。
- [x] `getEscalationTarget`、escalation resolver、`communicationPolicy.canSend` 生产残留为零。
- [x] Team Runtime barrel 不再导出 `resolveCommunicationPolicy` 或 `CommunicationPolicy`。
- [x] TeamPack `canReceiveFrom / canEscalateTo` 数据、API 与 prompt 注入保持正式可达。
- [x] Human Command 继续只豁免 agent-to-agent matrix，不豁免 roster。
- [x] 测试通过正式 Team Runtime / A2A Command Guard interface 验证，不保留死实现自测。
- [x] 架构守卫覆盖生产 TS/TSX 并禁止浅接口回流。
- [x] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
