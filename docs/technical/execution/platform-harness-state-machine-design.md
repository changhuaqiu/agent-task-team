# Platform Harness 状态机与模块集成设计

> 日期：2026-07-27
>
> 状态：目标设计；实施契约见 `specs/platform-harness-state-machines/`
>
> 当前实现说明：[`platform-harness-loop.md`](platform-harness-loop.md)
>
> 事件机制说明：[`platform-runtime-event-model.md`](platform-runtime-event-model.md)
>
> 可视化：[`Platform Harness 目标架构图`](platform-harness-target-architecture.html)

## 1. 先用一句话讲清楚

**Platform Harness 是整个平台的运行时环境。**

它把人的命令、Agent 的自主工作、团队协作、上下文、审查门禁和可靠执行接成一个可以持续推进、
可以恢复、也可以停下来的系统。但它不是一个替所有 Agent 思考的“总管 Agent”。

可以把职责边界记成两句话：

- **Agent 决定做什么、怎么做，以及何时需要协作。**
- **Harness 决定这个动作是否允许、交给谁、事实是否已经成立，以及系统下一步应激活、等待、重试还是停止。**

## 2. 为什么不是一个大 Todo List

平台里同时存在两类清单：

| 对象 | 谁维护 | 生命周期 | 用途 |
| --- | --- | --- | --- |
| Agent 内部 Todo | Agent / CLI runtime | 单次或若干次思考周期，可随时改写 | 帮 Agent 自己规划“接下来怎么做” |
| Platform Task Graph | Task 模块 | 跨 Agent、跨进程、可恢复 | 记录团队已经承诺的工作、依赖、负责人和验收状态 |

Harness 不读取 Agent 的每一个内部 Todo 来驱动平台，也不替 Agent生成详细步骤。它只消费 Agent
主动提交的结构化结果，例如“提交任务结果”“请求审查”“交接给另一个 Agent”“报告阻塞”。

因此，平台解决的重试也必须分层：

- Invocation 重试：某次 Agent 启动、传输或执行失败后，是否重新启动这一轮。
- Effect 重试：结果已经被平台接纳，但写外部系统或投影失败，是否重放副作用。
- Task 返工：Gate 判断结果未通过，产生新的团队工作。
- Agent 内部重试：Agent 自己判断某个工具调用或内部步骤要不要再试。

这四者不能用同一个 `retry` 状态表达。

## 3. 三层嵌套循环

### 3.1 Agent 认知循环

```text
观察上下文 -> 规划 -> 使用工具/修改产物 -> 验证/反思 -> 继续或提交结构化结果
```

这个循环是开放式的。Harness 不规定 Agent 必须有几步，也不把 Agent 的内部 Todo 转成平台状态机。

### 3.2 团队协作循环

```text
Agent 提交结构化命令
  -> 领域 owner 校验并修改权威事实
  -> 产生领域事件
  -> Process Manager 计算控制动作
  -> 激活下一个合法角色，或等待 Gate / Human
```

这一层解决“谁接球、任务是否完成、是否需要审查”，不直接操作 ACP 会话。

### 3.3 交付控制循环

```text
读取权威事实
  -> 按容量计算确定性的有序控制动作集
  -> activate | wait | retry | requestGate | resume | escalateToHuman | terminate
  -> 持久化动作与回执
  -> 再次读取事实
```

这一层必须是确定性的：相同事实、策略和容量得到相同的有序控制动作集。它不通过 LLM
猜测下一步。

### 3.4 从单 Agent 循环扩展为多 Agent 循环图

单 Agent Harness 监督一条认知循环；多 Agent Harness 监督的是 **N 个 Agent Work Cell
组成的动态图**，不是把 N 个 Agent 合并成一个“大脑”。

```text
                   shared Task / A2A / Gate facts
                         ↑ command  ↓ work
       ┌─────────────────┼─────────────────┐
       │                 │                 │
Agent Work Cell A  Agent Work Cell B  Agent Work Cell C
observe/plan/act    observe/plan/act    observe/plan/act
       └──────── structured outcomes ──────┘
                         ↓
              Team + Delivery control
```

`Agent Work Cell` 是一个逻辑运行单元，包含：角色身份、WorkContract、ContextSnapshot、
Inbox claim、Invocation/Session 和结构化 Outcome。它不是新的领域事实源，只是把已有模块
围绕“一名 Agent 的一次工作”组合起来。

多 Agent 比单 Agent 多出的复杂性，主要不在模型调用，而在循环之间：

| 新问题 | Harness 的处理方式 | 不交给谁猜 |
| --- | --- | --- |
| 谁现在有权修改哪份共享事实 | owner + permission + possession fencing | 不靠 prompt 自觉 |
| 两个 Agent 同时接到冲突工作 | Inbox lease、幂等、Task 依赖和资源锁 | 不靠先回复者获胜 |
| Agent 如何主动找另一个 Agent | Agent 提交 handoff proposal，A2A 校验后投递 | Harness 不替 Agent 编造协作意图 |
| 多条分支何时汇合 | Task Graph 依赖 + Gate evidence | 不以某次 Invocation 结束为准 |
| 某个 Agent 卡住是否拖死全队 | heartbeat、deadline、retry budget、blocked reason | 不无限重试 |
| 循环互相等待或反复传球 | wait-for graph、handoff hop budget、deadlock/livelock 检测 | 不让 Agent 自己维护全局图 |
| 谁能宣告最终完成 | Delivery 收口条件 + 必要 Gate | 不由任一 Agent 单方面宣告 |

