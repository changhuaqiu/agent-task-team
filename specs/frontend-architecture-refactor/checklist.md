# 前端与架构重构验收清单

> Status: active

## 产品与 UX

- [x] 侧栏明确展示 Project -> Delivery，两者不再共用“项目”名称。
- [x] 页面只有一个主创建动作“新建交付”。
- [x] 交付首屏展示阶段、验收进度、当前工作和需要处理。
- [x] 任务完成与验收通过使用不同标签和来源；已完成交付发生历史 Task 冲突时保留真实任务比例并显示“需核对”，不显示伪造的未验收结论。
- [x] 验收进度可展开为逐条证据包；每条结论来自正式 DeliveryBundle，展示验证方式、验证人、报告/规格引用、代码版本和完成时间，Agent 口头声明不计数。
- [x] 团队活动是次级信息，Runtime/Session/Receipt/Lease 等实现词不出现在主视图。
- [x] 同一 Invocation 在并行 Agent 事件穿插时仍只显示一个回复，不同 Invocation 不因发送者相同而被整组折叠。
- [x] Task/唤醒/系统通知不渲染为 Agent 气泡；工具调用摘要始终可见，最终结论无需展开历史分组即可阅读。
- [x] 已完成 Trace 收起时仍显示最近工具名称和目标；超长 Agent 正文默认收敛，但工具、任务引用、证据卡和阻塞事实保持可见。
- [x] 活动区首次只渲染最近 120 个聚合项，用户可按批次显示更早活动；服务端历史不被删除。
- [x] 右面板一级入口只有任务和调试；看板、列表、关系图为视图模式。
- [x] 页面没有外部参考项目的名称、品牌、猫形象、文案、CSS/token 或组件命名痕迹。
- [x] Web 与桌面使用同一个 Renderer 壳层，相同宽度下信息架构和关键交互一致。
- [x] 工作区侧栏提供交付总览，并以命名 Project 分组显示其 Delivery；未把 CommunityRail 误映射成 Project。
- [x] 未选择 Delivery 时不显示团队成员条、空活动时间线、禁用输入框或工作检查器。
- [x] 有数据的总览展示组合指标、继续工作和 Project 进度；零数据只保留一个解释性空态，不伪造样例数据。
- [x] 总览的开放阻塞与详情的用户“需要关注”使用不同投影语义和文案。
- [x] Delivery 详情提供概览 / 活动 / 评估三个 surface，切换时不改变当前 Delivery。
- [x] 每个 Delivery 恢复自己的输入草稿，不会把上一 Delivery 的草稿显示在当前输入区。
- [x] 用户上翻时新消息不抢滚动位置；有明确入口回到最新，自己发送成功后回到底部。
- [x] 引用回复目标可见且可取消，持久结果不伪装成尚未实现的 reply relation。
- [x] 消息操作通过 hover、focus-within 和触屏常驻入口均可发现。

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
