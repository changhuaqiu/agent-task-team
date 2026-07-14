# Team Runtime Contract Checklist

- [x] `src/lib/team-runtime/` exists and exposes a stable public API through `index.ts`.
- [x] Runtime resolution supports preset agents and TeamPack roles.
- [x] Runtime profile resolution supports roleCard override, account precedence, skill merge and engine resolution.
- [x] `dispatchToAgent()` uses `RuntimeAgentProfile`.
- [x] PromptComposer team roster is runtime-driven and does not import static `AGENT_ROSTER` for TeamLayer.
- [x] `/api/state` no longer hardcodes six preset agent IDs as the only skill hydration targets.
- [x] A2A communication uses `CommunicationPolicy`.
- [x] TeamModeEngine is accessed through `WorkflowPolicy` in at least one real execution path.
- [x] TeamPack roles are visible and configurable in account and skill binding UX.
- [x] Tests cover preset runtime, TeamPack runtime, prompt roster, dispatch profile, skill hydration, communication policy and workflow policy.
- [x] Architecture, store and daemon docs are updated to match the final behavior.
- [x] No primary UX copy exposes internal terms such as `runtime`, `channel`, `routing`, `bridge`, `providerHints` or `session`; the member binding panel may expose a debug-only CLI session id copy field.
- [x] User-entered mentions open a server-side A2A chain boundary and register the directly dispatched initial agents as executing, so agent-originated follow-up mentions route without duplicate initial dispatch.
