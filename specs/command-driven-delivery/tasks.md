# 命令驱动的交付内核任务

## 契约与内核

- [x] 确认事实面/观察面、CommandService、MCP/CLI Adapter 与回执契约。
- [x] 建立公共 ProductCommand、CommandReceipt、reason code 与 canonical input 类型。
- [x] 建立 Command Kernel dispatcher；`work.submit_outcome`、`project.create` 与 `project.agent.add/remove` 已集中处理事务、事件与统一回执，其余领域 handler 继续接入。
- [ ] 将 Task、Outcome、Gate、Delivery/Release owner handler 接入 Command Kernel；Artifact 先以 Clowder 式自动 Ledger 投影接入，registered 状态继续由 Outcome owner 提升。
- [ ] 建立声明式命令注册表，并让 Human API、typed MCP、`ath` CLI 从同一 entry 生成/调用适配器。
- [x] 将 Agent Definition 的 `agent.create` / `agent.update` 接入 Command Kernel；页面与兼容 API 不再直接写 Agent Repository，导入仍先形成本地草稿。
- [ ] 把 WorkItem Category、独立 Review、ObjectReference 与 ReferenceIndex 接入持久化和 PlatformEvent。
- [ ] 增加禁止 Runtime/页面 API 绕过 Command Kernel 写领域 Repository 的架构测试。

## Agent 接口

- [x] 把聚合 outcome 工具拆为单意图结构化 MCP 工具并保持 owner-local Schema。
- [x] MCP 工具返回统一 CommandReceipt；accepted 终态回执强制结束 turn。
- [x] 增加 `ended_without_outcome`、重复终态、stale authority、stale revision 测试；持久 Worker 已覆盖无回执退出、canonical/ACP namespaced tool 已接纳回执正例，WorkContract repository 覆盖重复终态与 stale authority/revision。
- [x] 建立 `ath` CLI，采用 JSON stdin/stdout、稳定退出码和 `delivery_unknown`。
- [x] 验证 MCP、CLI/Human API 对已接入命令复用同一 handler 与 receipt；其余命令随 registry 扩展补齐。

## 交付与页面

