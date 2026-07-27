# Platform Harness 状态机实施任务

## S0：术语与观测

- [x] 将窄义 Harness 直接迁为 Invocation Pipeline 目标命名，不保留旧别名。
- [x] 为 Command、Event、WorkContract、Invocation、Outcome 建立连续 correlation/causation；
  Invocation 通过不可变 WorkContract 关联信封，不复制可能漂移的字段。
- [x] 建立 `PlatformEventLog.listTrace(correlationId)` 跨 stream 状态迁移 trace，并为
  correlation 建索引。
- [x] 建立 project-start、parallel-handoff、review-rework、agent-failure、human-resume、
  delivery-close 六条命名场景基线；分别覆盖启动派发、真实结果汇合、Gate 返工预算、
  执行权撤销与恢复、显式人工恢复、冻结 Bundle 后完成交付。

## S1：状态守卫

- [x] 为 Task、Inbox、Invocation、Delivery 建立显式 transition API。
- [x] 将状态写入封装进 owner repository，并以数据库 trigger/约束拒绝未知值和非法迁移。
- [x] 冻结 Task、Inbox、Envelope、Invocation、Session、Gate、A2A、Delivery 各层独立
  completion 语义。
- [x] 为 Task Graph 建立原子 commit、依赖引用/DAG 校验、graph revision CAS 和源事件语义
  幂等；durable Outcome Process Manager 已接通 `propose_task_graph`。

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
- [x] durable Gate Outcome Process Manager 将接纳的 `record_gate_decision` Outcome 校验后
  翻译为 Gate owner 的 evidence/evaluating/decision Commands；Delivery Gate 同步保存
  已校验 receipt，不再依赖旧推进器轮询 proof 文本。

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
- [x] 实现 profile、session、context、transport 错误归一化；preflight 由 Harness
  边界发布，ACP session/transport/diagnostic 由 Runtime Adapter 发布，原始诊断只作 evidence。
- [x] 为每次 Work Cell 激活生成 workEpoch / attemptId / fencingToken，将 Invocation 绑定
  Contract，并把迟到 Outcome 持久化为 rejected 诊断。
- [x] 冻结 WorkContract、AgentOutcome 和 ControlDecision 完整信封；Control snapshot
  显式包含 Work Cells、wait-for edges 与 closure。

已完成的子项：

- [x] Migration 60 建立 WorkContract/WorkAuthority/AgentOutcome 约束、不可变触发器、
  Invocation 完整绑定触发器和单终结 Outcome 唯一约束。
- [x] WorkContract issuance 使用 expected epoch CAS；旧 grant、错误 token、版本漂移、
  不允许类型、重复终结结果及幂等内容冲突均有测试。
- [x] WorkContract、AgentOutcome 与 ControlDecision 信封已经冻结并贯穿 trace。
- [x] `runtime_profile_missing` 不再冒充一次 Agent 执行失败，而是
  `runtime.invocation.blocked`；`required_context_missing` 以结构化缺失项发布
  `context.snapshot.rejected`。ACP session 丢失、transport fallback 和 CLI error trace
  分别归一为 session、transport 和 diagnostic 事件。
- [x] Delivery Process Manager 已订阅 Task、Gate、Context 与可恢复 Runtime 事实；
  原始 `runtime.diagnostic.observed` 明确不触发 reconcile。
- [x] S3 foundation 通过 TypeScript、目标 lint 与全量 Vitest（193 files passed、1 skipped；
  1472 tests passed、1 skipped）。

## S4：A2A

- [x] 选择唯一 handoff / possession 数据模型。
- [x] 删除 chain/worklist 与 possession/pass 的重复生命周期。
- [x] 所有 A2A 下游激活先经过持久 Inbox。
- [x] 建立 handoff hop budget 与祖先环检测；跨 Work Cell wait-for graph 留在 S5。
- [x] 以 A2ACollaboration 聚合统一 Chain/Possession/Pass，不保留旧 worklist 投影。
- [x] 为 fan-out group 实现成功分支 + 原 holder recovery possession 的原子提交。

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
- [x] WebUI A2A 状态已改为服务端 `a2a.snapshot` Projection；首屏由 `/api/state`
  恢复同一快照，实时更新只替换读模型，不再消费五组 Orchestrator socket 控制事件。
- [x] 旧 AgentMessenger/Orchestrator、文本 scanner、Worklist/Cursor 源文件与专属测试已删除；
  migration 62 删除 `invocation_chain / chain_worklist / delivery_cursor /
  a2a_audit_log / a2a_delivery`，Drizzle schema 与 conversation cleanup 同步收口。
- [x] Agent 与 Human handoff 共用 A2A Command Guard：目标必须属于 conversation roster，
  Agent source 也必须在 roster 内并通过 Team Runtime communication policy；显式 Human
  Command 只绕过 agent-to-agent policy，不绕过 roster。

## S5：Delivery Control Process Manager

- [x] 实现十种 ControlAction 的纯决策函数；同一 snapshot/policy revision 生成稳定
  decisionId、actionId 与有序动作集。
