# Platform Runtime 事件模型

> 日期：2026-07-24
> 状态：目标设计；基础设施第一切片实施中
> 活动规格：`specs/platform-runtime-events/spec.md`（规范事实源）
> 依赖：`acp-runtime-integration`、`system-control-plane`、`agent-session-identity`

本文是平台事件驱动 Runtime 的**顶层技术设计与架构决策记录**。它承载长期设计动机、
关键决策的 ADR 记录，以及现状到目标的差距分析。可实施的契约条款以
`specs/platform-runtime-events/spec.md` 为事实源，本文为它的支持材料与设计背景。

---

## 1. 定位：runtime 是整个平台运行时

### 1.1 术语收敛

项目历史中 `runtime` 一词被重载为多种含义（ACP 执行进程、Team Runtime 契约、
Runtime Node 身份等）。本设计统一收敛到一个心智模型：

> **runtime = 整个平台运行时本身**。它不是某个 agent 执行进程，也不是某个领域模块，
> 而是平台在运行过程中持续产生并处理信息的那一层。ACP 执行进程、领域模块、协作流转
> 都是 runtime 运行过程中的**事件源**，不是 runtime 本身。

这对应 spec §4 中"canonical `runtime.*` 事件的唯一生产者 Platform Runtime"这一概念——
Platform Runtime 就是归一化层，把 Runtime 原始信号收敛成有严格语义的 `runtime.*`
事件流。领域事件仍由对应领域模块生产，Platform Runtime 不代理领域 owner。

### 1.2 OS 中断模型隐喻

平台事件驱动可以精确类比为操作系统的中断机制：

| OS 概念 | 平台对应 | 现状 |
| --- | --- | --- |
| 运行中的系统 | 平台 runtime（整个运行时） | 平台本身 |
| 中断源（时钟/磁盘/网卡） | 事件源（ACP 进程/领域模块/用户命令） | runtime 源✓ 领域源✗ |
| 中断 = 信号 | `PlatformEvent` 信封 | ✓ 已有 |
| **中断向量表** | **Durable Dispatcher + handler 注册表** | **✓ 已实现并接 production worker** |
| ISR（中断服务程序） | Handler（四角色） | spec §7 已定义角色 |
| 上半部/下半部 | 同步 guard / 异步 fan-out | guard✓ fan-out✗ |
| 中断屏蔽/优先级 | handler 分级 | 待定 |

**核心推论**：平台"事件驱动"的全部难度在**消费者如何响应**，不在生产者发事件。
"针对不同事情设计不同方法"（用户原话）的工程落点，就是补一个 Dispatcher（中断向量表）。
没有它，"不同事件不同 handler"只是一句原则；有了它，事件驱动才有唯一的分发包络，
像 OS 中断向量表一样让所有处理方式注册于此。

### 1.3 事件系统的定位

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

Agent 是 Command actor，不是事件消费者（经 Inbox 被动消费除外，见 §7）。Invocation 是
Agent 的一次激活。Platform Runtime 只负责可靠执行 Invocation，不拥有 Task、A2A、Review
或 Delivery 事实——这些事实源是各领域的表（见 §2）。

---

## 2. 事实源立场：事件 = 协调信号

> **ADR-001：事件作为协调信号，领域表仍是事实源**
> 详见 §11 ADR-001。

这是整个设计的分类地基。它决定：

| 维度 | 协调信号立场（本设计选定） | Event Sourcing 立场（被否决作为默认） |
| --- | --- | --- |
| 领域表 | 表是事实源，事件**派生于表变更** | 表是投影，状态由事件 reduce 重建 |
| 生产时机 | 表写入动作**同事务发事件**（inline） | 必须先有事件，表是结果 |
| 消费者失败后果 | 某投影挂了只是 UI 不更新，表还在 | Reducer 挂了状态全丢 |

**关键含义**：在协调信号立场下，"不同事情不同方法"的主战场不在生产侧（生产侧基本统一
为 inline 同事务发事件），而在消费侧——不同事件驱动不同动作，每种动作有自己的方法。
spec §7 的四角色就是这"不同方法"的分类。

**例外**：少数高价值聚合采用 sourcing 语义。最典型是 Invocation——它的状态完全由
`runtime.*` 事件流重建（`RuntimeEventPublisher` 的 guard 就是生产侧 Reducer）。这是
合理例外，不构成平台默认立场。

