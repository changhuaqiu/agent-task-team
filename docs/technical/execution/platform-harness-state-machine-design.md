# Platform Harness 状态机与模块集成设计

> 日期：2026-07-27
>
> 状态：已实施；历史验收记录见
> `docs/archive/specs/platform-harness-state-machines/`
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

这四者不能用同一个 `retry` 状态表达。其中前三者是平台控制事实；Agent 内部重试属于
单次 WorkContract 约束下的 Agent Runtime 自主循环，不进入 Process Manager 的
`ControlAction / RetryBudgetKind`，平台只观察该 Invocation 最终是否终结。

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
  -> Process Manager 汇总事实并组装控制快照
  -> Decision Policy 纯计算控制动作
  -> 激活下一个合法角色，或等待 Gate / Human
```

这一层解决“谁接球、任务是否完成、是否需要审查”，不直接操作 ACP 会话。

### 3.3 交付控制循环

```text
Process Manager 读取权威事实并组装快照
  -> Decision Policy 按容量计算确定性的有序控制动作集
  -> activate | wait | retry | requestGate | resume | escalateToHuman | terminate
  -> Process Manager 持久化动作并交给 owner Command adapter
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
| Delivery Control Process Manager | 消费触发事件、查询 owner、组装快照、调用 Policy、持久化决定并推进跨领域流程 | Process cursor / persisted ControlDecision | 自己发明业务策略、直接改领域事实或执行副作用 |
| Delivery Decision Policy | 根据冻结事实、policy revision 和容量纯计算有序 ControlAction | 无；返回不可变 ControlDecision | 读取数据库、调用 Runtime、投递 Command |
| Event Dispatcher | 提交后投递事件给 Router、Reducer、Process Manager、Projection | Event delivery cursor | 成为领域事实源 |
| Durable Effect Outbox | 可靠执行数据库外副作用 | Effect command / receipt | 再做业务决策 |
| Projection & Observability | WebUI 投影、trace、诊断 | Read model | 直接修改领域状态 |

“Harness 包含这些模块”是**运行环境上的包含**，不是**事实所有权上的吞并**。每个领域 owner
仍然独立守护自己的状态机；Harness 不能绕过 owner 直接改表。

这里的 Team Scheduling 优先深化现有 System Control Plane 的 dispatch policy 与 Agent Inbox
admission，不默认新增一套持久化领域模块。它只从候选工作中确定合法目标；Delivery
Decision Policy 把该目标表达为 `activate` 控制动作，Process Manager 负责可靠提交，
三者都不直接启动 Agent。

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

显式 fan-out 为同一 source possession 下的一个 pass group，单组最多三个不同接球人。已启动
的分支各自产生 open possession，不能因另一分支失败而回滚。Agent 发起的 fan-out 在全部分支终结后，聚合不把
"每个 Agent 都说完了"误判为协作完成，而是原子创建一个指向原 holder 的 reconciliation
possession，并以同一个 source Work 写入持久 Agent Inbox。成功的一对一 transfer 可以直接
完成；Agent 发起的 fan-out 无论全部成功还是部分失败，都必须经原 holder 汇总为一个结构化下一步。
Human 发起的多目标命令没有可执行的 source holder，保留直接 join，并在聚合事件中暴露 complete/partial 分支事实。
Chain 在仍有任一 open/reconciliation possession 时保持 active。

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

Pass Group 的 join 不在 `started` 时完成。Group 持久绑定 source Work 与 DeliveryRun；
每个未终结分支形成 `sourceWorkId -> a2a-pass:<passId>` wait-for 边。全部 receiver
Possession 终结后才关闭 source Possession。fan-out 的 join 生成有界选择性结果包：按稳定顺序
携带每个 pass 的目标、请求动作、终态摘要或失败原因，以及 accepted outcome 的精确 evidence
refs；无法对齐 accepted outcome 时显式标记 missing，不复制完整聊天或分支 transcript，最终 focus
文本上限为 24,000 字符。原 holder 的回调 Inbox 复用 sourceWorkId 并绑定新的
`a2a_possession` 权威引用与 revision；派发与 Outcome 接纳同时校验项目、holder、active chain、
open 状态和 revision。链被取消或替换时，平台取消其全部 pending Inbox 项并关闭已签发的回调
WorkAuthority，因此 queued、claimed 或已授权的旧回调都不能再启动 Agent/工具或写入事实。有效回调
由新 epoch 继续；幂等键保证同一 group 只产生一次回调，部分失败
不会抹掉已完成分支，也不会重跑旧 Invocation。

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
工作。已经 claim 或 running 的执行不能由 WebUI 假装取消，必须交给后续 Control Process Manager
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
4. 只有匹配当前 `Task.revision` 的 `code_review Gate.passed` 才能授权 `Task.done`；
   Invocation、WebUI、Skill、通用 Tool 和文件投影都不能自行写入。
