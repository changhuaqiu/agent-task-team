# Architecture Subtraction

> Status: completed
> Date: 2026-08-13

## Goal

降低仓库和系统的维护面：删除未提交实验、被版本控制的依赖/构建产物、已合入的历史 worktree，以及经调用关系证明无效的浅 Module。

## Invariants

1. 不删除未合入提交或来源不明的改动。
2. 依赖由 lockfile 和包管理器恢复，不作为源码提交。
3. 构建产物由源码生成，不作为当前仓库事实源。
4. 代码 Module 只有在无生产引用、无动态注册入口且测试证明删除安全时才移除。
5. 删除后全仓核心符号搜索不得留下未说明的当前事实引用。

## Exit Criteria

- 所有 worktree 无未提交内容；
- `mcp-server/node_modules` 与 `mcp-server/dist` 不再被 Git 跟踪；
- 已合入 main 的历史 worktree 被清理，未合入分支保留；
- 类型检查、相关测试、MCP 子包构建和生产构建通过；
- 删除范围和保留边界有可复核清单。
