# Trace Runtime Hardening Spec

Status: active
Change ID: `trace-runtime-hardening-2026-08-22`
Evaluation level: C（Harness、WorkContract、Session 与观测链路行为变化）

## 1. 目标

用 2026-08-22 的真实运行 Trace 收敛四个会直接降低自主任务完成率的问题：

1. 一个 WorkContract 只能接纳一个结构化退出，包括 `continue_work`；
2. Agent 在 WorkContract 内不能直接修改 Task 等领域权威状态；
3. 长期复用的 ACP CLI session 在隐藏历史超过预算前自动轮换；
4. 当前运行事件持续投影到 Phoenix，能够从 Task、WorkContract、Invocation、Tool、Outcome 和 Gate 追溯失败。

## 2. 非目标

- 不重写 Agent 角色人格或聊天视觉组件；
- 不把 Invocation 的传输成功等同于 Task/Delivery 的业务完成；
- 不让 Phoenix 成为控制平面事实源；
- 不以 Prompt 代替数据库约束、权限裁剪或状态机守卫。

## 3. 权威契约

### 3.1 唯一结构化退出

- 任一结构化生命周期命令的首次 accepted 记录消费当前 WorkContract 的唯一退出槽。
- 首次 accepted 可以是 `continue_work` 或任一终结 Outcome；两类不能在同一合同内各接纳一次。
- schema、Gate target、revision、fencing 等校验失败的 rejected 记录不消费退出槽。
- 相同幂等键和相同内容仍返回 duplicate；不同内容仍返回 idempotency conflict。
- 数据库 insert trigger 阻止任何绕过 repository 的第二条 accepted row；迁移不删除或改写已有历史歧义记录。

### 3.2 领域状态写入

- WorkContract permissions 与实际 MCP grant 均不得包含 `task_create`、`task_update_status`、`task_assign`、`collaboration_record_pr/review/merge` 等领域 mutation tool。
- Task 执行者通过 `request_review`、`submit_task_result`、`report_blocked` 等 AgentOutcome 提交意图和证据。
- Task Authority / AgentOutcome Process Manager 在接纳事务后更新 Task、创建 Gate、安排 reviewer；Agent 不得先改 Task revision。
- Git-backed Task 的 review Outcome 必须包含 canonical PR URL 与结构化实现证据；Process Manager 核验 provider receipt 后，必须在写事务内再次 fencing frozen Task revision，再记录可回放的 `task.pull_request_submitted` fact。closed、failing、URL 变更、head 未更新或核验期间 revision 漂移均不得推进 Task。
- 浏览器产物服务属于 `browser-verification` 能力，不再依赖任务状态写入 Skill。

### 3.3 Session 预算

- Session owner 在恢复已有 ACP CLI session 前，累计统计该 session 已终结 Invocation 的输入 token 和次数。
- 达到任一预算时 seal 当前逻辑 session，并签发新 generation；不删除历史 Invocation。
- 默认预算为累计输入 token `120000` 或已终结 Invocation `12` 次，可通过环境变量覆盖。
- evaluation isolation session 也使用同一机制，但按自身 isolation key 独立累计。
- generation 选择、预算 seal 与 Invocation 创建处于同一 SQLite immediate transaction；恢复 CLI id 前重新读取并确认 generation 为 active。
- active generation 已有关联的未终结 Invocation 时，新的 dispatch 必须 fail closed，不得复用同一 CLI session。

### 3.4 Phoenix 投影

- SQLite/Event Log 继续是控制事实源，Phoenix 只保存可重建的 OTLP trace/metric 投影。
- collector 未配置或暂时不可用时 fail-open；Phoenix 使用独立 durable dispatcher，不阻塞 Task/Gate/runtime 主事件 worker；每个 dispatcher 只能 claim/recover 自己注册的 handler。
- 默认不导出消息、prompt、tool input/output 原文；只有显式配置才导出 redacted 内容。
- 根 span 的业务完成判断必须读取 structured outcome / gate facts，不能只看 Invocation `status=OK`。
- 首次导出前按 terminal event 的 Event Log ingestion 游标固化 plan；Task、Gate、Outcome 均从游标前事件重建，retry 使用同一 plan/trace id。计划只允许在内容策略收紧时单调重建为更少内容，metadata-only 模式不得输出自由文本错误。

## 4. 退出条件

- 单元测试证明一个合同不能接纳 `continue_work` 后的 terminal Outcome，反向顺序同样被拒绝。
- dispatch contract 测试证明领域 mutation tool 被裁掉，WorkContract 允许的单意图生命周期工具与浏览器验证工具仍可用。
- session repository 与 daemon 测试证明 token/Invocation 预算触发 seal，新 session 可以继续执行。
- Phoenix exporter 与 runtime worker 测试通过，并能在本地 collector 不可用时 fail-open。
- 相关技术文档、诊断报告、修复计划和 C 级评测记录同步更新。
- full Vitest、TypeScript、受影响路径 ESLint 与 production build 通过。