因此更准确的比喻不是“一个导演指挥所有演员怎么演”，而是：

- Agent 是各自有判断力的演员/专家；
- Task、A2A、Gate 是共享剧本状态与协作规则；
- Harness 是舞台运行系统：排期、上场、交接、灯光信号、故障恢复和散场条件；
- Human/GoalContract 提供演出目标，Lead Agent 可以提出计划，但不能绕过平台事实。

核心扩展原则是：**Harness 管理循环图的节点生命周期和边，不进入节点内部替 Agent 思考。**

## 4. Platform Harness 的内部模块

| 模块 | 核心能力 | 权威事实 | 不负责 |
| --- | --- | --- | --- |
| Command Gateway | 接收 Human / Agent / Integration 命令，认证、幂等、路由 | Command receipt | 推断任务是否完成 |
| Task Graph | 任务依赖、负责人、验收状态 | Task | 启动 Agent |
| A2A | 交接意图、接球人、交接包、持球关系 | Handoff / possession | 直接调用 Runtime |
| Review & Gate | 审查请求、证据、判定、返工要求 | Gate decision | 调度具体执行进程 |
| Context Manager | 按 WorkContract 组装不可变快照 | Context snapshot / provenance | 修改 Task、Gate |
| Agent Inbox | 可恢复的工作投递、claim、lease、fencing | Inbox item | 表示业务完成 |
| Invocation Pipeline | preflight、profile 解析、会话、Agent 启动、结果归一化 | Invocation / session binding | 判定 Task 完成 |
| Team Scheduling（System Control Plane 能力） | 从依赖、角色、容量、占用关系中选择可激活 Work Cell | 可重算的 scheduling decision | 生成 Agent 的实施方案 |
| Delivery Supervisor | 根据事实和策略计算控制动作 | Delivery run / action / receipt | 替 Agent 做方案判断 |
| Event Dispatcher | 提交后投递事件给 Router、Reducer、Process Manager、Projection | Event delivery cursor | 成为领域事实源 |
| Durable Effect Outbox | 可靠执行数据库外副作用 | Effect command / receipt | 再做业务决策 |
| Projection & Observability | WebUI 投影、trace、诊断 | Read model | 直接修改领域状态 |

“Harness 包含这些模块”是**运行环境上的包含**，不是**事实所有权上的吞并**。每个领域 owner
仍然独立守护自己的状态机；Harness 不能绕过 owner 直接改表。

这里的 Team Scheduling 优先深化现有 System Control Plane 的 dispatch policy 与 Agent Inbox
admission，不默认新增一套持久化领域模块。它只从候选工作中确定合法目标；Delivery Supervisor
把该目标封装成 `activate` 控制动作，两者不各自启动一次 Agent。

A2A 的目标权威是一个 `A2ACollaboration` 聚合，而不是 Chain、Worklist、Possession、Pass
四套平行状态机：

- `Chain` 是聚合根，状态只由子状态派生；
- `Possession` 是“谁有权交接”的权威；
- `Pass` 是从一个 Possession 到另一个 Possession 的转换尝试；
- 观测关系直接由 `a2a_pass` 与 `a2a_possession_chain` 派生，不再读取旧 Worklist；
- WebUI 只接收服务端生成的完整 `a2a.snapshot`，首屏与重连从 `/api/state` 恢复；
  fan-out 的当前持有者是 `currentHolderIds[]`，不得压缩成单一 holder；
- migration 62 已删除 `invocation_chain / chain_worklist / delivery_cursor /
  a2a_audit_log / a2a_delivery`，源码中不再保留第二套兼容状态机。

显式 fan-out 为同一 source possession 下的一个 pass group。已启动的分支各自产生 open
possession，不能因另一分支失败而回滚；失败分支产生一个指向原 holder 的 recovery
possession。source possession、成功子分支和 recovery possession 在同一聚合事务中提交。
Chain 在仍有任一 open/recovery possession 时保持 active。

Agent 主动协作不再从最终回复文本中猜测。Agent 必须提交结构化
`handoff_to_agent` Outcome，A2A 流程协调器读取已接纳 Outcome 和不可变 WorkContract，
再调用 A2A owner 创建 pass group。它不直接写 A2A 表，也不直接启动 Runtime。
调用 owner 前，统一 A2A Command Guard 从 Team Runtime 校验当前 conversation roster
与 communication policy；“存在于全局 Agent 表”不再代表该 Agent 可接收本项目交接。

```text
AgentOutcome(handoff_to_agent)
  -> A2A Outcome Process Manager
  -> A2ACollaboration.offerPassGroup
  -> Pass + HandoffPacket + AgentInbox（同一事务）
  -> Inbox admitted
  -> Pass accepted -> starting
  -> Runtime invocation started
  -> Pass started + receiver Possession
```

`handoff_to_agent.payload` 至少包含稳定幂等键和一个或多个明确分支：