5. `DeliveryRun.waiting_human` 是可恢复等待态，不是终态；配置修复后可以 `resume`。
6. 所有迁移通过 owner 的显式命令完成，禁止任意字符串更新状态。

### 5.1 Task 状态机的已落地边界

所有 WebUI、通用工具、Skill Tool、Engineering receipt、ControlAction、Agent Outcome、
TASKS.md 文件投影、评估运行器与 Runtime 元数据更新对 Task 的写入，都必须进入
`TaskCommandService / TaskGraphRepository` owner command。命令冻结 graph revision、Task revision、
幂等键和 trace；改派 owner 时同事务关闭旧 `WorkAuthority`，物理删除被收敛为可审计的
`cancelled` 迁移。生产调用者不得直接调用 `taskRepo.create/transition/update/delete`；
架构测试把直接写入限定在 Task owner 实现及其原子 group-chat Task Graph mutation 内。

Task owner 已采用上述七个规范状态，并通过显式 `transition` 同时校验前态、目标态与单调
递增的 `Task.revision`。WorkContract 和 QualityGate 的 artifactRevision 都冻结该整数版本，
不再用可能在同一毫秒重复的 `updated_at` 冒充 CAS 版本。
`task.work_dir` 只是 Runtime 的 TASKS.md 投影位置，不属于 Task 的业务事实；它只能通过
`recordProjectionLocation` 更新，不递增 Task/Task Graph revision，也不会让已签发
WorkContract 或 Gate 失效。
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

文件投影还必须服从两条协作隔离规则：

1. 同一运行目录在任一时刻只归一个 Conversation 的 Task Graph 投影所有。新 Conversation
   接管共享目录时，必须通过 `TASKS.owner.json` 的 `claiming -> owned` 两阶段租约，以自己的
   权威 Task Graph 重建 `TASKS.md`；所有 task tool、Harness receipt 和 watcher 写入都必须在
   SQLite transaction-backed projection mutex 内校验租约；mutex key 与 watcher 共用 canonical
   realpath（Windows 同时统一大小写），进程退出时由数据库自动释放互斥；
   `TASKS.md` 与 owner 文件一律通过同目录临时文件和原子 rename 替换，不能原地截断。owner
   文件损坏、出现未知 state 或处于 claiming 时，普通 watcher 必须 fail closed；只有同一
   Conversation 的 daemon 恢复迁移可以读取 claiming 投影。旧 watcher 失去所有权后不得继续
   同步。升级旧版无 owner 文件的目录时，daemon 必须先单独提交 claiming 标记且保留原文件，
   再在下一事务导入并提交尚未归属其他 Conversation 的 Task，最后开启新事务从已提交 Task
   Graph 重建文件并发布 owned；owned 绝不能早于 Task import COMMIT，不能为避免 shadow task
   而直接覆盖历史数据；
   project-local ID 与其他 Conversation 重名且无法安全判源时，必须先隔离完整旧看板并发出
   `task.sync_error`，该行只有通过 `task_create` 才能显式采用。每个阶段都必须持有同一 mutex；
   claiming 租约阻止其他 Conversation 穿插，而同一 Conversation 可在任意崩溃点幂等恢复。
   所有权建立后，文件中新增的陌生行不能再隐式创建 Task；watcher 必须要求 `task_create` 并从
   Task Graph 恢复成员集合；文件被清空或删除也必须触发重建，避免已退出角色或陈旧进程再次
   制造 shadow work。
2. Task 一旦进入 WorkContract 管理，`TASKS.md` 对该 Task 的状态、owner、标题、交付物和依赖
   字段永久退化为只读投影。文件里的陈旧值不能推进或回滚 Task revision；watcher 必须恢复
   当前权威字段并留下可诊断 receipt。这样 QualityGate 的 artifactRevision 不会被文件竞态打穿。

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

Invocation lifecycle 不向浏览器通用 mutation 暴露；Invocation Pipeline、daemon 与 Runtime
Event owner 使用 `expectedFrom` 做 fencing，数据库 trigger 拒绝未知状态、非法迁移和缺失/越界 outcome。`Invocation.terminated` 只说明一次 Agent 激活
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
完成。它是 Inbox 的终态 receipt，不能继续作为 active overlay 覆盖后续 Invocation 的
`terminated / failed`；控制快照只把 `enqueued / claimed` 当作尚未完成的激活。
`released` 表示当前 claim 已释放，保留原 Inbox identity，并在 `availableAt` 到达后
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

