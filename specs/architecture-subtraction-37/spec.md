# Architecture Subtraction — Round 37

> Status: active
> Date: 2026-08-15

## Goal

删除 Team Runtime 对账号可执行输入的重复类型声明。账号 Provider、认证模式、readiness 字段与校验继续由 `src/lib/account-auth.ts` 唯一拥有；Team Runtime 的 Profile resolver 只在共享候选类型上增加查找所需的账号 `id`，不再公开 `RuntimeAccountProvider` 或 `RuntimeAccountInput` 两套别名。

## Evidence

- `RuntimeAccountProvider` 只是 `AccountProvider` 的逐字类型别名，仓库内除声明和 barrel 重导出外没有消费者。
- `RuntimeAccountInput` 重复声明 `AccountExecutionCandidate` 的全部 readiness 字段，只额外增加 `id`。
- 浏览器 Store、服务端 Invocation Pipeline 与 Evaluation Snapshot 都以结构化对象调用 resolver，没有导入这两个 Team Runtime 类型。
- `isAccountReadyForExecution()` 与 `providerToExecutionEngine()` 已由 `account-auth.ts` 统一拥有，重复输入类型不能提供额外验证、迁移或适配能力。

## Contract

1. `resolveRuntimeAgentProfile()` 接受 `Array<AccountExecutionCandidate & { id: string }>`。
2. Provider、认证模式、Base URL、模型、启用状态、验证状态与 API Key readiness 只由 `account-auth.ts` 的共享类型和函数定义。
3. Team Runtime 只负责按成员绑定顺序选择第一个 ready account，并组装 engine/account/profile。
4. 浏览器 Store、正式 Invocation Pipeline 与 Evaluation Snapshot 的对象形状、选择顺序和 fail-closed 行为不变。
5. 历史 `gemini` engine 读取迁移、显式 runtime selection、daemon 最终执行复核与凭据存储不在本轮改动范围。
6. 删除 `RuntimeAccountProvider`、`RuntimeAccountInput` 及 barrel 重导出，不新增替代别名。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在 `RuntimeAccountProvider` 或 `RuntimeAccountInput`。
- `resolveRuntimeAgentProfile()` 直接复用 `AccountExecutionCandidate`，账号 readiness 仍由共享函数判定。
- 浏览器、服务端派发与评估快照的真实调用测试保持通过。
- 架构守卫禁止重复 Team Runtime 账号候选类型回流。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过，719 packages，lockfile 未变。
- 基线定向命令：`pnpm exec vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/architecture/account-runtime-reachability.test.ts src/server/evaluation/application-snapshot.test.ts src/__tests__/store/server-hydration-runtime.test.ts src/__tests__/store/team-role-card-compatibility.test.ts --reporter=dot`，5 files / 61 tests 通过。
- 实现后同一定向命令：5 files / 62 tests 通过；新增共享账号候选唯一 owner 架构守卫。
- `pnpm exec tsc --noEmit`：通过。
- 构建、全量测试与独立复审待完成。
