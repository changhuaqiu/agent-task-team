# Architecture Subtraction — Round 31

> Status: implemented
> Date: 2026-08-15

## Goal

删除浏览器 `Agent` 投影中已经被 RoleCard 取代的 `role / roleLabel` 第二套角色事实，以及两个零消费者 RoleCard 查询 action。成员的岗位分类、显示名和行为边界只从 `roleCardId + RoleCard` 解析；Team Runtime、账号、Skill、派发和动态 TeamPack 身份保持不变。

## Evidence

- `Agent.role` 在生产代码中只被构造、复制和导出，没有任何读取者；唯一断言来自 `default-team-harness.test.ts` 对废字段自身的测试。
- `Agent.roleLabel` 由 `ROLE_LABEL_MAP` 或 RoleCard displayName 重复生成，并被 `getEffectiveRoster()` 再投影一次；四个 UI/上下文调用点已经同时拥有 `roleCardId` 与 RoleCard 集合。
- `AgentRole`、`ROLE_MAP` 和 `ROLE_LABEL_MAP` 只服务上述兼容字段，不参与 Team Runtime、Invocation Planner 或服务端派发。
- `getRoleCardById()` 与 `getRoleCardForAgent()` 只出现在 Store interface 和 slice 实现中，生产、测试、脚本均无消费者。
- `resolveTeamRuntime()` 的 preset 输入只消费 `id/name/roleCardId/accountIds/cliEngine/emoji/theme`；动态 TeamPack 使用 role snapshot 或 roleCardId，不依赖旧三态 `planner/worker/reviewer`。

## Contract

1. `Agent` 只保留成员标识和展示/执行投影：`id/name/roleCardId/theme/emoji/isOnline/cliEngine/accountIds`；不得恢复 `role` 或 `roleLabel`。
2. 岗位分类、显示名、能力与权限的事实 owner 是 RoleCard。preset 成员名保持 Mario/Luigi 等成员身份；动态 TeamPack 成员名只来自 `TeamPackRole.displayName`，不得被 snapshot RoleCard displayName 覆盖。RoleCard 单独显示岗位；缺失时不得猜成 `worker/reviewer`，只保留成员名或省略岗位标签。
3. `getEffectiveRoster()` 只适配 Team Runtime 成员到浏览器成员投影，不再复制角色分类；`getAgentRoleCard(agentId)` 是 UI、@提及与任务详情解析 global/snapshot RoleCard 的唯一缓存读边界。
4. 删除 `AgentRole`、`ROLE_MAP`、`ROLE_LABEL_MAP`、`getRoleCardById()` 和只查全局数组的 `getRoleCardForAgent()`；不得用旧 action 绕过 Team Runtime snapshot。
5. 默认 DK 的评审身份必须通过 `roleCardId -> preset-arch-reviewer RoleCard` 证明，而不是断言废字段。
6. 不改变 RoleCard schema、TeamPack role snapshot、账号绑定、Skill 绑定、Runtime Profile、Task、派发协议、持久化版本或用户主流程。

## Exit Criteria

- 生产 TypeScript/TSX 中不存在 `AgentRole`、`roleLabel`、`ROLE_MAP`、`ROLE_LABEL_MAP` 或两个死 lookup action。
- `Agent` interface 不再声明 `role` / `roleLabel`；默认和服务端 roster 水合不再生成它们。
- AgentBar、Roster Modal、TaskDetail、@提及与 Team context 通过 Team Runtime 的 RoleCard 展示岗位；TeamPack 成员名、A2A 标签不受 snapshot RoleCard 名称影响；RoleCard 缺失时失败关闭而非猜测分类。
- 架构守卫阻止兼容字段、映射表和死 Store action 回流。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过；719 packages，锁文件未变。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- `pnpm exec vitest run src/__tests__/architecture/runtime-ownership.test.ts src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/store/account-binding.test.ts src/__tests__/store/default-team-harness.test.ts src/lib/agent-context/layers/teamLayer.test.ts src/__tests__/task-hub/AgentRolePresentation.test.tsx src/__tests__/task-hub/A2APossessionStrip.test.tsx src/__tests__/task-hub/TaskDetailPanel.runtime-profile.test.tsx src/__tests__/store/team-pack-roster.test.ts src/__tests__/store/team-role-card-compatibility.test.ts --reporter=dot`：10 files / 82 tests 通过；覆盖生产零残留、默认 RoleCard 分类、preset/TeamPack roster、snapshot RoleCard selector、RoleCard 缺失失败关闭、成员名与岗位名分离、岗位名 @提及及真实候选弹层、持球/回执成员身份、任务详情、Roster Modal 响应更新、账号与 Runtime Profile 链。
- `pnpm build`：通过；仅保留既有 Turbopack NFT 动态路径 warning。
- 最终全量测试：206 files / 1508 tests passed，2 files / 2 tests skipped，1 test failed；唯一失败为既有稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，不经过浏览器 Agent/RoleCard 展示投影。较早一次全量中的 ACP 子进程 15 秒并发超时已单独复跑为 1 file / 18 tests 全过，并在后续两次全量中通过。
- 首轮独立复审：Critical 0 / Important 2 / Minor 1；发现 TeamPack snapshot 名称覆盖成员名、任务详情无法解析 snapshot RoleCard、Team context 缺卡重复成员名，均已修复并补行为回归。第二次复审发现 @mention 子弹层仍重复查询全局卡、Roster Modal 未订阅解析结果（Important 1 / Minor 1），也已修复。最终复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