Gate 的证据追加、终态判定与 Delivery acceptance receipt 必须在同一数据库事务提交。Receipt 是
Delivery owner 的权威事实，并原子发布 `delivery.receipt.recorded`；任一写入发生语义幂等冲突时，
整次 Gate 推进回滚，禁止出现“Gate 已通过但 Delivery 没有验收回执”的半完成状态。

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

工程协作服务只验证 provider PR 并把 receipt、head SHA 与对应 `Task.revision` 记录为
权威产物事实；它不创建 Gate。Delivery Control Process Manager 看到“产物已提交且当前
revision 尚无 Gate”后产生唯一 `requestGate` ControlAction，由 QualityGate owner 按冻结的
criteria/policy 创建 Gate。相同 Gate identity 的重复请求只有内容完全一致才可幂等回放，
criteria 或 policy 漂移必须以 `quality_gate_request_conflict` 失败关闭。

WebUI、Skill 与通用 Tool 的直接 Task 状态命令只经过纯
`TaskStatusEvidencePolicy` 做 `in_review` 字段/receipt admission；该 Policy 不创建 Gate、
不写 Proof、不改变 Task，并一律拒绝通用 `done` 命令。Task owner 自身再次验证
`gateId + gate.passed eventId + artifactRevision`，只有 Task Gate Lifecycle Process Manager
能提交完成迁移；Gate 必须以 `targetType=task / targetId=Task.id` 为目标，`gate.passed`
事件的 subject 也必须绑定同一个 Task，不能用 ID 恰好相同的其他目标类型冒充。
其他命令由 Task owner 以稳定 idempotency key 和首次冻结的 Task/Graph
revision 精确提交或重放。

该边界已由 migration 59 和 `QualityGateRepository` 落地。Task Gate 的 artifact revision
只使用整数 `Task.revision`；Git head SHA、PR URL 与 provider review ID 是 Gate evidence，
不得成为另一套版本轴。Provider adapter 不直接推进 Task；`gate.passed /
changes_requested / rejected` 只由 Task Gate Lifecycle Process Manager 翻译为 Task owner
Command。Delivery review 与 acceptance verification 绑定 Delivery 的冻结产物 revision。
Delivery Process Manager 消费 `gate.*`，Delivery facts 读取 Gate status，receipt 仅用于
最终 Bundle 投影。数据库同时保护 Evidence/Decision 不可变、状态迁移和终态不可复活。
Gate Agent 通过 `record_gate_decision` 结构化 Outcome 返回判定。durable Gate Outcome
Process Manager 只负责把已接纳 Outcome 翻译成 Gate owner Commands，并校验 Contract
project/agent/target；Delivery review/verification receipt 同步保存为证据，但最终状态只读 Gate。
Acceptance verification receipt 只在该 Outcome admission seam 直接校验结构、冻结 criteria、
Contract agent 与 decision 一致性；report/spec 引用只接受冻结 project path 内真实存在的普通文件，
并拒绝缺失、junction 越界和未绑定可信 provider/attachment receipt 的 HTTP(S) 字符串。Gate
数据库事务不发起远端网络探测。Proof Log 是审计/投影，
不会被再次解析为另一条 Gate admission，也不独立维护 verifier allowlist。

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

Migration 65 已将上述字段与 `maxAttempts` 固化到现有 `platform_effect_outbox`，没有建立
第二套 Effect 管理器。注册表只在 Effect 创建时提供默认预算；创建后即使进程重启或注册值
变化，该 Effect 仍使用原预算。`listApplicableBlocking(runId, revision)` 同时返回 queued、
running 和 dead-letter；只有成功或带原因的 cancel/supersede 才退出收口集合。
Control snapshot 将 pending blocking Effect 投影为 `wait`，将 dead-letter 投影为
`escalateToHuman`，预算类型固定为 `effect`，不消耗 Invocation 或 Task rework 预算。

Effect owner 的控制相关变化与结构化事实原子提交：
`effect.enqueued / retry_scheduled / succeeded / dead_lettered / cancelled / superseded`。
这些事实继承 source Event 的 correlation，并推进项目 snapshot revision；Delivery Process
Manager 订阅 `effect.*` 后立即重新计算。这样 `integrate` 创建 Effect 后不会继续复用旧
decision identity，Effect 成功或 dead-letter 也不依赖轮询猜测。

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
- Process Manager：收集跨状态机事实、调用 Decision Policy 并推进流程；
- Decision Policy：对冻结输入纯计算下一项控制动作；
- Projection：生成 WebUI 和观测读模型。

Event 不是远程函数调用，也不能被消费者解释成“可以直接改发布者的表”。

### 6.4 Effect

Effect 是已经完成业务决策之后需要可靠执行的 I/O，例如启动 ACP、发送外部通知或写投影。
Decision Policy 只产生 Effect 所需的控制意图，Process Manager 可靠提交给 Effect owner；
Outbox 负责执行、重试、顺序和回执。

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

