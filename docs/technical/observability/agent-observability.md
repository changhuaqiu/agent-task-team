# Agent 可观测性架构

> Implemented contract archive: `docs/archive/specs/agent-observability/spec.md`
> Architecture diagram: `agent-observability-architecture.html`

## 决策

平台采用“本地事实源 + OTel 兼容观测投影”的结构。`invocation`、Task Graph、A2A、
`control_proof_event` 和消息仍是业务事实；`observation_span` 只负责把一次执行组织成可查询、
可展示、未来可导出的 Trace/Span 结构。

这样做的原因：

- 当前系统已有多数事实，重建一套日志总线会产生双写和一致性问题。
- Agent turn、上下文组装、工具调用天然适合父子 span。
- Agent 交接和并行任务不总是树结构，应该通过 chain/pass 和未来的 span link 表达因果关系。
- GenAI semantic conventions 仍在演进，内部稳定 kind + attributes 比把实验字段固化成大量列更易迭代。

## 边界

- Harness 负责建立 trace 身份并携带上下文报告。
- Daemon/runtime adapter 负责记录真实开始、工具事件和终态。
- Runtime adapter 只把 ACP update 规范化为 `AgentEvent`；daemon 拥有 trace/span 身份并通过 best-effort telemetry sink 落库，adapter 不直接依赖 SQLite。
- Observation Projection 只读聚合 Task Graph、A2A、proof 和 spans。
- Project UI 只通过查询 API 读取，不在前端推断执行成功或 Agent 关系。
- Runtime Message Projection 可以为同一次 invocation 持久化多条文本或工具事实；Project UI 仅在展示层按相同 `invocationId` 聚合这些连续事实，并保留事件顺序。流式临时投影与持久事实短暂重叠时只展示临时投影，完成后切换为持久事实，禁止把两种表示同时渲染。特殊业务卡片仍保持独立消息边界。展示聚合不得改写、丢弃或合并底层 `chat_message` 事实。
- 外部 OTLP/Phoenix 由独立于 Task/Gate 主 dispatcher 的 durable export worker 发送，不进入核心 loop，也不成为控制事实源。每个 dispatcher 只 claim/recover 自己注册的 durable handler；collector 未配置时不注册 handler，导出失败只在独立队列重试，不反向改写 Invocation/Task，也不占住业务事件 drain。

## 标准映射

| 平台概念 | OTel/OpenInference 映射 |
|---|---|
| 一次角色 Agent turn | root span / `invoke_agent` / `AGENT` |
| ContextManager assemble | child span / prompt-context operation |
| tool use/result | child span / `execute_tool` / `TOOL` |
| agent response / runtime-exposed thought | child span / `message` + lazy payload |
| workflow/chain | trace correlation + causal links |
| project conversation | session/thread grouping |
| proof event | span event or correlated audit log（当前保持事实表） |

## 外部依据

- [OpenTelemetry Tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OpenTelemetry GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenInference semantic conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html)
- [LangSmith observability concepts](https://docs.langchain.com/langsmith/observability-concepts)

## 演进约束

新增 runtime 只需继续输出统一 `AgentEvent`，不得在可观测页面增加 runtime 专属查询分支。
完整 payload 与列表预览分离；payload 查询必须携带 conversationId 并校验 span 归属。
thinking 仅指 runtime 主动暴露的 reasoning summary，并按统一脱敏与容量上限采集；当前没有关闭开关，隐藏 chain-of-thought 永不采集。
新增业务工作流必须先进入其权威事实表，再由 projection 读取；不得让 span 成为任务状态权威。
当引入 OTLP exporter 时，本地 span id/trace id 与语义字段保持不变，exporter 只做映射和发送。

## Phoenix 在线投影

设置 `PHOENIX_COLLECTOR_ENDPOINT=http://127.0.0.1:6006` 后，Runtime Worker 在本地
`runtime-observability-projection` 完成之后，将已终结 Invocation 的完整 span tree 映射为稳定 OTLP
trace。`ATH_PHOENIX_PROJECT_NAME` 控制项目名；`PHOENIX_API_KEY` 只用于 collector 鉴权。

默认 `ATH_PHOENIX_EXPORT_CONTENT` 未设置时只导出 metadata，不导出 prompt、消息或工具 I/O。
显式设为 `preview` 时只导出已脱敏的 2,000 字符预览；设为 `redacted` 时才按 trace 级 64 KiB
上限导出经过统一 secret sanitizer 的 payload，thinking 永不导出。

Phoenix root span 同时记录两组语义：`ath.invocation.outcome` 表示 Runtime/transport 终态，
`ath.business.exit_state`、`ath.outcome.type`、`ath.task.status` 与最新 Gate 属性表示业务收口。
有 WorkContract 的 Invocation 若以 `completed` 终结却没有 accepted Outcome，导出 root span 强制标为
error，reason=`work_contract_completed_without_accepted_outcome`；因此 Phoenix 的 OK 不再被误读为
Task/Delivery 已完成。

每个 termination event 在首次网络投递前，按 Event Log ingestion 游标从事件事实重建
Task、Gate 与 Outcome 并写入 `phoenix_export_plan`；同毫秒但位于终结事件之后的事实不会越界，
没有 Event Log fact 的孤立业务表行也不会进入外部判断。后续重试复用同一 plan 与确定性 trace/span id，
不重新读取已经变化的当前表。plan 通常不可变，唯一允许的更新是内容策略从 redacted/preview 收紧到 none 时
单调重建为更少内容。默认 `none` 模式只输出稳定错误码；自由文本错误、prompt、message、tool
input/output 只有显式 content opt-in 后才会脱敏导出。

## Agent loop 完成语义

可观测性必须能区分“协议停止”和“用户收到答复”。当 ACP runtime 以 `end_turn` 结束但没有任何文本 completion 时，平台 harness 会执行一次有界 recovery。已经出现工具事件或本轮显式 resume 时，recovery 留在同一 session，只补充最终答复；若这是全新会话且完全没有文本、工具事件或其他可见副作用，则允许创建一次 replacement session 并重放原始请求，避免无副作用的 poisoned session 让 A2A 调用立即空返回。两条路径共享原 invocation 的 idle/hard timeout，且总 recovery 次数仍为 1。恢复仍为空时，invocation 以 `acp_empty_completion` 或 `acp_tool_completion_missing` 失败并输出 Runtime error observation；不得生成看起来像 Agent 答复的降级文本。Project 顶部状态读取 `run.finished` 显示可操作说明，完整原因保留在 Invocation/terminal/span，Inbox 不投影该诊断。该恢复属于平台层 agent loop 不变量，与具体 OpenCode、Claude 或 Codex adapter 无关。
