# Platform Harness 状态机实施任务

## S0：术语与观测

- [ ] 建立当前名到目标名的兼容映射。
- [ ] 为 Command、Event、WorkContract、Invocation、Outcome 补齐 correlation/causation。
- [ ] 建立跨模块状态迁移 trace。
- [ ] 建立 project-start、parallel-handoff、review-rework、agent-failure、human-resume、
  delivery-close 六条场景基线测试。

## S1：状态守卫

- [ ] 为 Task、Inbox、Invocation、Delivery 建立显式 transition API。
- [ ] 删除或封装任意字符串状态写入。
- [ ] 冻结各层 completion 语义。
- [ ] 为 Task Graph 建立原子提交、DAG 环检测和版本冲突校验。

已完成的子项：

- [x] Task 收敛为 `proposed / ready / in_progress / blocked / in_review / done / cancelled`。
- [x] Task owner 拒绝非法迁移，并用 `expectedFrom` 对陈旧事实进行 fencing。
- [x] API、技能工具、工程协作、Daemon、Harness outcome 和 TASKS.md 适配器全部改走
  `taskRepo.transition`；普通更新拒绝夹带状态。
- [x] migration 54 归一化历史状态，并以数据库 trigger 阻止未知状态和非法规范状态跳转。
- [x] `rejected / test_gate / abandoned / merged` 从 Task 语义中移回 Gate、Attempt 和 Task Graph。
- [x] Task 状态切片通过 TypeScript 检查和全量 Vitest（188 files、1443 tests，1 skipped）。
- [x] Invocation 生命周期已冻结为 `planned / starting / running / terminating / terminated`，
  terminal outcome 独立为 `completed / failed / cancelled / timed_out`。
- [x] 终态 Invocation 不可复活；自动重试创建新的 Invocation，Session binding 不再写执行结果。
- [x] migration 55、API、Daemon、Session、Evaluator 和 Task watcher 已迁入新 Invocation 契约。
- [x] Invocation 切片通过 TypeScript、相关 lint 和全量 Vitest（188 files、1444 tests，1 skipped）。

## S2：Review & Gate

- [ ] 统一 review request、evidence、decision 数据模型。
- [ ] 将 Git / Delivery review receipt 接入 Gate owner。
- [ ] 接通 `requestGate`、`changes_requested`、`passed`。

## S3：Invocation Pipeline

- [ ] 收敛 Inbox、Envelope、Invocation、Session 的关联和终态。
- [ ] 引入 WorkContract 与结构化 AgentOutcome。
- [ ] 实现 profile、session、context、transport 错误归一化。
- [ ] 为每次 Work Cell 激活生成 workEpoch / fencingToken，拒绝迟到 Outcome。
- [ ] 冻结 WorkContract、AgentOutcome 和 ControlDecision 完整信封。

## S4：A2A

- [ ] 选择唯一 handoff / possession 数据模型。
- [ ] 迁移 chain/worklist 与 possession/pass 的重复生命周期。
- [ ] 所有 A2A 下游激活先经过持久 Inbox。
- [ ] 建立 wait-for graph 与 handoff hop budget，检测死锁和循环传球。
- [ ] 以 A2ACollaboration 聚合统一 Chain/Possession/Pass，并将旧 worklist 降为只读投影。
- [ ] 为 fan-out group 实现成功分支 + 原 holder recovery possession 的原子提交。

## S5：Delivery Supervisor

- [ ] 实现七种 ControlAction 的纯决策函数。
- [ ] 将 `escalated` 迁为可恢复的 `waiting_human`。
- [ ] 分离 Invocation retry、Effect retry、Task rework 和 Agent local retry 预算。
- [ ] 深化 System Control Plane 的 Team Scheduling 能力，在角色、依赖、容量和 possession
  约束下选择可激活 Work Cell；不另建重复事实源。
- [ ] 增加公平性、角色容量与饥饿测试。
- [ ] 支持一次 reconcile 返回容量约束的有序动作集，冻结 action identity。
- [ ] 将 blocking Effect 分类、适用区间和显式 cancelled/superseded 写入 Effect Command，
  并接入 Closure CAS。

## S6：迁移清理

- [ ] 迁移窄义 Harness 旧命名的全部调用者。
- [ ] 删除已无读者的兼容分支、投影、状态字段和文档。
- [ ] 更新长期文档、架构图和测试证据。
- [ ] 完成退出条件并归档本规格。