若 Runtime 正常结束但当前 Contract 没有 accepted Outcome，Harness 不重新执行原任务。Control
Snapshot 将它投影为独立的 `outcome_recovery` 预算，最多签发一个新的 fenced epoch；该 Contract
只授权 `agent_submit_outcome`，禁止原生 edit/execute 和 Skill 工具，并把上一轮持久化回复与当前
权威事实作为上下文，要求 Agent 只提交一次受支持的结构化出口。恢复轮次仍无 Outcome 或 Runtime
失败时，平台以内部协议故障终止，不再重试整项工作，也不升级为需要用户判断的业务问题。

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

`InvocationPlanner` 只有在 Runtime Profile、Skill 与 ContextSnapshot 均成功编译后才签发
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

Delivery Control Process Manager 读取状态并组装快照，不直接编辑其他 owner 的事实；
`decideDeliveryControl` 纯 Decision Policy 对快照计算下表动作。

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

当 Delivery 尚无 Task Graph 时，快照包含一个 `purpose=planning` 的合成 Work Cell，
纯决策返回 `initializeGraph`。该动作调用 Task owner 幂等创建 root Task，并由 Delivery
owner 记录 root 引用；它不启动 Agent、不占用 Agent slot，也不把实施步骤预编排进平台。
新 Task 事实触发下一轮 reconcile 后，才由普通 `activate` 进入 Agent 自主循环。
当 required Tasks 与 Delivery Gates 已满足而合并尚未完成时，纯决策返回 `integrate`。
该动作只向 Effect owner 提交冻结 `deliveryRunId / appliesFromRevision / sourceActionId`
的 blocking provider Effect；Git/GitHub I/O 由 Effect Worker 执行，失败、lease、重试与
dead letter 不再由 Process Manager 自己维护。
`publish_delivery` 不再是伪外部动作。所有前置事实满足后，`finalize` 调用 Delivery owner
从已通过 Gate 的验收/评审 receipt、Task artifacts 与 provider receipt 构造并冻结
DeliveryBundle；Bundle 写入产生新 revision，下一轮 reconcile 才能返回
`terminate(completed)`，避免“生成结果”和“宣告完成”共用一个未经复核的动作。
required Tasks 全部完成后，Delivery review 与 acceptance verification 分别形成独立
Gate Work Cell。缺少 Gate 时先发 `requestGate` owner Command；Gate requested 后再以
`review_gate / test_gate` 激活 Reviewer/QA。二者使用不同 workId、WorkContract、epoch
和 slot，因此一个评审等待不会把另一个验收 Cell 或其他 Agent 工作串行化。

单个 Task 也使用同一协作形状：Implementer 的 `submit_task_result / request_review` 只是候选
结果；durable Task Outcome Process Manager 以 Contract 冻结的 `Task.revision` 调 Task
owner，将其推进到 `in_review` 并登记 evidence。Control snapshot 随后先请求
`code_review` Gate，再为项目中的独立 Reviewer 生成自己的 Work Cell、WorkContract、
epoch 与 slot。Reviewer 的 `record_gate_decision` 由 Gate owner 接纳；`gate.passed` 才由
Task Gate Lifecycle Process Manager 把 Task CAS 到 `done` 并关闭执行/评审 authority，
`changes_requested / rejected` 则只关闭 Reviewer authority、把原 Task 返回
`in_progress`，下一轮返工必须签发新的执行 epoch。找不到独立 Reviewer 时进入
Human escalation，不能退化成实现者自审。
生产 bootstrap 现由 `DeliveryControlRuntime` 提供 `start/get/advance` 外观，
内部唯一推进器是 `DeliveryControlProcessManager`。migration 67 已删除旧
`autonomous_delivery_action/attempt`，旧 Supervisor、纯策略函数和 production adapters
也已从源码删除；控制动作的持久化、claim、lease 与 fencing 统一由 Control Plane 表承担。

优先级固定为：安全/合法性 > 回收失效 authority > Gate/Human 恢复 > 可恢复重试 >
在剩余容量内新激活 > 收口。某个 Cell 的 `wait` 只描述该 Cell，不阻止其他 Cell 激活。
只有不存在可运行候选、无待恢复动作且至少一个 Cell 仍在运行时，决策才可以只有 `wait`。
相同 snapshot/policy 得到相同 action ids；重复 reconcile 不新增重复动作。
`wait` 是无副作用的决策结果，不创建 DeliveryAction/Effect 记录；只有等待原因或截止时间变化
才更新可查询状态。其他动作在 claim 时必须再次 CAS snapshot revision、slot 和 work epoch。

