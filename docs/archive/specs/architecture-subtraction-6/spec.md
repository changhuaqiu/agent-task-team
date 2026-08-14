# Architecture Subtraction — Round 6

> Status: implemented
> Date: 2026-08-15

## Goal

删除两个没有真实调用方的 Pages API transport，同时保留其仍在使用的深层领域能力与前端消息展示。

## Evidence

- `/api/tokens/summary` 全仓没有 fetch、脚本、测试或文档消费者；聊天中的 `TokenBadge` 直接使用消息段上的 `tokenUsage`，不依赖该路由。
- `/api/engineering-collaboration` 没有调用方，生产环境默认返回 404，且唯一环境开关只存在于 handler 内。
- 工程协作正式入口已经是 `skill-tool-executor` 对 `EngineeringCollaborationService` 的直接受控调用；卡片投影、GitHub 校验与领域服务仍被生产代码使用。
- `/api/agent-outcomes` 仍是文档明确保留的非 ACP 提交通路，本轮不删除。

## Contract

1. 删除 `tokens/summary` 与 `engineering-collaboration` 两个无消费者 API route。
2. 保留 `TokenBadge`、工程协作领域服务、Skill 工具、GitHub verifier、消息卡片与其测试。
3. 不修改 AgentOutcome、逐 Invocation MCP 或 WorkContract 契约。
4. 当前事实文档记录删除边界；历史仅保留在本规格与架构减法决策中。

## Exit Criteria

- 两个路由及测试专用环境开关不再存在。
- 保留模块的调用关系、类型检查、相关测试和生产构建通过。
- 独立复审无 Critical/Important。