---

## 3. 静态结构与事件流

```text
┌─────────────────────────────────────────────────────────────────────┐
│  外层：事件源（产生原始信号/命令，本身不是事件）                       │
│                                                                      │
│   用户/Web UI          ACP 执行进程            领域状态变更            │
│   ─────────────       ──────────────          ──────────────         │
│   C2S Command          opencode/claude/         task / review         │
│   (terminal:start,     codex 子进程             delivery              │
│    task.assigned...)   产生原始信号             a2a(possession/chain) │
│        │                    │                    envelope/session     │
│        │                    │                    binding/node         │
│   [命令通道,             [原始信号,            [表是事实源,            │
│    不进事件流]            非 canonical]          inline 发事件]       │
└────────┼────────────────────┼──────────────────────────┼──────────────┘
         │                    ▼                          │
         │     ┌──────────────────────────────┐          │
         │     │  Platform Runtime（归一化层）  │          │
         │     │  ★ runtime.* 唯一生产者       │          │
         │     │  AcpRuntimeEventCoordinator   │          │
         │     │  RuntimeAgentEventBridge      │          │
         │     │  RuntimeEventPublisher        │          │
         │     └──────────────┬───────────────┘          │
         │                    │ canonical runtime.*      │
         │                    ▼                          ▼ domain.*
┌────────┼─────────────────────────────────────────────────────────────┐
│        │           ★ 事件事实层（平台唯一的真相枢纽）                   │
│        │           PlatformEventLog                                   │
│        │           ─ stream 顺序 ─ dedupe 幂等 ─ 冲突检测              │
│        │           ─ 唯一终态守护 ─ schema 校验                        │
│        │     [生产侧上半部：同步，在领域事务内，拒绝非法迁移]           │
└────────┼─────────────────────────┬────────────────────────────────────┘
         │                         │
         │                         ▼ (下半部 fan-out，异步)
         │     ┌────────────────────────────────────────────────┐
         │     │   ★ Durable Dispatcher（中断向量表）               │
         │     │   register(type, handler) / recover() / drain() │
         │     │   持久投递 · 错误隔离 · 局部顺序 · 恢复/重试       │
         │     └────┬───────────┬──────────────┬───────────────┬──┘
         │          ▼           ▼              ▼               ▼
         │     ┌────────┐  ┌─────────┐   ┌───────────┐   ┌──────────┐
         │     │①Router │  │②Reducer │   │③Process M│   │④Projectn │
         │     │        │  │         │   │           │   │          │
         │     │domain→ │  │重建聚合 │   │跨域闭环   │   │可重建投影│
         │     │Inbox   │  │当前态   │   │只调 iface │   │UI/统计   │
         │     └───┬────┘  └────┬────┘   └─────┬─────┘   └────┬─────┘
         │         │            │              │              │
└────────┼─────────┼────────────┼──────────────┼──────────────┼─────────
         │         ▼            ▼              ▼              ▼
   ┌─────┴──────────────────────────────────────────────────────────┐
   │  内层：消费者/执行体                                             │
   │                                                                  │
   │  Agent Inbox        聚合状态机       领域协调          Web UI    │
   │  Agent claim ←──┐   invocation 态    delivery phase   socket 投影 │
   │  Inbox item     │   task 状态        推进（从 daemon   agent:event│
   │       │         │   session 态       迁出）           task.state │
   │       ▼         │       │                │                │      │
   │  Harness 编译    │       │                │                ▼      │
   │  ContextSnapshot│       │                │           [纯投影，    │
   │       │         │       │                │            非事实源]   │
   │       ▼         │       │                │                      │
   │  启动 Invocation─┘───────┘────────────────┘                      │
   │  (回到顶层的 ACP 执行进程)                                         │
   └──────────────────────────────────────────────────────────────────┘
```

读图：事件只**向上**进事实层，经 Dispatcher **向下** fan-out。没有任何"agent 横向直接交互"
的箭头——包括 A2A（见 §8）。

---

## 4. 四类事件分类与 owner 全景

