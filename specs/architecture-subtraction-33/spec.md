# Architecture Subtraction — Round 33

> Status: active
> Date: 2026-08-15

## Goal

删除 Team Runtime 中没有生产消费者的“后续角色选择”与 TeamModeEngine 内重复的通信判断，把工作流 interface 收窄为当前真实能力：根据 TeamPack workflow 与当前 roster 选择初始负责人。A2A 通信继续由独立 `CommunicationPolicy` 负责，任务后续推进继续由 Task Graph / Platform Harness owner 负责。

## Evidence

- 全生产调用图中，`TeamRuntime.workflowPolicy.getNextAgent()` 只有定义和构造，没有任何调用者；测试只为满足宽接口反复补空函数。
- `TeamModeEngine.getNextRole()` 只被上述零消费者方法调用；四种 Strategy 的 `getNextRole()` 均无其他调用者，且 `taskResult` 在全部实现中从未读取。
- `TeamModeEngine.canCommunicate()`、四种 Strategy 的同名实现与 `TeamModeStrategy.mode` 均无生产或测试读取者。
- 正式任务创建只在 `src/server/team-runtime/task-assignment.ts` 调用 `workflowPolicy.assignInitialTask()`，并且最终只读取返回对象的 `agentId`；传入的 task description/status、返回的 taskId/roleId/assignedAt 都不参与决策或持久化。
- A2A admission 使用 `TeamRuntime.communicationPolicy`，直接读取 TeamPack communication matrix；本轮不得删除或弱化该真实链。
- 基线定向验证：Team Runtime、A2A Command Guard、mutation task creation 与架构守卫共 4 files / 85 tests 通过。

## Contract

1. `WorkflowPolicy` 只暴露 `selectInitialAgent(): string | null`，不再承诺未接线的后续角色路由。
2. `resolveWorkflowPolicy()` 保持 pipeline / parallel / hub_spoke / custom 四种初始选择语义与 roster availability 校验。
3. 删除 `TeamModeEngine`、Strategy interface、`TaskAssignment` 伪结果对象以及 `getNextAgent / getNextRole / canCommunicate` 死接口。
4. 没有 TeamPack 或没有可用 workflow 成员时返回 `null`；服务端仍按既有顺序尝试 runtime roster 与调用方 fallback。
5. 保留 TeamPack workflow/communicationMatrix 数据结构、`CommunicationPolicy`、A2A admission、显式任务负责人优先级与任务持久化行为。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在 `TeamModeEngine`、`getNextAgent`、`getNextRole` 或 TeamMode Strategy `canCommunicate`。
- Team Runtime public export 不再暴露零消费者 `resolveWorkflowPolicy` helper、`WorkflowPolicy` 或 `TaskAssignment` 类型；调用方只通过 `TeamRuntime` 使用收窄后的策略。
- 行为测试通过 Team Runtime interface 覆盖四种模式、无 TeamPack、无可用成员与正式任务创建链。
- 架构守卫禁止被删的宽接口和独立 orchestration module 回流。
- 当前技术/wiki/roadmap 只描述真实的初始分配能力，不再宣称存在后续角色引擎。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- 基线 `pnpm exec vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/server/a2a/command-guard.test.ts src/__tests__/api/state/mutations.test.ts src/__tests__/architecture/runtime-ownership.test.ts --reporter=dot`：4 files / 85 tests 通过。
- 其余验证待实现后记录。
