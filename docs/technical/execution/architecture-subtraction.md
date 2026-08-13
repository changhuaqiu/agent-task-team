# Architecture Subtraction

> Status: implemented
> Date: 2026-08-13

## Decision

仓库只保留正在产生运行价值的 Module、源文件和事实文档。依赖与构建产物由 lockfile、源码和构建命令恢复；未挂载 UI、只被自身测试调用的未来机制、以及已被当前事实 owner 替代的兼容 repository 不再作为“可能以后会用”的平行架构保留。

## Deleted Surfaces

- 七个未挂载 UI：`ChatHubView`、`WorkspaceRootRow`、`RoleCardBindingSelector`、`AgentTaskGroup`、`SummaryBar`、`FormField`、`QualityView`。
- 四个只有自身测试调用的孤立 Module：native child activity、native tool classifier、autonomous review receipt parser、evaluation runtime isolation helper。
- 两个只有测试调用且已被当前 owner 替代的 repository：`dispatchRepo`、`eventRepo`。
- 一个只有自身测试调用的旧 message router。
- `mcp-server/node_modules` 与 `mcp-server/dist` 共 3,972 个被错误跟踪的依赖/生成文件。

## Retained Boundaries

- Next.js 路由保留，即使没有静态 import；文件系统就是其运行入口。
- ACP mock 与测试 fixtures/helpers 保留；它们有明确测试 Adapter 职责。
- 未合入 `main` 的分支和 worktree 保留，不以“看起来旧”作为删除依据。
- 数据库中的历史表不在本轮破坏性删除；本轮只删除无生产消费者的访问 Module。

## Prevention

`.gitignore` 现在忽略任意层级 `node_modules/` 与 `dist/`。Git/Worktree 规范明确子包同样不得提交依赖或构建产物。
根 `pnpm build` 会先执行 `build:mcp`，再执行 Next.js 生产构建，保证 fresh clone 不依赖被删除的预编译 MCP 文件。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过，依赖可由 lockfile 与本地 store 恢复。
- `pnpm --filter @agent-task-hub/mcp-server build`：通过，`dist` 可由源码重建且保持 ignored。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 相关架构、routing、repository 测试：88/88 通过。
- `pnpm build`：通过。
- 全量测试：1496/1498 通过；ACP subprocess 超时用例单独重跑通过，`control-runtime` 的 human-resume 场景仍稳定复现基线失败，未被本轮改动触及。

## Filesystem Cleanup Note

历史 worktree 的 Git 注册与已合入分支已清理。Windows 拒绝递归删除部分已注销目录中的锁定或超长路径依赖文件，因此这些目录不再是 Git worktree、也不包含待保留提交，但仍可能存在纯磁盘残留；不得把它们误认为活动开发分支。