| 类别 | 命名示例 | 唯一生产者 | 主要消费者 | 进 Core? |
| --- | --- | --- | --- | --- |
| `domain` | `task.assigned`、`delivery.run.phase_advanced`、`a2a.possession.passed` | 各领域模块（inline） | ①Router、②Reducer、③PM、④Projection | 状态校验进 Core，fan-out 不进 |
| `coordination` | `agent.work.enqueued`、`agent.work.claimed` | Agent Inbox 模块 | Scheduler、Harness、④Projection | 不进（下半部） |
| `runtime_lifecycle` | `runtime.invocation.started`、`runtime.invocation.terminated` | Platform Runtime | ②Reducer（重建 invocation 态） | ✓ 上半部（guard） |
| `runtime_activity` | `runtime.message.segment.completed`、`runtime.tool.started` | Platform Runtime | ④Projection（UI/观测） | 不进（下半部） |

Adapter、模型进程、工具和权限策略只提供原始信号。Platform Runtime 完成校验、归一化、
排序和持久化后，才形成 canonical `runtime.*` 事件。

Agent 是 Command actor，不是领域事件生产者。Agent 的工具请求必须经过对应领域模块校验，
由领域模块提交业务状态并产生领域事件。详见 §7。

完整的 domain / coordination 事件目录见 spec §6。

---

## 5. 消费侧四角色 = Handler 四种 Stereotype

spec §7 的四种消费方式（Reducer / Router / Process Manager / Projection）不是四个平级
消费者子系统，而是 **Handler 的四种标准写法（stereotype）**。一个领域模块注册 handler 时，
选一种范式来写。"不同事情不同方法"= 注册不同的 handler stereotype。

```
所有 PlatformEvent
       │
       ▼
   Dispatcher ──按 type 查表──┐
       │                       │
       │       ┌───────────────┼───────────────┬───────────────┐
       │       ▼               ▼               ▼               ▼
       │   ①Router         ②Reducer        ③Process Mgr    ④Projection
       │   domain→Inbox     重建聚合态      跨域调 iface     刷新投影
       │   "激活"           "状态机"        "闭环"          "投影"
```

| Stereotype | 输入 | 动作 | 关键约束 | 错误语义 |
| --- | --- | --- | --- | --- |
| ①Router | domain 事件 | 给 ProjectAgent 创建 Inbox item | 只发 Command，不直接启动 Runtime | 入队失败重试，幂等（按 eventId） |
| ②Reducer | 事件流 | 重建聚合当前态 | 幂等，拒绝非法迁移 | 非法迁移拒绝并记录 |
| ③Process Manager | domain 事件 | 跨领域协调闭环 | 只调目标模块 interface，不越权写表 | interface 调用失败重试 |
| ④Projection | 事件 | 刷新 UI/socket/统计 | 可重建，不是事实源 | durable 投影重试；best-effort 实时推送可丢 |

---

## 6. 进/不进 Runtime Core 的边界

> **ADR-002：上半部/下半部分离**
> 详见 §11 ADR-002。

```text
┌─────────────── Runtime Core（上半部，同步，事务内）──────────────┐
│  必须立即生效，错过难纠正：                                       │
│  • runtime.invocation 终态唯一性、状态机非法迁移拒绝（guard）     │
│  • domain 表的状态校验（task status 合法迁移、delivery 不回退）   │
│  • dedupe 冲突检测                                                │
│  原则：只做"拒绝非法"和"保证唯一"，不做 I/O、不 fan-out            │
└────────────────────────────────────────────────────────────────┘
                            │ append 提交后
                            ▼
┌─────────────── 下半部（异步，fan-out，不进 Core）──────────────┐
│  可失败、可重试、可延迟：                                        │
│  • ①Router：domain→Inbox（触发 Scheduler，重）                  │
│  • ②Reducer：重建聚合态（读多写少）                              │
│  • ③Process Manager：跨域协调（调 interface，可能跨进程）        │
│  • ④Projection：UI/socket/统计（可重建，可丢）                  │
│  原则：一个 handler 挂，不影响别的（错误隔离）                    │
└────────────────────────────────────────────────────────────────┘
```

`RuntimeEventPublisher` 的 guard 已示范了上半部 ISR 模式（在 append 事务内拒绝非法迁移）。
domain 表的状态校验应当镜像这一模式：领域模块的状态机校验、表写入与事件追加在同一事务内
完成。上半部是 producer-local invariant，不注册到 Dispatcher；Dispatcher 只负责提交后的
下半部 fan-out。

