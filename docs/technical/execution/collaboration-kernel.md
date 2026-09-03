# 统一协作内核

> 状态：Implemented（当前架构）
> 日期：2026-08-23
> 已归档规格：`docs/archive/specs/collaboration-kernel/`

## 1. 架构结论

Agent Task Hub 的产品价值是有证据的软件交付，但运行底座是多 Workspace/Project/Delivery/Agent 的长期
协作系统。参考 Buzz 后采用的核心不是 Nostr，而是“持久事实同时提供触发身份、作用域、重放与回复地址”。

本项目以 `CollaborationKernel` 作为所有 Agent 工作触发的唯一外部 seam：

```text
Human / Task / Gate / A2A / Delivery / Recovery
                       |
                       | WorkRequest
                       v
              CollaborationKernel
              - identity + scope
              - cause + replyTo
              - idempotency
              - lane derivation
              - durable inbox
                       |
                       v
              Invocation Pipeline
                       |
                       v
                 Agent Runtime
              prepare -> real ACK -> run
                       |
                       v
             Outcome -> domain owner
```

## 2. 事实 owner

| 事实 | Owner |
| --- | --- |
| 谁请求哪个 Agent 做什么、应回复哪里 | Collaboration Kernel / Durable Inbox |
| Agent 是否已真实接管一次执行 | Agent Runtime / ExecutionEnvelope ACK |
| Runtime Invocation/Session/Process 生命周期 | Agent Runtime |
| Task、Gate、Delivery、A2A 状态 | 各领域 owner |
| 用户展示 | Project View projection |

Inbox 的 `admitted` 表示该 durable request 已等到目标 Runtime 的真实 ACK，调度租约可以释放；
ExecutionEnvelope ACK 是这个判断的权威事实。Invocation Pipeline 仅同步接受、但 Runtime 尚未 ACK 时，
Inbox 仍保持 `claimed` 并续租。Runtime 正常结束仍不表示 Task、Gate 或 Delivery 已完成。

失败队列的“重新入队”不能复活一个已经终结的 A2A Pass 或关闭的 WorkAuthority。Human A2A 失败项重试时，以失败 Inbox id
创建幂等的新 user-turn Chain/Pass/Inbox，handoff packet 继续引用原消息；旧 Inbox 经 `expired -> released -> cancelled` 的合法
状态迁移在同一事务中标记为 `manual_retry_reissued`。如果当前 Conversation 已有 active chain，则拒绝重试，避免覆盖正在运行的新请求。
不可变 Platform Event 同时保存旧 Inbox 到 replacement Inbox 的映射；相同请求重放从该映射返回同一替代项。成员或运行配置变化返回
422，active chain/幂等冲突返回 409，lane 容量耗尽返回 429。Agent 发起的 A2A 失败必须交回原 source owner/控制面恢复，失败队列不得把它伪造成 Human turn。

评测也不是特殊旁路：Evaluation Case 使用同一个 `WorkRequest`，以 `evaluation_case` 作为 reply address；
启动失败由 durable `agent.work.expired` Process Manager 投影回 Case owner；真实接纳则由 durable
`agent.work.admitted` 携带 Invocation/trace binding，并幂等投影 `planning -> running`。daemon 的同步投影只是
低延迟加速，进程在 ACK 后立即崩溃时仍可由事件重放恢复，started proof 与状态迁移在同一事务中只提交一次。

## 3. Module 深度

领域调用者只能学习 `request()` 与 `cancel()`。Prompt 编译、Inbox schema、claim lease、retry、Runtime
Node、Session 和 transport 都是 implementation。测试通过相同 interface 验证幂等、Lane、reply address
和重启恢复，不跨过 seam 断言私有步骤。

## 4. Buzz 参考与差异

Buzz 使用 `relay event + channel + mentioned pubkey` 同时确定触发、串行空间和回复位置；本项目对应为
`WorkRequest + project/agent lane + replyTo`。Buzz 的频道对话可以直接作为协作结果，本项目的 Runtime
结果只能成为候选 Outcome，最终仍由 Task/Gate/A2A/Delivery owner 裁决。

