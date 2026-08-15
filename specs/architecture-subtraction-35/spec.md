# Architecture Subtraction — Round 35

> Status: active
> Date: 2026-08-15

## Goal

删除只包裹一个无参数 getter 的 `WorkflowPolicy` 浅 Module。Team Runtime 在解析 roster 时直接计算并返回 `initialAgentId`，任务创建消费该确定值；四种 TeamPack mode、显式负责人优先与 roster fallback 行为保持不变。

## Evidence

- `WorkflowPolicy` 当前只剩 `selectInitialAgent(): string | null`，实现没有可变状态、延迟 I/O 或第二种 adapter。
- 唯一生产调用方 `src/server/team-runtime/task-assignment.ts` 构建 `TeamRuntime` 后立即调用一次该方法；没有调用方持有、替换或复用 policy。
- `resolveWorkflowPolicy()` 只被 `resolveTeamRuntime()` 调用，且未从 Team Runtime barrel 导出。
- Team Runtime 是进程内派生值，没有 `WorkflowPolicy` 的持久化、序列化或跨实例兼容边界。
- 四种 mode 的初始角色规则已由 `resolveTeamRuntime()` 接口测试覆盖；任务创建的显式负责人、workflow 选择与 roster fallback 已由真实 mutation 测试覆盖。

## Contract

1. `TeamRuntime` 直接暴露 `initialAgentId: string | null`；它表示当前 TeamPack workflow 中首个可用初始负责人。
2. `resolveTeamRuntime()` 在已排序 roster 上同步计算该值：pipeline 取首 step，parallel 取首个可用 step，hub_spoke/custom 取首个非终态 state；未知历史 mode 继续使用 state-machine 规则。
3. 无 TeamPack 或 workflow 角色不在 runtime roster 时返回 `null`。
4. 服务端任务创建继续按“显式负责人 → `initialAgentId` → roster 首成员 → 明确失败”选择负责人。
5. 删除 `WorkflowPolicy` 类型、`resolveWorkflowPolicy.ts` 和所有 `selectInitialAgent()` 生产/测试尾巴。
6. 不改变 TeamPack schema、workflow 数据、roster 排序、A2A communication policy、Task Graph 或 Platform Harness 的后续推进职责。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在 `WorkflowPolicy`、`resolveWorkflowPolicy`、`selectInitialAgent` 或 `workflowPolicy`。
- `TeamRuntime.initialAgentId` 通过真实 runtime interface 覆盖四种 mode、无 TeamPack、缺失角色和未知历史 mode。
- mutation 行为继续覆盖显式负责人优先、workflow 选择、roster fallback 与无法解析时拒绝。
- 架构守卫禁止浅 policy Module/interface 回流，并确认后续角色路由仍归 Task Graph / Platform Harness。
- 当前 wiki、daemon 说明、系统概览与减法决策只描述直接的 `initialAgentId` 派生结果。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- 基线 `pnpm exec vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/server/a2a/command-guard.test.ts src/__tests__/api/state/mutations.test.ts src/__tests__/architecture/runtime-ownership.test.ts --reporter=dot`：4 files / 96 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- 实现后同一定向命令：4 files / 96 tests 通过。
- `pnpm build`：通过；保留既有 Next.js NFT tracing warning。
- `pnpm test -- --run --reporter=dot`：执行完成；205 files / 1517 tests 通过，2 files / 2 tests skipped，1 file / 1 test failed。唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，本轮定向链与生产构建均通过，不将全量 suite 误记为全绿。
- 独立复审待执行。
