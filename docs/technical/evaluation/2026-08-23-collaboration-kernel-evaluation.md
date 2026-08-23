# Collaboration Kernel Evaluation

- Change ID: `collaboration-kernel-2026-08-23`
- Evaluation level: C
- Status: accepted（确定性协作与 Runtime 启动契约；真实 Agent 任务成功率待 E 级复测）
- Code/spec revision: branch `codex/unified-event-agent-runtime`, base `feaa15f`，candidate 与本记录同一原子提交
- Evaluator/benchmark revision: `docs/archive/specs/collaboration-kernel/` at the same working tree

## Why

Agent Task Hub 是多个 Project、Delivery 与 Agent 持续协作的软件交付系统，但旧实现让 Human Command、
Task、Gate、A2A 和恢复入口分别构造 Inbox 命令、Prompt 与回调引用。生产领域中存在 5 个直接
`AgentInbox` 构造/投递点；ExecutionEnvelope 又在 ACP backend 准备前就 ACK。结果是一次工作缺少统一的
request identity、lane 和 reply address，运行端尚未真实接管时控制面也可能显示已接管。

## What changed

- 新增领域唯一入口 `CollaborationKernel.request/cancel`，统一 `WorkRequest` 的 identity、scope、cause、
  `replyTo`、幂等与 `project + agent` lane。
- Human、Task、Gate/Delivery、A2A 与 Evidence Recovery 改走 Kernel；旧 AgentInbox Router 删除，静态架构
  测试阻止领域模块重新直接 enqueue。
- 共享 `EventEnvelope` / `IdentityRef`，浏览器项目运行展示收敛为一个 `project:view` 通道；领域表继续是
  权威事实，未改成 Event Sourcing。
- `AgentRuntime` 拥有 directed envelope、reservation、Session/Invocation、ACP setup、permission、event
  normalization 与 cleanup；真实 execution handles 创建后才 ACK。
- Inbox claim 等待 Runtime ACK 时续租，ACK 后立即 `admitted`；繁忙 lane 使用最高 30 秒指数退避；
  Runtime setup 使用 10 分钟有界 Envelope TTL。
- ACP 增加 `AgentRun.started` readiness contract；claim 校验、Envelope ACK 与 Inbox admitted 原子提交，
  取消/lease loss 会 fence ACK 并 abort Runtime startup；`runtime_start_failed` 使用独立计数最多真实重试
  3 次，busy 不消耗预算，deferred/startup failure 不进入 completed dedupe cache。
- Invocation 使用跨 daemon owner token/lease 保持 project + Agent lane；live owner 不会被误判 orphan，
  owner lease 过期后才终结 Invocation 并轮换 Session generation；Runtime event、Session binding 与 terminal
  result 与 permission callback 使用 owner-fenced 写事务，backend failure 也必须先赢得 terminal fence 才能
  更新 Envelope/业务 owner，旧 owner 的迟到输出无业务副作用；Evaluation Case 和
  Task wakeup 也统一通过 Kernel 投递，不再直接调用 Invocation Coordinator。
- Evaluation 的 durable `agent.work.admitted` 携带 Invocation/trace binding，并以幂等事务投影 started proof 与
  `planning -> running`；ACK 后立即 crash 可由 Process Manager 重放恢复。
- Inbox、Kernel requestId 和 Coordinator dedupe 的幂等范围统一为 project + Agent + caller key；跨项目
  cause event fail closed。

直接回退代码会重新引入旧事件通道和假 ACK，不提供兼容开关。需要回退时应回退整个原子提交，并保留数据库
中的 durable Inbox/Event 历史用于审计。

## Industry evidence

访问日期：2026-08-23。依据为用户提供的 Buzz 源码快照
`C:\Users\qiufa\Downloads\buzz-main\buzz-main`：

- `ARCHITECTURE.md`（SHA-256 `568C697024F910BD6B4527FA77A97E1B9BD9287074285E78B8FA97E9F850346E`）
  展示 Relay 作为持久事件与订阅事实源、mention 触发 Agent、channel 作为回复与串行空间。
- `crates/buzz-acp/src/queue.rs`（SHA-256
  `AA49DD8D8573F273501AF4E1A9CF97DF8A9A5B17C9FAEE8CBCE81250DD8CAC24`）展示 per-channel
  inflight、去重、有界 batch、timeout release、retry/backoff 与 dead-letter 处理。

可迁移的是“一个持久协作事实同时携带触发身份、作用域、重放身份和回复位置”，以及按协作空间串行的 Runtime
队列。不可直接照搬的是 Nostr/channel 产品模型：本项目的结果必须由 Task、Gate、A2A 或 Delivery owner 裁决，
Runtime completion 不能直接成为业务完成。

## Method

环境：Windows，Node/pnpm 由当前 workspace 提供，Next.js 16.2.4，Vitest 4.1.5。

