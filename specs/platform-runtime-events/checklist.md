# 验收清单

按 spec §9 的 6 切片组织。每项对齐 spec §10 退出条件与 tasks.md 任务。

## 事件契约

- [x] 一套统一信封覆盖四类事件。
- [x] 每个命名空间有唯一 canonical producer。
- [x] Command 与 Event 在命名和类型上分离。
- [x] Domain Event 不携带泛化 audience；路由结果进入 Agent Inbox。
- [ ] domain 事件目录覆盖 9 领域（task/review/delivery/a2a/envelope/binding/node/session/invocation）。
- [x] coordination 事件目录覆盖 enqueued/claimed/recovered。

## 事件日志

- [x] 同一 stream 的 sequence 严格递增。
- [x] 不同 stream 不要求全局排序。
- [x] 相同 dedupe key 与相同内容返回已有事件。
- [x] 相同 dedupe key 与不同内容返回稳定冲突。
- [x] payload 以 JSON 持久化并在读取时恢复。
- [x] 按 project、stream、invocation 和 ProjectAgent 可查询。

## Runtime（切片 0/1）

- [x] Adapter 原始信号不能直接成为平台事件。
- [x] accepted Invocation 最终且只能 terminated 一次。
- [x] terminated 后拒绝新的 Runtime 活动事件。
- [x] Runtime completed 不直接推进 Task done。
- [x] ACP Runtime 事件能关联 project、Agent、Invocation、Session 和 trace。
- [ ] daemon ACP 路径产生可查询的 Runtime 事件（切片 1 退出）。
- [ ] 双写 fail-open，且代码中标记退出条件（切片 1）。

## 消费架构（切片 2/3/4/5）

- [x] Dispatcher 实现错误隔离（一个 handler 挂不影响其他）。
- [x] durable handler 有持久投递、attempt、lease、retry 与 terminal receipt。
- [x] Dispatcher 启动恢复能回补 append 后未投递事件并回收过期 lease。
- [x] Dispatcher 实现同一 handler × stream 局部有序分发。
- [ ] Reducer 幂等并校验状态迁移。
- [x] Router 只产生 Inbox Command，不直接启动 Runtime。
- [ ] Process Manager 只调目标模块 interface，不越权写表。
- [ ] Socket、Message、Observability 是可重建 projection。
- [x] 至少一个投影从 Runtime Event 重建（`RuntimeInvocationProjection`，切片 2 退出）。

## Agent 边界（ADR-003）

- [ ] Agent 通过 Inbox + ContextSnapshot 消费事件，不直接订阅总线。
- [ ] Agent 不直接生产 domain 事件（经工具 → 领域模块）。
- [ ] Runtime 拿不到 Event Bus 引用，只拿 Coordinator 和只读工具（模块边界强制）。
- [ ] eventHistory 工具集（只读查询事件流）已定义。

## Core 边界（ADR-002）

- [ ] 上半部（终态守护、状态校验、dedupe）作为 producer-local invariant 在 append/UPDATE 事务内同步执行，不注册到 Dispatcher。
- [ ] 下半部（Router/Reducer/PM/Projection）在事务外异步 fan-out。
- [ ] 上半部不做 I/O、不 fan-out。

## Process Manager（切片 5，ADR-005）

- [ ] delivery 协调不再依赖 task-notification-publisher.ts:260 尾部硬编码。
- [ ] bootstrap.ts 周期 reconcile 仅作为 crash/retry 恢复触发器。
- [ ] PM handler 只把事件映射为 `advance(runId, cause)`。
- [ ] `advance()` 继续隐藏状态推导、claim、lease、执行、重试与收口规则。
- [ ] 现有 delivery 测试无回归。

## 兼容与验证

- [x] 双写路径有明确退出条件。
- [x] migration 可重复执行且不破坏旧数据库。
- [x] 相关单测、类型检查和构建通过（切片 0）。
- [ ] 长期文档与当前实现保持一致（切片 6 退出）。
- [ ] 兼容双写已删除，`agent_event` 写入已移除（切片 6 退出）。
- [ ] 现有 Runtime、Session、A2A、Task 和 observability 测试无回归（全切片）。
