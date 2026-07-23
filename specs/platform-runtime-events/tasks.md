# 实施任务

- [x] T1 建立活动规格与长期技术设计，冻结事件分类、owner、信封和消费方式。
- [x] T2 增加 `platform_event` schema 与 forward-only migration。
- [x] T3 实现事件日志：自动 ID/时间、stream sequence、dedupe 幂等和冲突检测。
- [x] T4 实现 typed Runtime Event publisher 和生命周期不变量。
- [x] T5 daemon 对 Runtime 活动与终态执行兼容双写。
- [ ] T6 增加 Runtime Event 查询与首个 projection。
- [ ] T7 建立持久 Agent Inbox 与 coordination 事件。
- [ ] T8 接入第一组领域事件和 Wakeup Router。
- [ ] T9 迁移 Message、UI、Observability、Harness Outcome 消费者。
- [ ] T10 删除旧 `AgentEvent` 业务副作用与 `agent_event` 兼容写入。
- [ ] T11 完成全量验证、长期事实回写并归档规格。
