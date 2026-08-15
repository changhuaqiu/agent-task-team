# Architecture Subtraction — Round 40

> Status: active
> Date: 2026-08-15

## Goal

删除未接线的 `agent_team_pack` 并行成员绑定模型，以及 TeamPack repository 中无生产消费者的单角色增删与 Agent-Pack assignment interface。正式模型只保留：Conversation 选择 TeamPack，TeamPack 自身拥有 roles，`TeamPackRole` 持有 RoleCard/Account/Skill 配置。

## Evidence

- `agent_team_pack` 仅在 migration 11、repository 的四个 assignment 方法和两个 repository 自测中出现；没有 API、UI、Store、daemon、Team Runtime、seed、脚本或当前文档消费者。
- `assignAgentToPack`、`removeAgentFromPack`、`getAgentsForPack`、`getPacksForAgent` 没有生产调用方，且不会影响任何实际执行资料解析。
- `addRole` 与 `removeRole` 同样零调用；正式 TeamPack 编辑通过 `teamPackRepo.update(...roles)` 原子替换角色集合，成员配置通过 `updateRoleConfig()` 修改。
- 当前产品事实已是 `conversation.team_pack_id` 选择团队，成员定义及绑定保存在 `team_pack_role`，不存在“全局 Agent 再加入 TeamPack”的用户流程。

## Contract

1. 删除上述六个零消费者方法及只验证死接口的自测。
2. 新增 forward-only migration，删除已有数据库中的 `agent_team_pack` 表；历史 migration 11 保持不可变。
3. TeamPack create/update/delete/list/export、整包 roles 更新、role config、Conversation 绑定、Team Runtime 解析全部保持。
4. 不删除 `team_pack`、`team_pack_role`、`conversation.team_pack_id` 或 `TeamPackRole.accountIds/skillIds/roleCardSnapshot`。
5. 架构守卫阻止旧表名与旧 repository interface 回流。

## Exit Criteria

- 生产代码中没有六个旧方法，非历史 migration 段中没有 `agent_team_pack` 当前写读逻辑。
- 新旧 SQLite 数据库执行迁移后均不存在 `agent_team_pack`。
- TeamPack repository、API、seed、Team Runtime 与架构守卫测试通过。
- 冻结安装、TypeScript、构建、全量测试与独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：7 files / 105 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- 实现后定向：8 files / 106 tests 通过，覆盖 TeamPack repository/API/role config/seed/runtime、真实 SQLite migration、evaluation recovery 与架构守卫。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 全量测试执行完成：205 files / 1519 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：待执行。
