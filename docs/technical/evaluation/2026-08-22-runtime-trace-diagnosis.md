# 2026-08-22 多 Agent Runtime Trace 诊断报告

## 结论

最近任务没有完成的首因不是 Agent “不够努力”，而是平台同时开放了两套互相冲突的完成协议：WorkContract 要求 Agent 只提交结构化 Outcome，但激活的 `task-status-receipt` 又允许 Agent 直接写 Task 状态。执行者先把 Task 从 `in_progress` 改成 `in_review`，Task revision 随即变化，之后提交 `report_blocked` 时被 `task_authoritative_revision_stale` 拒绝；因为这次状态变更没有经过 AgentOutcome Process Manager，也没有创建/唤醒对应 Gate reviewer，TASK-015 被留在 `in_review` 且没有后继工作。进一步代码审查还确认 `collaboration_record_pr/review/merge` 同样会写 Task、Task Graph 或 Gate，必须与通用 Task 写工具一起从 WorkContract grant 裁掉。

第二个确定性缺陷是同一 WorkContract 可以接纳一个 `continue_work` 和一个 terminal Outcome。最近 Mario Invocation 实际先接纳“占位”的 `continue_work`，随后又接纳 `submit_task_result`。Prompt 虽然写了“唯一出口”，repository 却把两类各保留了一个槽，导致模型可以用占位调用绕过协议。

第三个问题是 ACP CLI session 无限复用。Context Manager 给 Mario 编译的输入只有约 2,042 token，但 provider 的实际输入达到 698,857 token；同一 Claude session 在多次 Invocation 间恢复了大量隐藏历史，平台的上下文预算因此失真。

Phoenix 里的最近 trace 还不是当前服务的实时完整事实：20 条 trace 中 8 条为 ERROR，5 条包含 transport warning，且 4 条带 transport warning 的 root span 仍显示 OK。当前主进程数据库里存在更新的 Invocation，但 Phoenix 没有持续收到它们，说明 exporter 尚未进入当前运行基线或服务仍运行旧构建。

## 证据

### 1. TASK-015 被直接状态写入卡住

Invocation `inv-0001787327206300-055757-49f675d2`：

- Luigi，TASK-015，work epoch 6；运行约 5 分 18 秒；19 次工具调用，6 次失败。
- `task_update_status(in_review)` 在补入静态证据后成功，将 Task revision 从 5 推到 6。
- 浏览器能力实际缺失，后续 `agent_submit_outcome(report_blocked)` 被拒绝，reason 为 `task_authoritative_revision_stale`。
- Invocation 自身以 `outcome=completed, exit_code=0` 终结，但 agent.message 为空。
- 当前 TASK-015 仍为 `in_review`、revision 6、`completed_at=NULL`，没有新 Peach reviewer Invocation。

这证明“Runtime 完成”和“业务任务完成”是两件事，也证明直接 Task mutation 绕过了 Gate owner。

### 2. 同一 WorkContract 接纳两个出口

Invocation `inv-0001787327443845-056708-fcddd4d5`：

- Mario 首先调用 `agent_submit_outcome(continue_work)`，summary 为“占位”，调用被 accepted。
- 同一 WorkContract 后续又调用 `agent_submit_outcome(submit_task_result)`，再次被 accepted。
- 最终 agent.message 仍为空，却对外判断“没有卡住任务”，与 TASK-015 的权威状态冲突。

对应实现 `WorkContractRepository.admitOutcome` 只分别检查“是否已有 continuation”和“是否已有非 continuation”，因此允许两类各一次。

### 3. 隐藏会话历史突破预算

Mario 复用 CLI session `0e412fae-…`，多次 provider 输入 token 依次出现约 12,452、586,794、320,255、312,411、326,635、670,654、698,857。最新 Context Snapshot 预算为 8,000，实际 assembly 约 2,042；数量级差异只能由恢复的 CLI session 历史解释。

现有 `sessionRepo` 只在 runtime profile 变化或 `acp_session_load_failed` 后 seal，没有累计 token/turn 上限。

### 4. Phoenix 状态语义与在线性不足

Phoenix trace `b862e625df330f3af74f53c4b2478bb7`：

- Luigi / TASK-015 / recovery，约 673.65 秒；33 次工具调用，17 次失败。
- 包含 WebSocket 重连和 HTTPS timeout，但 root span 为 OK。
- 后继 trace `ac0665d55a13dd7bbb57b326c157da58` 以 `acp_session_load_failed` 在 0.543 秒内 ERROR。

样本说明 root `OK` 只能表示 exporter 看到的 Invocation 终结方式，不能代表 Task/Delivery 已验收；同时 Phoenix 中没有主数据库更新的最新 Invocation，不能作为在线诊断面板使用。

## 根因分层

| 层级 | 根因 | 用户表现 |
| --- | --- | --- |
| 权限 | WorkContract 暴露 Task 与 Git receipt 领域写工具 | Agent 提前改状态/判 Gate，Outcome revision 失效 |
| 接纳 | repository 允许 continuation 与 terminal 各一次 | 同一轮先占位、后交付，唯一出口失效 |
| Session | CLI session 无累计 token/turn 预算 | 输入越来越大、响应越来越慢且跑偏 |
| 交付凭据 | Git-backed Outcome 未强制 provider verification | Agent 的完成声明可能先于真实 PR 事实推进 Task |
| 完成语义 | Invocation success 与 Task/Delivery completion 混用 | 页面有气泡/运行结束，但任务未完成 |
| 观测 | Phoenix exporter 未进入当前运行闭环 | UI 看到旧 trace，无法追当前任务 |

审查还暴露五个放大器：单出口只有 repository 查询、数据库没有硬约束；session 选中与 seal/恢复不是同一原子边界，并发 Invocation 可能复用同一 generation；Git-backed Task 的 accepted Outcome 可以绕过 provider receipt 核验；Phoenix 网络 I/O 与控制 Process Manager 共用 drain，两个 dispatcher 的 recovery 还能改写彼此租约；retry 首次构建计划时读取可变 Task/Gate 当前值，隐私配置从 redacted 收紧为 none 后还可能复用旧内容。这些问题未必触发本次 TASK-015，但会让同类故障在并发、伪造/过期 PR、collector 断连或延迟重放时再次出现。

## 风险判断

这是 C 级变更：会改变 Harness 的结果接纳、工具权限、session lifecycle 和 observability projection。必须以确定性约束和真实 trace 复测为主，不能只改角色提示词。
