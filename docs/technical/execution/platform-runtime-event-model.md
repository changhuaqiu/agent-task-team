# Platform Runtime 事件模型

> 日期：2026-07-24
> 状态：目标设计；基础设施第一切片实施中
> 活动规格：`specs/platform-runtime-events/`

## 定位

项目是多 Agent 协作作用域，Agent 是项目内长期逻辑 Actor，Invocation 是 Agent 的
一次激活。Platform Runtime 只负责可靠执行 Invocation，不拥有 Task、A2A、Review
或 Delivery 事实。

事件系统把项目事实、Agent 调度和 Runtime 执行连接起来：

```text
Domain Event
  -> Wakeup Router
  -> Agent Inbox / Coordination Event
  -> Harness + ContextSnapshot
  -> Runtime Event
  -> Domain Command
  -> Domain Event
```

## 四类事件

| 类别 | 作用域 | owner | 持久化策略 |
| --- | --- | --- | --- |
| Domain | 领域 aggregate | 对应领域模块 | 全量 |
| Coordination | ProjectAgent Inbox | Agent Inbox 模块 | 全量 |
| Runtime Lifecycle | Invocation | Platform Runtime | 全量 |
| Runtime Activity | Invocation | Platform Runtime | 结构事件全量、文本只落完成段 |

所有事件共用 `PlatformEvent` 信封，但使用独立 stream 局部排序。系统不建立项目全局
严格顺序。

## 生产与消费

- Agent、用户和系统产生 Command。
- 对应 owner 校验 Command、提交状态并产生 canonical Event。
- Router 消费领域事件，只向 Agent Inbox 发送 Command。
- Scheduler claim Inbox Item 后由 Harness 构造不可变执行输入。
- ACP、工具和进程只提供原始信号；Platform Runtime 归一化为 `runtime.*` 事件。
- Reducer 维护权威投影，Process Manager 推进跨领域闭环，Projection 服务 UI 和调试。

Agent 不直接订阅事件总线。Agent 被激活时消费 Inbox Item、当前项目事实、私有
Logical Session、Handoff Packet、ContextSnapshot 和 CapabilitySnapshot。

## 当前实现边界

当前生产路径仍以 `AgentEvent`、`AgentResult` 和 `daemon.forwardAgentEvent()` 为主。
第一切片新增 `platform_event` 日志与 Runtime publisher，并在 daemon 中兼容双写，
不改变 Socket、聊天、Session、A2A 和 observation 的现有行为。

daemon 的 ACP 路径通过 `AcpRuntimeEventCoordinator` 驱动接受、启动、Session 绑定、
Adapter 活动与唯一终态；同步启动失败和异步执行失败复用同一协调器，避免错误处理
分支各自拼装事件顺序。

ACP text/thinking delta 继续由现有 Socket 实时投影；兼容 bridge 在工具、错误、完成或
文本类型切换形成的段边界写入 `runtime.message.segment.completed` /
`runtime.thinking.segment.completed`，不产生 token 级持久事件。

Runtime 生命周期迁移校验与事件追加在同一个 SQLite immediate transaction 内完成，
因此同一 Invocation 即使出现多个 publisher 实例，也不能在终态后追加活动事件。
ACP 工具更新保留 `pending`、`in_progress`、`completed`、`failed` 状态；只有后两者
生成 canonical 工具终态，且失败不会降级成完成。

双写是临时迁移机制。只有在 Message、UI、Observability、Harness Outcome 和 Session
投影全部迁移到新事件流后，才能删除旧路径；在此之前不得宣称事件日志已经成为唯一
执行事实源。

## 设计不变量

1. 一个命名空间只有一个 canonical producer。
2. 一个 accepted Invocation 最终且只能 terminated 一次。
3. terminated 后禁止产生新的 Runtime 活动。
4. 相同 dedupe key 的重复写入必须幂等，不同内容必须冲突。
5. 事件先持久化，再发布到进程外消费者。
6. Runtime completion 不等于 Task completion。
7. Agent 通过 Command 影响项目，领域模块裁决并产生领域事实。