### 6.1 下半部可靠性

仅有进程内 `dispatch(event)` 无法提供 at-least-once：进程可能在事件提交后、回调执行前
退出。因此 durable handler 必须有持久投递事实（event × handler）、attempt、lease、
next-attempt 与 terminal receipt；启动恢复会从 `platform_event` 回补缺失投递，再 claim
执行并建立基于 AUTOINCREMENT ingestion offset 的 handler cursor；运行期只扫描 cursor
之后的新事件，删除 project/event 也不会造成 offset 复用。best-effort handler 仅用于
可重建或允许丢失的实时通知，不承诺重试。

同一 handler 对同一 stream 串行消费，只有前序事件成功或明确 dead-letter 后才推进；
不同 stream 可以并行。handler 必须按 `eventId` 幂等，并接受 `AbortSignal`：超时只触发
协作取消，Dispatcher 必须等本次执行真正释放后才重试同 stream；活跃执行用 claim token
续租，只有进程退出后才允许 lease recovery 接管。

---

## 7. Agent 产/消边界（修正版）

> **ADR-003：Agent 是 Command actor，不 push-订阅 Bus，但可消费**
> 详见 §11 ADR-003。

早期表述"Agent 消费：零"过度收紧。精确边界如下。

### 7.1 两个区分

- **消费 ≠ 订阅**。消费 = 通过某个 interface 拉取/接收事件数据；订阅 = 拿 Event Bus 引用
  自己注册 listener 被事件 push。Agent 可以消费，不可以 push-订阅。
- **生产 ≠ 直接发**。Agent 不直接生产 domain 事件；Agent 的工具请求经领域模块校验后，
  由领域模块发事件。

### 7.2 产/消矩阵

| | 产出 | 消费 |
| --- | --- | --- |
| runtime.* 活动信号 | ✓ 原始信号 → 归一化入流 | ✗（不应回头看自己刚发的） |
| domain 事件 | ✗ 不直接生产（经领域模块） | ✓ 可消费，两种合法方式（见下） |
| coordination 事件 | ✗ | ✓ claim Inbox item 即消费 `agent.work.enqueued` |

### 7.3 Agent 合法消费的两种方式

**方式一：经 Inbox claim（pull）**
Agent claim 一个 Inbox item，item 携带触发它的 domain 事件上下文。Agent 通过 claim
消费了那条事件的信息——只是它是 pull 来的，不是订阅来的。

**方式二：只读工具查询（pull）**
Agent 在执行中可调用工具查询事件历史：

```
eventHistory 工具集（供 Agent 调用，非订阅）：
  - queryTaskTimeline(taskId)      → 读 task.* 事件流
  - queryInvocationLog(invId)      → 读 runtime.* 事件流
  - queryConversationEvents(...)   → 读某聚合的事件历史
```

工具内部调 `PlatformEventLog.listStream()` / `listByInvocation()`，返回只读快照。
这符合 spec §3"不让 Agent 直接订阅事件总线"，同时让 Agent 具备事件感知能力。

### 7.4 OS 类比修正

Agent 像用户态进程：通过 Inbox（消息队列）和 ContextSnapshot（共享内存映射）接收输入，
可**读**系统状态（`dmesg`/`/proc`），但**不能注册自己的中断 handler**（不能 push-订阅 Bus）。

### 7.5 边界强制

"不订阅"必须靠**模块边界**强制，不能靠纪律——Runtime 根本拿不到 Event Bus 的引用，
只能拿到 Coordinator 和只读工具。一旦让 Agent 直接发/订事件，四类 owner 划分名存实亡，
deep module 退化成 shared mutable 全局。

---

## 8. A2A 作为 domain 事件的一部分

A2A 不在事件架构里有单独位置——它就是 domain 事件的一部分，与 task/review/delivery 同级。
A2A 的 `a2a.possession.passed` / `a2a.chain.entry_done` 是 domain 事件，走同一条
①Router→Inbox 链。

### 8.1 目标时序

