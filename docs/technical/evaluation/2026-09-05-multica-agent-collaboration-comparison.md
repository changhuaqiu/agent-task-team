# Multica Agent 协作机制对比评测

- Analysis date: 2026-09-05
- Multica source revision: `ca47495fcc3c4d2d0d6c7a421e45ddd0de98f0fd`
- Local baseline: `main@c574a24`
- Scope: Agent activation, coordinator behavior, runtime scheduling, collaboration recovery, and completion truth

## Conclusion

Multica 的稳定性主要来自清晰的控制边界，而不是让多个 Agent 自由对话：Project 组织多个 Issue，Issue 持有一件工作的目标和讨论，Run 只记录一次 Agent 执行，Runtime 决定在哪台机器和哪个 coding tool 上执行，Squad 只负责路由。所有入口最终汇入同一 Run 队列。

本项目已经在结构化完成语义上更严格：WorkContract 冻结权限与 revision，Task Graph Outcome 原子提交，A2A Possession/Authority 防止旧执行写回，Gate 决定 Task 完成。因此不应退回 Multica 的“评论即协议”；应学习它的对象分层、显式 per-turn coordinator role、运行资源互斥、失败分类和可观察运行历史。

## How Multica keeps agents running

### 1. Identity, work, execution, and machine are different objects

Multica 明确区分：

| Object | Responsibility |
| --- | --- |
| Agent | 可复用身份、instructions、skills、model 与访问规则 |
| Project | 多个 Issue 的长期目标、资源和共享上下文 |
| Issue | 一件工作的目标、assignee、状态、讨论与交付历史 |
| Run / `agent_task_queue` | 一次触发到终止的执行记录；同一 Issue 可有多个 Run |
| Runtime | 一台连接电脑上的一个 coding tool/profile |
| Squad | 一个 leader 加成员的路由对象，本身不执行 |

官方文档明确说 Agent 不是常驻进程，Run completed 也不等于 Issue done。源码中 `CreateAgentTask` 为每次触发创建独立队列行，旧 Run 不被覆盖。

### 2. All triggers converge on one execution path

Assignment、comment mention、direct chat 和 Autopilot 提供不同上下文，但都归一为：创建 Run → 匹配 Runtime → daemon claim → 准备工作目录/skills → 启动 coding tool → 回写进度和结果。Server push 只降低延迟，daemon polling 是断线后的 backstop；heartbeat 决定 Runtime availability。

源码 `TaskService.enqueueMentionTaskWithCommentPlan` 在创建前检查 Agent 是否 archived、是否绑定 Runtime，并为并发重复触发返回 typed duplicate，而不是泄漏数据库约束或创建两份 pending work。

### 3. Coordinator is a per-run role, not personality text

Issue 分配给 Squad 时只唤醒 leader，不自动 fan-out 全队。Leader 当前轮获得系统管理的 Operating Protocol、Roster 和 Squad Instructions，然后：

1. 读取 Issue；
2. 选择合适成员并发出一个带精确 mention identity 的 delegation comment；
3. 记录 `action | no_action | failed` evaluation；
4. 保持 parent `in_progress` 并停止当前轮；
5. 等成员回复或阶段 barrier 再被唤醒，决定继续分派、升级或进入 `in_review`。

`is_leader_task`、`squad_id` 和 `leader_role_resolved` 是 Run 上的权威字段。`prompt.go` 只在兼容旧 server 时才从 Markdown marker 推断；当前 server 不允许用户 instructions 偶然包含标题就把普通 Agent 提升为 leader。Leader 自己的评论不触发自己；显式 @ 已表达路由时通常不再额外唤醒 leader；pending Run 去重继续防止循环。

### 4. Runtime owns liveness and filesystem safety

daemon 以全局和 per-Agent concurrency limit 控制运行，用 prepare deadline 区分“claim 后尚未启动”和 provider execution。普通队列在 Runtime 仍有心跳时不会仅因等待时间长而失败。

同一 canonical local path 由 daemon 的 `LocalPathLocker` 串行化，等待项进入 `waiting_local_directory`，防止两个 Agent 同时修改一个 checkout。不同 worktree/path 可以并行。Task-scoped token 绑定 workspace、task、agent 与 server；请求体不是身份来源。

### 5. Failure recovery creates another Run and preserves history

Multica 只对基础设施型故障自动重试，通常最多两次；provider network 可到三次。Auth、quota、配置、模型和上下文类错误要求先修原因。`FailTask` 在同一事务里终结 parent Run 并创建 retry child，避免失败已提交而重试尚未出现的竞态；session-poisoning reason 会强制 fresh session，安全场景才恢复原 session/workdir。无自动重试的 delegated failure 会显式回交 coordinator。

## Comparison with Agent Task Hub

