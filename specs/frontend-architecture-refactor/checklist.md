# 前端与架构重构验收清单

> Status: active

## 产品与 UX

- [x] 侧栏只展示 Project 与跨项目工作总览，不再嵌套 Delivery/Conversation。
- [x] 页面只有一个全局主创建动作“添加项目”；不存在“新建交付”产品入口。
- [x] 交付首屏展示阶段、验收进度、当前工作和需要处理。
- [x] 任务完成与验收通过使用不同标签和来源；已完成交付发生历史 Task 冲突时保留真实任务比例并显示“需核对”，不显示伪造的未验收结论。
- [x] 验收进度可展开为逐条证据包；每条结论来自正式 DeliveryBundle，展示验证方式、验证人、报告/规格引用、代码版本和完成时间，Agent 口头声明不计数。
- [x] 团队活动是次级信息，Runtime/Session/Receipt/Lease 等实现词不出现在主视图。
- [x] 同一 Invocation 在并行 Agent 事件穿插时仍只显示一个回复，不同 Invocation 不因发送者相同而被整组折叠。
- [x] Task/唤醒/系统通知不渲染为 Agent 气泡；thinking 摘要与最终结论是回复主线，工具调用只显示一个 Invocation 级操作回执。
- [x] 同一 Agent 的并发 Invocation 使用独立实时 stream/buffer/watchdog，完成其中一个不会关闭或合并另一个。
- [x] `runtime.completed`、watchdog 与 `terminal.exited` 都携带 Invocation identity 完成精确 stream；单个进程退出不把同 Agent 其他活动回复置为完成或 idle。
- [x] 工具完成/失败状态进入持久消息观察投影，刷新后操作回执仍保留执行问题数且不会成为答复正文。
- [x] 主时间线不显示最近工具名称、参数或逐条结果；完整 Trace 从观察入口查看，超长 Agent 正文默认收敛，任务引用、证据卡和阻塞事实保持可见。
- [x] 活动区首次只渲染最近 120 个聚合项，用户可按批次显示更早活动；服务端历史不被删除。
- [x] 右面板一级入口只有任务和调试；看板、列表、关系图为视图模式。
- [x] 页面没有外部参考项目的名称、品牌、猫形象、文案、CSS/token 或组件命名痕迹。
- [x] Web 与桌面使用同一个 Renderer 壳层，相同宽度下信息架构和关键交互一致。
- [x] 工作区侧栏提供跨 Project 工作总览；未把 CommunityRail 误映射成 Project。
- [x] 未选择 Project 时不挂载协作输入；选中 Project 后不要求创建 Delivery 即可工作。
- [x] 有数据的总览展示组合指标、继续工作和 Project 进度；零数据只保留一个解释性空态，不伪造样例数据。
- [x] 总览的开放阻塞与详情的用户“需要关注”使用不同投影语义和文案。
- [x] Project Object Workspace 提供概览 / 工作 / 评审 / 产物 / 动态；Agent Conversation 仅按需打开且不改变当前 Project。
- [x] 每个 Delivery 恢复自己的输入草稿，不会把上一 Delivery 的草稿显示在当前输入区。
- [x] 用户上翻时新消息不抢滚动位置；有明确入口回到最新，自己发送成功后回到底部。
- [x] 引用回复目标可见且可取消，持久结果不伪装成尚未实现的 reply relation。
- [x] 消息操作通过 hover、focus-within 和触屏常驻入口均可发现。
- [x] Project 可独立存在并出现在总览/侧栏；用户无需创建空交付来保存项目。
- [x] Agents 一级页面以 Agent 对象为主；打开一个 Agent 可以查看并统一编辑工作指令、Skills、运行环境和模型。不存在独立角色素材或团队能力入口；权限细项仍按 WorkContract 动态裁剪，不在设置页重复组装。
- [ ] Team Pack 与 Delivery 只引用 Agent identity，不再持有第二套 runtime/account/skill 执行配置。
- [x] Agent 设置展示的忙碌/连接状态来自现有运行事实；未实现常驻 lifecycle 时不显示伪造的启动/停止控制。
- [x] Agent 接球、派发与交接摘要位于 Project 视图导航下方的顶部状态栏，不插入消息时间线或输入器区域；记录向下展开且不挤压主内容、消息和输入器。
- [x] Project 状态栏不随子任务会话选择漂移，记录面板可查看完整混合历史，失败原因不暴露内部代码。
- [x] 切换 Project 会关闭旧 Project 的记录浮层，历史状态枚举全部使用用户文案。
- [x] Project 工作页以 WorkItem 为主对象；任务按生命周期分组、整行可打开，状态不以重复徽章堆叠，窄窗口会按信息优先级收敛。
- [x] 收件箱不展示独立 thinking/工具调用/结果条目；Project 回复在正文内保留低权重 thinking 摘要、操作计数与执行问题，完整工具轨迹从 Invocation 观察详情查看，可行动失败以业务事实而非内部工具名呈现。

