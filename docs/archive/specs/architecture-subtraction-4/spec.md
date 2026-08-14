# Architecture Subtraction — Round 4

> Status: implemented
> Date: 2026-08-15

## Goal

删除已经被 ACP 单一执行通路替代、没有生产消费者的 OpenCode HTTP Bridge 整条幽灵功能链，让 daemon、API、脚本和文档重新一致。

## Current Evidence

- 当前长期架构明确规定 Agent 执行只走 ACP，Bridge 已不再是产品执行通路；
- 生产调用方从不提供 `opencodeBridgeUrl`，store 只显式写入 `undefined`；
- `/api/opencode/status` 与 `/api/opencode/bridge/status` 没有生产消费者；
- `daemon.ts` 仍保留远程 Bridge 拓扑节点、HTTP `/run`、NDJSON 解析和错误处理分支；
- `bridge/`、四个安装/启动脚本和五个 package scripts 只服务这条旧路径。

## Contract

1. daemon 只保留 ACP 与明确仍受支持的 tmux 观察模式，不接受 `opencodeBridgeUrl`；
2. 删除 Bridge 专用 HTTP 执行、输出解析、运行时上下文枚举和拓扑节点；
3. 删除无消费者的 OpenCode 状态 API、`bridge/`、Bridge scripts 与 package scripts；
4. 当前文档只描述 ACP 单一执行事实，历史说明保留在本规格与减法决策；
5. 不删除 OpenCode 运行时本身、ACP launcher、runtime probe 或账号配置。

## Exit Criteria

- 当前运行代码、脚本和 package scripts 不再包含 Bridge 执行入口；
- `opencodeBridgeUrl`、`/api/opencode/status` 与 `/api/opencode/bridge/status` 无当前事实引用；
- 类型检查、相关测试、全量测试和生产构建完成；
- Next 构建路由表不再暴露两个 OpenCode 状态 API；
- 独立复审无 Critical/Important。
