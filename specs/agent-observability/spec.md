# Agent Observability Workbench

> Status: Active implementation
> Date: 2026-07-16
> Scope: project-level agent turns, context, tools, skills, task workflow, and A2A causality

## 1. Problem

The platform already persists execution facts in `invocation`, `platform_event`, `chat_message`,
`control_proof_event`, task graph, and A2A tables. The retained `agent_event` table is historical
compatibility storage, not a current execution-fact owner. These facts cannot currently answer one
project-level debugging question without manually joining logs:

> What context did a role agent receive, what did it execute, which tools and skills were
> involved, how did work move to another agent, and where did time or failures accumulate?

This spec adds a compatible observation model and a project workbench. It does not replace
the existing fact tables and does not introduce a second workflow authority.

## 2. Standards and references

- OpenTelemetry trace model: a trace is a DAG of spans; a span has a parent, events, status,
  attributes, and links to causally related spans.
- W3C Trace Context: trace and span identifiers use interoperable 16-byte and 8-byte
  lowercase hexadecimal forms.
- OpenTelemetry GenAI semantic conventions: use `invoke_agent`, `execute_tool`, provider,
  model, token usage, and tool-call attributes where a stable local equivalent exists.
- OpenInference: retain explicit `AGENT`, `TOOL`, and `CHAIN`-style kinds for AI debugging.
- LangSmith is a UX reference only: project -> traces -> runs and conversation/thread
  grouping. It is not a runtime dependency.

GenAI conventions are still under development. The database therefore stores a small
platform-owned vocabulary plus versioned attributes, rather than coupling schema columns to
every experimental attribute name.

## 3. Goals

- Inspect all agent turns for one project.
- Drill from a turn into context budget/layers, loaded skills, available tools, tool calls,
  runtime, duration, token usage, and failure reason.
- Show task workflow and agent-to-agent transfers using existing Task Graph and A2A facts.
- Preserve causal correlation across harness, dispatch envelope, invocation, task, chain, and
  pass identifiers.
- Keep collection runtime-neutral across ACP-backed and other agent backends.
- Make the model exportable to OTLP later without requiring OTLP for local operation.
- Bound sensitive payloads and storage size.

## 4. Non-goals for this iteration

- A hosted telemetry service, collector deployment, or vendor-specific SDK.
- Capturing hidden chain-of-thought.
- Replacing task state, proof events, chat messages, or A2A possession as truth sources.
- Full metrics aggregation, evaluation datasets, cost accounting, or distributed sampling UI.
- Replaying a production turn automatically.

## 5. Canonical model

### 5.1 Trace

One harness trigger creates one trace. A direct legacy runtime start creates a trace at
invocation creation. Multi-turn project conversations contain many traces.

### 5.2 Span

`observation_span` is an append/update telemetry projection:

| Field | Meaning |
|---|---|
| `trace_id` | 32 lowercase hex characters |
| `span_id` | 16 lowercase hex characters |
| `parent_span_id` | Parent operation inside the same trace |
| `kind` | `agent`, `context`, `tool`, `workflow`, `handoff`, `runtime` |
| `name` | Stable operation name, not unique user content |
| `status` | `running`, `ok`, `error`, `cancelled` |
| correlation fields | project, task, agent, invocation, envelope, chain, pass |
| `attributes` | Versioned, bounded JSON metadata |
| `input_preview` / `output_preview` | Optional redacted and truncated debug previews |
| timestamps | start/end for duration and waterfall layout |

The agent turn is the root span. Context assembly and tool calls are child spans. A2A and task
workflow remain authoritative in their current tables and are projected as causal links in
the query response.

### 5.3 Context snapshot

`ContextReport` is extended with:

- `loadedSkills`: names of skills included in the assembled capability context.
- `availableTools`: names derived from those skills.

The context child span stores report metadata and layer token counts. It must not store hidden
reasoning. Prompt previews are optional, redacted, and bounded.

### 5.4 Tool lifecycle

- `tool_use` starts a tool span.
- `tool_result` closes the matching span by call id; name is a fallback only.
- Invocation termination closes any unmatched tool span with the invocation terminal status.
- Unknown tool names remain observable; the workbench does not reinterpret or execute them.

### 5.5 Causal workflow projection

The project snapshot joins without mutating:

- task nodes and edges;
- A2A chain work items and possession passes;
- proof events and execution envelopes;
- observation spans.

Agent-to-agent edges are derived from explicit `from_holder_id/requested_by` and target agent
fields, never inferred from chat prose.

## 6. Collection flow

```text
Harness trigger
  -> ContextManager report (layers, budget, skills, tools)
  -> Harness plan carries trace metadata
  -> Dispatch envelope
  -> Invocation + root agent span
      -> context child span
      -> tool child spans
  -> terminal status closes open spans
  -> project observation projection joins Task Graph / A2A / proof
  -> /api/observability
  -> project "调试" workbench
```

## 7. Query contract

`GET /api/observability?conversationId=<id>&limit=<n>` returns:

- `summary`: trace, invocation, agent, tool, failure, token, and duration totals.
- `agents`: per-role activity and failure/tool counts.
- `traces`: newest first, each with ordered spans and correlation identifiers.
- `workflow`: explicit agent nodes/edges plus task nodes/edges.

Unknown projects return an empty snapshot so a new project can render the workbench before its
first turn. Invalid parameters return `400`. The endpoint is read-only and uncached.

## 8. UX contract

The project side panel gains a single `调试` tab. It contains:

1. Compact health summary.
2. Agent activity cards.
3. Agent interaction edges.
4. Trace list with status, duration, tools, context saturation, and token usage.
5. Expandable trace detail showing context layers and the span waterfall.

The default project experience remains chat and task flow. Internal identifiers are shown only
inside expandable technical details.

## 9. Privacy and limits

- Apply secret redaction before storing input/output previews.
- Preview limit: 2,000 characters per field.
- Attributes must be JSON and should remain below 32 KiB per span.
- API returns at most 100 traces and 2,000 spans per request in this iteration.
- Account credentials, environment variables, authorization headers, private keys, and hidden
  model reasoning must never be recorded.

## 10. Failure semantics

- Observation writes must not prevent an agent turn from executing.
- Collection failures are logged and the trace may be partial.
- A root span is `error` for failed/timeout runtime results and carries the stable reason code.
- Missing tool results are visible as incomplete/error spans rather than silently discarded.

## 11. Acceptance criteria

- A completed ACP-backed turn has one agent span and one context span.
- Tool use/result pairs appear as timed child spans with call correlation.
- Context detail shows scenario, layers, budget saturation, loaded skills, and available tools.
- Project query shows task and explicit A2A relationships without parsing chat text.
- Sensitive preview values are redacted and bounded.
- Existing execution, A2A, task, and project tests remain green.
- Repository, API, component, integration, typecheck, and production build checks pass.

## 12. Iteration path

- P1 (this spec): local durable spans, project projection, workbench, tests.
- Drill-down extension (implemented): full redacted prompt/response/tool/thinking payloads, exact message-invocation correlation, message drawer, ReactFlow chain DAG, Task×Chain and socket refresh; see `specs/observability-drilldown/` and `docs/technical/execution/observability-drilldown.md`.
- P2: externalized span links/event timeline, model latency breakdown, cost and evaluation feedback.
- P3: OTLP exporter/collector adapter, sampling and retention policies, trace comparison/replay.
