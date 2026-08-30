# Outcome Commit Atomicity

Status: implemented
Change ID: `outcome-commit-atomicity-2026-08-29`
Evaluation level: C（WorkContract、Task Graph、AgentInbox 与 A2A continuation 行为变化）

## 1. Goal

消除“AgentOutcome 已返回 `applied`，但领域事实随后异步失败”的假成功。规划 Agent 必须能够通过一个结构化 `propose_task_graph` 命令，为已有未分配 WorkItem 绑定负责人或创建新的 Task，并让依赖满足的 Task 进入既有 AgentInbox。非 Delivery Work 的合法 `continue_work` 必须产生一个新的 fenced epoch，而不是被 A2A Process Manager 静默忽略。

## 2. Authoritative contract

- `work.submit_outcome` 的 `applied` 表示该 Outcome 对应的确定性领域变更已经在同一个 SQLite 事务中完成；只把事件写入日志不算 applied。
- `propose_task_graph` 使用一个共享 parser 和 owner。parser 校验 canonical `{ expectedRevision, tasks[] }`；owner 在 Outcome 接纳事务中提交 Task Graph。
- 当前 MCP Adapter 从 WorkContract 冻结的 `authoritativeRevisions.taskGraph` 注入 `expectedRevision`，Agent 不重复提交平台已经持有的 revision；任何暴露该工具的合同都必须携带相同 authority，Task Graph owner 再次强制 payload revision 与冻结值相等，完整 API 也不能绕过 fencing。
- Task Graph proposal 可以创建新 Task，也可以更新同 Project 中仍为 `proposed/ready` 的 WorkItem。更新已有 WorkItem 时保留 identity，并原子写入负责人、标题、说明和依赖；进行中或终态 Task 不可被重新规划。
- proposal 中所有负责人必须是当前 Project 成员。独立于 Delivery 的 proposal 会在同一事务中把依赖已满足的已分配 Task 写入 AgentInbox；Delivery-owned proposal 继续由 Delivery Control Plane 调度。
- durable Task Graph Outcome Process Manager 只做旧 accepted Outcome 的幂等恢复；它兼容 v1 以 event id 建立、没有冻结 result 或 Contract graph authority 的记录：已有 commit 从 action/current truth 恢复派发，未提交 outcome 仍用旧 payload revision 做一次 stale-fenced owner commit。新 Outcome 在返回 receipt 前已经提交。
- 非 Delivery 的 `continue_work` 在接纳事务中通过 CollaborationKernel 创建稳定、幂等的 AgentInbox continuation，复用相同 Work identity、execution mode/subject、execution stage 与 A2A Possession，并在当前 Invocation 结束后签发下一 epoch。Delivery continuation 继续由 `ContinueGateLite + Control Plane` 调度。
- standalone continuation 每个 Work 最多三次；超过预算的候选 Outcome 在消费退出槽前拒绝。
- MCP 为 `task_propose_graph` 与 `work_continue` 暴露完整 JSON Schema。外层参数错误返回可定位字段，不能只让 Agent猜测。

## 3. Non-goals

- 不改变 Delivery Control Plane 的 continuation 决策和容量模型。
- 不把 Runtime 文本或进程退出提升为交付事实。
- 不允许 Task Graph proposal 修改已经执行、评审或终态的 Task。
- 不通过 Prompt 掩盖状态机缺陷。

## 4. Verification

- 错误 Task Graph payload 在 Outcome admission 中被 rejected，不产生 accepted Outcome、Task、Task Graph commit 或 Inbox item。
- 合法 proposal 返回 applied 时，Task、负责人、Graph revision、commit 与立即可运行的 Inbox item均已存在。
- 已有未分配 WorkItem 可以在 revision-matched proposal 中绑定负责人；错误 Project 成员、stale graph revision 和不可重规划状态均失败关闭。
- Process Manager 重放同一 accepted proposal不产生第二次 Task/commit/Inbox。
- v1 event-id commit 在 v2 handler 中不产生第二次 graph mutation，并可恢复立即/依赖后派发。
- 升级前没有 graph authority、没有完整 result_json 或尚未完成 commit 的 accepted proposal 具备显式、受 stale revision 约束的恢复路径。
- standalone `continue_work` accepted 后立即存在下一轮 Inbox command；重复事件/重启不重复排队，超过预算不接纳。
- Task 的最新 graph commit 若已由 Delivery 或其他 owner 接管，依赖完成事件不得回看旧 standalone proposal 派发。
- 延迟 Outcome handler 与 dependency scheduler 使用同一 latest-owner 判定，均不能旁路 Delivery 接管。
- Delivery continuation 仍只由既有 Control Plane 处理。
- 定向测试、TypeScript、全量测试和 production build 通过。
