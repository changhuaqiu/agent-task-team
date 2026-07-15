# ADR-023: Server-Owned Platform Harness Loop

> 同主题设计文档：[`platform-harness-loop.md`](./platform-harness-loop.md)（已落地状态说明）。本文件保留为该决策的 ADR 记录。

## 状态

Accepted — 2026-07-14

## 背景

当前系统已具备 Team Runtime、ContextManager、Task Wakeup、A2A、DispatchGateway、ExecutionEnvelope、session、invocation 和 AgentBackend，但实际续接仍依赖浏览器 store。服务端能够判断下一位 Agent，却只能向浏览器发送事件；浏览器再组装上下文并发出 `terminal:start`。

这使浏览器成为隐含控制面，导致无浏览器无法继续、队列不持久、状态权威重复，并增加 A2A/Wakeup 双派发风险。

## 决策

服务端 Platform Harness 成为 Agent Loop 的续接与派发权威：

- 触发源提交结构化 `HarnessTrigger`；
- Coordinator 解析角色、运行配置和上下文；
- DispatchGateway 负责派发门禁和 proof；
- Runtime Port 只负责执行并产生统一事件；
- Task/A2A repository 负责业务状态；
- 浏览器只提交用户意图并投影服务端状态。

ACP 和 legacy backend 都位于 Runtime Port 后面。ACP 集成不改变 Harness 上层契约。

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
- 迁移期保留浏览器兼容事件，但必须携带是否已由 Harness 处理的标记。
- 后续可引入持久 dispatch inbox，而无需改变触发、上下文或 Runtime Port 契约。

## 退出与迁移条件

当所有生产触发均走服务端 Harness、没有 compatibility fallback、ACP Runtime Port 通过兼容套件后，删除浏览器调度权威、本地 pending queue 和 bespoke runtime 分支。