- [x] 去除“创建交付”作为项目协作前置条件；保留可创建的长期 Project。
- [x] 将用户级 Delivery 前置降为内部编排/投影视图，并落地可选 Release 聚合；Release 只冻结 Project 内正式 Work/Review。
- [x] 项目时间线区分 Runtime Activity 与 Command Fact 卡片；重复观察按语义键折叠，domain event 以独立事实卡投影。
- [x] Workspace / Project / Agent 对象面已分离，WorkItem、Artifact 与 Review 从同一 Project 投影进入对象视图和既有详情入口。
- [ ] 删除“Review=Task in_review”临时实现，完成 Repository/Base/Compare 驱动的独立 Review 创建、列表、详情和决定闭环。
- [x] Agents 页面承载 AgentTeam 创建、编辑、删除与部署；Team 只选择真实 Agent，不再导入/复制角色素材或成员执行快照；四类写操作均进入 CommandService 并使用幂等/revision 门禁。
- [x] Agents 创建器完成基础身份、默认/自定义 Harness、模型、指令权限、并行度、实例命名池、Skills、权限和草稿丢失保护；并行度与实例名称池真实控制 ACP worker pool。
- [x] 废弃“团队能力 / 角色素材”产品层；Agent 工作指令直接进入 Runtime identity prompt，Task 通知与评估快照从 Agent Definition 读取职责、权限和 revision，Team 修改不再反写 Agent 配置。
- [x] 删除 RoleCard 导入、编辑、详情组件与 Team 成员能力覆盖 API；Mention、任务负责人、Agent Bar 和运行资料只读取 Agent Definition。
- [x] Project 添加器先浏览/搜索已有对象，无精确匹配时进入预填名称的新建表单。
- [x] Project 新建的返回、失败保留、脏草稿保护和成功后打开权威对象有组件测试与真实页面验证；真实 EXE 仍随桌面总验收执行。
- [x] 把统一对象创建协议扩展到 Work、Review、Agent、Automation 和可选 Release；Release 创建/发布均进入 Command Kernel。
- [x] Project Automation 完成卡片浏览、共享创建/编辑器、默认关闭、revision 启停、立即运行、事件/手动/schedule 触发、顺序动作与 Run trace；Agent 动作只写入 AgentInbox。
- [x] Automation durable handler 排除 `automation.*` 用户触发、按 source event/schedule window 去重，并在 daemon 重启后恢复 pending Run；项目通知通过现有消息投影即时进入协作流。
- [x] Automation Run 冻结 Definition revision/Trigger/Actions；事件订阅使用 activation watermark 与版本历史；临时失败交回 durable dispatcher，同一失败 Run 可查看逐步 trace 并人工重试。
- [x] Automation Action Registry 首批接通 `work.create` Product Command，并以稳定 step receipt 处理成功、冲突、拒绝与 delivery unknown。
- [x] 增加持久 AutomationDecision、`automation.decide`、批准后 durable resume、拒绝后取消及 Project trace 原位操作。
- [x] 增加 Automation Definition 的代码复制/导入；只交换经 schema 校验的 Definition，导入默认关闭且不携带运行历史。
- [x] Project 消息回复使用服务端校验的 `replyToMessageId/threadRootId`，Inbox 与消息流按同一 root 聚合；Thread 详情侧栏与精确深链待完成。
- [x] 完成 Clowder 式 Artifact Ledger：成功写工具自动发现、Outcome evidence 自动登记、同 ref 合并、Project 页面与 Agent briefing 共用投影。
- [x] 将 `work_handoff` 从不透明 payload 改为显式 MCP Schema，并由 ACP Adapter 统一外层/领域幂等身份，消除合法交接被 `a2a_outcome_invalid` 连续拒绝的问题。
- [ ] 完成状态只从 receipt、artifact revision、gate 与 release policy 计算。
- [x] 为 Task `in_review` 增加 revision-bound Gate durable backfill；普通 Project 幂等派发 reviewer，active Delivery 从同一 `gate.requested` 事实继续编排。
- [x] 评审中 Task revision 变化会在同一写事务内 supersede 旧 Gate/reviewer authority 并创建当前 Gate；每次 replay 都重新收敛旧 authority，WorkContract 签发与 Gate outcome admission 均强制 current artifact revision，outcome 另强制 authorized evaluator 与禁止自评。

## Runtime

- [x] 建立统一 `DispatchAdmission` Module，让 Human/A2A/Workflow/Gate 在签发 WorkContract 前共用任务归属、Agent 职责、阶段和权限判定。
- [x] 将 Agent Definition revision、职责和写/评审能力冻结进 WorkContract；规划合同不得获得代码修改授权。
- [x] 增加“未分配任务 + @Mario 开始处理”只进入规划、不产生实现合同的事故回归测试。

- [x] daemon composition root 长期持有 AcpRuntimeDriver；ManagedAgentRuntimeSupervisor、AgentWorkerPool 与 PersistentAcpWorker 已接入真实 Invocation 路径并跨 Invocation 复用健康 transport。
- [x] Durable Inbox 具备 per-runtime-lane FIFO、公平 oldest-head、容量上限、lease/ACK fencing、退避与终态 expiry；显式 dead-letter 投影继续补齐。
- [x] 每个 persistent worker turn 重新签发最小 MCP grant，并在所有终态/异常路径撤销；下一 Session 不继承上一 Invocation 的 MCP server。
- [x] 区分 application failure 与 transport failure，只有后者替换 worker；同 lane 忙时不再错误切换 Worker，stale lease 不能释放新 turn。

## 验证与收口

- [x] 运行 Command Kernel、MCP、CLI、交付投影和 Managed Runtime 测试。
- [x] 运行 TypeScript、全量 Vitest、生产 build 与真实页面/桌面流程。
- [x] 删除本轮被替代的创建入口、Settings Agent 入口和用户级 Delivery 前置文案，并确认评估、调试、任务详情等既有能力仍可到达。
- [x] 更新长期技术、产品与迭代知识文档。
