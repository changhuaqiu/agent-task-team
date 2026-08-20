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
- 外部 OTLP/Phoenix 通过终态 Runtime Event 的 durable projection 接入，不进入核心 loop，
  不参与任务完成判断；未配置 collector 时不注册 handler。

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
OTLP exporter 保持本地 span/trace 事实不变，只做确定性身份映射和发送。外部 OTel id 从
`invocation_id + local trace/span id` 确定性生成，原 id 保留为 `ath.*` 属性，保证 retry/replay
不会制造新的 Phoenix Trace。Phoenix Project 表示 Agent Task Hub 应用，Conversation 表示
OpenInference Session，每次 Agent turn 表示一个 Trace。

## Phoenix 接入

配置 `PHOENIX_COLLECTOR_ENDPOINT` 后，Runtime Worker 为
`runtime.invocation.terminated` 注册 Phoenix durable projection。该 handler 等待本地
`runtime-observability-projection` 收口后读取同一 Invocation 的完整 span 树，映射为
OpenInference `AGENT / LLM / TOOL / PROMPT / CHAIN` 并经 OTLP HTTP protobuf 发往
`/v1/traces`。投递复用 `platform_event_delivery` 的 claim、lease、retry 与 dead-letter，
不再创建第二套 exporter 队列。

配置边界：

- `PHOENIX_COLLECTOR_ENDPOINT`：显式启用并指定 collector；未配置即关闭。
- `ATH_PHOENIX_PROJECT_NAME`：Phoenix Project，默认 `agent-task-team`。
- `PHOENIX_API_KEY`：可选 bearer credential，只进入 exporter header，不写日志和 span。
- `ATH_PHOENIX_EXPORT_CONTENT=redacted`：允许导出本地已脱敏的 prompt、tool I/O 与 completion；
  默认只导出结构、状态、预览与 token。

Phoenix 是可替换的外部观察面：服务不可用时 durable delivery 独立重试，本地消息、Task、
Outcome、Gate、proof 和 Delivery 仍按原链路推进。hidden chain-of-thought 与本地 thinking
payload 永不导出；未知 attributes 不做透传。handler identity 与 endpoint、Project、内容模式和
credential 解耦，轮换 API key 不会重放全部历史或留下无法认领的旧 delivery。preview 模式不读取
完整 payload；redacted 模式在 SQL 读取阶段应用 trace-wide 内容预算，再执行最终字节级脱敏与截断。
OTLP HTTP 请求固定 10 秒上限；durable handler 的 AbortSignal 触发后立即释放共享 worker，不再等待
不支持主动取消的 exporter 连接，后台收口仍受上述固定上限约束。

### 依赖决策

采用 Phoenix 原生支持的标准 OTLP HTTP protobuf 路径，固定
`@opentelemetry/api`、`core`、`exporter-trace-otlp-proto`、`resources`、`sdk-trace-base` 与
`sdk-trace-node`。没有引入 `@arizeai/phoenix-otel` 的整套便捷封装，因为本项目不需要其
Vercel/AI SDK instrumentation，直接使用标准 exporter 能缩小依赖与启动面；也没有手写
OTLP protobuf，因为那会复制协议编码、认证 header、export result 和 timeout 语义。
同时不启用全局 auto-instrumentation：它会把 Next.js HTTP/render spans 混入 Agent Trace，
并使 Phoenix provider 变成应用全局事实。exporter 使用 non-global provider，只发送从
`observation_span` 重建出的 OpenInference spans。

这些包通过 `serverExternalPackages` 保持为 Node 原生依赖；Phoenix 未配置时 Runtime Worker
只加载轻量配置模块，OTel/Phoenix 实现通过 handler 首次执行时动态加载，避免增加默认启动路径。

## Agent loop 完成语义

可观测性必须能区分“协议停止”和“用户收到答复”。当 ACP runtime 以 `end_turn` 结束但没有任何文本 completion 时，平台 harness 会执行一次有界 recovery。已经出现工具事件或本轮显式 resume 时，recovery 留在同一 session，只补充最终答复；若这是全新会话且完全没有文本、工具事件或其他可见副作用，则允许创建一次 replacement session 并重放原始请求，避免无副作用的 poisoned session 让 A2A 调用立即空返回。两条路径共享原 invocation 的 idle/hard timeout，且总 recovery 次数仍为 1。恢复仍为空时，invocation 以 `acp_empty_completion` 失败，并生成明确的降级文本消息；因此 message span 不再出现空 completion 与 root `ok` 并存的假成功状态。该恢复属于平台层 agent loop 不变量，与具体 OpenCode、Claude 或 Codex adapter 无关。
