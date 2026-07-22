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
- [x] 自主项目加载 Team Pack 时禁止 legacy proposal，确保 `plan_goal` 是唯一规划入口。
- [ ] 归一化 ACP 平台 MCP 工具名，确保自主规划器可以调用已授权的 `task_create`。
- [x] 收口 quality-gate 任务裁决：任务工具成为唯一权威写入口，结构化 REJECT 持久化并立即打回实现者，重派保持 `code_review` 场景。
- [x] 将任务工具从个人 Skill 绑定中解耦：按 invocation Task/角色授予基础平台能力，并移除所有 `TASKS.md` 文件写入回退提示。
- [x] Delivery-bound `task_create` 原子写入 `task.created`、`subtask_of` 与 `depends_on`；daemon 通用守卫按整个 Delivery Conversation 隔离，避免边尚未投影时双调度。

## P1：恢复与安全

- [x] failure taxonomy 与 bounded exponential backoff。
- [ ] poisoned session 保留 workdir、切换 session generation。
- [x] runtime offline / lost response reclaim。
- [ ] startup 回收前一进程遗留的 started ExecutionEnvelope；periodic 只回收 pre-start 超时项。
- [x] policy denied / missing authorization 最小升级。
- [x] Provider action allowlist、目标仓库/分支校验和审计。
- [x] 进程重启场景集成测试。
- [ ] 非终态子 Task 存在时，根 Task 的历史/重复 Envelope 不参与 no-progress 恢复耗尽与 `poisoned_session` 升级。
- [x] ACP shell 的 RPC 完成与进程成功分离；超时、非零退出和 watch-mode termination 不能形成成功验证证据。

## P2：扩展

- [ ] 多 Provider adapter。
- [ ] 固定 Workflow DSL 作为 Squad/开放式路由之外的可选执行模式。
- [ ] 成本、时间和并行度预算。
- [ ] 历史 Run 复盘与策略评估。