```text
Agent A 执行中，决定移交给 B
   │  A 是 Command actor —— 不直接发事件
   ▼
A 调工具 requestHandoff({to:B, prompt, contextRef})
   │
   ▼
┌─ a2a 领域模块（表是事实源，inline 发事件）─────────────────┐
│  startPass()：                                              │
│    表：A.possession→completed, pass→started, B→open         │
│    发 domain 事件：a2a.possession.passed                     │
│       {from:A, to:B, passId, chainId, contextRef}            │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
                    PlatformEventLog.append()  ← 事实层
                            ▼ (下半部 fan-out)
                    Dispatcher.dispatch(a2a.possession.passed)
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
        ①Router        ②Reducer       ④Projection
        给 B 建         更新 chain     通知 UI
        Inbox item      当前态         "控制权→B"
        {passId,                       （替代旧 a2a:dispatch
         contextRef,                    socket，但只是投影，
         prompt}                        不再是激活必经环）
              ▼
   B claim Inbox item  ◄── B 经 claim 消费了这条事件的信息
              │           （B 没订阅任何东西，主动 pull）
              ▼
   Harness 编译 ContextSnapshot（注入 contextRef）
              ▼
   启动 B 的 invocation → runtime.invocation.accepted → ...
              ▼
   B 执行完，调工具 reportComplete()
              ▼
   a2a 领域模块 completeHolder()
     发 domain 事件：a2a.possession.completed / a2a.chain.entry_done
              ▼
   ... 同样经 Dispatcher fan-out（可能触发 chain 下一环，③Process Manager）
```

### 8.2 业务形状不变，协调机制解耦

对照现状（socket 握手绕道浏览器），目标架构的关键不变量与变化：

| 维度 | 现状 | 目标 | 变化 |
| --- | --- | --- | --- |
| 控制权转移 | possession 状态机 | 同样的 possession 状态机 | 不变 |
| 谁协调移交 | daemon orchestrator 硬编码 | a2a 领域模块（inline 发事件） | 从 daemon 移到领域 |
| B 怎么被激活 | socket 绕道浏览器 ACK | domain 事件 → Router → Inbox → claim | 去掉浏览器依赖 |
| B 拿 A 的上下文 | handoff packet 注入 prompt | 同样经 ContextSnapshot 注入 | 不变 |
| A、B 直接交互 | 否 | 否 | 都不直接交互 |

最重要的不变量：两栏"A、B 直接交互？"都是**否**。这正是"agent 不订阅 Bus"成立的关键。
若让 B 直接订阅 A 的事件，A2A 退回耦合模型；用 Inbox claim，B 永远只面对"平台派给我的
工作"，不感知触发者——这就是 OS 里"进程通过消息队列 IPC，不感知对方进程"的同构。

---

## 9. 现状 → 目标差距分析

### 9.1 核心矛盾：有"事件"但无"事件驱动"

平台现在到处都是"事件"，但没有一个真正的事件驱动系统：

- **没有 EventBus**（全代码库确认）。现在所谓"事件"只有三种落地：写 append-only 表
  （`agent_event`/`control_proof_event`/`a2a_audit_log`/`task_action`）、插 `chat_message`、
  Socket `room.emit`。**没有任何订阅者**——表是死档案，socket 是投影，没有 fan-out。
- **领域状态机全是静默的纯表写入**。delivery 的 `planning→executing→completed`、a2a 的
  控制权转移、envelope 的 10 态状态机、binding 的 busy/idle——全部零事件。
- **唯一的"事件驱动"是 `daemon.forwardAgentEvent`**——它是 shallow 透传，同时做持久化/
  观测/A2A 扫描/Session 确认/UI 投影六重职责（spec §1 批判的就是它）。

用 OS 隐喻说：**现在的系统有中断源、有中断处理逻辑，但缺中断向量表**。你要的"全平台
事件驱动"，本质就是补上这个中断向量表（Dispatcher）。

### 9.2 生产侧缺口（牌桌 A）

| 事件类 | 状态 | 说明 |
| --- | --- | --- |
| runtime_lifecycle / runtime_activity | ✓ 信封+归一化已就位，✓ 已接 daemon（兼容双写） | 切片 0/1 产物 |
| domain（9 领域） | ✓ typed 目录 + 领域事务内 inline seam | task/review/delivery/a2a/envelope/binding/node/session/invocation |
| coordination | ✓ 持久 Inbox + enqueued/claimed/recovered 已落地 | migration 49；Scheduler 经 Harness 提交 |

### 9.3 domain 事件缺口清单（按业务价值排序）

