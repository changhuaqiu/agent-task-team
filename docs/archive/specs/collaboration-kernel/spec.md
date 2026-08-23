# 统一协作内核规格

> Status: implemented
> Date: 2026-08-23
> Related: `specs/system-control-plane/`, `specs/context-manager/`, `specs/acp-runtime-integration/`

## 1. 用户问题

Agent Task Hub 同时承载多个项目、交付、Agent 和运行端，但当前 Human Command、Task、Gate、A2A、
自主恢复分别构造 `AgentWorkCommand`、Prompt、幂等键和 Runtime 元数据。一次协作跨越 Inbox、Invocation、
ExecutionEnvelope、WorkContract 和领域 Process Manager 后，系统很难用一个事实回答“工作是否已被接住、
由谁负责、结果应返回哪里”。断线、重启或局部失败因此容易表现为漏触发、重复触发或回调悬空。

## 2. 产品定位约束

- Workspace 是 Agent 团队长期协作空间；Project 是代码、知识与权限空间；Delivery 是用户委托的结果单元。
- Agent 是跨交付存在的长期身份，Runtime Process 只是可替换执行载体。
- 用户继续只面对项目、交付、工作项、验收证据和需要处理；协作事件、Lane、Inbox、ACK 只进入调试视图。
- 本轮不把产品改成聊天社区，也不引入 Nostr、社交频道或通用 Event Sourcing。

## 3. 决策

新增深 Module `CollaborationKernel`，领域调用者只使用两个动作：

```ts
interface CollaborationKernel {
  request(input: WorkRequest): WorkRequestReceipt
  cancel(input: WorkCancellation): number
}
```

`WorkRequest` 表达“哪个空间中的哪个 Agent 应完成什么动作，以及结果返回哪里”，不接受预编译 Runtime
Prompt、Session、Node、Lease 或 ExecutionEnvelope。Kernel 内部负责：

1. 规范化 identity、scope、cause、reply address 和幂等身份；
2. 派生稳定 `laneId = projectId + targetAgentId`；
3. 把 requested action 编译为内部 `AgentWorkCommand`；
4. 原子写入 Durable Agent Inbox 与协调事件；
5. 保留用于 ContextManager 的结构化 handoff、work/gate/delivery refs；
6. 让重试、取消、恢复继续以同一 request identity 收敛。

Human、Task、Gate、A2A、Delivery Control 和恢复入口不得直接调用 `AgentInbox.enqueue()`。

## 4. WorkRequest

```ts
interface WorkRequest {
  projectId: string
  targetAgentId: string
  source: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system'
  requestedAction: string
  idempotencyKey: string
  cause: { correlationId: string; causationId?: string; event?: PlatformEvent }
  scope?: { workId?: string; taskId?: string; deliveryRunId?: string; executionMode?: string }
  collaboration?: { fromAgentId?: string; chainId?: string; passId?: string; possession?: RevisionRef }
  context?: {
    scenario?: ContextScenario
    handoff?: A2AHandoffContext
    wakeup?: WakeupContext
    evaluation?: EvaluationContext
  }
  replyTo: ReplyAddress
}
```

`replyTo` 必填。人类根请求回到 Human Command/Delivery；Task/Gate 工作回到对应 owner；A2A 分支回到
Possession/PassGroup。Runtime 终结只产生协作回执，不越权推进 Task、Gate 或 Delivery；领域 Outcome
仍由对应 owner 接纳。

Evaluation Case 同样使用该模型，以 `evaluation_case` reply address 定位 owner，不得直接提交
Invocation。cause event 必须与 request 属于同一 Project。

## 5. Lane 与投递不变量

- 默认串行键是 `projectId + targetAgentId`，同一 Agent 在同一项目最多一个 in-flight。
- 不同 Agent 可并行；未来只有在 Worktree Authority 能证明文件隔离后才能放宽同 Agent 并发。
- 每个 request 使用稳定幂等键；唯一范围是 `projectId + targetAgentId + idempotencyKey`，相同范围内不同内容
  fail closed，不同项目或 Agent 可复用业务键。
