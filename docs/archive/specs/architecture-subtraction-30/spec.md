# Architecture Subtraction — Round 30

> Status: implemented
> Date: 2026-08-15

## Goal

删除浏览器 Store 中平行的账号→engine 解析接口和 provider 映射重导出，让任务详情、账号面板与正式执行统一消费 Team Runtime Contract 的 `RuntimeAgentProfile`。

## Evidence

当前浏览器存在两条解析链：

```text
正式链
TaskHubState.getAgentRuntimeProfile(agentId)
  -> resolveRuntimeAgentProfile(TeamRuntime, accounts)
  -> readiness + provider mapping + legacy engine normalization
  -> dispatch / simulate execution / Agent UI

平行链
TaskDetailPanel
  -> resolveAgentEngine(agent, accounts)
  -> providerToEngine(provider)
  -> providerToExecutionEngine(provider)
```

`resolveAgentEngine()` 只被任务详情和自身测试消费，复制了正式 resolver 的账号顺序、readiness、provider mapping 与 legacy fallback。`providerToEngine()` 是一行转发，`PROVIDER_TO_ENGINE` 又经 `account-auth → agentStore → taskHubStore` 连续重导出，生产消费者为零。任务详情在平行解析返回空时还使用 `agent.cliEngine ?? 'opencode'`，会把“没有 Runtime Profile”误显示为可运行 OpenCode，而正式派发随后会因 `no_runtime_profile` 拒绝。

## Contract

1. `src/lib/team-runtime/resolveRuntimeAgentProfile.ts` 是浏览器成员执行资料的唯一 resolver；provider mapping 与 readiness 继续归 `src/lib/account-auth.ts`。
2. `TaskDetailPanel` 通过 Store 的 `getAgentRuntimeProfile(agent.id)` 获取 engine；profile 为空时不得猜测或回退到 OpenCode，也不得展示运行按钮。
3. 删除 `resolveAgentEngine()`、`providerToEngine()` 以及 `PROVIDER_TO_ENGINE` 从 `agentStore`/`taskHubStore` 的重导出。
4. 保留 canonical `providerToExecutionEngine()`、`PROVIDER_TO_ENGINE` 的单一 owner、账号配置 UI 常量、历史 `gemini` 读边界和 Team Runtime 缓存。
5. 删除只验证平行 resolver/转发别名的自证测试；保留并复用 Team Runtime、账号可达性、Store hydration 与正式派发测试。
6. 不改账号 schema/API、模型、Runtime Catalog、daemon、Invocation、session、权限、Task 状态、UI 信息架构或持久化版本。

## Exit Criteria

- 生产代码不存在 `resolveAgentEngine` 或 `providerToEngine`。
- `PROVIDER_TO_ENGINE` 只由 `src/lib/account-auth.ts` 定义和消费，不再经 Store interface 重导出。
- 任务详情的可运行性和 engine 标签直接来自 `RuntimeAgentProfile`；profile 缺失时 fail closed。
- 架构守卫禁止恢复平行浏览器 resolver、Store mapping facade 或任务详情 fallback。
- Team Runtime 活动契约、Store wiki 与长期减法决策同步当前事实。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- `pnpm exec tsc --noEmit --pretty false`：通过（UI 回归加入后复跑）。
- `pnpm exec vitest run src/__tests__/architecture/account-runtime-reachability.test.ts src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/store/account-binding.test.ts src/__tests__/store/team-role-card-compatibility.test.ts src/__tests__/store/server-hydration-runtime.test.ts src/__tests__/store/team-pack-roster.test.ts src/__tests__/store/session-scope.test.ts src/__tests__/task-hub/TaskDetailPanel.runtime-profile.test.tsx --reporter=verbose`：8 files / 74 tests 通过；覆盖单一 mapping owner、正式 Profile resolver/cache/hydration/dispatch、动态 TeamPack 角色、UI 缺 Profile/Runtime 不可用/账号撤销失败关闭，以及跨项目任务不显示、不发送 `terminal:start` 和切项目清理任务选择。
- `pnpm build`：通过；仅保留既有 Turbopack NFT 动态路径 warning。
- 全量测试已执行：205 files / 1502 tests passed，2 files / 2 tests skipped，1 test failed；唯一失败为既有稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，不经过浏览器账号/Profile 解析链。
- 首轮独立复审发现跨项目任务可能借用当前项目 Runtime Profile 的 1 项 Important，以及守卫范围、UI 负向覆盖 2 项 Minor；已通过展示边界、项目切换清理和执行动作边界三层 fail closed 修复，并补双项目真实回归。
- 修复后独立复审：Critical 0 / Important 0 / Minor 0，Ready: Yes；独立复跑 8 files / 74 tests，通过 `git diff --check 8572e86..ac86035`，并确认稳定基线失败的测试 blob 与相关服务端 import graph 均未变化。