```ts
type HandoffOutcomePayload = {
  idempotencyKey: string
  sourcePossessionId?: string
  expectedSourceRevision?: number
  maxHops?: number
  branches: Array<{
    toAgentId: string
    intent: PassIntent
    taskId?: string
    title: string
    requestedAction: string
    possessionSummary?: string
    relevantDecisions?: string[]
    evidenceRefs?: EvidenceRef[]
    constraints?: string[]
    openQuestions?: string[]
    forbiddenBehaviors?: string[]
    sourceMessageIds?: string[]
  }>
}
```

Runtime completion 已移除 `runtime.a2a_response` 和 `runtime.a2a_done`：
普通文本里的 `@agent` 只是内容，不是控制命令。新旧 Invocation 都不能通过最终回复文本
创建协作；只有结构化 Outcome 或 Human Command 可以调用 A2A owner。

Human 通过 WebUI 发出的消息同样先成为 Command，而不是由浏览器直接启动 Agent 后再补写
协作事实。服务端 `a2a.human_handoff` 在消息持久化后调用 A2A owner：

```text
WebUI message
  -> message.append
  -> a2a.human_handoff
  -> A2ACollaboration（必要时显式终止旧 Human turn）
  -> Pass + HandoffPacket + AgentInbox
  -> Harness / Runtime
```

无目标的新 Human turn 是显式中断命令；它可以终止当前协作并取消尚未 claim 的 Inbox
工作。已经 claim 或 running 的执行不能由 WebUI 假装取消，必须交给后续 Supervisor
执行有 fencing 的停止/收口策略。

## 5. 不设计一个总状态机

平台没有一个可以诚实表达全部含义的 `running / completed / failed` 总状态机。
目标是“多个状态机 + 明确关联 + 一个确定性决策器”。

| 状态机 | 建议状态 | `completed` 的准确含义 |
| --- | --- | --- |
| Command | `received -> accepted / rejected` | 命令已被领域 owner 接纳，不代表工作完成 |
| Agent Inbox | `enqueued -> claimed -> admitted / released / expired / cancelled` | 工作已进入 Invocation，不代表 Agent 执行成功 |
| Invocation | `planned -> starting -> running -> terminating -> terminated` | 本次执行过程已终止；结果可能成功、失败或被取消 |
| Context Snapshot | `building -> ready / rejected`，之后不可变 | 这一版上下文可用，不代表已被 Agent 阅读 |
| A2A Chain（派生） | `active -> completed / aborted / timeout` | 所有 open/recovery possession 已收口 |
| A2A Possession | `open -> handoff_drafted / handoff_offered / handoff_accepted / handoff_started -> completed / aborted / timeout` | holder 的控制周期已结束 |
| A2A Pass | `drafted -> validated -> offered -> accepted -> starting -> started -> completed / blocked / rejected / timeout / error` | `started` 才建立接球人的 holder authority |
| Gate | `requested -> evaluating -> passed / changes_requested / rejected / cancelled` | 证据已被判定；只有 `passed` 可满足对应门禁 |
| Task | `proposed -> ready -> in_progress -> blocked / in_review -> done / cancelled` | 任务验收条件已经满足 |
| Effect | `pending -> executing -> succeeded / retryable_failed / dead_lettered / cancelled / superseded` | 外部副作用已有回执或已被显式终止适用性 |
| Delivery Run | `active -> waiting_gate / waiting_human / retrying -> completed / failed / cancelled` | 整个 GoalContract 的收口条件已满足 |

约束：

1. `Invocation.terminated != Task.done`。
2. `Inbox.admitted != Invocation.terminated`。
3. `A2A Pass.accepted` 只表示服务端接纳；只有 `Pass.started` 才转移 holder authority，
   且 `Pass.started != Task.done`。
4. `Gate.passed` 可以成为 `Task.done` 的前置证据，但不能由 Invocation 自行写入。
5. `DeliveryRun.waiting_human` 是可恢复等待态，不是终态；配置修复后可以 `resume`。
6. 所有迁移通过 owner 的显式命令完成，禁止任意字符串更新状态。

### 5.1 Task 状态机的已落地边界

Task owner 已采用上述七个规范状态，并通过显式 `transition` 同时校验前态和目标态。
`task.update`、Agent 技能工具和 TASKS.md 适配器都不能绕过 owner 直接写 `status`；
数据库 trigger 作为最后一道防线拒绝非规范状态和绕过迁移表的规范状态跳转。

以下旧词汇不再属于 Task：

- `rejected` 是 Gate decision；Task 对应迁移为 `in_review -> in_progress`，事件为
  `task.changes_requested`；
- `test_gate` 是 Gate/Verification 状态，不是 Task 状态；
- `abandoned` 是执行 Attempt 状态，不是 Task 终态；
- `merged` 是任务图上的 `merged_into` 关系；源 Task 保留自己的 `done` 事实。

TASKS.md 仍可解析 `todo / doing / review` 等展示词，但它们只会被归一化为规范状态并作为
Command 请求 owner 迁移。非法跳转会产生 `task.sync_error`、恢复文件中的权威状态，不能
修改数据库事实。

### 5.2 Invocation 状态机的已落地边界