实现入口为 `autonomous-delivery/control-decision.ts`：它是无 I/O 的纯函数，显式接收
`observedAt`、snapshot revision、policy revision、全局/角色容量和三类平台重试预算：
Invocation retry、Effect retry 与 Task rework。Agent 内部工具/步骤重试由 Runtime 在当前
WorkContract 预算内执行，不由 Process Manager 计算或持久化为控制动作。

三类预算不能只写枚举：Invocation 使用同一 Work 的已终结 Invocation 数，Effect 使用
Outbox item 创建时冻结的 `attemptCount / maxAttempts`，Task rework 使用同一 Gate 目标的
历史失败轮次；Invocation 上限取 `maxAttemptsPerAction`，Task 上限取
`maxRepairCycles`。第一次 Gate 失败尚未消费返工轮次，只有再次提交后仍失败才记为已用
一轮。
公平 aging 只使用快照时间，因此重放同一快照不会因墙钟变化产生不同排序。

持久化入口为 `autonomous-delivery/control-decision-repository.ts`。项目级
`platform_event_ingestion` cursor 是 snapshot revision：decision 首次保存和 action claim
都必须重新比对该 cursor；带 target 的动作还必须比对 `WorkAuthority.currentEpoch`。
`activate / retry` claim 通过数据库部分唯一索引占用 `(runId, slotId)`，claim 使用 lease/token，
崩溃后可回收。同一 ControlAction 最多执行三次基础设施级 owner Command attempt；
claim 时单调增加 `attemptCount`，异常或拒绝在预算内回到 `ready`，lease 过期由下一次
reconcile 先回收再重领。每次重领复用同一 actionId，依赖 owner 的幂等键防止“命令已生效、
回执前崩溃”造成重复业务结果。只有预算耗尽才原子发布 `control.action.failed`；
Control snapshot 将其投影为 Human 可恢复失败，显式 `manual_resume` 后旧失败事实才失效。

批量 claim 遇到已经被新 Work authority 取代的 ready action 时，将该 action 原子标记为
`cancelled/stale_work_epoch`，并继续 claim 同一 decision 中仍有效的 sibling actions。单 action
claim 仍保持 fail-closed；批量 reconcile 不得因为一条过期 action 永久阻断启动恢复与周期恢复。

`wait` 仍是纯观察结果，不写 action 表；新 decision 只取消旧 decision 中
尚未 claim 的动作，已 claim 动作继续依赖 owner 的 fencing/CAS 决定能否生效。

`RepositoryControlSnapshotBuilder` 从当前 WorkAuthority/WorkContract、Task、QualityGate、
Invocation 和结构化 AgentOutcome 构造 Work Cell，不从聊天文本推断状态；Invocation 失败
计入 invocation budget，Gate 返工计入 task-rework budget。`DeliveryControlProcessManager`
在任何 owner Command 执行前，先用一个事务 claim 同一 decision 的完整动作集并预留 slot。
这是多 Agent 并行的必要条件：否则第一条 Command 产生新事实后，会错误地让同批兄弟动作
全部因 snapshot cursor 更新而失效。生产 owner Command adapter 已接通；Runtime
`started / terminated` 以及 Invocation/Context preflight 阻塞事实会释放对应
`activate / retry` slot，避免尚未启动的工作永久占用容量。

Task 在 WorkContract 签发前也已经是 Work Cell：assigned `ready/in_progress` Task 使用
`workEpoch=0`，claim 同时要求对应 WorkAuthority 尚不存在；Harness 成功完成 Context
preflight 后才签发 epoch 1 Contract。依赖未完成的 Task 是 `waiting_dependency`，不会占用
slot。`ProductionControlCommandAdapter` 已将 activate/retry 写入 Durable AgentInbox，
requestGate 写入唯一 QualityGate owner，并在同一 SQLite 事务重新读取 Closure 后才允许
Delivery 终止；它不直接启动 Runtime。Runtime started/terminated 事实会释放 activate 的
slot reservation。重试和首次激活使用同一套全局/角色容量检查与 slot reservation，不能
通过 `retry` 绕过并发上限。生产 bootstrap 已只使用该 adapter 与新的多动作 Control Process
Manager。

跨 Work Cell 的持久依赖使用显式 wait-for graph。Task dependency 与 A2A join 已投影为
`waiter -> blocker` 边，稳定 DFS 返回可复放的第一条 cycle；检测到 cycle 后产生
`escalateToHuman(wait_for_deadlock:...)`，不会把它误当成某个 Agent 的 Invocation 失败而
消耗重试预算。Gate 在存在明确 Gate Work Cell 时投影同类边。

容量不足不是领域依赖，不能写入持久 wait-for graph。它由当前 policy revision 和运行中
slot 派生为 `global_capacity_exhausted / role_capacity_exhausted` wait 动作；Runtime
terminated 释放 slot 后重新决策，fairness aging 防止长期饥饿。这样避免把会自然释放的
调度约束误报成死锁。

