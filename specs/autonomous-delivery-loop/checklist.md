# 完成检查清单

## 设计

- [x] 顶层 Run 与 Conversation/Task/Invocation 分离。
- [x] Supervisor 是唯一跨阶段推进权。
- [x] Agent 输出不作为完成真相。
- [x] 外部副作用通过 Port + Adapter。
- [x] 事件驱动与周期 reconcile 并存。

## 数据与并发

- [x] 所有 Action 有稳定 idempotency key。
- [x] claim 是事务内条件更新。
- [x] Attempt 有 lease、heartbeat 和 terminal receipt。
- [x] 迟到 Attempt 受 fencing 保护，不能覆盖当前动作或写入 Receipt。
- [x] 重启后不依赖进程内 Map 恢复。
- [x] Provider 动作重复执行不会产生重复 PR/merge/comment。

## 产品体验

- [x] UI 只展示交付目标、验收、进度、异常和最终结果。
- [x] 正常路径不展示运行时实现术语。
- [x] 正常路径用户无第二条消息。
- [ ] 异常只请求最小决策。

## Closure

- [x] 每条验收标准有证据。
- [x] Task 子图全部终态且无 blocker。
- [x] Review/QA PASS。
- [x] Web UI E2E PASS。
- [x] 必需的 Provider Receipt 成功。
- [x] DeliveryBundle 已持久化并幂等发布。

## 验证

- [x] Repository / reducer 单元测试。
- [x] 并发 claim / lost response / stale lease 集成测试。
- [x] Harness adapter 测试。
- [x] Provider in-memory adapter 契约测试。
- [x] GitHub adapter 安全校验测试。
- [x] `pnpm test`。
- [x] `pnpm build`。
- [x] Playwright Web UI E2E。
- [x] repair verification 进程重启恢复 Web UI E2E。
- [x] executing / verifying / integrating 三阶段持久化重启恢复集成测试。
- [x] v42 水位但 Run 表缺少 `revision` 的 checkpoint 可前向修复，并保留既有 Run/Action。
- [x] 自主项目创建不触发 legacy proposal；普通 Team Pack 项目仍自动启动初始分析。
- [ ] Claude ACP 双下划线工具名可命中当前平台 grant，未知 MCP/普通工具仍拒绝。

## 全链路证据

- [x] UI 创建 GoalContract，不由测试直接创建 Conversation/Run。
- [x] 生产 Context Manager 与 RepositoryHarnessPlanner 参与每轮 dispatch。
- [x] 外部模型只在 HarnessRuntimePort 被确定性测试适配器替换。
- [x] Browser/Playwright 真实页面操作生成 Verification Receipt。
- [x] 首次失败触发 repair_verification。
- [x] repair 执行中进程终止，重启后 lease 回收并继续。
- [x] 最终 DeliveryBundle 由 Closure Invariant 生成并经 UI 展示。

## 当前验证记录（2026-07-20）

- 自主交付相关 41 条测试通过（包含结构化 Review/Web UI E2E Receipt、独立 gate owner、
  artifact scope、幂等 claim、长动作 heartbeat、迟到结果 fencing、lease 回收、数据库重开恢复、
  Provider lost-response reconcile 后的 Bundle 快照、DeliveryBundle 先持久化后发布，以及
  executing/verifying/integrating 三阶段 startup reconcile、Run revision CAS、项目级联删除、
  发布事务边界、创建失败回滚和 reconcile 不重复消耗 repair cycle）。
- Chrome Playwright 完整黑盒闭环通过：UI 创建 GoalContract → Context Manager / Harness →
  Task Tool → Review → 首次 Web UI E2E FAIL → repair verification → 进程终止 →
  lease 回收 / startup reconcile → Web UI E2E PASS → DeliveryBundle 完成卡片。
- 黑盒测试选择的是临时复制项目；源码、数据库、报告和 `.ath` 证据随测试临时根目录清理，
  不依赖或污染开发者的原工作区。

## 现场恢复记录（2026-07-22）

- 生产数据库已处于 v42 水位但 Run 表缺少 `revision`；v43 启动迁移后保留原 DeliveryRun，
  `foreign_key_check` 无违规，Supervisor 将该 Run 从 `submitted/planning` 推进到 `executing`。
- 恢复后已生成根任务、`plan_goal` / `advance_tasks` 两个持久化 Action 及对应 Attempt，
  Run `revision` 从 0 单调递增到 4，证明真实 `getDb()` → startup reconcile 链路可用。
- `pnpm build`（Next.js 16.2.4 / Turbopack）通过，TypeScript 与页面生成均成功。
- 独立 MR 工作树基于最新 `origin/main` 验证：`pnpm test` 全量 135 个测试文件、
  1192 条用例全部通过，无 unhandled rejection。

## Legacy proposal 隔离现场记录（2026-07-22）

- 在修复版生产构建中刷新浏览器后，通过真实 Web UI 新建空目录自主项目，只提交一次目标，未发送后续消息或手工指派 Agent。
- `/api/state` 将新会话水合为 `autonomous: true`；数据库只出现由 Supervisor 根任务关联的 Mario invocation。
- 等待超过 500ms 旧提案定时器窗口后，空 `task_id` invocation 数仍为 0；`plan_goal` 与 `advance_tasks` Action 均成功，页面没有 legacy proposal 队列。
- 回归测试同时覆盖普通 Team Pack 项目创建及显式重新生成 proposal，确认非自主交互路径未被禁用。
