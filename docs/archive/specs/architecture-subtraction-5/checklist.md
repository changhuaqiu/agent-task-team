# Acceptance Checklist

- [x] `backend/` 与 `mcp-server/` 不存在。
- [x] root build 不再执行 `build:mcp`，旧 daemon 独占的 `express` 直接依赖已删除。
- [x] workspace 与 lockfile 不再登记 standalone MCP package。
- [x] 当前文档不再描述独立 daemon/standalone MCP。
- [x] 内部逐 Invocation MCP 工具与授权测试 35/35 通过。
- [x] frozen-lockfile install、TypeScript、生产构建通过；全量测试 1471/1474 通过、2 跳过，仅保留既有 `human-resume` 失败。
- [x] 独立复审 Critical 0、Important 0、Minor 0，Ready to merge: YES。
