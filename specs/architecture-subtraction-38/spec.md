# Architecture Subtraction — Round 38

> Status: active
> Date: 2026-08-15

## Goal

删除服务端 `CliEngine` 改名别名，让 Agent 执行引擎身份只由 `RuntimeCliEngine` 表达。daemon、Invocation Pipeline、浏览器 Store 与 runtime detection transport 直接复用同一类型；保留 `DetectedRuntime` 的真实可用性投影，不改变任何运行时字符串、socket payload、持久化数据或迁移规则。

## Evidence

- `src/server/types.ts` 的 `CliEngine` 仅为 `RuntimeCliEngine` 的逐字类型别名，没有新增成员、校验、迁移或 adapter。
- daemon、Invocation Pipeline、Agent Store 与 Daemon Store 使用同一三个 engine 字符串；不存在服务端专属第四种 engine。
- `TaskHubStore` 继续二次重导出 `CliEngine`，但仓库内没有从该 barrel 导入该类型的消费者。
- `DetectedRuntime` 是真实 daemon→browser transport shape，仍被任务详情的运行按钮和 socket list/update 消费，不能删除。
- `runtime-selection.ts` 的显式 fail-closed 与历史 `gemini` 读取迁移依赖 `RuntimeCliEngine`，本轮不改变其行为。

## Contract

1. `RuntimeCliEngine = 'opencode' | 'claude' | 'codex'` 是生产 Agent engine 的唯一类型身份。
2. `DetectedRuntime.engine`、daemon 执行参数、Invocation trigger 与浏览器 Agent projection 直接使用 `RuntimeCliEngine`。
3. 删除 `CliEngine` 声明、所有 import 和 `TaskHubStore` 二次重导出，不增加新的同义别名。
4. `DetectedRuntime`、`daemonRuntimes`、`runtimes:list`、`runtimes:update` 与任务详情可用性检查保持不变。
5. Catalog launcher、engine↔runtimeId 映射、账号 provider 映射、历史 `gemini` 迁移、持久化 JSON 与 socket wire shape 保持不变。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在独立 `CliEngine` 类型。
- daemon、Store、Invocation Pipeline 与 runtime detection 统一消费 `RuntimeCliEngine`。
- `DetectedRuntime` 的真实 list/update/UI 消费链测试保持通过。
- 架构守卫禁止 `CliEngine` 别名和重导出回流，并继续锁定三种 ACP engine。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过，719 packages，lockfile 未变。
- 基线 `pnpm exec vitest run src/server/runtime-selection.test.ts src/__tests__/architecture/runtime-ownership.test.ts src/__tests__/task-hub/TaskDetailPanel.runtime-profile.test.tsx src/__tests__/server/invocation-pipeline/context-planner.test.ts src/__tests__/lib/team-runtime/team-runtime.test.ts --reporter=dot`：5 files / 73 tests 通过。
- 实现后同一定向命令：5 files / 73 tests 通过；架构守卫新增生产 `CliEngine` 零残留与 TaskHub 不重导出断言。
- `pnpm exec tsc --noEmit`：通过。
- 构建、全量测试与独立复审待完成。
