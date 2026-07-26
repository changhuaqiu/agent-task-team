# WebUI 被动项目投影

状态：implemented（已归档）

## 1. 目标

WebUI 是当前项目事实的展示层，也是人的 Command 输入界面。人的点击、输入和明确确认可以通过正式 Command/API 触发平台事件；但 WebUI 不得因为收到展示事件而自行启动 Agent、推进任务、确认 A2A 或执行恢复动作。

## 2. 成功标准

1. 所有项目级实时事件都携带非空 `projectId`。
2. 服务端只向 `projectId` 对应的 Socket room 发布项目事件。
3. WebUI 在写入 Store 前再次校验事件属于当前项目。
4. 切换项目时清空终端日志、流式消息、Agent 活跃态等瞬态投影，随后从服务端事实恢复。
5. `task.assigned`、`task.wakeup`、`a2a:dispatch`、`terminal:exit` 和 `agent:error` 的浏览器处理器不再调用 `dispatchToAgent`、更新任务状态或向服务端发送执行确认。
6. Runtime 的结构化展示事件不再通过职责混杂的 `agent:event` 信封进入 WebUI，而使用统一、带版本的 `project:view` 契约。
7. 直接 ACP 和 tmux/bridge 的输出都能在项目视图中表达：结构化事件进入活动流并形成可读终端时间线，原始终端字节也进入同一项目终端投影。

## 3. 非目标

- 不禁止人的行为通过 WebUI 调用正式 Command/API 修改项目并产生事件；本规格只禁止展示事件反向触发业务执行。
- 不把 Socket 变成持久事件总线。Socket 仍是 best-effort 投影。
- 不让 WebUI 直接订阅 Platform Event Dispatcher。
- 不重做现有任务、消息和 observability 的持久化事实模型。

## 4. 核心契约

### 4.1 `project:view`

```ts
type ProjectViewEnvelope = {
  version: 1;
  projectId: string;
  occurredAt: string;
  eventId?: string;
  invocationId?: string;
  agentId?: string;
  kind: ProjectViewEventKind;
  payload: unknown;
};
```

`kind` 第一阶段覆盖：

- `runtime.session`
- `runtime.activity`
- `runtime.text.delta`
- `runtime.thinking.delta`
- `runtime.plan`
- `runtime.tool.started`
- `runtime.tool.completed`
- `runtime.tool.failed`
- `runtime.warning`
- `runtime.usage`
- `runtime.completed`
- `terminal.output`
- `terminal.exited`

任务、协作和 observability 的既有 room 事件可以分切片迁移，但必须立即满足相同的 `projectId` 和只读消费约束。

### 4.2 服务端发布接口

服务端通过一个深模块发布项目投影：

```ts
publisher.publish(projectId, event)
```

发布模块负责：

- 拒绝空项目标识；
- 注入 `version`、`projectId` 和时间；
- 只向项目 room 发布；
- 保持 Socket best-effort 语义。

调用方不接触 `io.emit`，也不负责拼装隔离字段。

### 4.3 WebUI 消费接口

WebUI 通过一个入口消费：

```ts
consumeProjectViewEvent(envelope)
```

消费模块负责：

- 版本校验；
- 当前项目校验；
- 按 `kind` 更新展示投影；
- 对未知事件安全忽略并保留诊断信息；
- 永不调用 Command、Harness、任务 mutation 或 Socket ACK。

人的输入使用另一条独立链路：

```text
Human action -> WebUI Command adapter -> server domain module -> domain event
```

`project:view` 不是 Command；消费它只能改变浏览器展示投影。

## 5. 隔离不变量

1. 缺少 `projectId` 的项目事件不得发布、不得消费。
2. 当前项目为 A 时，项目 B 的事件对 A 的 Store 可观察状态零影响。
3. `agentId` 只在项目内唯一；不得仅以 `agentId` 作为跨项目状态身份。
4. 项目切换后，不得显示上一项目的终端日志、活动态、流式缓冲和执行错误。
5. 全局 Runtime catalog 可以保持系统级通道，但不得携带项目运行事实。

## 6. 可靠性

- 持久事实：领域表、Platform Event Log、Agent Inbox、Effect Outbox。
- 可恢复投影：任务、消息、invocation、observability，由 HTTP/数据库快照恢复。
- 瞬态投影：文本 delta、thinking delta、结构化终端时间线和原始终端输出；断线期间允许丢失。
- WebUI 不通过“重放命令”恢复。恢复只能重新读取事实或等待新的投影。

## 7. 迁移

| 切片 | 内容 | 退出条件 |
| --- | --- | --- |
| 1 | 建立 `ProjectViewPublisher` 与共享契约 | 空项目拒绝、room 投递测试通过 |
| 2 | Runtime/ACP/tmux 投影迁入 `project:view` | WebUI 不再订阅旧 Runtime/terminal Socket 事件 |
| 3 | 删除 WebUI 执行兜底 | Socket 展示处理器中无派发、任务推进、A2A ACK |
| 4 | 项目切换与快照恢复 | 跨项目事件和瞬态泄漏测试通过 |
| 5 | 任务/A2A/observability 契约收敛 | 所有项目事件均 room-scoped 且携带 `projectId` |

## 8. 风险

- 删除浏览器兜底会暴露尚未接入 Harness 的生产者；测试必须覆盖每一种 wakeup/dispatch 来源。
- 当前 Store 多处以 `agentId` 建索引，迁移期必须通过当前项目门禁和切换清理防止污染，后续再演进为复合键。
- Socket 事件迁移期间不得双重更新同一展示投影。

## 9. 退出条件

- checklist 全部通过；
- 受影响设计文档、wiki 和事件清单与代码一致；
- 相关 store、daemon、A2A、task-flow、runtime projection 测试通过；
- 类型检查和构建通过；
- 搜索证明 WebUI Socket 展示处理器不存在执行触发。