## 投影与项目隔离

- [x] 主工作区组件通过 `DeliveryWorkspaceProjection` 消费跨领域数据。
- [x] 主视图不解析原始 receipt；逐条证据由 `DeliveryWorkspaceProjection` 从冻结 Bundle 一次性提供。
- [x] `/api/state` 不返回首屏无消费者的 Invocation 调试对象，初始消息窗口按交付有界；选中交付后仍通过消息快照对账。
- [x] 关闭的设置/弹窗/评估/调试不进入首屏业务 chunk；未打开关系图时不会发出 `/api/task-graph` 请求。
- [x] DeliveryRun 阶段投影滞后时，主视图以 Task 权威状态校正展示，评审任务不会显示成“正在规划”或“等待下一项工作”。
- [x] 错项目、未知版本或空 `projectId` 的展示事件不会改变当前视图。
- [x] 项目切换清除瞬态运行投影，但不丢失未发送草稿。
- [x] 未选交付时不能提交活动，Store 不会隐式创建或选择交付。
- [x] 关系图迟到响应不会覆盖当前交付；返回范围与当前交付不一致时回退到本地投影。
- [x] “需关注”只统计人工 blocker 和自主交付 `waiting_human`，不把普通 ready/review 或自动 gate 失败算作用户待办。
- [x] 持久消息在刷新重连后自动对账，不重复、不回滚实时内容。
- [x] 服务端能依据交付完成前已持久化的评审通过记录幂等修复 Task 投影回退，并发布可审计的 Task/Proof 事实。
- [x] Conversation 兼容映射只存在于投影 producer/repository 边界并有退出条件；工作区子组件与侧栏只消费统一 View。
- [x] Workspace Inbox 在持久投影边界按消息类型排除 Runtime thinking 与工具观察，并能幂等清理历史已投影条目，不依赖 UI 文案匹配。
- [x] Runtime thinking/tool 观察不发布为用户消息事实，也不能匹配 Project message Automation；兼容历史事件时在 Automation 边界再次过滤。

## Command 与控制面

- [x] 所有 Delivery/Work 显式用户操作通过 `WorkspaceCommandGateway` 获取 receipt。
- [x] 拆解确认只有一个稳定命令意图；阶段、任务和文件投影不由浏览器循环写入。
- [x] 命令幂等 journal 独立于 Delivery 生命周期，并拒绝同键并发 owner。
- [x] 补充要求的消息、A2A possession 与 Inbox 工作由一次服务端事务提交，并按 idempotency key 返回权威 receipt。
- [x] 展示事件消费者不 import、不调用 Command Interface。
- [x] 任务创建、改派和状态变化不在浏览器自动触发 Agent 执行。
- [x] React/store 生产代码中没有 `terminal:start` emitter。
- [x] 浏览器不持有 Runtime admission、busy queue、自动重试或执行成功事实。
- [x] 服务端 Command owner、Inbox、DispatchGateway 和 Task Authority 是唯一自动执行链。

## Daemon

- [x] Daemon 只消费已裁决的执行命令和取消命令。
- [x] Daemon ExecutionAdapter 只处理定向 envelope 与执行生命周期；自主恢复和 closure policy 由服务端 owner 决策。
- [x] 本地 directed admission、原子进程占位、no-ACK、unreachable 和重复回调测试通过。
- [ ] 多节点远端 transport 与 daemon 重启恢复测试通过。

## 质量

- [x] 投影 Interface、Command Interface 和 Project View Adapter 的测试通过。
- [x] 关键组件测试与浏览器 E2E 通过。
- [x] 架构依赖门禁通过。
- [x] TypeScript 类型检查通过。
- [x] 相关测试、全量测试和生产 build 通过，或已记录与本规格无关的稳定基线失败。
- [x] C 级性能评测记录包含同一现场数据集的前后原始指标、复测命令、限制与保留结论。
- [x] 设计文档、wiki、活动规格和实际代码一致。
- [x] 变更来源检查确认没有复制外部实质代码或品牌资产。
