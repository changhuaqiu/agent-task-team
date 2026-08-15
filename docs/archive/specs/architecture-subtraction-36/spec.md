# Architecture Subtraction — Round 36

> Status: implemented
> Date: 2026-08-15

## Goal

删除只有一个方法、一个 adapter 和一个生产消费者的嵌套 `CommunicationPolicy` 浅 Module。Team Runtime 直接暴露 A2A handoff 的单次准入结果，Command Guard 只跨一个 Team Runtime interface；TeamPack communication matrix、default-team 兼容补全、错误语义与 Human Command 边界保持不变。

## Evidence

- `CommunicationPolicy` 当前只暴露 `explainBlock(from, to)`，没有可替换实现、状态、I/O 或跨进程协议。
- 唯一生产消费者是 `src/server/a2a/command-guard.ts`；它只从 `TeamRuntime.communicationPolicy` 取出该方法。
- `resolveCommunicationPolicy()` 只被 `resolveTeamRuntime()` 调用，且已不从 Team Runtime barrel 导出。
- Team Runtime 是进程内派生值，不持久化或序列化 policy 对象。
- Team Runtime 接口测试已覆盖无 TeamPack、普通矩阵和 default-team 兼容；Command Guard 测试覆盖允许、拒绝、空原因 fallback、Human 豁免与 roster 校验顺序。

## Contract

1. `TeamRuntime` 直接暴露 `explainHandoffBlock(fromAgentId, toAgentId): string | undefined`；`undefined` 表示允许，字符串表示拒绝原因。
2. `resolveTeamRuntime()` 内聚 matrix/default-team 兼容规则，不向调用方暴露 policy 构造器或独立类型。
3. Command Guard 对每个 Agent branch 只调用一次该方法，继续使用 `a2a_communication_policy_blocked` 和既有可读 detail。
4. 无 TeamPack 时继续允许；普通 TeamPack 严格读取 `canSendTo`；受管 default-team 继续补齐四人 Harness 必需连线。
5. 显式 Human Command 继续只豁免 agent-to-agent matrix，不豁免 source/target roster 规则。
6. 删除 `CommunicationPolicy`、`resolveCommunicationPolicy.ts`、`communicationPolicy` 嵌套字段和 `explainBlock` 命名尾巴。
7. 不改变 TeamPack schema/API/repository、prompt 中的 canReceive/canEscalate、A2A durable owner、Task Graph 或 Execution Plane。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在 `CommunicationPolicy`、`resolveCommunicationPolicy`、`communicationPolicy` 或 `explainBlock`。
- Team Runtime 真实 interface 覆盖无 TeamPack、普通矩阵与 default-team compatibility。
- Command Guard 真实 interface 覆盖允许/拒绝、空原因 fallback、Human 豁免和 roster-before-policy 顺序。
- 架构守卫禁止旧嵌套 policy 回流，并证明 TeamPack prompt 的接收/升级说明保留。
- 当前架构 wiki、daemon 说明、system-control-plane 活动契约与减法决策只描述 Team Runtime 直接准入方法。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- 基线 `pnpm exec vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/server/a2a/command-guard.test.ts src/__tests__/api/state/mutations.test.ts src/__tests__/architecture/runtime-ownership.test.ts --reporter=dot`：4 files / 96 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- 实现后同一定向命令：4 files / 96 tests 通过；包含 default-team sender row 缺失时 fail closed 的真实 Team Runtime 回归。
- `pnpm build`：通过；保留既有 Next.js NFT tracing warning。
- `pnpm test -- --run --reporter=dot`：执行完成；205 files / 1517 tests 通过，2 files / 2 tests skipped，1 file / 1 test failed。唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，本轮定向链与生产构建均通过，不将全量 suite 误记为全绿。
- 第一次独立复审：Critical 0 / Important 0 / Minor 2，代码与旧矩阵实现逐分支等价；要求补强“非 default 名但包含四正式角色”的兼容识别，以及 target roster 在 policy 前拒绝的 spy 证据。
- 修复后 `pnpm exec tsc --noEmit`：通过；同一定向命令 4 files / 96 tests 通过。
- 最终独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes；独立重跑补强测试 2 files / 27 tests 通过，工作树与 base→HEAD diff-check 清洁。