- Inbox claim 有 lease、续租、过期释放和有界重试；Socket 只做低延迟投影，不作为投递事实。
- Context 在消费时由 ContextManager 组装，生产者只提交 requested action 与结构化引用。

## 6. Runtime ACK 不变量

ExecutionEnvelope 的阶段语义固定为：

```text
routed -> sent -> acknowledged -> execution finished/failed
```

`acknowledged` 只能在目标 Runtime 已完成以下动作后记录：

1. 创建并持久化 Invocation；
2. 取得有效 Session generation；
3. 完成 ACP backend/permission/setup 准备；
4. 已取得本轮 execution event/result/kill handles。

准备前失败保持未 ACK，并以明确 reason code 拒绝；ACK 后失败记录 execution failure。Runtime 正常终结
不等于业务完成。

上述第 3/4 项由 `AgentRun.started` readiness contract 表达，而不是“execute 返回对象”这一弱代理。
Inbox claim token 必须贯穿到 ACK：取消、lease loss 与 worker shutdown 在 ACK 前撤销执行权限。启动失败使用
`runtime_start_failed` 使用独立失败计数有界重试，busy 不消耗该预算。ACK 与 Inbox admission 必须在同一
持久事务中同时比较 claim token 与 Invocation owner lease 后提交，不能使用 check-then-ACK。Runtime 执行期间必须持久化 owner token 与
renewable lease；live lease 使所有 daemon 都把该 project + Agent lane 视为 busy。只有 owner lease 过期
才能终结 orphan 并轮换 Session generation，不能仅凭另一进程的内存 Map 判断 owner 是否消失。Runtime event
和 terminal result 必须在 owner-token + live-lease 的写事务内线性化；旧 owner 的迟到结果不得更新
Invocation、Session 或任何业务 owner。Evaluation 的 `planning -> running` 必须可由 durable
`agent.work.admitted` 重放恢复，不能依赖 ACK 后的易失内存步骤。

## 7. 直接替换

用户已授权直接重构，本轮不保留领域侧 `AgentInbox.enqueue()` 兼容入口。内部 Inbox repository 与 worker
可以继续存在，但只能由 Collaboration Kernel 模块树和 daemon composition root 使用。旧 Router 暴露
`AgentWorkCommand` 的接口删除或收进 Kernel。

## 8. 验收

- 五类生产触发均只调用 `CollaborationKernel.request()`；静态架构测试阻止回归。
- 同一 request replay 只产生一个 Inbox item；内容冲突明确失败。
- 同项目同 Agent 串行、不同 Agent 并行。
- A2A request 保存明确 `replyTo` 和 handoff refs，回调可由持久事实定位。
- ACP setup 失败不会留下 acknowledged Envelope；真实 execution handle 创建后才 ACK。
- 重启后未完成 Inbox 工作可重新 claim，不依赖浏览器或 Socket。
- ACK 前 crash/cancel/lease loss 不会留下可迟到 ACK 的旧 worker；orphan Invocation 可恢复。
- ACK 后 owner lease 失效并被接管时，旧 Runtime 的 event/result 被 fencing 丢弃。
- ACK 后立即 crash 时，Evaluation 可由 durable admitted event 恢复到 running，且 proof 只写一次。
- Evaluation Case、Task wakeup 与其它领域入口均无 Invocation Coordinator 旁路。
- 相关单元、集成、类型检查和 build 通过。

## 9. 非目标

- 本轮不实现远端 Runtime transport；未连接远端 executor 继续 fail closed。
- 不改变 Task、Gate、Delivery、A2A 的业务状态机 owner。
- 不把 stdout、token delta、窗口事件升级为业务事实。
- 不复制 Buzz 源码、Nostr 协议、品牌或 UI。