Invocation owner 已将“执行生命周期”和“执行结果”拆开：

```text
status:  planned -> starting -> running -> terminating -> terminated
outcome: completed | failed | cancelled | timed_out
```

旧的 `queued / succeeded / failed / canceled` 由 migration 55 归一化。Invocation 一旦进入
`terminated`，不得复活或改写 outcome；重试必须创建新的 Invocation identity。Session owner
只维护 runtime session binding，不再用“session 已确认”冒充“Invocation 已成功”。Daemon 在
接收 Runtime 终止事实后，分别提交 Session binding 与 Invocation terminal outcome。

API 只暴露 `invocation.transition`，owner 使用 `expectedFrom` 做 fencing，数据库 trigger
拒绝未知状态、非法迁移和缺失/越界 outcome。`Invocation.terminated` 只说明一次 Agent 激活
已经结束，不代表 `Task.done`。

### 5.3 Agent Inbox 状态机的已落地边界

Agent Inbox 只负责“工作命令是否被 Invocation Pipeline 接纳”，不再使用容易冒充执行结果的
`completed / failed`：

```text
enqueued -> claimed -> admitted
                    -> released -> claimed
                    -> expired
                    -> cancelled
```

`admitted` 表示 Harness 已接纳这次激活命令，既不表示 Invocation 已结束，也不表示 Task
完成。`released` 表示当前 claim 已释放，保留原 Inbox identity，并在 `availableAt` 到达后
允许使用新 lease token 重领；旧 token 被 fencing 拒绝。无法接纳且不应由 Inbox 自动重试的
命令进入 `expired`，原因保存在 `lastError`，由上层恢复策略决定是否创建新的激活命令。

migration 56 将 `queued / completed / failed` 分别归一化为
`enqueued / admitted / expired`，并把含义不再准确的 `completed_at` 改为 `settled_at`。
数据库约束同时守护迁移表、lease 字段和 settled timestamp，生产 API 只返回仍待接纳的
`enqueued / released / claimed` 项。

### 5.4 ExecutionEnvelope 状态机的已落地边界

ExecutionEnvelope 只描述“一条派发指令是否被目标执行管线确认”，不再复制 Runtime 的启动、
完成和失败状态：

```text
drafted -> validated -> routed -> sent -> acknowledged
       \-> rejected
       \-> expired
```

`acknowledged` 是派发终态，表示目标 Invocation Pipeline 已确认接纳；后续 Agent 是否开始、
成功、失败、取消或超时，只读取 Invocation。Envelope 不再拥有
`queued / started / completed / failed / blocked`，UI 派发回执也只展示
`requested / sent / acknowledged / rejected`。

migration 57 将旧 `started / completed` 归一化为 `acknowledged`，将
`blocked / failed` 归一化为 `rejected`，并增加 revision、settled timestamp 和数据库迁移表。
Delivery 恢复逻辑已改为：派发前故障读取 Envelope `rejected / expired`，派发后的运行与终止
读取 Invocation；因此不会把 `Envelope.acknowledged` 误判为 Agent 已执行完，也不会重复唤醒
仍在运行的 Work Cell。

### 5.5 Delivery Run 状态机的已落地边界

Delivery owner 已把“整个交付是否可继续运行”和“当前推进到哪个协作阶段”拆成两个正交字段：

```text
status: active | waiting_gate | waiting_human | retrying | completed | failed | cancelled
stage:  planning | executing | reviewing | verifying | integrating | delivering
```

`reviewing` 不再冒充生命周期状态；同一个 reviewing 阶段可以处于 `active`、
`waiting_gate` 或 `waiting_human`。`waiting_human` 是可恢复状态，只有显式
Human Command `manual_resume` 才能回到 `active`；周期 reconcile 和事实事件不能自行恢复。
WebUI 的“我已处理，继续”只是该 Human Command 的入口，不在浏览器内自行编排事件。

migration 58 将旧阶段型状态归一化：阶段词映射为 `active + current_stage`，
`recovering -> retrying`，`escalated -> waiting_human`，并为缺少原因的历史人工等待补充
明确的 legacy reason。代码 owner 使用 revision CAS 和显式 `transitionRun`；数据库 trigger
同时拒绝非法跃迁、无 reason 的 `waiting_human`、无 DeliveryBundle 的 `completed` 和终态复活。

### 5.6 QualityGate 的目标聚合边界

Review、verification 和交付证据不再各自保存一套“通过/失败”事实。唯一权威聚合为：

```text
QualityGate {
  kind
  targetType / targetId
  artifactRevision
  criteria / policy
  status
  revision
}

GateEvidence[]    // immutable append-only
GateDecision      // one terminal decision per Gate
```

状态机固定为：

```text
requested -> evaluating -> passed
                        \-> changes_requested
                        \-> rejected
requested / evaluating -> cancelled
```

同一个 target 的新 artifact revision 必须创建新的 Gate；旧 Gate 的通过不能覆盖新提交。
`passed` 必须引用本 Gate 的 Evidence identity。工程协作卡片、Task Action、Proof Log 和
Delivery Receipt 都只能作为 Gate 的输入证据或投影，不能再自行宣告审查结论。

