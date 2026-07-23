# 验收清单

## 事件契约

- [x] 一套统一信封覆盖四类事件。
- [x] 每个命名空间有唯一 canonical producer。
- [x] Command 与 Event 在命名和类型上分离。
- [x] Domain Event 不携带泛化 audience；路由结果进入 Agent Inbox。

## 事件日志

- [x] 同一 stream 的 sequence 严格递增。
- [x] 不同 stream 不要求全局排序。
- [x] 相同 dedupe key 与相同内容返回已有事件。
- [x] 相同 dedupe key 与不同内容返回稳定冲突。
- [x] payload 以 JSON 持久化并在读取时恢复。
- [x] 按 project、stream、invocation 和 ProjectAgent 可查询。

## Runtime

- [x] Adapter 原始信号不能直接成为平台事件。
- [x] accepted Invocation 最终且只能 terminated 一次。
- [x] terminated 后拒绝新的 Runtime 活动事件。
- [x] Runtime completed 不直接推进 Task done。
- [x] ACP Runtime 事件能关联 project、Agent、Invocation、Session 和 trace。

## 消费

- [ ] Reducer 幂等并校验状态迁移。
- [ ] Router 只产生 Inbox Command。
- [ ] Agent 通过 Inbox + ContextSnapshot 消费事件，不直接订阅总线。
- [ ] Socket、Message、Observability 是可重建 projection。

## 兼容与验证

- [x] 双写路径有明确退出条件。
- [x] migration 可重复执行且不破坏旧数据库。
- [x] 相关单测、类型检查和构建通过。
- [x] 长期文档与当前实现保持一致。