## 9. 错误如何进入事件设计

`manual_resume` 是显式 Human Command，不是一个无身份的 reconcile 开关。命令必须携带稳定
`idempotencyKey` 与 Human actor；Delivery owner 先原子记录 `human.manual_resume` receipt，
再以 `delivery.receipt.recorded` 的 eventId 作为 `delivery.run.state_changed` 的 causation。
相同命令重放只返回当前快照，不增加 Run revision，也不重复生成 ControlAction。
当前本地单用户部署由服务端把受信 WebUI ingress 标记为 `webui:local-user`，不接受请求体伪造
actorId；未来接入多用户认证时，该字段只能由认证 principal 替换。

Agent Inbox 的 lease token 只在 `lease_expires_at > now` 时有效。renew、release、admit 和 expire
都在 SQL CAS 中检查 token 与有效期；因此即使回收扫描尚未运行，过期 worker 也不能提交迟到结果。
ControlAction claim 使用相同规则：执行 owner Command 前复核有效期，complete/fail 也在 SQL CAS
中校验未过期；迁移 75 同时冻结 Delivery start idempotency key，并禁止 claimed action 缺少完整
lease token/owner/expiry。

Task Graph mutation 的精确重放返回首次提交时冻结的 `result_json` 和 revision，而不是重新读取当前
Graph。后续 revision 不得改变旧命令的响应语义。
迁移前未保存原始结果的历史 commit 无法被可靠重建，因此明确 fail closed 为
`task_graph_legacy_replay_unavailable`，不伪造“当前状态就是首次结果”的兼容响应。

Group-chat split 同时写入规范 `depends_on` edge 和 Task owner 使用的 `task.dependencies`，两者方向
统一为“当前 Task 依赖目标 Task”。Control snapshot 因此不会把 Human 创建的依赖分支提前并发激活。

可注入数据库的 Process Manager 必须把同一个 DB 传给 Gate 与 Delivery repository；不得从注入 DB
读取 Outcome、再向全局 DB 写 owner 事实。Task/Task Graph Outcome Process Manager 不暴露
无法贯穿其 singleton owner repository 的伪 DB 注入入口，只使用平台配置的权威 DB。
Engineering ToolInvocation 把 WorkContract 根
correlation/causation 传入 Task 与 Gate，provider receipt 链不会另起 trace。

错误不能只是一段 CLI 文本。Adapter 先保留原始诊断，再归一化为有语义的事实。

| 现象 | 归属 | 规范化事实 | 控制动作 |
| --- | --- | --- | --- |
| `runtime_profile_missing` | Invocation preflight / account config | `runtime.invocation.blocked`，reason=`runtime_profile_missing` | `escalateToHuman`；补齐后 `resume`，不是盲目重试 |
| ACP `Resource not found` | Session Identity | `runtime.session.resume_failed`，reason=`resource_not_found` | 失效旧 binding；策略允许时创建新 session 后 `retry` |
| WebSocket 重连并回退 HTTPS | Runtime Transport | `runtime.transport.degraded` / `runtime.transport.recovered` | Invocation 未终止时 `wait`；超过期限才 `retry` |
| CLI Trace 标记 error | Runtime Adapter | `runtime.diagnostic.observed`；若导致结束再产生 `runtime.invocation.terminated` | 由终止原因和预算决定 `retry` 或升级 |
| `required_context_missing` | Context preflight | `context.snapshot.rejected`，列出缺失项 | 可补齐则回到 Context Manager；否则升级给人 |

原始 stderr、trace 和 UI 文案属于观测证据，不应直接驱动领域状态。控制动作只依据归一化事实。

当前实现中，这不是一个新的“错误管理模块”。Invocation preflight 的失败由
`HarnessFailureEventPublisher` 在现有 Harness/Invocation 边界归一化；ACP 会话、传输与
CLI trace 由 `AcpRuntimeEventCoordinator` 和 `RuntimeAgentEventBridge` 在现有 Runtime
Adapter 边界归一化。`runtime.invocation.blocked` 是一次尚未启动的 attempt 终态，投影不会
伪造 `accepted / started / terminated`；`context.snapshot.rejected` 保留
`missingRequired`，并作为 coordination event 连接 Context preflight 与 Invocation，
不扩张已经冻结的九个 domain owner 目录。Process Manager 已按当前 Delivery/Work 的最新
preflight 事实投影 `escalateToHuman`，并忽略显式 `manual_resume` 之前的旧阻塞事实；补齐配置
后由新的激活 attempt 继续原 Work，而不是盲重试失败的 Agent Invocation。

