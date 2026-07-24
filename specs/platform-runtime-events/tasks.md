# 实施任务

任务按 spec §9 的 6 切片组织。每切片落地前另起 plan，不在本文件锁定实现细节。
对齐 spec §10 退出条件与 checklist.md 验收项。

## 切片 0：基础设施（已完成）

- [x] T1 建立活动规格与长期技术设计，冻结事件分类、owner、信封和消费方式。
- [x] T2 增加 `platform_event` schema 与 forward-only migration。
- [x] T3 实现事件日志：自动 ID/时间、stream sequence、dedupe 幂等和冲突检测。
- [x] T4 实现 typed Runtime Event publisher 和生命周期不变量。
- [x] T4b 实现 AcpRuntimeEventCoordinator + RuntimeAgentEventBridge（归一化与兼容桥）。

## 切片 1：接入 daemon（代码已接入，待补边界回归）

- [ ] T5 daemon 对 Runtime 活动与终态执行兼容双写（经 AcpRuntimeEventCoordinator）。
  - daemon.execute 路径持有 coordinator：accept → backend.execute → terminate
  - 同步启动失败复用 failSetup
  - 双写 fail-open，标记退出条件（不得永久双事实源）
  - 退出：daemon ACP 路径产生可查询 Runtime 事件

## 切片 2：Durable Dispatcher + 第一个 Projection（已完成）

- [x] T6 建立 Durable Dispatcher，并增加 Runtime Event 查询与首个 projection。
  - durable handler 使用持久投递、attempt、lease、retry 与 receipt
  - recover 能回补 append 后未投递事件并回收过期 lease
  - best-effort handler 错误隔离但不承诺重试
  - 同一 handler × stream 保证局部顺序
  - 首个投影选定 `RuntimeInvocationProjection`，只从 `platform_event` 生命周期事件构建
  - 退出：至少一个投影从 Runtime Event 重建，而非读取 ACP/AgentEvent 原始信号

## 切片 3：Agent Inbox + coordination 事件（已完成）

- [x] T7 建立持久 Agent Inbox 与 coordination 事件，替换浏览器内存队列。
  - AgentInbox module：enqueue(domainEvent) → InboxItem + claim(projectAgentId) → InboxItem | null + recover()
  - coordination 事件：agent.work.enqueued / claimed / recovered
  - Scheduler 仅 claim Inbox 后调用 Harness；浏览器队列只作显示投影，不再触发执行
  - 通用 Router 把领域事实解析为 Inbox Command，具体领域 resolver 在切片 4 注册
  - 退出：Agent Inbox 能由领域事件幂等产生、claim、恢复

## 切片 4：domain 事件 inline seam（已完成）

- [x] T8 9 领域状态变更 inline 发 domain 事件，从 task 开始。
  - 先 task（task_action 准事件源最成熟），再 delivery / a2a / envelope / binding / node / session / invocation / review
  - inline seam：领域模块表写入动作同事务发事件（ADR-001）
  - 接入 Wakeup Router（domain 事件 → Inbox）
  - 退出：四类事件契约和 owner 有自动化测试

## 切片 5：Process Manager 触发入口迁移（已完成）

- [x] T9 delivery 阶段推进抽成 Process Manager handler（ADR-005，立即迁移触发入口）。
  - task-notification-publisher.ts:260 硬编码抽成 task/review 事件订阅 handler
  - bootstrap.ts 周期 reconcile 保留为 crash/retry 恢复触发器
  - handler 以 source event 幂等写入 delivery advancement queue
  - delivery worker 复用 AutonomousDeliverySupervisor.advance() 深模块，不复制其内部规则
  - Platform Event delivery 以持久接纳为成功边界；实际推进失败由 delivery queue 重试
  - 退出：delivery 协调不再依赖 task-notification-publisher 尾部硬编码；现有 delivery 测试无回归

## 切片 6：退出双写（待开始）

- [ ] T10 删除 forwardAgentEvent 业务副作用 + 旧 agent_event 写入。
  - 前置：切片 2/3/4/5 全部完成
  - 迁移 Message、UI、Observability、Harness Outcome 消费者
  - 退出：长期设计与 wiki 已同步，兼容双写已删除
- [ ] T11 完成全量验证、长期事实回写并归档规格。
