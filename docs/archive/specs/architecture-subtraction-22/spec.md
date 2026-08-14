# Architecture Subtraction — Round 22

> Status: implemented
> Date: 2026-08-15

## Goal

删除浏览器 `pending/rejected` 六态与 Task Graph `proposed/ready/.../cancelled` 七态之间的平行生命周期，让服务端、`/api/state`、Zustand、Kanban 和任务操作共享一个 TaskStatus interface。

## Evidence

- Task repository 的正式状态是 `proposed | ready | in_progress | blocked | in_review | done | cancelled`，但浏览器重新定义了 `pending | in_progress | in_review | done | rejected | blocked`。
- `/api/state`、store hydration、socket task sync 和 MiniKanban 均通过 `toLegacyProjectTaskStatus()` 丢失 `proposed/ready/cancelled` 语义。
- UI 的“拒绝”发送 `rejected`，服务端 `assertTaskStatus()` 必然拒绝；TaskDetailPanel 还展示所有非当前状态，而不是合法迁移。
- 新建任务对用户暴露状态下拉并乐观保存该值，但 `task.create` 不消费它，Task repository 始终按正式规则创建 `ready`。
- MiniKanban、ContextMenu 与 repository 各维护一份迁移表，容易继续漂移。

## Contract

1. `src/shared/task-status.ts` 成为纯状态 vocabulary 与合法迁移 interface；server repository 和 browser UI 共同消费。
2. `/api/state` 与 task sync 传递正式 TaskStatus，不再降级成 legacy UI 状态。
3. Browser Task 模型不再声明 `pending` 或 `rejected`；评审退回使用正式 `in_review → in_progress`，取消使用 `cancelled`。
4. UI 只展示 repository 允许的下一步，不发送不可达状态。
5. 新建任务不再询问一个服务端会忽略的初始状态；新任务按 Task Authority 创建为 `ready`。
6. TASKS.md 等外部历史文本输入的兼容解析继续由服务端 intake 负责，本轮不破坏持久数据。

7. 浏览器持久化状态升级到 v9：历史 `pending/rejected` 只在该一次性迁移边界转为 `ready/in_progress`，其他非法状态丢弃。
8. socket `task.state/task.sync` 在运行时校验状态；非法事件不修改任务并留下同步错误。
9. 直接浏览器动作只暴露无需证据的迁移；`in_review` 和 `done` 分别由实现证据流程与 QualityGate 推进。
10. Agent preset 工具 schema 与共享七状态契约一致，seed 会更新既有 preset 行。

## Exit Criteria

- 生产代码无 `LegacyProjectTaskStatus`、`toLegacyProjectTaskStatus` 或浏览器 Task `pending/rejected` 状态。
- TaskStatus 与合法迁移只维护一个共享事实源。
- API hydration、socket sync、Kanban、任务详情与新建任务均使用正式状态。
- 当前事实文档不再描述 `/api/state` legacy projection。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向回归：17 files / 206 tests 通过；最终边界复跑 6 files / 53 tests 通过。
- `pnpm build`：通过；仅保留既有 Next.js NFT tracing warning。
- 全量：204 files / 1511 tests 通过，2 files / 2 tests 跳过；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
