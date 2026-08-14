# Architecture Subtraction — Round 20

> Status: implemented
> Date: 2026-08-15

## Goal

删除 `/api/mutations` 中无生产调用方、重复正式 Skill/MCP 执行器且绕过 invocation 授权的 `tool.invoke`，并清理 `skill-tool-router` 中只服务于旧 HTTP/mutation 设计的空映射接口。

## Evidence

- 全仓生产搜索中 `tool.invoke` 只存在于 mutation 类型、handler case 与当前事实文档；调用仅来自 endpoint 自测。
- 正式 Agent 工具链为 daemon 注册 invocation-scoped grant，`/api/acp-tools` 校验 loopback bearer，再由 `acp-skill-mcp` 调用 `skill-tool-executor`。
- 正式链拥有 permitted tool、conversation/task scope、rate limit、correlation/causation 与 proof；旧 mutation 接受浏览器 payload 并复制 task list/create/update/assign 实现。
- `HandlerMapping`、`mutationType`、`HANDLER_MAP`、`resolveHandler()` 与 `resolveHandlerByToolName()` 没有生产或测试消费者；真实调用方只需要 `isSkillTool()` 和 `getSupportedToolNames()`。

## Contract

1. `/api/mutations` 不再声明或接受 `tool.invoke`。
2. Agent 平台工具只通过 invocation-scoped Skill/MCP grant 进入 `skill-tool-executor`。
3. Runtime-native tool event 仅用于观测，不触发第二次平台工具执行。
4. `skill-tool-router` 只维护受支持工具名集合，不再声称映射 HTTP handler 或 mutation type。
5. 保留并回归 task list/create/update/assign 的正式 executor、MCP grant 与 daemon 注入链。

## Exit Criteria

- 生产代码无 `tool.invoke` mutation、`mutationType` 或无消费者 handler resolver。
- 旧 mutation 返回 Unknown mutation；正式 MCP/skill tool 测试继续通过。
- 当前事实文档只描述 invocation-scoped Skill/MCP owner，mutation 数从 12 收敛到 11。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向测试：5 files / 71 tests 通过，覆盖 mutation 拒绝、架构 owner、Skill Tool executor、ACP Skill/MCP grant 与 WorkOutcome。
- `pnpm run build`：通过；仅保留既有 Turbopack 动态路径追踪 warning。
- `pnpm test`：200 files / 1503 tests 通过，2 files / 2 tests 跳过；唯一失败为基线稳定复现的 `src/server/autonomous-delivery/control-runtime.test.ts:131` human-resume fixture，与本轮无关。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
