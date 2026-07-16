# Agent 可观测性架构

> Canonical implementation contract: `specs/agent-observability/spec.md`
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
- Observation Projection 只读聚合 Task Graph、A2A、proof 和 spans。
- Project UI 只通过查询 API 读取，不在前端推断执行成功或 Agent 关系。
- 外部 OTLP/Phoenix/Jaeger/LangSmith 适配属于后续 exporter，不进入核心 loop。

## 标准映射

| 平台概念 | OTel/OpenInference 映射 |
|---|---|
| 一次角色 Agent turn | root span / `invoke_agent` / `AGENT` |
| ContextManager assemble | child span / prompt-context operation |
| tool use/result | child span / `execute_tool` / `TOOL` |
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
新增业务工作流必须先进入其权威事实表，再由 projection 读取；不得让 span 成为任务状态权威。
当引入 OTLP exporter 时，本地 span id/trace id 与语义字段保持不变，exporter 只做映射和发送。
