# Architecture Subtraction — Round 18

> Status: implemented
> Date: 2026-08-15

## Goal

删除 `/api/mutations` 中已经失去生产调用方、并绕过当前领域 owner 的旧 task/session/invocation 写入口，把浏览器公开写面收口到仍被真实产品链使用的命令。

## Evidence

- 全仓生产调用搜索显示 `task.delete`、`session.create`、`session.updateCliSessionId`、`session.seal`、`session.sealByTask`、`invocation.create`、`invocation.transition` 均无 `/api/mutations` 调用方。
- 这些 case 只由 `mutations.test.ts` 直接构造 request 证明自身存在。
- `task.delete` 实际不是删除而是 cancelled transition；当前 WebUI 已通过 `/api/task-graph` 的 `cancelTask` 进入 Task Graph owner。
- Session identity 与 Invocation lifecycle 已由 daemon / Invocation Pipeline 持有；浏览器只读取服务端投影，不应直接创建、绑定或终结它们。
- 当前长期文档仍声称 `/api/mutations` 公开 session/invocation 写入，且架构设计仍写“API 只暴露 invocation.transition”，与单 owner 事实冲突。

## Contract

1. `/api/mutations` 不再接受 task delete 别名或任何 session/invocation 生命周期写命令。
2. Task 取消只通过 Task Graph/Task Command owner 的规范动作进入。
3. Session create/bind/seal 只由服务端 Session identity owner 执行。
4. Invocation create/transition 只由 Invocation Pipeline、daemon 与 runtime event owner 执行。
5. 删除只验证退役公开 case 的 endpoint-local 测试；保留 repository、pipeline、socket 和 Task Graph 的真实接口测试。

## Exit Criteria

- `MutationType` 和 handler 中无 7 个退役动作。
- 生产代码无这些 mutation 调用；当前文档只描述真实 owner。
- Task Graph cancel、Session identity、Invocation lifecycle 与现有 WebUI mutation 测试通过。
- 冻结安装、类型、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- 定向测试：7 files / 146 tests 通过，覆盖 mutation、Task Graph cancel、Session repository、socket/session identity、Invocation coordinator 与架构边界。
- `pnpm run build`：通过（仅保留既有 Turbopack 动态路径追踪 warning）。
- `pnpm test`：1501 passed / 2 skipped / 1 failed；唯一失败为基线同样复现的 `src/server/autonomous-delivery/control-runtime.test.ts:131` human-resume fixture，与本轮无关。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
