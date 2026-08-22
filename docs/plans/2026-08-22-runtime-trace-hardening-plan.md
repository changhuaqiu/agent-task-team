# 2026-08-22 Runtime Trace Hardening 修复方案

## 修复顺序

### 1. 先封住错误写路径

- WorkContract 派发与 MCP grant 双重裁掉 `task_create`、`task_update_status`、`task_assign` 以及 `collaboration_record_pr/review/merge`。
- 任务执行者只提交 AgentOutcome；Task Authority 根据 accepted outcome 更新 Task 和 Gate。
- Git-backed Task 的 `request_review` / `submit_task_result` 由 Outcome owner 先读取 live provider receipt，再在写事务内二次校验 frozen Task revision，最后原子记录 `task.pull_request_submitted` 与评审状态；closed、failing、head 未变化或核验期间 revision 漂移的 PR 不改变 Task。
- `verification_serve_artifact` 移到 `browser-verification` Skill，避免为了浏览器核验重新开放 Task mutation。

这样可直接消除 TASK-015 的复现路径：Agent 不可能先改 revision，再让自己的 Outcome 变 stale。

### 2. 把唯一出口做成数据库不变量

- admission 查询当前合同是否已有任一 accepted outcome。
- SQLite insert trigger 在数据库层拒绝同一合同的第二条 accepted row，同时保留迁移前历史歧义记录用于诊断。
- 若已有，除同内容幂等重放外，统一拒绝为 `work_exit_already_accepted`。
- 保持所有前置校验失败“不消费退出槽”的既有行为。

这样模型即使先发“占位继续”，也不能在同一合同继续提交第二个结果；ContinueGate 会在新 WorkContract epoch 继续工作。

### 3. 对 ACP session 增加 generation 预算

- 在 session repository 汇总已终结 Invocation 的 token usage 和数量。
- 默认累计输入 token 120,000、Invocation 12 次任一达到即 seal。
- daemon 在一个 immediate transaction 内完成预算检查、旧 generation seal、新 generation 选择与 Invocation 创建；恢复前再次确认 generation 仍 active，且存在未终结 Invocation 时不得被预算检查并发 seal。
- 同 generation 已有未终结 Invocation 时 fail closed，不复用 CLI session 或跨 profile 并发执行。
- 环境变量只负责调参，不改变 fail-closed 的轮换语义。

### 4. 接回现有 Phoenix，不新建第二套系统

- 将 Event Log 投影为 OpenTelemetry spans，发送到 `127.0.0.1:6006`；Phoenix 使用独立 dispatcher/timer，不占用 Task/Gate 主 Process Manager drain。
- 默认 metadata-only / redacted；collector 故障 fail-open。
- 首次投递前按 terminal event 的 Event Log ingestion 游标固化 export plan；Task、Gate 与 Outcome 全部从该游标前的事件事实重建，retry 不再读取已经变化的当前表。计划通常不可变，仅允许在内容策略收紧时单调重建为更少内容；metadata-only 只导出稳定错误码，不发送自由文本错误。
- 每个 dispatcher 只 claim/recover 自己注册的 durable handler，Phoenix 断连不会重置控制平面的租约。
- 在 root span 上同时保留 Invocation transport outcome 与 structured business outcome/gate 状态，避免 `OK` 被误读为已完成。

### 5. 验证

- Repository：交叉出口、幂等、rejected 不占槽。
- Dispatch/Profile：领域 mutation tool 不可见，浏览器验证能力仍完整。
- Session/Daemon：token 和 invocation 两类预算轮换。
- Phoenix：export、redaction、fail-open、真实 collector smoke。
- Git completion custody：真实 open PR 通过，closed/failing/stale PR 不改变 Task，Outcome replay 不重复写 action。
- 全量：相关 Vitest、`pnpm check`、必要 build；最后做独立 code review。

## 回滚边界

- migration 仅新增单出口 trigger 与 Phoenix plan 表，不改写历史数据。代码回滚若还要恢复旧的多出口语义，必须显式删除 `trg_agent_outcome_single_accepted_exit`；默认保留该安全不变量。
- Session 轮换只 seal 当前 generation，不删除历史，回滚后仍可创建新 generation。
- Phoenix 是 fail-open 投影，关闭 collector endpoint 即停止导出，不影响控制平面。
