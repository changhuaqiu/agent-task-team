# Runtime Trace Hardening Evaluation

- Change ID: `trace-runtime-hardening-2026-08-22`
- Evaluation level: C
- Status: accepted（组件与在线 exporter）；真实任务完成率结论待 E 级复测
- Code/spec revision: branch `codex/trace-runtime-hardening`, base `4298f9ea5442cfd832dcbbc0fed7e9b6ddd9b27e`, uncommitted candidate
- Evaluator/benchmark revision: `specs/trace-runtime-hardening/` at the same working tree

## Why

真实 Trace 暴露出四个确定性缺陷：Task 执行者可直接修改权威状态并使自己的 WorkContract revision
失效；同一合同可以接纳 continuation 与 terminal 两个结果；Claude CLI session 隐藏历史把约 2K 的
Context Snapshot 放大为约 699K provider input tokens；Phoenix 只显示旧导入数据，且 transport OK
容易被误读为任务完成。完整证据见
`docs/technical/evaluation/2026-08-22-runtime-trace-diagnosis.md`。

## What changed

- 每个 WorkContract 只接纳一个结构化退出；rejected 与 exact duplicate 语义保持不变。
- issuance 与 MCP grant 双重裁掉 Task/Task Graph/Git receipt mutation tool；Task 状态由 accepted Outcome 后的 owner 更新。
- SQLite trigger 把“一个 accepted exit”提升为数据库不变量，历史歧义数据仍可诊断。
- accepted exit 后拒绝其他平台工具和需授权的 runtime-native 副作用。
- confirmed ACP session 在累计 120,000 input tokens 或 12 个 terminated Invocation 后 seal。
- active session generation 有未终结 Invocation 时拒绝并发复用；profile、预算检查与 Invocation 创建共享原子边界。
- Git-backed Task Outcome 验证 live provider PR，并在写事务内二次 fencing frozen Task revision 后记录 `task.pull_request_submitted`；无效、失败、stale 或核验期间漂移的 receipt 不推进 Task。
- 独立 Phoenix worker 按 Event Log ingestion 游标固化 Task/Gate/Outcome 后把 trace plan 以 OTLP 投影到现有 Phoenix；dispatcher 只恢复自己的 handler；默认 metadata-only，不输出自由文本错误，配置收紧时单调移除既存计划内容。
- Phoenix root 同时展示 transport outcome 与 business exit/Task/Gate；completed-without-outcome 标 error。

迁移只新增单出口 trigger 与 immutable Phoenix plan 表，不改写历史数据。代码回滚若还要恢复旧的
多出口行为，必须显式删除该 trigger；默认应保留安全不变量。session seal 不删除历史；删除
`PHOENIX_COLLECTOR_ENDPOINT` 即停止注册 exporter，plan 表可作为无害审计历史保留。

## Industry evidence

访问日期：2026-08-22。

- [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/) 把 span `Error` 定义为操作包含错误，并要求 error description 可预测；据此使用稳定
  `work_contract_completed_without_accepted_outcome`，而不是把业务协议失败继续标 OK。
