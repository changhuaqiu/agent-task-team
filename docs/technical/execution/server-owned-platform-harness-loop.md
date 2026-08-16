# ADR-023: Server-Owned Platform Harness Loop

> 同主题设计文档：[`platform-harness-loop.md`](./platform-harness-loop.md)（已落地状态说明）。本文件保留为该决策的 ADR 记录。

## 状态

Accepted and implemented — 2026-07-14（2026-07-26 完成浏览器控制路径退役）

## 背景

实施前系统虽已具备 Team Runtime、ContextManager、Task Wakeup、A2A、DispatchGateway、ExecutionEnvelope、session、invocation 和 AgentBackend，实际续接仍依赖浏览器 store；本 ADR 决定并已完成该责任迁移。

这使浏览器成为隐含控制面，导致无浏览器无法继续、队列不持久、状态权威重复，并增加 A2A/Wakeup 双派发风险。

## 决策

服务端 Platform Harness 成为 Agent Loop 的续接与派发权威：

- 触发源提交结构化 `AgentActivationCommand`；
- Coordinator 解析角色、运行配置和上下文；
- DispatchGateway 负责派发门禁和 proof；
- Runtime Port 只负责执行并产生统一事件；
- Task/A2A repository 负责业务状态；
- 浏览器只提交用户意图并投影服务端状态。

ACP 和 legacy backend 都位于 `AgentRuntimePort` 后面。ACP 集成不改变 Invocation Pipeline 上层契约。

## 放弃的方案

### 继续由浏览器续接

无法满足无浏览器运行、持久队列和服务端事实权威。

### 重写全部任务、A2A 与执行模块

现有模块已经覆盖核心契约，重写会扩大风险并破坏迭代原则。

### 等 ACP 完成后再建设 Harness

ACP 只解决执行协议，不解决角色、上下文、工作流和续接权威。两者应通过 Runtime Port 并行演进。

## 后果

- daemon 需要暴露可被 Coordinator 调用的执行入口。
- 服务端需要 repository-backed Team Runtime 和 Context providers。
- Socket 事件只保留项目展示投影，不携带浏览器 fallback 开关。
- 持久 Agent Inbox 已接入，负责 busy 排队、claim、lease、恢复和重试。

## 退出与迁移条件

退出条件已满足：所有自动触发走服务端 Harness，没有 compatibility fallback；浏览器 `pendingDispatches`、
`terminal:start` 与 `terminal:kill` 已删除。人工点击或输入经 Human/Task Command 进入服务端 owner，Socket 展示事件
不会产生执行命令。
