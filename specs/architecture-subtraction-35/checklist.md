# Acceptance Checklist

- [x] `TeamRuntime` 直接暴露 `initialAgentId: string | null`。
- [x] pipeline / parallel / hub_spoke / custom 与未知历史 mode 的初始选择语义保持。
- [x] 无 TeamPack 或 workflow 角色缺失时返回 `null`。
- [x] 服务端任务创建保持显式负责人、runtime 初始值、roster fallback 的顺序。
- [x] `WorkflowPolicy`、`resolveWorkflowPolicy`、`selectInitialAgent` 与 `workflowPolicy` 生产残留为零。
- [x] TeamPack schema、workflow、roster、A2A 与 Task Graph 后续推进职责未改变。
- [x] 测试通过正式 Team Runtime / mutation interface 验证，不保留死实现自测。
- [x] 架构守卫覆盖生产 TS/TSX 并禁止浅 policy 回流。
- [x] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0 / Minor 0。