> **ADR-004：全领域转 domain 事件（第一阶段）**
> 详见 §11 ADR-004。

| 领域 | 静默状态机 | 潜在 domain 事件 |
| --- | --- | --- |
| autonomous-delivery | run: `submitted→planning→executing→reviewing→verifying→delivering→completed/escalated`；attempt `succeeded/failed` | `delivery.run.submitted/phase_advanced/completed/escalated` |
| a2a possession | `startPass`（控制权转移）、`createPass`、`completeChain` | `a2a.possession.passed/completed` |
| a2a chain | `markDone`、`complete/abort` | `a2a.chain.entry_done/completed` |
| execution_envelope | 10 态：`drafted→...→blocked/completed/failed/expired`，终态不可逆 | `envelope.validated/blocked/queued/routed/sent/...` |
| task | `updateStatus`、`recordHandoffAccepted` | `task.assigned/in_progress/in_review/done`（最成熟，有 `task_action` 准事件源） |
| agent_binding | `markStarted/markFinished/markError` | `binding.started/finished/error` |
| runtime_node | `recordMiss`（`reachable→stale→unreachable`） | `node.stale/unreachable` |
| invocation/dispatch | `updateStatus`、`claimNext` | `invocation.queued/claimed/succeeded` |
| agent_session | `seal*` 系列 | `session.sealed` |

**可复用的准事件源**（已是 append-only，加 fan-out 即变 domain 事件）：`task_action`
（16 个 `task.*` 动作）、`control_proof_event`、`a2a_audit_log`、`agent_event`。

### 9.4 消费侧缺口（牌桌 B）

| 角色 | 状态 | 缺口 |
| --- | --- | --- |
| ①Router | ✓ 通用 domain→Inbox Router 已落地；具体领域 resolver 随切片 4 接入 | Router 只创建 Command，不启动 Runtime |
| ②Reducer | ◐ runtime 侧已有 publisher 守护（生产侧 Reducer）；消费侧 Reducer 缺 | 无人读 runtime 事件重建态，daemon 仍直接查表 |
| ③Process Manager | ✓ task/review domain event durable handler | 仅调用 delivery advancement port；port 持久接纳后由 delivery worker 推进 |
| ④Projection | ✗ 全部错位 | 读 AgentEvent/ACP 原始信号，spec §10 要求迁 |

### 9.5 Process Manager 错位（精确落点）

> **ADR-005：立即解耦 Process Manager 触发入口，保留 Supervisor 深模块**
> 详见 §11 ADR-005。

delivery 的阶段推进不是"硬编码在 daemon"（之前的判断有误）。精确结构：

- `reconcileAutonomousDeliveryConversation`（`autonomous-delivery/registry.ts:50-59`）是
  9 行薄外壳，真正逻辑在 `AutonomousDeliverySupervisor.advance`（`supervisor.ts:84`）。
- `advance` 已有良好分层：纯函数决策 `decideDeliveryNext`（`policy.ts:90`）+ 端口适配
  （`DeliveryFactsPort`/`DeliveryActionPort`）+ 乐观锁串行化（`updateRun` 用
  `expectedRevision`，`repository.ts:111-112`）。
- **错位点**（需重构的两处）：
  1. **入口硬编码时序**：`task-notification-publisher.ts:260` 尾部 `void reconcile...`
     把 delivery 协调挂在 task 通知函数尾部，与 task 通知耦合。应抽成 task/review
     事件订阅 handler。
  2. **触发原因未利用**：`cause` 参数被 `void` 掉（`supervisor.ts:85`），事件因果没有进入
     可观察证据。

`AutonomousDeliverySupervisor.advance()` 已是深模块：它用一个小 interface 隐藏状态推导、
claim、lease、重试、恢复、并发控制和收口规则；这与
`specs/autonomous-delivery-loop/spec.md` 的既有契约一致。事件迁移不得为了“handler 化”
把这些内部职责泄露成多个浅 interface。事件 handler 只负责把 event 映射为幂等的
delivery advancement request；delivery 模块持久接纳后，由自己的 worker 调用
`advance(runId, cause)`。Platform Event delivery 的成功边界是持久接纳，实际推进失败由
delivery queue 重试。bootstrap 的周期 reconcile 保留为兜底恢复触发器，不与事件驱动入口
争夺事实 owner。