| Concern | Multica | Agent Task Hub | Judgment |
| --- | --- | --- | --- |
| Project hierarchy | Project → Issue/sub-issue → Run | Project → WorkItem → Task/Subtask → Invocation | 当前分层已对齐；WorkItem 不应退回 Project 全局聊天 |
| Coordinator | Squad leader 通过 @ comment 路由，逐轮 evaluation | coordinator WorkContract 强制 Task Graph-first，Outcome owner 校验覆盖与 owner | 本项目更强；保留结构化图，不复制 comment-as-protocol |
| Role authority | Run 字段显式标记 leader turn | DispatchAdmission + frozen Agent Definition responsibility | 已对齐 |
| Execution admission | Queue claim + daemon start | Durable Inbox + ExecutionEnvelope ACK + Invocation | 本项目 ACK 语义更严格 |
| Completion | Run completed ≠ Issue done；通常 human/PR 决定 done | Invocation terminated ≠ Task done；Gate/evidence 决定 done | 已对齐且本项目证据门更强 |
| Retry | 新 child Run，reason allowlist，session safety | Inbox/Invocation recovery、WorkAuthority fencing；Human A2A 终态重试现创建新 chain/pass/inbox | 主路径已对齐；需继续统一 reason taxonomy |
| Same-folder safety | canonical path mutex + waiting state | Git worktree 隔离；普通目录没有跨 Agent 的 path lease | **当前最大缺口** |
| Observability | Issue 侧 Run log、live transcript、availability/workload 分离 | WorkItem 活动、Trace、Invocation、Runtime observed state | 事实齐全，UI 仍可进一步收敛为“工作 + 运行记录” |

## What to adopt

### P0 — Direct workspace path lease

为非 worktree 执行增加 durable `workspace_execution_lease`，key 使用 canonical real path + execution mode。它应在 Runtime ACK 前获取，在 Invocation 终态/owner lease 过期时释放；等待状态与 `running` 分开，不占 provider execution slot。UI 展示“等待目录”以及持有 Work/Agent，不暴露用户绝对路径。Git worktree 只要 canonical path 不同仍允许并行。

不要复制 Multica 当前的内存锁边界：其公开 issue 显示 `waiting_local_directory` 仍可能占 Agent capacity，且 daemon 重启会释放内存锁。我们的 lease 应持久化、带 fencing token，并由恢复流程校正。

### P1 — One trigger predicate and one retry classifier

- 继续让 Human、Task、Gate、A2A、Recovery 汇入 CollaborationKernel，但把“是否产生新工作”的预览与真实写路径共享同一 predicate；去重维度至少包含 WorkItem、Agent、purpose、authoritative revision。
- 将 Runtime/Provider failure taxonomy 收敛为一个 classifier：明确 auto-retryable、attempt ceiling、backoff、resume-safe、fresh-session-required 与 human-action-required。
- 自动重试必须与当前 Attempt 终结原子提交；终态记录不原地复活。当前 Human A2A 手工重试的新链语义应作为其他重试路径的模板。

### P1 — Coordinator state visible as a control fact

保留 `task_propose_graph`，并在 WorkItem timeline 投影 coordinator 的 `evaluated → graph accepted → tasks dispatched → waiting for branches → replanning/closure`，而不是增加聊天噪音。`no_action` 必须是结构化终态并带 reason，不能靠不回复表示。

### P2 — Agent reliability evaluation

固定 TestSuiteRevision 做 baseline/candidate paired experiment，至少记录：

- trigger accepted rate；
- queue-to-claim、claim-to-start、start-to-first-meaningful-output；
- structured Outcome first-pass acceptance 与最终 acceptance；
- path convergence；
- duplicate wakeup / loop amplification；
- directory wait time 与错误计入 execution-capacity 的比例；
- Task result success（与 Invocation completed 分开）。

本轮真实 Mario 案例只能证明一个旧普通目录 Project 完成“启动 → 分析 → 校验失败后自纠正 → Task Graph 接纳 → 分派 → 回复”，不能外推总体完成率。

## What not to copy

- 不把评论 Markdown 当成唯一协作协议；identity、scope、revision 和 permission 必须仍由结构化字段绑定。
- 不让目录等待占用真正的 Agent/provider execution slot。
- 不用纯内存 path lock 作为崩溃恢复后的事实源。
- 不用静态 retry allowlist 漏掉 queue-expired 等基础设施路径；Multica 公开 issue #7795 正在指出这类缺口。
- 不让 Agent 自己把 Run success 解释成工作 done；Task/Gate owner 继续裁决。

## Evidence

Primary sources:

- Multica repository and source revision: https://github.com/multica-ai/multica
- How Multica works: https://multica.ai/docs/how-multica-works
- Projects: https://multica.ai/docs/projects
- Issues: https://multica.ai/docs/issues
- Runs and retries: https://multica.ai/docs/tasks
- Agents: https://multica.ai/docs/agents
- Squads: https://multica.ai/docs/squads
- Daemon and runtimes: https://multica.ai/docs/daemon-runtimes
- Source: `server/internal/service/task.go`, `server/internal/service/issue_trigger.go`, `server/internal/daemon/daemon.go`, `server/internal/daemon/prompt.go`, `server/pkg/db/queries/agent.sql` at revision above.

Known Multica limitations used only as counter-evidence, not as design authority:

- Directory wait consumes Agent capacity: https://github.com/multica-ai/multica/issues/6525
- Queue-expired retry gap: https://github.com/multica-ai/multica/issues/7795