项目启动本身也受 Command 幂等约束：`GoalContract.idempotencyKey` 是必填字段。同一 key
与相同规范化 Goal 内容重放时返回同一个 DeliveryRun；同一 key 内容漂移，或同一 conversation
已经存在另一个非终态 DeliveryRun 时，必须在仓储事务内拒绝。该检查不能由 API 层
“先查询、后创建”，否则并发启动仍可能产生两个运行实例。

## 10. 当前实现到目标命名

原 `src/server/harness` 实际只覆盖单次 Agent 激活链，现已迁入
`src/server/invocation-pipeline`。最终命名如下，避免把局部模块误认成整个系统：

| 旧名 | 当前名 |
| --- | --- |
| `HarnessCoordinator` | `InvocationCoordinator` |
| `RepositoryHarnessPlanner` | `InvocationPlanner` |
| `HarnessRuntimePort` | `AgentRuntimePort` |
| `HarnessTrigger` | `AgentActivationCommand` |

迁移已完成，旧目录、导出和兼容别名均已删除。

### 10.1 完成托管与阻塞恢复

Task、Delivery 到达终态后，业务对象虽然已经结束，运行侧仍可能留下排队命令、当前
WorkAuthority 或占用中的 Control slot。统一由 `WorkLifecycleReconciler` 消费终态 owner event：

- Task `done/cancelled` 只收口 `task:<id>` 范围的 Work，保留后置 Delivery review/verify；
- Delivery `completed/failed/cancelled` 收口当前 WorkContract 归属该 run 的全部 Work；
- 先关闭 WorkAuthority 形成 fencing 事实，再取消 pending/claimed Inbox command 并清除 Inbox lease；
- `work.authority.closed` 释放 applied Control slot；
- 不越权把其他 Runtime 可能仍持有的 Invocation 写成 terminated，迟到写入由 epoch fencing 拒绝；
- 新的 durable handler 会回放历史终态事件，因此部署也能修复已有孤儿 Work。

`task.blocked` 是 blocker 事实，不是 wakeup command。`TaskWakeupRouter` 不再对它直接派工。
`BlockedRecoveryOwner` 读取最新 accepted Task execution `report_blocked` 和结构化
`blocker.type / recoveryCondition`，
调用确定性探针；只有探针证明恢复条件满足，才能通过 Task Authority 以 outcome+revision 幂等键
把 Task 移回 `ready`。`request_human_decision` 始终归 Human；未知、缺字段或环境未变化的 blocker
保持 blocked；Gate evaluator blocker 暂时继续由 Human 处理，直到存在 Gate 专用探针。这样恢复次数由
事实变化驱动，而不是由唤醒次数驱动。

## 11. 实施切片

| 切片 | 内容 | 退出条件 |
| --- | --- | --- |
| S0 术语与观测 | 建立新旧名映射、补 correlation、记录状态迁移证据 | 可以按一个 workId 串起 Command→Task→Inbox→Invocation→Outcome |
| S1 状态守卫 | 为 Task、Inbox、Invocation、Delivery 使用显式 transition API | 任意字符串状态更新被测试拒绝 |
| S2 Gate 深模块 | 统一 review request、evidence、decision、返工 | Gate 是唯一审查判定事实源 |
| S3 Invocation 边界 | 收敛 Inbox/Envelope/Invocation/Session 的完成语义和恢复策略 | 各层 completion 不再互相冒充 |
| S4 A2A 收敛 | 合并重复的 chain/worklist 与 possession/pass 生命周期 | 只保留一个 handoff owner 和一个状态机 |
| S5 Control Process Manager | 组装事实快照、调用纯 Policy 并可靠推进十种控制动作 | 同一快照产生相同有序动作集；waiting_human 可恢复 |
| S6 迁移清理 | 删除兼容分支、旧命名和无读者投影 | 架构图、spec、代码、测试一致 |

## 12. 设计不变量

1. Harness 是平台运行环境，不是 Boss Agent。
2. 每份可变事实只有一个 owner。
3. Agent 可以自主思考，但跨模块改变事实必须提交结构化 Command。
4. 人可以通过 WebUI 主动触发 Command；WebUI 不自行编排。
5. ContextSnapshot 不等于投递确认；消费游标必须区分 delivered 与 acknowledged。
6. 领域事务与 Event Outbox 原子提交；外部 I/O 只能走 Durable Effect Outbox。
7. Process Manager 只组装快照、调用纯 Decision Policy 并推进动作；Policy 不做 I/O，
   Process Manager 不直接启动 Runtime、不直接改领域表。
8. 所有 `completed` 必须带对象类型；禁止裸 `completed` 作为跨模块协议。
9. 错误先归一化再决策，CLI 文本和 UI 文案不是控制平面事实。
10. Invocation 重试、Task 返工和 Effect 重放必须分别计数、分别限额；Agent 内部重试由
    Runtime 在当前 WorkContract 预算内管理，不得伪装成 Process Manager 控制动作。
