# Workspace 应用层

> 状态：Current（Delivery/Work 主流程已统一）
> 日期：2026-08-23

## 定位

上层不是 Conversation、Task 和多个 API 的集合，而是用户在本地项目空间中推动一次交付。统一模型为：

`Project（工作空间） -> Delivery（目标与验收） -> Work（任务与证据） -> Agent（执行身份）`。

`Conversation` 是现有数据库兼容名称，只允许在 `DeliveryWorkspaceProjection` 的输入边界出现；页面组件不得把它当作产品对象。

## 两个深 Module

### WorkspaceCommandGateway

唯一 Interface 是 `submit(command) -> receipt`。Command 是带 actor、scope、idempotencyKey、issuedAt 的判别联合；Receipt 是服务端对接纳、拒绝、重复和权威结果的统一确认。

该 Module 负责输入归一化、范围校验、幂等回执和跨领域应用编排；实际 Delivery、Task Graph、Collaboration 和 Runtime 事实仍委托给原有 owner。它不成为新的 God Object，也不复制领域状态机。幂等键先进入独立于 Delivery 生命周期的 `workspace_command_journal`；owner token 通过 heartbeat 续租，长操作返回后及下游副作用前必须再次执行 fence。删除 Delivery 不删除历史回执，失败后的同键重放从持久事实继续。

交付创建是一个应用操作：兼容 Conversation 聚合创建、项目上下文初始化和可选自主 DeliveryRun 启动由服务端统一编排。浏览器不再做“创建记录 -> 启动运行 -> 查询 -> 补偿删除”。
自主运行的初始推进与 accepted 回执在同一 SQLite 事务中写入 durable advancement queue；reclaim owner 即使看到既有 DeliveryRun 也会幂等补齐同一 queue item，不能留下“已接纳但从未启动”的运行。

拆解确认也是一个应用操作：阶段、Task Graph commit 与 `.ath` 投影由 `delivery.breakdown.confirm` 的一个稳定幂等键协调。浏览器只有在收到完整权威回执后才更新阶段和任务，不再循环 fire-and-forget 写入。

### DeliveryWorkspaceProjection

唯一 Interface 是 `project(source, deliveryId) -> DeliveryWorkspaceView`。页面根组件只计算一次并向下传递；DeliveryWorkspaceView 统一暴露 project、delivery、stage、acceptance、work、attention、recentActivity，子组件不得重复从全局 Store 拼装领域含义。

## 操作流

```text
Renderer intent
  -> WorkspaceCommandGateway
  -> authenticated Web adapter
  -> WorkspaceCommandService (validate + idempotency + orchestration)
  -> Delivery / Task / Collaboration owner
  -> durable fact + project:view
  -> DeliveryWorkspaceProjection
  -> Renderer
```

展示事件绝不能反向触发 Command；Socket 断开、页面重载和多标签页只影响投影新鲜度，不改变自动执行结果。

## 兼容退出条件

- 所有页面与 Store 消费者不再导入 `HumanCommandGateway`；兼容导出随后删除。
- 所有显式用户业务写入不再直连 `/api/mutations`、`/api/task-graph`、`/api/autonomous-delivery`。
- `/api/phases` 仅保留兼容读取/内部接口，Renderer 的阶段写入统一提交 `work.phase.*` Command。
- `Conversation` 类型仅存在于 repository 与 Projection producer，UI 统一使用 DeliveryWorkspaceView/DeliverySummary。

本轮按产品决策采用 clean break，不迁移旧浏览器 localStorage 领域快照；SQLite 持久事实是唯一启动来源。