## 5. Runtime ACK

旧实现由定向 adapter 在调用 executor 前 ACK，无法证明 ACP 已启动。当前实现由 Agent Runtime 在创建
Invocation、绑定 Session、完成 ACP setup 并取得 execution handles 后回调 ACK。setup 前错误拒绝未 ACK
Envelope；ACK 后错误记录 execution failure 和唯一 Runtime terminal event。

Runtime 准备阶段使用 10 分钟有界 Envelope TTL，覆盖 Codex ACP 的慢启动窗口，但不会用假 ACK 绕过
超时。Inbox claim 在等待真实 ACK 期间续租；Runtime ACK 后立即结束该租约。繁忙 Lane 的重试按指数退避，
上限 30 秒，避免长任务运行时形成 1 秒热循环。

ACP `AgentRun.started` 是显式 readiness contract：只有 initialize 与 session new/load 成功、即将提交 prompt 时
才返回 `ok`；spawn、并发限制和 session setup 失败均返回 `ok: false`。claim lease token 一直传递到 ACK
闭包。最终 claim 校验、Invocation owner lease 校验、ExecutionEnvelope ACK 与 Inbox `admitted` 在同一个 SQLite immediate transaction
提交，ACK 前取消、租约过期或 Scheduler 停止都会撤销启动权限并中止 Runtime；旧 worker 即使迟到也不能
提交 ACK。启动错误以独立的 `runtime_start_failure_count` 最多真实重试 3 次；busy claim 不消耗该预算，
deferred/startup failure 也不写入 Coordinator 的 completed dedupe cache。

Runtime ACK 后，跨 daemon 的 lane ownership 由 Invocation 上的 `runtime_owner_token + lease_expiry` 持久化，
daemon 每 10 秒续租 45 秒。下一个 Inbox item 在 live Invocation lease 存在时不能 claim；只有 owner lease
过期才可终结 orphan、封存旧 Session generation 并创建新 generation。旧 owner 恢复后续租失败会 kill
自己的进程。每个持久 Runtime event 都在 owner lease 的写事务内提交；Session binding 与成功终态共用同一
原子提交，失败终态也必须先赢得 owner-fenced transition，之后才允许写 Envelope 与业务 owner。Adapter event、
permission request/resolution 使用同一个 `RuntimeOwnershipFence`；失权的 permission fail closed 并终止旧 turn。
租约过期并被新 daemon 接管后，旧进程的迟到 event/result
会被丢弃，不能改写 Invocation、Session、Envelope、Task 或 Evaluation。进程注册表的清理同样比较当前 process
identity，旧清理回调不会移除同 lane 的新进程。

## 6. 并发键

第一阶段 lane 固定为 `projectId + targetAgentId`。这与当前项目级 Session/Agent Process ownership 一致，
避免同一 Agent 在同一代码空间并发修改。不同 Agent 可并行。未来若引入 Worktree Authority 证明隔离，
只能通过修改本设计和对应并发测试放宽。

调用者幂等键只在 `projectId + targetAgentId` 范围内唯一；Inbox 数据库约束、Kernel requestId 与
Invocation Coordinator dedupe 使用同一个 scope。`cause.event.projectId` 必须等于 WorkRequest project，
避免跨项目事件误触发另一个空间的 Agent。

## 7. 删除门禁

- `src/server/a2a/**`、`human-command/**`、`autonomous-delivery/**`、`task-flow/**` 不得直接 enqueue AgentInbox。
- Evaluation Case 不得直接调用 Invocation Coordinator。
- 领域 producer 不得构造 Runtime Node、ExecutionEnvelope、Session 或 Lease。
- Socket/Project View consumer 不得触发 Agent 执行。
- Runtime ACK 不得出现在 execution handle 创建之前。
