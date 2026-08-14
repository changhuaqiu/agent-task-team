# Architecture Subtraction — Round 5

> Status: implemented
> Date: 2026-08-15

## Goal

删除已被当前 Next daemon、控制面和逐 Invocation 授权 MCP 替代的独立 `backend/` 原型与 standalone `mcp-server/`，消除一套不可用、无项目作用域且硬编码旧团队的并行执行入口。

## Current Evidence

- `backend/server.js` 只启动旧 `opencode run --format json` 私有解析 daemon，仓库没有脚本、配置或生产调用方启动它；
- 该 daemon 使用 Socket.IO 默认 `/socket.io`，standalone MCP 却固定请求 `/api/socketio`，默认情况下两者无法互连；
- standalone MCP 默认 `localhost:4000`，而当前 Next 应用默认运行在 3000；
- `dispatch_to_agent` 硬编码 `projectId:'default'`、`allowMockRunner:true` 和已删除的 6-Agent 阵容，不经过当前项目、Team Runtime、账号、WorkContract 或逐 Invocation 授权；
- 当前受支持的 MCP 平台工具由 daemon 为每个 Invocation 创建 loopback-only、短期 bearer grant，并注入 ACP session；
- 根构建仍为无消费者 standalone MCP 多跑一次子包构建。

## Contract

1. 删除 `backend/` 三个独立 daemon/mock 原型文件；
2. 删除 `mcp-server/` standalone 包、workspace 注册和 root `build:mcp`；
3. root `build` 只构建当前 Next 应用，内部逐 Invocation MCP 能力保持不变；
4. 清理 lockfile 中只属于已删除 workspace 包的 importer/依赖；
5. 当前文档与架构图不再把 standalone MCP 或独立 daemon 当作系统组成；历史只保留在本规格与减法决策。

## Exit Criteria

- `backend/`、`mcp-server/`、`build:mcp` 与 `ATH_DAEMON_URL` 不再存在于当前代码和配置；
- 内部 `src/server/acp-tools`、逐 Invocation MCP grant 与 ACP session 注入保持可构建、可测试；
- frozen-lockfile install、类型检查、相关测试、全量测试和生产构建完成；
- 独立复审无 Critical/Important。
