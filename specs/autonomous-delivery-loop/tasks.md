# 实施任务

## P0：可运行纵向闭环

- [x] 冻结 GoalContract、DeliveryRun、Action、Attempt、Receipt 和 Closure Invariant。
- [x] 新增持久化表与 Repository。
- [x] 实现 `AutonomousDeliverySupervisor.start/advance/get`。
- [x] 实现事务级 Action 去重、Attempt claim、heartbeat、lease 回收与迟到结果 fencing。
- [x] 将现有 Harness 封装为 `ExecutionPort`。
- [x] 监听 Task/Execution 事实变化并触发 `advance()`。
- [x] 增加周期 reconcile，替换只靠内存 TTL 的自主扫描。
- [x] 实现 Verification Receipt 与 Web UI E2E gate。
- [x] 实现 ProviderActionPort 及 GitHub adapter。
- [x] 实现 DeliveryBundle 先持久化、后幂等发布。
- [x] Web UI 支持提交 GoalContract、查看运行状态、查看最终交付。
- [x] 正常路径 Web UI E2E 证明用户只发送一次。
- [x] 修复 v42 水位与 Run 表结构不一致时 Supervisor 无法启动，并增加数据保留回归测试。

## P1：恢复与安全

- [x] failure taxonomy 与 bounded exponential backoff。
- [ ] poisoned session 保留 workdir、切换 session generation。
- [x] runtime offline / lost response reclaim。
- [x] policy denied / missing authorization 最小升级。
- [x] Provider action allowlist、目标仓库/分支校验和审计。
- [x] 进程重启场景集成测试。

## P2：扩展

- [ ] 多 Provider adapter。
- [ ] 固定 Workflow DSL 作为 Squad/开放式路由之外的可选执行模式。
- [ ] 成本、时间和并行度预算。
- [ ] 历史 Run 复盘与策略评估。
