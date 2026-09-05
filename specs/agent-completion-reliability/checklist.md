# Checklist

- [x] 过期 starting/running/terminating Invocation 在启动恢复后变为 terminated/failed。
- [x] 失败 Invocation 对应的当前 WorkAuthority 被关闭，现有 Wakeup/Delivery owner 可决定后续动作。
- [x] terminal A2A Pass 不保留 active `a2a-pass:*` Authority。
- [x] terminal Task 不保留 Task-owned Authority，但不误关 Delivery-owned Authority。
- [x] 启动恢复重复运行结果相同且不重复发布业务事实。
- [x] 新旧 done/cancelled Task 都有 `completed_at`。
- [x] EvalSnapshot 冻结 WorkAuthority 与 AgentOutcome，cutoff 语义可复现。
- [x] 评估分别输出 Task 完成率、终态收敛率、Outcome 接纳率和 Attempt 可靠性。
- [x] 失败已收敛的 Task 不会被评为完成，未收敛路径会触发 fail。
- [x] 命令、测试、Trace、PID、数据库与 E2E 证明不再成为独立正式交付件卡片。
- [x] 已退役 handler 不保留永久 queued delivery。
- [x] 固定场景、全量测试、类型检查与生产构建通过。
- [x] C 级评测记录包含 baseline、candidate、局限和 E 级复测条件。
- [ ] accepted `task_graph_first` 图内显式写成 `proposed` 的已分配新 Task 也会原子激活为 `ready`。
- [ ] 未满足依赖的 `ready` Task 不提前派发；依赖完成后只派发一次。
- [ ] 新 handler 版本重放旧 accepted Outcome 时，仅恢复该 Outcome 仍最新拥有的 proposed Task，重复恢复不重复 Inbox。
- [ ] WorkItem 详情用文字展示 Task 状态与依赖，不把 A2A ACK 显示成任务已运行。
- [ ] 真实旧任务恢复后，首批依赖已满足的子任务有 durable Inbox/Invocation 证据。
