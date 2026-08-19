# 前端与架构重构验收清单

> Status: active

## 产品与 UX

- [x] 侧栏明确展示 Project -> Delivery，两者不再共用“项目”名称。
- [x] 页面只有一个主创建动作“新建交付”。
- [x] 交付首屏展示阶段、验收进度、当前工作和需要处理。
- [x] 任务完成与验收通过使用不同标签和来源；已完成交付发生历史 Task 冲突时保留真实任务比例并显示“需核对”，不显示伪造的未验收结论。
- [x] 团队活动是次级信息，Runtime/Session/Receipt/Lease 等实现词不出现在主视图。
- [x] 同一 Invocation 在并行 Agent 事件穿插时仍只显示一个回复，不同 Invocation 不因发送者相同而被整组折叠。
- [x] Task/唤醒/系统通知不渲染为 Agent 气泡；工具调用摘要始终可见，最终结论无需展开历史分组即可阅读。
- [x] 已完成 Trace 收起时仍显示最近工具名称和目标；超长 Agent 正文默认收敛，但工具、任务引用、证据卡和阻塞事实保持可见。
- [x] 右面板一级入口只有任务和调试；看板、列表、关系图为视图模式。
- [x] 页面没有外部参考项目的名称、品牌、猫形象、文案、CSS/token 或组件命名痕迹。

## 投影与项目隔离

- [x] 主工作区组件通过 `DeliveryWorkspaceProjection` 消费跨领域数据。
- [x] DeliveryRun 阶段投影滞后时，主视图以 Task 权威状态校正展示，评审任务不会显示成“正在规划”或“等待下一项工作”。
- [x] 错项目、未知版本或空 `projectId` 的展示事件不会改变当前视图。
- [x] 项目切换清除瞬态运行投影，但不丢失未发送草稿。
- [x] 未选交付时不能提交活动，Store 不会隐式创建或选择交付。
- [x] 关系图迟到响应不会覆盖当前交付；返回范围与当前交付不一致时回退到本地投影。
- [x] “需关注”只统计人工 blocker 和自主交付 `waiting_human`，不把普通 ready/review 或自动 gate 失败算作用户待办。
- [x] 持久消息在刷新重连后自动对账，不重复、不回滚实时内容。
- [x] 服务端能依据交付完成前已持久化的评审通过记录幂等修复 Task 投影回退，并发布可审计的 Task/Proof 事实。
- [ ] Conversation 兼容映射只存在于投影边界并有退出条件。

## Command 与控制面

- [ ] 所有人的显式操作通过 `HumanCommandGateway` 获取 receipt。
- [x] 补充要求的消息、A2A possession 与 Inbox 工作由一次服务端事务提交，并按 idempotency key 返回权威 receipt。
- [x] 展示事件消费者不 import、不调用 Command Interface。
- [x] 任务创建、改派和状态变化不在浏览器自动触发 Agent 执行。
- [x] React/store 生产代码中没有 `terminal:start` emitter。
- [x] 浏览器不持有 Runtime admission、busy queue、自动重试或执行成功事实。
- [x] 服务端 Command owner、Inbox、DispatchGateway 和 Task Authority 是唯一自动执行链。

## Daemon

- [ ] Daemon 只消费已裁决的执行命令和取消命令。
- [x] Daemon ExecutionAdapter 只处理定向 envelope 与执行生命周期；自主恢复和 closure policy 由服务端 owner 决策。
- [x] 本地 directed admission、原子进程占位、no-ACK、unreachable 和重复回调测试通过。
- [ ] 多节点远端 transport 与 daemon 重启恢复测试通过。

## 质量

- [x] 投影 Interface、Command Interface 和 Project View Adapter 的测试通过。
- [x] 关键组件测试与浏览器 E2E 通过。
- [x] 架构依赖门禁通过。
- [x] TypeScript 类型检查通过。
- [x] 相关测试、全量测试和生产 build 通过，或已记录与本规格无关的稳定基线失败。
- [x] 设计文档、wiki、活动规格和实际代码一致。
- [x] 变更来源检查确认没有复制外部实质代码或品牌资产。
