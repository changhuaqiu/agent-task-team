# Architecture Subtraction — Round 43

> Status: active
> Date: 2026-08-15

## Goal

删除 Message、Task 与 Skill repository 中 4 个没有生产消费者的浅 interface，同时保留正式消息持久化、Task lifecycle 与 Skill 不可变 revision 幂等安装。

## Evidence

- `messageRepo.appendTextChunk` 仅有两个 repository 自测，daemon 的 ACP text stream 会合并为最终消息后通过 `append` 持久化，没有 chunk 写入路径。
- `taskRepo.getByAgent` 和 `taskRepo.delete` 各只有一个 repository 自测；正式读取按 conversation/id，Task lifecycle 使用 transition/update，项目删除通过 aggregate cleanup。
- `skillRepo.getRevisionByHash` 只被同 repository 的 `createOrActivateRevision` 调用；它没有独立校验或 adapter 语义，content-hash 幂等查询应内聚到安装事务。

## Contract

1. 删除 `messageRepo.appendTextChunk`、`taskRepo.getByAgent`、`taskRepo.delete`、`skillRepo.getRevisionByHash` 及只验证死 interface 的测试。
2. `createOrActivateRevision` 在自身实现内查询 `(skill_id, content_hash)`，同内容仍复用 revision 并切换 active revision。
3. 保留 Message append/chunk事件合并后持久化、Task getByConversation/getById/transition/update、Skill install/compile/revision read/files。
4. 架构守卫阻止四个旧 qualified method 和 repository 声明回流。

## Exit Criteria

- 四个旧方法生产零残留，防回流守卫通过。
- Message、Task lifecycle、Skill Runtime 幂等 revision 定向回归通过。
- install、tsc、build、全量与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages，通过。
- 冻结基线：5 files / 129 tests 通过。
- `pnpm exec tsc --noEmit`：通过。
- 实现后定向：5 files / 126 tests 通过，覆盖 repository、SkillRuntime、Context Planner 与架构守卫。
- `pnpm build`：通过；仅有既有 Turbopack NFT 动态路径警告。
- 首次与 build 并行的全量除稳定基线外出现 `acpBackend.test.ts` 15s subprocess 超时；独立复跑该文件 1 file / 18 tests 通过。
- 不与 build 并行的最终全量：205 files / 1511 tests 通过，2 files / 2 tests 跳过，1 file / 1 test 失败；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready: Yes；独立复跑定向 5 files / 126 tests、Runtime Message Projection 1 file / 3 tests 与 `pnpm exec tsc --noEmit` 均通过，status 与 base→HEAD diff-check clean。