- [x] 将 `escalated` 迁为可恢复的 `waiting_human`，将 `recovering` 迁为 `retrying`。
- [x] 分离 Invocation retry、Effect retry 与 Task rework 预算：分别读取 Invocation 终结次数、
  Effect Outbox 冻结计数/上限和 Quality Gate 返工历史；Invocation/Task 上限来自
  GoalContract。Agent local retry 归属 Runtime 的单次 WorkContract 自主循环，不进入
  Process Manager 的 `RetryBudgetKind / ControlAction`。
- [x] 深化 System Control Plane 的 Team Scheduling：在角色、依赖、容量和 possession
  约束下选择可激活 Work Cell；WorkAuthority/Contract、Task、Gate、Invocation、Outcome、
  Inbox、A2A 与 Effect 均已接入事实快照或 closure，并由 claim CAS 守卫执行。
- [x] 增加确定性公平 aging、角色容量与饥饿排序测试。
- [x] 支持一次 reconcile 决策返回容量约束的有序动作集，冻结 action identity。
- [x] Migration 64 持久化 ControlDecision 和非 wait ControlAction；首次保存与 claim
  双重校验项目事件 cursor，claim 另校验 workEpoch、slot 唯一占用和 lease token。
- [x] 用权威 WorkAuthority/Contract、Task、Gate、Invocation、AgentOutcome 构造
  `DeliveryControlSnapshot`；同一 decision 的非 wait 动作先原子 batch claim，再执行，
  避免首条 Command 产生的事实错误地 stale 同批兄弟动作。
- [x] 将 A2A Group/Pass wait facts 补入 snapshot；Inbox、Effect 与 dependency facts 已接入，
  持久 ControlAction 已接到 Task/Gate/Inbox/Delivery/Effect owner Command。
- [x] pre-Contract assigned Task 已作为 epoch 0 Work Cell，依赖未满足时 wait；activate/retry
  只写 Durable AgentInbox，requestGate 只写 QualityGate owner，terminate 在同一事务复核
  Task/Bundle/blocking Effect Closure；activate/retry 使用同一容量 slot，Runtime
  started/terminated 与启动前 profile/context 阻塞事实均能释放 slot。
- [x] DeliveryRun 启动幂等下沉到仓储立即事务：GoalContract 强制稳定 idempotencyKey，
  精确重放返回原 Run，内容漂移或同 conversation 非终态并发 Run 被拒绝。
- [x] Delivery 尚无 Task 时构造不占 Agent slot 的 planning Work Cell；
  `initializeGraph` 经 Task owner 幂等建立首个 root Task，再由后续 `activate` 进入 Agent 循环。
- [x] provider integration 从旧推进器的同步 I/O 拆为 `integrate` ControlAction；
  action 只向 Effect owner 幂等提交带 run/revision/sourceAction 的 blocking Effect。
- [x] `publish_delivery` 拆为本地 `finalize` owner Command：从已通过 Gate 的验收/评审
  receipt、Task artifacts 与 provider receipt 构造 Bundle；Bundle 冻结后下一轮才 terminate。
- [x] required Tasks 完成后生成独立 Delivery review/verification Gate Work Cells：先由
  `requestGate` 调 Gate owner，再分别以 `review_gate/test_gate` 激活 Reviewer/QA；
  两者拥有不同 workId/epoch/slot，任一等待不阻塞另一个可运行 Cell。
- [x] production bootstrap 已切换到 `DeliveryControlRuntime +
  DeliveryControlProcessManager`；外部 start/get/advance 端口不变，内部不再创建旧
  `autonomous_delivery_action/attempt`。
- [x] 删除旧 `decideDeliveryNext`、Supervisor、production adapters 与旧 action/attempt 状态；
  migration 67 删除表，migration 68 将新控制表从 `supervisor_*` 重命名为 `delivery_control_*`。
- [x] 建立稳定 wait-for graph cycle 检测，Task dependency deadlock 进入 Human escalation，
  不消耗 Invocation/Effect/Task rework 任一平台重试预算。
- [x] 将 A2A join 接入 wait-for graph：Group 等待 branch terminal result，不以 Runtime
  started 冒充完成；失败终止旧边并以原 source Work 的新 epoch 自动恢复。
- [x] 将有明确 Gate Work Cell 的等待接入 wait-for graph，并在 Control snapshot 暴露
  `waitForEdges` 作为可观测事实。
- [x] 容量等待保留为 policy 派生的瞬时 `wait` 动作，不伪造持久依赖边；Runtime
  terminated 释放 slot，fairness aging 处理饥饿。
- [x] 将 blocking Effect 分类、适用区间、创建时 retry budget 和显式
  cancelled/superseded 写入现有 Effect Outbox，并接入 Control snapshot closure；
  dead-letter 产生 Human escalation，pending 产生无副作用 wait。

## S6：迁移清理

- [x] 迁移窄义 Harness 旧命名的全部调用者；源码目录已从 `src/server/harness`
  收敛为 `src/server/invocation-pipeline`。
- [x] 删除已无读者的兼容分支、投影、状态字段和文档；旧自主交付 spec/设计已归档，
  旧 Supervisor、policy、production adapters 与 Action/Attempt 表已退役。
- [x] 更新长期文档、架构图和测试证据；S6 回归通过 TypeScript、目标 lint 与全量
  Vitest（202 files passed、1 skipped；1421 tests passed、1 skipped）。
- [ ] 完成退出条件并归档本规格。