| 指标 | 接受阈值 |
| --- | --- |
| 领域直接 AgentInbox 生产入口 | `0` |
| 相同 WorkRequest replay | 只产生 `1` 个 Inbox item；内容冲突 fail closed |
| Lane | 同项目同 Agent 串行；不同 Agent 可并行 |
| Runtime ACK | setup 前失败为未 ACK；execution handles 后才 ACK |
| Inbox 启动租约 | ACK 前续租，ACK 后释放；繁忙重试不热循环 |
| ACK fencing | claim + Invocation owner check + Envelope ACK + Inbox admitted 单事务；startup failure 独立有界计数 |
| Crash recovery | live Invocation lease 跨 daemon 阻止同 lane；expired owner 才恢复 orphan；旧 owner terminal 被拒绝 |
| Evaluation ACK crash | admitted event 重放后 Case 进入 running；started proof 恰好一次 |
| 旧项目 Socket 通道 | 生产代码 `0` |
| 回归 | TypeScript、相关 lint、全量 Vitest、production build 通过 |

可重复命令：

```powershell
pnpm exec tsc --noEmit
pnpm exec eslint src/server/agent-runtime src/server/collaboration-kernel `
  src/server/platform-events/agent-inbox.ts src/server/platform-events/agent-inbox-scheduler.ts `
  src/server/invocation-pipeline/coordinator.ts src/server/invocation-pipeline/types.ts
pnpm test
pnpm build
```

静态 baseline 使用 `git grep ... main -- <producer roots>`；candidate 由
`src/__tests__/architecture/runtime-ownership.test.ts` 固化。测试数字来自同一 candidate worktree 的命令输出。

## Baseline vs candidate

| 场景 | Baseline | Candidate | 结果 |
| --- | --- | --- | --- |
| 领域投递入口 | 5 个直接 `AgentInbox` 构造/投递点 | 0；全部调用 Kernel | 通过，静态门禁 |
| request identity | 各 producer 自行拼 command 与回调 refs | requestId/laneId/cause/scope/replyTo 随 durable row 保存 | 通过，Kernel/Inbox tests |
| 幂等 scope | caller key 全局唯一，跨项目/Agent 冲突 | project + Agent + caller key | 通过，DB/Kernel/Coordinator tests |
| replay | Inbox 可去重，但没有统一领域请求接口 | identical replay 返回同 receipt；不同内容抛 conflict | 通过 |
| A2A 回调 | 依赖 command JSON 与分支局部知识定位 | Possession/PassGroup/Work reply address 显式持久化 | 通过，A2A tests |
| Runtime 接管 | `markSent -> acknowledge -> backend.execute` | `backend.execute handles -> acknowledge -> run` | 通过，pre/post-ACK tests |
| Runtime readiness | execute 返回 handles 即视为可 ACK | ACP initialize + session new/load 成功后 `started.ok` | 通过，spawn/concurrency/normal tests |
| ACK 前取消/崩溃 | claim 与 Runtime 无共同 fencing；starting Invocation 可阻塞 Session | 原子 claim-fenced ACK + AbortSignal；持久 owner lease 过期后恢复 orphan | 通过，fault-injection tests |
| ACK 后 owner 接管 | 旧进程可迟到提交 Invocation 与业务副作用 | owner-fenced event/Session/terminal commit；迟到结果丢弃 | 通过，cross-owner fault-injection tests |
| Evaluation ACK 后 crash | ACK 与 Case running 间存在易失窗口 | admitted durable projection 幂等恢复 running + proof | 通过，replay fault-injection test |
| 慢启动 | 2 分钟默认 TTL 与 Codex ACP 慢启动窗口接近 | 10 分钟 startup TTL，3 分钟未 ACK setup 不误过期 | 通过，DispatchGateway test |
| 长任务队列 | Inbox lease 等待整个 Invocation；或 busy 1 秒重试 | lease 只等真实 ACK；busy 指数退避至 30 秒 | 通过，Scheduler tests |
| 项目展示协议 | 7 类平行 Socket 运行事件 | 单一 `project:view` envelope | 通过，架构/Store tests |
| 全量回归 | 不适用 | 233 files passed / 2 skipped；1746 tests passed / 2 skipped | 通过 |
| 静态与构建 | 不适用 | TypeScript、核心受影响文件 ESLint、Next production build 通过 | 通过；build 保留既有 NFT warning |

仓库全量 `pnpm lint` 仍有 221 个既有 error 与 36 个 warning，集中在未触及的测试 helper、旧 Store 和 React
effect 规则；本变更核心受影响文件的 ESLint 为 0 error。该基线不被本次架构重构扩张，也不作为已修复项宣称。

## Decision

接受 Collaboration Kernel、统一事件身份和真实 Runtime ACK 作为当前架构。确定性证据证明触发入口、幂等、
lane、reply address 与 ACK 时序已经收敛，但不能据此声称真实 Agent 任务成功率已经提高。

下一次 E 级复测至少覆盖：同项目两 Agent 并行、同 Agent 长任务排队、真实 daemon 进程在 ACP handshake
期间被强制终止、A2A fan-out 部分失败后聚合回调、Gate reject 回派，以及浏览器断开期间的 Human Command。
本轮已经用 repository/session lifecycle fault injection 验证原子 ACK、跨 daemon live-owner guard 与 expired
owner recovery，但尚未把真实进程 kill
纳入长期 E 级 benchmark。远端 Runtime transport 仍未实现，
非本地 target 继续 fail closed。
