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
- [x] Agent Inbox 已冻结为 `enqueued / claimed / admitted / released / expired / cancelled`，
  删除会冒充 Agent 结果的 `completed / failed`。
- [x] lease 过期或调度暂缓进入可重领的 `released`；未被接纳的非重试结果进入 `expired`。
- [x] migration 56、数据库 transition/lease guard、Scheduler、Router 和 Dispatch API
  已迁入新 Inbox 契约。
- [x] Inbox 切片通过 TypeScript、相关 lint 和全量 Vitest（188 files、1446 tests，1 skipped）。
- [x] ExecutionEnvelope 已冻结为
  `drafted / validated / routed / sent / acknowledged / rejected / expired`，删除 Runtime
  重复状态 `queued / started / completed / failed / blocked`。
- [x] Delivery 恢复和 autonomy guard 在派发确认后改读 Invocation，不再把
  `Envelope.acknowledged` 当成执行完成。
- [x] migration 57、Domain Event、DispatchGateway、Daemon receipt 和 WebUI 投影
  已迁入新 Envelope 契约。
- [x] Envelope 切片通过 TypeScript、相关 lint 和全量 Vitest（188 files、1448 tests，1 skipped）。
- [x] Delivery Run 生命周期已与阶段分离；reviewing 等阶段不再冒充运行状态。
- [x] migration 58、revision CAS、数据库 transition/state guard 和终态不可变约束已落地。
- [x] `waiting_human` 只能由 WebUI/API 发出的 `manual_resume` Human Command 恢复；
  周期 reconcile 不会自行恢复。
- [x] Delivery Run 切片通过 TypeScript、相关 lint 和全量 Vitest
  （188 files、1452 tests，1 skipped）。

## S2：Review & Gate

- [x] 统一 review request、evidence、decision 数据模型。
- [x] 将 Git / Delivery review 与 verification receipt 接入 Gate owner。
- [x] 接通 `requestGate`、`changes_requested`、`passed`。

已完成的子项：

- [x] 建立唯一 `QualityGate + immutable GateEvidence + terminal GateDecision` 聚合，
  migration 59 和数据库 trigger 拒绝非法迁移、证据篡改与终态复活。
- [x] Gate identity 绑定 kind、target 和 artifact revision；新 revision 必须创建新 Gate。
- [x] Git PR 创建 `code_review` Gate；provider-backed review 作为 evidence，由 Gate owner
  产生 `passed / changes_requested`，Merge 只读取当前 head 对应 Gate decision。
- [x] `review.submitted/approved/rejected/merged` 不再作为并行权威事件；Delivery Process
  Manager 改为消费 `gate.*`。
- [x] QualityGate 基础切片通过 TypeScript、相关 lint 和全量 Vitest
  （189 files、1455 tests，1 skipped）。
- [x] Task evidence 与 Delivery review/verification 全部改读 QualityGate decision；完成
  TypeScript、相关 lint 和全量 Vitest（190 files、1456 tests，1 skipped）。

## S3：Invocation Pipeline

- [x] 收敛 Inbox、Envelope、Invocation、Session 的完成语义；Inbox 只负责 admission，
  Envelope 只负责 acknowledgement，Invocation 单独保存 lifecycle/outcome，Session 单独保存 binding。
- [x] 引入不可变 WorkContract、当前 WorkAuthority 与结构化 AgentOutcome，并提供 ACP
  invocation-scoped 平台工具及完整信封 API。
- [ ] 实现 profile、session、context、transport 错误归一化。
- [x] 为每次 Work Cell 激活生成 workEpoch / attemptId / fencingToken，将 Invocation 绑定
  Contract，并把迟到 Outcome 持久化为 rejected 诊断。
- [ ] 冻结 WorkContract、AgentOutcome 和 ControlDecision 完整信封。

已完成的子项：

- [x] Migration 60 建立 WorkContract/WorkAuthority/AgentOutcome 约束、不可变触发器、
  Invocation 完整绑定触发器和单终结 Outcome 唯一约束。
- [x] WorkContract issuance 使用 expected epoch CAS；旧 grant、错误 token、版本漂移、
  不允许类型、重复终结结果及幂等内容冲突均有测试。
- [x] WorkContract 与 AgentOutcome 信封已经冻结并贯穿 trace；ControlDecision 信封仍归 S5。
- [x] S3 foundation 通过 TypeScript、目标 lint 与全量 Vitest（193 files passed、1 skipped；
  1472 tests passed、1 skipped）。

## S4：A2A

- [ ] 选择唯一 handoff / possession 数据模型。
- [ ] 迁移 chain/worklist 与 possession/pass 的重复生命周期。
- [ ] 所有 A2A 下游激活先经过持久 Inbox。
- [ ] 建立 wait-for graph 与 handoff hop budget，检测死锁和循环传球。
- [ ] 以 A2ACollaboration 聚合统一 Chain/Possession/Pass，并将旧 worklist 降为只读投影。
- [ ] 为 fan-out group 实现成功分支 + 原 holder recovery possession 的原子提交。

已完成的基础子项：

- [x] Migration 61 建立单一 `A2ACollaboration` 聚合所需的 revision、pass group、
  parent pass、hop、target possession 与 Inbox 关联字段。
- [x] `offerPassGroup` 在一个事务内创建 Pass、HandoffPacket 和全部 AgentInbox item，
  fan-out 分支失败时原子创建原 holder recovery possession。
- [x] hop budget、祖先循环、source revision 和语义幂等冲突已有聚合测试。
- [x] durable A2A Outcome Process Manager 已把接纳的结构化 `handoff_to_agent`
  Outcome 翻译为聚合 Command；非结构化最终文本不再驱动 WorkContract Invocation 的 A2A。
- [x] durable A2A Lifecycle Process Manager 已区分 Inbox admission 与真实 Runtime start：
  admission 只到 `starting`，Runtime started 才创建 receiver Possession。
- [x] WebUI Human turn 已改为 `message.append -> a2a.human_handoff -> AgentInbox`；
  删除浏览器直接启动后再发 `a2a:user-turn-created` 补登记的反向链路。
- [x] Runtime completion 的 `runtime.a2a_response / runtime.a2a_done` 与生产
  AgentMessenger 实例已删除；任何 Invocation 的最终文本都不再创建协作。
- [x] 项目观测关系已只从权威 `a2a_pass` 与 `a2a_possession_chain` 派生；
  Context prompt 只教授结构化 `agent_submit_outcome`，不再保留文本扫描协议。
- [ ] 旧 AgentMessenger/Orchestrator 源文件、浏览器旧 A2A socket 投影与历史表尚需删除；
  在 `invocation_chain / chain_worklist / a2a_audit_log / a2a_delivery` 完全退役前，S4 不算完成。

## S5：Delivery Supervisor

- [ ] 实现七种 ControlAction 的纯决策函数。
- [x] 将 `escalated` 迁为可恢复的 `waiting_human`，将 `recovering` 迁为 `retrying`。
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
