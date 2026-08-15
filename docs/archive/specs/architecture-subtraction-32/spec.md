# Architecture Subtraction — Round 32

> Status: implemented
> Date: 2026-08-15

## Goal

删除 ContextManager Knowledge Tier 中无生产必要的静态团队花名册 fallback。正式 Invocation 已经先由 Team Runtime 解析当前项目 roster，再构造 ContextManager；上下文组装只消费这份 `RuntimeAgent[]`，不再通过 `getAllRoleCards + AGENT_ROSTER + buildTeamLayer` 维护第二套团队身份路径。

## Evidence

- 生产代码只有 `src/server/invocation-pipeline/context-planner.ts` 构造 `ContextManager`，并无条件以 `getRuntimeRoster: async () => runtime.roster` 提供当前项目 roster。
- `ContextProviders.getAllRoleCards()` 只被 `ContextManager.assembleContext()` 调用一次，结果只进入 `TierContext.allRoleCards`，最终只服务 Knowledge Tier 的静态 fallback。
- `buildTeamLayer()` 的生产调用方只有上述 fallback；其余调用全部位于 `teamLayer.test.ts`，没有第二个生产消费者。
- fallback 直接读取浏览器 `AGENT_ROSTER`，会让服务端正式 Context 链在类型上仍允许绕过 Team Runtime，且无法表达动态 TeamPack snapshot、项目 roster 或当前成员名。
- 基线定向验证：ContextManager、teamLayer、InvocationPlanner、架构守卫共 4 files / 60 tests 通过。

## Contract

1. `ContextProviders.getRuntimeRoster(conversationId)` 必须返回 `Promise<RuntimeAgent[]>`；空数组表示当前没有可注入团队成员，不得解释为“改用静态默认团队”。
2. Knowledge Tier 的 `team:roster` Fragment 只由 `runtimeRoster` 生成；成员顺序、ID、显示名与当前角色标记保持不变。
3. 删除 `ContextProviders.getAllRoleCards()`、`TierContext.allRoleCards`、`buildTeamLayer()` 及其自证测试。
4. 保留 `getRoleCard(agentId)`：它仍负责当前 Agent 的身份、职责、能力与 system bootstrap，不是团队 roster fallback。
5. 不改变 TeamPack、RoleCard、Context Registry、scenario policy、预算、Snapshot、A2A、Skill、Tool、Task 或 Runtime dispatch 行为。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在 `getAllRoleCards`、`TierContext.allRoleCards` 或 `buildTeamLayer`。
- `src/lib/agent-context/layers/teamLayer.ts` 与其仅自证测试删除。
- ContextManager 的 provider interface 对 runtime roster 失败关闭，不保留 `undefined` 兼容分支。
- 行为测试证明 Team Runtime roster 进入 `team:roster` Fragment；空 roster 不注入静态成员。
- 架构守卫禁止静态 roster fallback 回流。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- 基线 `pnpm exec vitest run src/lib/agent-context/ContextManager.test.ts src/lib/agent-context/layers/teamLayer.test.ts src/__tests__/server/invocation-pipeline/context-planner.test.ts src/__tests__/architecture/runtime-ownership.test.ts --reporter=dot`：4 files / 60 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm exec vitest run src/lib/agent-context/ContextManager.test.ts src/__tests__/server/invocation-pipeline/context-planner.test.ts src/__tests__/architecture/runtime-ownership.test.ts --reporter=dot`：3 files / 58 tests 通过。
- `pnpm run build`：通过；仅保留既有 Turbopack NFT 动态路径 warning。
- `pnpm test -- --reporter=dot`：执行完成；205 files / 1506 tests 通过，2 files / 2 tests skipped，1 个既有稳定基线失败仍为 `src/server/autonomous-delivery/control-runtime.test.ts:131`，未表述为全量通过。
- 首轮独立复审：Critical 0 / Important 0 / Minor 1；唯一 Minor 是测试 fixture 使用了不可达的 `source: 'team-pack'`。
- 修复后将 fixture 改为正式 `source: 'team-pack-role'`，并以 `satisfies RuntimeAgent[]` 锁定生产类型；重新执行 TypeScript 与 3 files / 58 tests 均通过。
- 最终独立复审：Critical 0 / Important 0 / Minor 0，Ready: Yes。