- [OpenInference Specification](https://arize-ai.github.io/openinference/spec/) 把一次 Agent 请求建模为 root trace，并以 AGENT/LLM/TOOL/PROMPT span kind 表达子操作；本实现复用该结构，但额外保留项目自己的 WorkContract/Task/Gate 属性。
- [Phoenix self-hosted configuration](https://arize.com/docs/phoenix/self-hosting/configuration) 明确 6006 `/v1/traces` 接受 OTLP protobuf；[Phoenix project setup](https://arize.com/docs/phoenix/tracing/how-to-tracing/setup-tracing/setup-projects) 明确 HTTP exporter 可用 `x-project-name` 选择项目。本实现同时设置该 header 与 resource attribute。
- OpenInference 将 prompt/output 作为可选敏感属性；本项目没有照搬“默认全量采集”，而是默认 metadata-only，显式 opt-in 后仍先脱敏和限额。

## Method

### 数据与环境

- OS: Windows，timezone Asia/Shanghai。
- Baseline DB: `C:\Users\qiufa\projects\agent-task-team\.ath\data.db`（运行中可变事实源，只读查询）。
- Phoenix DB: `C:\Users\qiufa\.phoenix\phoenix.db`。
- 关键 baseline Invocation:
  - Luigi `inv-0001787327206300-055757-49f675d2`；
  - Mario `inv-0001787327443845-056708-fcddd4d5`。
- Phoenix baseline trace: `b862e625df330f3af74f53c4b2478bb7`。
- Candidate live smoke trace: `c9e510a262f6a2c229e4bb0ff630ea20`，project `agent-task-team-live`。

### 指标与阈值

| 指标 | 公式 | 接受阈值 |
| --- | --- | --- |
| accepted exits / contract | `COUNT(agent_outcome WHERE admission_status='accepted')` | `<= 1` |
| WorkContract domain mutation tools | permissions 与 runtime grant 中 mutation tool 数 | `0` |
| session hidden-history bound | 恢复前累计 input tokens / terminated invocations | 命中 `120000` 或 `12` 后 seal |
| false-green business exit | completed WorkContract 且无 accepted outcome 的 Phoenix root status | `error` |
| default exported content | 未设置 content opt-in 时的 `input.value/output.value` 数 | `0` |
| regression | full Vitest / typecheck / affected lint / build | 全通过 |

### 可重复命令

```powershell
pnpm test
pnpm exec tsc --noEmit
pnpm exec eslint <affected-files>
pnpm build
$env:PHOENIX_COLLECTOR_ENDPOINT='http://127.0.0.1:6006'
$env:ATH_PHOENIX_PROJECT_NAME='agent-task-team-live'
$env:ATH_PHOENIX_EXPORT_CONTENT='none'
$env:ATH_PHOENIX_SMOKE_DB='C:\Users\qiufa\projects\agent-task-team\.ath\data.db'
pnpm observability:phoenix:smoke
```

## Baseline vs candidate

| 场景 | Baseline | Candidate | 结果 |
| --- | --- | --- | --- |
| continuation 后再交 terminal | 两次都 accepted | 第二次 `work_exit_already_accepted` | 通过，repository test |
| terminal 后再交 continuation | 可形成第二类出口 | 第二次 `work_exit_already_accepted` | 通过，repository test |
| Task 执行权限 | `task_update_status` 与 Git receipt 写工具可改变 Task/Graph/Gate | Task 与 collaboration receipt mutation 在 issuance + MCP grant 双层裁掉 | 通过，dispatch/MCP/profile tests |
| accepted exit 后继续做副作用 | 平台 Skill 与 runtime-native 写仍可能继续 | 平台工具返回 `work_exit_already_accepted`；权限策略 deny | 通过，MCP/permission tests |
| CLI session 上下文 | 无累计上限；同 session 达 698,857 input tokens | 120K input 或 12 terminated invocations 后原子换 generation；恢复前复核 active | 通过，repository/config tests |
| Session 并发 | 同 generation 可能被两个 Invocation 同时恢复 | 未终结 Invocation 占用 generation 时 fail closed | 通过，repository/daemon boundary tests |
| Git 交付凭据 | structured Outcome 可在 provider 核验前推进 Task | live PR receipt 核验 + 写事务 revision fencing 后才写 PR fact/进入 review；closed/stale/drifted 不变更 Task | 通过，Outcome Process Manager tests |
| Phoenix 完成语义 | transport warning 可显示 OK；重试读取可变 Task/Gate，网络可能阻塞业务 drain | 独立 worker + event-time plan；handler-scoped recovery；无 accepted Outcome 的 completed root 为 error | 通过，exporter/dispatcher/worker tests |
| Phoenix 在线性 | 20 条历史导入 trace | smoke 新增 7-span trace `c9e510...`，历史双 accepted exit 显示 `ambiguous/error` | 通过，Phoenix root `ERROR/work_contract_multiple_accepted_outcomes` |
| 回归 | 不适用 | 226 files passed / 2 skipped；1709 tests passed / 2 skipped | 通过 |
| 静态与构建 | 不适用 | typecheck、affected lint、Next production build 通过 | 通过；build 保留既有 NFT warning |

确定性组件指标证明错误路径已被封住；它们不等价于“真实 Agent 任务完成率提高”。

## Decision

接受这组组件变更。它把任务完成 custody 从 Prompt/Agent 自觉收回到 WorkContract admission、permission
和 owner Process Manager，并让现有 Phoenix 成为实时、可区分业务语义的只读投影。

限制与后续触发条件：

- 当前 candidate 尚未合并/重启主服务，因此没有在同一真实任务上做 baseline/candidate paired run；
- session 预算能阻止已膨胀 generation 继续复用，不能保证某个 provider 的首次 resume 永不出现异常大输入；
- 任何“任务完成率提升”结论必须在合并重启后进入 E 级固定数据集，至少覆盖规划、实现、浏览器 Gate、阻塞恢复与 A2A callback；
- 本轮稳定结论已回写现有 product/technical/spec 文档，属于项目内控制契约，不另建通用 `docs/knowledge/` 条目。
