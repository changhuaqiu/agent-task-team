# Acceptance Checklist

- [x] `/api/mutations` 拒绝 `tool.invoke`。
- [x] Agent 平台工具只通过 invocation-scoped Skill/MCP 执行。
- [x] 正式 executor 的授权、scope、限流与 proof 保持。
- [x] Router 不再保留 HTTP/mutation 映射假接口。
- [x] 当前事实文档与架构图只描述真实 owner。
- [x] TypeScript、定向测试、构建和全量测试已记录。
- [x] 独立复审无 Critical/Important。