11. 多 Agent 调度只管理 Work Cell 和协作边，不读取或合并各 Agent 的内部 Todo。
12. 对共享事实的并发写入必须经过 owner 的版本校验、lease 或 fencing；不能靠消息时序碰运气。
13. 系统必须能检测 wait-for graph 的死锁和 A2A 循环传球，并升级给 Human 或 Lead Agent。
14. 终态 owner 必须最终收回其 WorkAuthority；blocked 只有在恢复条件被证明满足后才能重新派工。

跨模块 trace 使用一条连续因果链，不在每张表复制一套可能漂移的字段：

- Platform Event 强制 `correlationId`，非根事件携带 `causationId`；
- GoalContract 在 Delivery owner 中冻结根 correlation；未显式提供时从稳定 start
  idempotency key 派生一次，后续不得换号；
- AgentInbox Command 从 source Event 继承 correlation，并以 source event id 为 causation；
- Scheduler 原样传入 Invocation Pipeline，后者以 correlation 作为 traceId；
- WorkContract 与 AgentOutcome 冻结 correlation/causation；Invocation 通过不可变
  `work_contract_id` 关联该信封，Runtime Events 同时带 invocationId 与 correlation；
- Invocation owner 的 `planned -> starting -> running -> terminated` 事件从首个 planned
  事件继承根 correlation，并以前一 Invocation 事件作为 causation；ExecutionEnvelope
  只能作为派发因果节点，不能覆盖根 trace；
- ControlDecision/ControlAction、Task、Gate 与 A2A Chain/Pass 只把自身 ID 用作 aggregate
  或 causation；其事件和下游 Command 继续携带 Goal/Human turn 的根 correlation，不能把
  decisionId、inboxId 或 chainId 提升成新 trace；
- `PlatformEventLog.listTrace(correlationId)` 跨 stream 按记录顺序恢复完整状态迁移 trace。

## 13. 用真实协作场景反推设计

### 场景 A：项目启动与首次拆解

```text
Human 提交 Goal
  -> Command Gateway 创建 GoalContract / DeliveryRun
  -> Delivery Control Process Manager 发现“尚无可执行 Task”
  -> activate Lead Agent Work Cell
  -> Lead 自主理解目标并提交 propose_task_graph Outcome
  -> Task owner 校验并持久化 Task Graph
  -> Team Scheduler 只激活依赖已满足、角色可用的 Work Cells
```

关键边界：

- Harness 不在启动时自己用规则或 LLM 拆任务；Lead Agent 提出拆解。
- Lead 的自然语言计划不是 Task Graph，只有被 Task owner 接纳的 Command 才是共享承诺。
- Task Graph 一次提交要么整体通过，要么返回可修正的验证错误，避免其他 Agent 看见半张图。
- `propose_task_graph` 由 durable Process Manager 翻译为现有 Task Graph owner 的
  `commit(expectedRevision, idempotencyKey, tasks[])`；owner 在单事务内完成引用校验、DAG
  校验、Tasks/depends_on edges/action 写入与 graph revision CAS。事件重放返回同一 commit，
  内容漂移或并发旧 revision 被拒绝。
- 这一边界不只约束 Lead Outcome。WebUI、Task Graph API、Harness `initializeGraph` 和
  group-chat task flow 的创建、拆分、合并、重开、阻塞、恢复、改派与取消全部调用同一个
  `mutate` owner。调用者必须提供当前 graph revision 与稳定幂等键；精确重放返回首次完整
  结果，内容漂移或陈旧 revision 在任何领域写入前失败。
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
- receiver 提交 `report_blocked` 或 `request_human_decision` 时，A2A owner 必须把父 Pass
  标记 `blocked`、撤销 receiver Possession 并为 source holder 打开 recovery；这类结果
  不是成功完成，不能满足分支 join。

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
- Task Outcome 接纳同时校验当前 `Task.revision`；信封版本与冻结版本相同但当前 Task 已漂移，
  仍必须拒绝。
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
Control Process Manager 也无法判断该等待、重试、换 session 还是请人补配置。

### 场景 E：Human 介入后恢复

```text
Delivery.waiting_human
  -> WebUI 展示 reason + requiredAction + affectedWork
  -> Human 在 WebUI 补配置 / 授权 / 做 Gate 决策
  -> Human Command 进入对应 owner
  -> owner 修改事实并产生 Event
  -> Delivery Control Process Manager 重新计算
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
  -> Delivery Control Process Manager 产生 terminate
  -> Delivery owner 校验 Closure 并完成
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
| 跨状态机唯一 ControlAction | Delivery Control Process Manager |

如果现有模块能承担，就深化现有接口；只有当某项能力没有自然 owner 时才增加模块。