该边界已由 migration 59 和 `QualityGateRepository` 落地。Task 的实现/交付证据统一由
`TaskGateService` 接纳；Git provider review 绑定 PR head SHA；Delivery review 与 acceptance
verification 绑定 receipt 的 code revision（缺失时绑定不可混淆的 proof revision）。
Delivery Process Manager 消费 `gate.*`，Delivery facts 读取 Gate status，receipt 仅用于
最终 Bundle 投影。数据库同时保护 Evidence/Decision 不可变、状态迁移和终态不可复活。

Effect 创建时必须冻结：

```text
criticality: blocking | non_blocking
deliveryRunId / appliesFromRevision / supersededAtRevision?
sourceActionId / successorEffectId?
```

`blocking` Effect 的 `pending / executing / retryable_failed / dead_lettered` 都阻止 Delivery
完成；耗尽重试后根据策略进入 `waiting_human` 或 `failed`。`non_blocking` Effect 可以在
Delivery 完成后继续重放，但不得改变已冻结的 Delivery 结果。Closure CAS 与“是否存在
blocking Effect”的检查必须使用同一事务快照，避免完成与 dead-letter 竞态。

Effect 从 `appliesFromRevision` 起持续适用，不能因为 Run revision 增长而自动消失。
只有 Effect owner 收到显式 Command，并在同一事务中记录撤销/替代原因及可选 successor，
才可进入 `cancelled / superseded` 并写入 `supersededAtRevision`。Closure 必须检查所有在
当前 revision 仍适用的 blocking Effect，而不是只检查“创建 revision 等于当前 revision”。

## 6. 统一集成契约：Command、Query、Event、Effect

### 6.1 Command

Command 表达“请求某个 owner 改变事实”，必须包含：

```text
commandId, commandType, projectId, actor, target, payload,
causationId, correlationId, idempotencyKey, occurredAt
```

WebUI 本身是只读投影消费者，但**人的行为可以通过 WebUI 发 Command**。例如输入消息、
批准 Gate、补充配置或恢复运行。WebUI 不自行编排事件，它只是 Human Command 的一个入口。

Agent 结束一轮时只能通过受支持的结构化 outcome 提交跨模块意图：

```text
continue_work
propose_task_graph
submit_task_result
request_review
record_gate_decision
handoff_to_agent
report_blocked
request_human_decision
```

自然语言回复用于沟通，不是状态迁移凭证。

### 6.2 Query

Query 只读取 owner 的权威事实或稳定投影，不产生副作用。Context Manager 通过 Query
收集 Task、A2A、Gate、项目知识和 Agent 身份，然后编译不可变 `ContextSnapshot`。

### 6.3 Event

Event 表达“事实已经发生”，必须在 owner 的事实变更提交后发布。消费者可以：

- Router：把事件转成另一个 owner 的 Command；
- Reducer：维护同一 owner 内的派生状态；
- Process Manager：跨状态机计算下一项控制动作；
- Projection：生成 WebUI 和观测读模型。

Event 不是远程函数调用，也不能被消费者解释成“可以直接改发布者的表”。

### 6.4 Effect

Effect 是已经完成业务决策之后需要可靠执行的 I/O，例如启动 ACP、发送外部通知或写投影。
Process Manager 只规划 Effect；Outbox 负责执行、重试、顺序和回执。

## 7. WorkContract：Agent 自主与平台控制的接缝

每次激活 Agent，Harness 编译一个 `WorkContract`，只规定边界，不规定思考步骤：

```text
workId
workEpoch / attemptId / fencingToken
goal / acceptanceCriteria
role / permissions
authoritativeRefs
authoritativeRevisions
contextSnapshotRef
allowedOutcomeTypes
deadline / budget
correlationId / causationId
```

Agent 在这个边界内自主循环。只有当它提交结构化 outcome，或者 Invocation 因外部原因终止时，
控制权才回到 Harness。

结构化 Outcome 使用统一信封：

```text
outcomeId / idempotencyKey
outcomeType / payload / evidenceRefs
projectId / workId / workEpoch / attemptId / fencingToken
authoritativeRevisions
correlationId / causationId / occurredAt
```

Outcome owner 必须同时验证：类型在 WorkContract allowlist 内、epoch/token 仍有效、
幂等键未被处理、关键权威版本未发生不允许的漂移。旧 attempt 的迟到 Outcome 只记诊断，
不得改变事实。

### 7.1 已落地的运行边界

Migration 60 建立三个职责分离的权威对象：

- `work_contract`：不可变的单次激活契约；
- `work_authority`：一个 `workId` 当前唯一有效的 epoch/contract 指针；
- `agent_outcome`：不可变的候选结果及 admission 结论。

`RepositoryHarnessPlanner` 只有在 Runtime Profile、Skill 与 ContextSnapshot 均成功编译后才签发
WorkContract。`Invocation.id` 复用 Contract 的 `attemptId`，并同时绑定
`workContractId / workId / workEpoch / fencingToken`；数据库拒绝部分绑定、伪造绑定及绑定改写。
同一 `workId` 的新激活以 CAS 方式把 authority 推进一个 epoch，旧 Contract 永远不会恢复为当前
authority。

