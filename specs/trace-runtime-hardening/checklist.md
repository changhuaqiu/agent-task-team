# Verification Checklist

## WorkContract

- [x] accepted `continue_work` 后，任一新 Outcome 都以 `work_exit_already_accepted` 拒绝。
- [x] accepted terminal Outcome 后，`continue_work` 也以 `work_exit_already_accepted` 拒绝。
- [x] rejected Outcome 不消费退出槽，duplicate 语义不变。
- [x] WorkContract 的 runtime tool permissions 不包含 Task 领域 mutation tool。
- [x] Git collaboration receipt 写工具也从 WorkContract permission 与实际 MCP grant 裁掉。
- [x] SQLite trigger 阻止 repository 外直接插入第二条 accepted exit，并保留历史歧义数据。

## Completion custody

- [x] Task revision 只能在 structured outcome 被接纳后由 owner 更新。
- [x] `request_review` 沿用既有 TaskOutcome Process Manager 创建/推进当前 revision Gate 的测试覆盖。
- [x] Git-backed review Outcome 必须经 provider verification；核验后的写事务二次 fencing Task revision，closed/stale/drifted PR 不改变 Task，重放不重复写 PR fact。
- [x] Invocation `completed` 不会在 Phoenix 被误当作 WorkContract 业务完成。

## Session

- [x] 累计输入 token 达阈值后旧 session 被 seal，reason 为 `context_budget_exhausted`。
- [x] 已终结 Invocation 次数达阈值后也会轮换。
- [x] 缺失/非法 token usage 不会中断调度。
- [x] generation 选择与 Invocation 创建同事务完成；未终结 Invocation 不会被预算检查并发 seal。
- [x] 同 generation 有未终结 Invocation 时，后继 dispatch fail closed，不并发复用 CLI session。

## Observability

- [x] Phoenix span 可关联 project、agent、task、work contract、invocation、tool 与 outcome。
- [x] 未显式允许时不导出 prompt、message、tool input/output 原文。
- [x] collector 不可用不修改或阻塞 runtime/Task 事实，投影独立重试。
- [x] Phoenix 使用独立 worker，首次投递固化 immutable plan；metadata-only 错误不含自由文本。
- [x] dispatcher recovery 只处理自己注册的 handler；计划按 Event Log ingestion 游标固化全部业务事实，忽略同毫秒后继事件与孤立 Outcome row，隐私策略收紧会单调移除内容。
- [x] 真实本地 trace 已在线写入现有 Phoenix；历史双 accepted exit 被标为 ambiguous/error。

## Quality gates

- [x] full Vitest：226 files passed / 2 skipped；1709 tests passed / 2 skipped。
- [x] TypeScript、受影响路径 ESLint 与 production build 通过。
- [x] 独立代码审查无未处理 Critical/Important 问题；最终结论 Ready to merge。