### 9.6 forwardAgentEvent 六重职责（待拆）

`daemon.ts:1365-1528`，六重职责精确定位：

1. 持久化文本分片（1369, 1493-1516）
2. 观测 span 上报（1398-1467）
3. Session 身份确认/绑定（1374-1391）
4. A2A 文本缓冲扫描（1483-1524）
5. UI 投影/socket 广播（1425/1440/1463/1469-1480）
6. 背景子活动标记 + 心跳重置（1393-1396, 1527）

拆分方向：接入 `AcpRuntimeEventCoordinator` 后，1-4 的副作用迁移到对应 handler
（②Reducer/③PM/④Projection），5 退化为纯 Projection，6 下沉到 invocation 生命周期。
forwardAgentEvent 最终退化成兼容 shim，在双写退出后删除。

---

## 10. 迁移路线（高层）

> 详细切片依赖与退出条件见 spec §9 与 `tasks.md`。

```text
切片1: 接入 daemon（已完成，待补 daemon 边界回归）
  AcpRuntimeEventCoordinator 接进 daemon.execute 路径，双写 fail-open
  退出: daemon ACP 路径产生可查询 Runtime 事件（spec §10）

切片2: Durable Dispatcher + 第一个 Projection
  建立持久投递/恢复，再把 UI/Message 投影从读 AgentEvent 改为读 runtime 事件
  退出: 至少一个投影从 Runtime Event 重建（spec §10）

切片3: Agent Inbox + coordination 事件（已完成）
  持久 Inbox 已替换浏览器执行队列；前端仅保留临时显示投影
  Scheduler claim 后经 Harness 提交；严格 FIFO、heartbeat、lease 恢复与 token fencing
  浏览器投影按 project 恢复，持久化确认/重试和取消均以服务端 Inbox 为准
  退出: Agent Inbox 能由领域事件幂等产生、claim、恢复（spec §10）

切片4: domain 事件 inline seam（已完成）
  从 task 开始（最成熟的 task_action 准事件源），证明 inline 模式可行，再扩展全领域
  退出: 四类事件契约和 owner 有自动化测试（spec §10）

切片5: Process Manager 触发入口迁移（已完成）
  delivery 阶段推进抽成 handler，复用 AutonomousDeliverySupervisor.advance 深模块
  退出: delivery 协调不再依赖 task-notification-publisher 尾部硬编码

切片6: 退出双写
  删除 forwardAgentEvent 业务副作用 + 旧 agent_event 写入
  退出: 长期设计与 wiki 已同步，兼容双写已删除（spec §10）
```

每切片满足 spec §10 的某个退出条件，且不破坏兼容。各切片在落地前另起 plan，
不在本顶层文档锁定实现细节。

---

## 11. ADR 记录

### ADR-001：事件作为协调信号，领域表仍是事实源

- **背景**：平台要做成全平台事件驱动。事件在平台里是"协调信号"还是"事实源"是分类地基，
  决定后面所有"不同事情不同方法"的形态。
- **决策**：事件 = 协调信号，领域表仍是事实源。domain 事件生产用 inline（领域模块写表
  的那一步同事务发事件）。sourcing 仅在高价值聚合例外（如 invocation 已有终态守护）。
- **替代方案**：事件 = 事实源（sourcing）。状态由事件 reduce 重建，领域表降为投影。否决
  原因：现有 task/review 等成熟领域表要重做，改造量大、风险高。
- **后果**：①"不同事情不同方法"的主战场在消费侧（四角色 handler），不在生产侧
  （生产侧基本统一为 inline）。②领域表是事实源，事件是派生协调——消费者失败只影响投影
  /激活，不丢事实。
- **退出条件**：若未来某高价值聚合（如 invocation）证明需要 sourcing，按例外处理，
  不改变平台默认立场。

### ADR-002：上半部/下半部分离

- **背景**：事件生产与消费混在一起会导致：要么把 I/O 塞进事务（事务变重），要么关键
  校验放到事后异步（错过难纠正）。
- **决策**：上半部（同步，producer-local 领域事务内）只做"拒绝非法"和"保证唯一"——
  终态守护、状态机非法迁移拒绝、dedupe 冲突检测；它不是 Dispatcher handler。下半部
  （提交后 fan-out）做 Router/Reducer/PM/Projection。durable handler 通过持久投递事实
  at-least-once 恢复，best-effort handler 允许丢失；一个 handler 挂不影响别的。