ACP 执行端得到的是每次 Invocation 独占的 `agent_submit_outcome` 平台工具。模型只提交
`outcomeType / payload / evidenceRefs / idempotencyKey`，平台 grant 负责绑定私有 fencing token、
权威版本、correlation 和 causation，避免模型自行拼装安全信封。非 ACP 运行端可以使用
`POST /api/agent-outcomes` 提交完整信封。

Admission 只产生 `agent.outcome.accepted | agent.outcome.rejected` 协调事件，不直接修改 Task、
Gate、A2A 或 Delivery。一个 Contract 可以提交多个 `continue_work` 进度，但只允许一个终结性
Outcome；同一幂等键的不同内容属于冲突，而不是“重复成功”。后续领域变化仍必须由对应 owner
接收 Command 并完成自己的版本与证据校验。

这解决了两种极端：

- Harness 不会把 Agent 降级成“执行静态 Todo 的脚本”；
- Agent 也不能只说“做完了”就绕过 Task、Gate 和证据规则。

## 8. 控制动作决策表

Delivery Supervisor 读取状态，不直接编辑其他 owner 的事实。

| 事实条件（按 Work Cell / 资源 slot 判断） | 控制动作 | 下一责任模块 |
| --- | --- | --- |
| 有合法、未投递的工作且仍有容量 | `activate` | Agent Inbox |
| 某 Work Cell 的 Invocation 已接纳但仍在运行 | 该 Cell `wait`，不占用其他空闲 slot | Invocation Pipeline |
| 可恢复的启动/传输失败且预算未耗尽 | `retry` | Invocation Pipeline / Outbox |
| Task 产物已提交且 Gate 尚未创建 | `requestGate` | Review & Gate |
| 人已补齐缺失配置或完成决策 | `resume` | 原被阻塞 owner |
| 缺少不可自动生成的配置/权限/业务决策 | `escalateToHuman` | Delivery owner 写 `waiting_human`，Projection 通知人 |
| Goal 收口条件满足或不可恢复失败 | `terminate` | Delivery Run |

一次 reconcile 不返回“Delivery 全局唯一动作”，而返回容量约束下的**有序动作集**：

```text
ControlDecision {
  decisionId              // runId + snapshotRevision + policyRevision 派生
  snapshotRevision / policyRevision
  actions[]               // 每个 targetWorkId / slot 最多一个动作
}

ControlAction {
  actionId                // decisionId + type + target 派生，天然幂等
  type / targetWorkId? / workEpoch? / slotId? / reasonCode
}
```

优先级固定为：安全/合法性 > 回收失效 authority > Gate/Human 恢复 > 可恢复重试 >
在剩余容量内新激活 > 收口。某个 Cell 的 `wait` 只描述该 Cell，不阻止其他 Cell 激活。
只有不存在可运行候选、无待恢复动作且至少一个 Cell 仍在运行时，决策才可以只有 `wait`。
相同 snapshot/policy 得到相同 action ids；重复 reconcile 不新增重复动作。
`wait` 是无副作用的决策结果，不创建 DeliveryAction/Effect 记录；只有等待原因或截止时间变化
才更新可查询状态。其他动作在 claim 时必须再次 CAS snapshot revision、slot 和 work epoch。

## 9. 错误如何进入事件设计

错误不能只是一段 CLI 文本。Adapter 先保留原始诊断，再归一化为有语义的事实。

| 现象 | 归属 | 规范化事实 | 控制动作 |
| --- | --- | --- | --- |
| `runtime_profile_missing` | Invocation preflight / account config | `runtime.invocation.blocked`，reason=`runtime_profile_missing` | `escalateToHuman`；补齐后 `resume`，不是盲目重试 |
| ACP `Resource not found` | Session Identity | `runtime.session.resume_failed`，reason=`resource_not_found` | 失效旧 binding；策略允许时创建新 session 后 `retry` |
| WebSocket 重连并回退 HTTPS | Runtime Transport | `runtime.transport.degraded` / `runtime.transport.recovered` | Invocation 未终止时 `wait`；超过期限才 `retry` |
| CLI Trace 标记 error | Runtime Adapter | `runtime.diagnostic.observed`；若导致结束再产生 `runtime.invocation.terminated` | 由终止原因和预算决定 `retry` 或升级 |
| `required_context_missing` | Context preflight | `context.snapshot.rejected`，列出缺失项 | 可补齐则回到 Context Manager；否则升级给人 |

原始 stderr、trace 和 UI 文案属于观测证据，不应直接驱动领域状态。控制动作只依据归一化事实。

## 10. 当前实现到目标命名

当前 `src/server/harness` 实际只覆盖单次 Agent 激活链，目标上它属于
`Platform Harness / Invocation Pipeline`。迁移时采用以下命名，避免把局部组件误认成整个系统：

| 当前名 | 目标名 |
| --- | --- |
| `HarnessCoordinator` | `InvocationCoordinator` |
| `RepositoryHarnessPlanner` | `InvocationPlanner` |
| `HarnessRuntimePort` | `AgentRuntimePort` |
| `HarnessTrigger` | `AgentActivationCommand` |

这是语义迁移，不要求第一切片立即移动目录。先提供兼容别名并迁移调用者，最后再删除旧名。

