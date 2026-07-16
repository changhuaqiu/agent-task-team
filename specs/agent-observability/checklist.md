# Agent Observability Acceptance Checklist

- [x] Agent turn, context, and tool spans use interoperable trace/span identifier sizes.
- [x] Context snapshot exposes scenario, budget, layers, loaded skills, and available tools.
- [x] Tool use/result events are correlated by call id with name fallback.
- [x] Observation write failures cannot block the agent loop.
- [x] Sensitive previews are redacted and truncated before persistence.
- [x] Project query joins observation, invocation, Task Graph, and explicit A2A facts read-only.
- [x] Project UI shows summary, Agent interactions, traces, context, tools, and waterfall timing.
- [x] New repository, projection, API, and component tests pass.
- [x] Full repository test suite and Next.js production build pass.
- [x] Long-lived design and architecture diagram are present under `docs/technical/observability/`.
