# Acceptance Checklist

- [x] `TeamRuntime` 直接暴露 `explainHandoffBlock()`。
- [x] 无 TeamPack、普通矩阵与 default-team compatibility 语义保持。
- [x] Agent handoff 只做一次准入读取，reason code 与 detail 保持。
- [x] Human Command 继续只豁免矩阵，不豁免 roster。
- [x] `CommunicationPolicy`、`resolveCommunicationPolicy`、`communicationPolicy` 与 `explainBlock` 生产残留为零。
- [x] TeamPack schema/API/repository、prompt 接收/升级说明与 A2A durable owner 未改变。
- [x] 测试通过正式 Team Runtime / Command Guard interface 验证，不保留死实现自测。
- [x] 架构守卫覆盖生产 TS/TSX 并禁止嵌套 policy 回流。
- [x] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0 / Minor 0。