## 11. 实施切片

| 切片 | 内容 | 退出条件 |
| --- | --- | --- |
| S0 术语与观测 | 建立新旧名映射、补 correlation、记录状态迁移证据 | 可以按一个 workId 串起 Command→Task→Inbox→Invocation→Outcome |
| S1 状态守卫 | 为 Task、Inbox、Invocation、Delivery 使用显式 transition API | 任意字符串状态更新被测试拒绝 |
| S2 Gate 深模块 | 统一 review request、evidence、decision、返工 | Gate 是唯一审查判定事实源 |
| S3 Invocation 边界 | 收敛 Inbox/Envelope/Invocation/Session 的完成语义和恢复策略 | 各层 completion 不再互相冒充 |
| S4 A2A 收敛 | 合并重复的 chain/worklist 与 possession/pass 生命周期 | 只保留一个 handoff owner 和一个状态机 |
| S5 Supervisor 决策 | 用事实 + 策略按容量计算七种控制动作 | 同一快照产生相同有序动作集；waiting_human 可恢复 |
| S6 迁移清理 | 删除兼容分支、旧命名和无读者投影 | 架构图、spec、代码、测试一致 |

## 12. 设计不变量

1. Harness 是平台运行环境，不是 Boss Agent。
2. 每份可变事实只有一个 owner。
3. Agent 可以自主思考，但跨模块改变事实必须提交结构化 Command。
4. 人可以通过 WebUI 主动触发 Command；WebUI 不自行编排。
5. ContextSnapshot 不等于投递确认；消费游标必须区分 delivered 与 acknowledged。
6. 领域事务与 Event Outbox 原子提交；外部 I/O 只能走 Durable Effect Outbox。
7. Process Manager 只计算动作，不直接启动 Runtime、不直接改领域表。
8. 所有 `completed` 必须带对象类型；禁止裸 `completed` 作为跨模块协议。
9. 错误先归一化再决策，CLI 文本和 UI 文案不是控制平面事实。
10. 自动重试、Agent 内部重试、Task 返工和 Effect 重放必须分别计数、分别限额。
11. 多 Agent 调度只管理 Work Cell 和协作边，不读取或合并各 Agent 的内部 Todo。
12. 对共享事实的并发写入必须经过 owner 的版本校验、lease 或 fencing；不能靠消息时序碰运气。
13. 系统必须能检测 wait-for graph 的死锁和 A2A 循环传球，并升级给 Human 或 Lead Agent。

## 13. 用真实协作场景反推设计

### 场景 A：项目启动与首次拆解

```text
Human 提交 Goal
  -> Command Gateway 创建 GoalContract / DeliveryRun
  -> Supervisor 发现“尚无可执行 Task”
  -> activate Lead Agent Work Cell
  -> Lead 自主理解目标并提交 propose_task_graph Outcome
  -> Task owner 校验并持久化 Task Graph
  -> Team Scheduler 只激活依赖已满足、角色可用的 Work Cells
```

关键边界：

- Harness 不在启动时自己用规则或 LLM 拆任务；Lead Agent 提出拆解。
- Lead 的自然语言计划不是 Task Graph，只有被 Task owner 接纳的 Command 才是共享承诺。
- Task Graph 一次提交要么整体通过，要么返回可修正的验证错误，避免其他 Agent 看见半张图。
- 如果没有可用 Lead profile，Delivery 进入 `waiting_human`，而不是循环重试同一个空配置。

需要防的故障：

- 用户重复点击启动：依靠 command idempotency 只产生一个 DeliveryRun。
- Lead 拆解过程中进程崩溃：Invocation 可以重试，但旧 attempt 的迟到 Outcome 必须被
  `workEpoch / fencingToken` 拒绝。
- Lead 生成循环依赖：Task owner 在写入前拒绝 DAG 环。

### 场景 B：多 Agent 并行执行与主动交接

```text
Task A ready ─┐                         ┌─ Agent A Outcome
              ├─ Scheduler ─ Work Cell ┤
Task B ready ─┘                         └─ Agent B Outcome

Agent A 发现需要 Agent C
  -> handoff_to_agent proposal
  -> A2A 校验角色、权限、当前 possession 和 hop budget
  -> 创建接球人的 Inbox item
  -> Agent C 获得基于最新共享事实编译的 ContextSnapshot
```

关键边界：

- 并行单位是 Work Cell，不是聊天室消息；每个 Work Cell 有独立 lease、attempt 和预算。
- Agent 可以自主提出未预编排的交接，Harness 只校验合法性、可靠投递和 possession。
- Agent C 不直接继承 Agent A 的全部对话；Context Manager 根据 handoff package 和权威事实
  重新编译最小上下文。
- 两个 Agent 写同一事实时，owner 使用 version / fencing 拒绝过期写；不能以到达顺序覆盖。

需要防的故障：

- 双重 claim：同一 Inbox item 只有当前 fencing token 可以 admission。
- 无限传球：记录 hop chain；超过预算或发现 A→B→A 循环时 `escalateToHuman`。
- 饥饿：Team Scheduler 必须考虑等待时间和角色容量，不能永远只跑高频角色。
- 上下文漂移：Snapshot 记录权威版本；提交 Outcome 时校验关键前置版本是否仍有效。

