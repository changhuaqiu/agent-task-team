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
- [x] 完成态默认展示摘要，验收与评审证据按需展开，且不挤出聊天输入框。
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
- `pnpm build`（Next.js 16.2.4 / Turbopack）通过，TypeScript 与页面生成均成功。
- 独立 MR 工作树基于最新 `origin/main` 验证：`pnpm test` 全量 135 个测试文件、
  1192 条用例全部通过，无 unhandled rejection。
