# WebUI 被动项目投影设计

## 1. 决策

WebUI 不属于 Runtime Core、Dispatcher、Process Manager 或 Agent Harness。它是项目事实的 best-effort 展示投影，同时承载人的 Command 输入界面。

这里的“被动”约束的是自动事件消费者，不是人：

- 人的点击、输入、确认可以通过 WebUI 的 Command adapter 调用服务端；
- 服务端领域模块裁决 Command，并产生领域事件；
- WebUI 收到事件后只更新展示，不能自行把事件解释成下一条 Command。

允许的主动动作只有展示层自身的订阅控制和事实查询：

- 选择项目；
- 加入/离开对应项目 room；
- 请求当前项目快照；
- 人明确发起的正式 Command/API。

禁止由展示事件反向产生执行动作：

- 收到 task assignment/wakeup 后启动 Agent；
- 收到 A2A dispatch 后启动 Agent 或回传执行 ACK；
- 收到 terminal exit/error 后重新派发或推进任务；
- 根据本地 Store 推断领域状态并写回服务端。

Agent 执行、恢复、重试和 A2A 推进只由服务端 Agent Inbox、Harness、Process Manager 与 Effect Worker 拥有。

## 2. 项目投影 seam

服务端通过 `ProjectViewPublisher.publish(projectId, event)` 这一小接口发布展示事件。该模块隐藏 room 选择、信封版本、项目标识和时间注入；调用方不得使用全局 `io.emit` 发布项目事实。

WebUI 只通过 `consumeProjectViewEvent(envelope)` 接收 Runtime 展示流。消费者先校验：

1. `version` 是支持的版本；
2. `projectId` 非空；
3. `projectId` 等于当前选择项目。

校验失败时不允许产生任何 Store 变更。服务端 room 隔离是第一道防线，浏览器项目门禁是第二道防线，二者不可互相替代。

## 3. 事件与事实

`project:view` 不是第五类 Platform Event，也不是事实源。它是由 canonical Runtime Event、领域表和瞬态 Runtime 输出派生的展示信封：

```text
领域表 / Platform Event / Agent Inbox / Effect Outbox  = 持久事实
                          |
                          v
               Project View Projection
                          | project room
                          v
              WebUI display projection Store
```

结构化 Runtime 事件、ACP delta、tmux/bridge 原始输出可以共享该展示信封，但必须使用明确的 `kind`，不得继续把 plan/tool/usage/error/system 混入无约束的 `agent:event`。终端视图同时投影 ACP 文本与结构化 plan/tool/warning/completion 时间线，因此不再只对 tmux/bridge 有内容。

Socket 断线不通过重放命令恢复；持久部分重新查询事实，瞬态 delta 和终端字节允许丢失。

## 4. 项目隔离不变量

1. 项目事件必须携带 `projectId`，且只投递到同名 room。
2. `agentId` 只在项目内唯一，不是跨项目身份。
3. 项目切换必须清空终端日志、流式缓冲、Agent 活跃态和执行错误等瞬态投影。
4. 当前项目 A 的 WebUI 收到项目 B 的信封时，所有可观察状态保持不变。
5. Runtime catalog 等真正的系统级状态可以使用系统通道，但不得夹带项目运行事实。

## 5. ADR

### ADR-007：WebUI 自动消费者只更新展示投影

- 背景：浏览器曾同时承担展示、Agent 派发、失败恢复和 A2A 确认，导致断线、重复标签页和跨项目状态污染都会改变执行结果。
- 决策：服务端拥有全部自动执行职责；WebUI 的事件消费者只能更新展示 Store。人的显式操作通过独立 Command adapter 进入服务端，不受此限制。
- 替代方案：保留浏览器兜底派发。否决原因是它让同一领域动作拥有浏览器和服务端两个 owner，无法形成可靠的幂等与恢复语义。
- 后果：服务端必须覆盖所有 wakeup/dispatch 来源；浏览器断线只影响实时可见性，不影响任务执行。
- 退出条件：搜索和自动化测试证明 Socket 展示处理器不调用执行入口，且跨项目事件不能改变当前项目状态。

### ADR-008：不保留可重新激活旧架构的兼容控制路径

- 背景：只停用调用方、但保留浏览器派发 ACK、失败兜底、旧 Socket listener 和陈旧事实文档，会让仓库同时表达两套 owner。后续维护者可能重新接上旧路径，使浏览器在线状态再次影响执行结果。
- 决策：兼容代码只有在仍有真实生产者、明确退出条件和覆盖测试时才能保留。已经没有生产者的控制事件、handler、类型、测试和“当前事实”文档必须一起删除或归档。
- 不允许的“整洁性假象”：把旧 handler 留成 no-op；只删除 `dispatchToAgent()` 调用但继续注册旧控制事件；用注释称其为兼容却没有退出条件；让活动 spec 与已实施长期设计并存。
- 后果：架构审计必须同时覆盖生产者、消费者、文档和测试。搜索结果不是完成证据，必须由可执行契约证明展示事件不会产生网络写入、持久化或执行命令。
- 退出条件：仓库只剩一条自动执行 owner 链；所有活动文档与代码一致；已实施 spec 已归档；静态架构测试能阻止旧控制事件和全局项目广播回归。

## 6. 架构一致性门禁

以下不变量适用于所有前后端模块，而不只适用于 `project:view`：

1. **事件消费无控制副作用**：浏览器 Socket 消费者可以更新本地展示 Store、订阅、查询快照；不得调用 mutation、`fetch` 写接口、`socket.emit` 控制事件、Harness、Inbox 或任务状态更新。
2. **Human Command 有显式来源**：只有人的点击、输入和确认，或明确的服务端自动化 owner，才能创建 Command。Human Command adapter 不得被展示事件处理器复用。
3. **自动执行只有服务端 owner**：Task wakeup、A2A handoff、恢复和重试由 Inbox、Harness、Dispatcher、Process Manager 或 Effect Worker 持有；浏览器无兜底协议。
4. **项目事实双重隔离**：服务端只发项目 room 且信封携带 `projectId`；浏览器在变更 Store 前校验当前项目。
5. **系统通道不夹带项目事实**：`io.emit` 仅允许真正的系统 catalog/health 信号；项目运行、任务、协作、observability 和错误必须 room-scoped。
6. **兼容路径有生命周期**：每条兼容路径必须有当前生产者、原因、退出条件和测试；否则删除。已实施 spec 必须迁入 `docs/archive/specs/`。

实施期契约已经归档到 [`docs/archive/specs/webui-passive-project-projection/`](../../archive/specs/webui-passive-project-projection/)；全仓一致性整改记录已归档到 [`docs/archive/specs/runtime-architecture-integrity-audit/`](../../archive/specs/runtime-architecture-integrity-audit/)。

配套架构图见 [`platform-runtime-webui-current-architecture.html`](./platform-runtime-webui-current-architecture.html)。图中将人的主动 Command 通路与 WebUI 自动展示消费通路分开表达。