- **替代方案**：全部异步。否决原因：终态唯一性和状态机校验错过就难纠正。
- **后果**：RuntimeEventPublisher 的 guard 已示范上半部模式；domain 表状态校验应镜像。
- **退出条件**：无。

### ADR-003：Agent 是 Command actor，可消费但不订阅

- **背景**：早期表述"Agent 消费：零"过度收紧，把"不订阅 Event Bus"误读成"不消费任何
  事件"。
- **决策**：Agent 不直接生产 domain 事件（经工具→领域模块）；不 push-订阅 Event Bus；
  但可经 Inbox claim（pull）和只读工具查询（pull）两种方式消费事件信息。"不订阅"必须靠
  模块边界强制——Runtime 拿不到 Bus 引用，只拿 Coordinator 和只读工具。
- **替代方案**：让 Agent 直接订阅 Bus。否决原因：agent 互相感知形成耦合，四类 owner 划分
  名存实亡，deep module 退化成 shared mutable 全局。
- **后果**：A2A 协作经 Router→Inbox，agent 间无直接通道（见 §8）。新增 eventHistory 工具集
  作为 Agent 读事件流的接缝。
- **退出条件**：无。

### ADR-004：全领域转 domain 事件（第一阶段）

- **背景**：9 个领域的状态机全静默纯表写入，零 fan-out。这是"全平台事件驱动"相对
  "runtime 部分事件驱动"的核心价值缺口。
- **决策**：第一阶段将 9 领域全部转 domain 事件（task/delivery/a2a/envelope/binding/
  node/session/invocation）。生产用 inline（同事务发事件）。
- **替代方案**：①只转高价值领域（task/delivery/a2a/envelope）。否决原因：用户明确选
  "全领域都转"。②只从 task 试点。否决原因：用户选"全领域"。
- **后果**：domain 事件目录见 spec §6。`task_action` 等准事件源加 fan-out 即可复用。
- **退出条件**：四类事件契约和 owner 有自动化测试（spec §10）。

### ADR-005：立即解耦 Process Manager 触发入口，保留 Supervisor 深模块

- **背景**：delivery 阶段推进的触发职责错位——入口硬编码在
  task-notification-publisher 尾部；但 `advance()` 本身已经是符合既有 active spec 的
  深模块。
- **决策**：立即迁移触发入口（不保留通知尾部双写）。task/review 事件 handler 以
  source event 幂等持久接纳 advancement request；delivery worker 调用
  `advance(runId, cause)`，失败重新排队。周期 reconcile 保留为 crash/retry 兜底恢复触发器。
  Supervisor 内部的状态推导、claim、lease、执行、重试与收口继续隐藏在同一 interface 后。
- **替代方案**：①保留通知尾部触发，否决原因是继续耦合 Projection 与协调逻辑；
  ②把 Supervisor 拆成 PM handler + worker 公共 interface，否决原因是与
  `autonomous-delivery-loop` 事实源冲突并降低模块深度。
- **后果**：daemon 仍是纯 Runtime 执行器；delivery 协调可通过 Supervisor interface 独立
  测试；事件 handler 很薄但不复制业务规则。
- **退出条件**：delivery 协调不再依赖 task-notification-publisher 尾部硬编码；现有 delivery
  测试无回归。

---

## 12. 设计不变量

1. 一个命名空间只有一个 canonical producer。
2. 一个 accepted Invocation 最终且只能 terminated 一次。
3. terminated 后禁止产生新的 Runtime 活动。
4. 相同 dedupe key 的重复写入必须幂等，不同内容必须冲突。
5. 事件先持久化，再发布到进程外消费者。
6. Runtime completion 不等于 Task completion（runtime.* 与 domain.* owner 不交叉）。
7. Agent 通过 Command 影响项目，领域模块裁决并产生领域事实。
8. Agent 不 push-订阅 Event Bus（靠模块边界强制，非纪律）。
9. Runtime Core（上半部）只做"拒绝非法"和"保证唯一"，不做 I/O、不 fan-out。
10. 领域表是事实源；事件是协调信号；sourcing 仅作高价值聚合例外。