### 场景 C：分支汇合、审查与返工

```text
Implementer 提交 task result + evidence
  -> Task.in_review
  -> requestGate
  -> Reviewer Work Cell
  -> Gate.passed ----------------------> Task.done
             \-> Gate.changes_requested -> 新返工工作 / 原 Task 回到 in_progress
```

关键边界：

- Implementer 只能“提交验收”，不能直接把 Task 写成 `done`。
- Gate owner 保存审查标准、证据版本和决定；聊天中的“LGTM”不能代替 Gate decision。
- 返工不是 Invocation retry。它产生新的工作 epoch、明确 changeset 和新的验收证据。
- 多分支汇合以 Task 依赖和 Gate 为准，不以“所有 Agent 都停止输出”为准。

需要防的故障：

- Reviewer 审查旧产物：Gate decision 必须绑定 artifact/evidence revision。
- 审查者和实现者是同一角色但策略禁止自审：Gate owner 在 admission 前拒绝。
- `changes_requested` 无限循环：使用 rework budget；耗尽后升级给 Human，而不是伪造通过。

### 场景 D：Agent 故障

| 故障时点 | 示例 | Harness 处理 | 是否重新调用 Agent |
| --- | --- | --- | --- |
| 激活前 | `runtime_profile_missing` | `waiting_human`，展示缺失配置 | 否，配置补齐后 `resume` |
| 上下文编译 | `required_context_missing` | 返回缺失项；可生成则补齐，不可生成则升级 | 尚未调用 |
| 会话恢复 | ACP `Resource not found` | 失效旧 binding，按策略创建新 session | 是，使用新 attempt |
| 传输中 | WebSocket 重连 / HTTPS fallback | 标记 degraded，Invocation 仍活着则等待 | 超时后才重试 |
| 执行中 | 进程崩溃 / heartbeat 丢失 | lease 到期，终止 attempt，按预算重新入队 | 通常是 |
| 结果接纳时 | 迟到或重复 terminal Outcome | 用 workEpoch / fencing 幂等拒绝 | 否 |
| 语义验收 | 产物不满足 Gate | 创建返工工作 | 是，但这是 rework，不是 retry |

故障恢复必须保存“这次失败发生在哪一层”。否则 UI 只会不断显示 Reconnecting，
Supervisor 也无法判断该等待、重试、换 session 还是请人补配置。

### 场景 E：Human 介入后恢复

```text
Delivery.waiting_human
  -> WebUI 展示 reason + requiredAction + affectedWork
  -> Human 在 WebUI 补配置 / 授权 / 做 Gate 决策
  -> Human Command 进入对应 owner
  -> owner 修改事实并产生 Event
  -> Supervisor 重新计算
  -> resume 原 work 或 activate 新 work
```

WebUI 在这里不是“只能看、不能操作”。它不自行控制事件，但人的操作可以经它发出 Command。
`escalateToHuman` 的出站路径不经过 Human Command Gateway：Delivery owner 先持久化
`waiting_human / requiredAction`，再由 Projection 展示。只有人作出响应时，WebUI 才通过
Human Command Gateway 把新 Command 送回对应 owner。
恢复必须保留原 `workId`、correlation 和 causation。只要旧执行 authority 已被撤销
（lease 过期、进程丢失、取消或 session replacement），恢复就必须签发新的
`workEpoch / attemptId / fencingToken`；旧 token 永远不能复活。若故障发生在首次 authority
签发前，也仍通过新的 attempt 记录恢复原因，避免同一激活被重复接纳。

### 场景 F：最终验收与收口

```text
所有 required Tasks done
+ 所有 required Gates passed
+ 无 active Inbox / Invocation
+ 无仍适用的 pending/executing/retryable_failed/dead_lettered blocking Effect
+ Delivery acceptance criteria satisfied
  -> Supervisor.terminate(completed)
  -> 生成 DeliveryBundle
  -> Projection 通知 Human
```

Agent 可以建议“项目已经完成”，但只有 Delivery owner 能根据收口条件写
`DeliveryRun.completed`。如果仍有非阻塞的观测投影重试，可以继续重放 Effect，但不得再次
激活 Agent 或改变已冻结的 Delivery 结果。

### 13.1 场景推演暴露出的必要能力

这些不是新建一个“大一统模块”的理由，而是已有模块必须共同提供的能力：

| 能力 | 最合适的 owner |
| --- | --- |
| 原子 Goal / Task Graph 建立与 DAG 校验 | Delivery + Task Graph |
| 多 Work Cell 容量、公平性与可运行选择 | System Control Plane 的 Team Scheduling 能力 |
| claim、lease、heartbeat、fencing | Agent Inbox + Invocation |
| 交接环路与 wait-for deadlock 检测 | A2A Process Manager |
| artifact/evidence revision 绑定 | Review & Gate |
| session 失效和重新绑定 | Agent Session Identity |
| context 版本与关键前置校验 | Context Manager |
| 跨状态机唯一 ControlAction | Delivery Supervisor |

如果现有模块能承担，就深化现有接口；只有当某项能力没有自然 owner 时才增加模块。
