# Team Runtime Contract Checklist

- [ ] `src/lib/team-runtime/` exists and exposes a stable public API through `index.ts`.
- [ ] Runtime resolution supports preset agents and TeamPack roles.
- [ ] Runtime profile resolution supports roleCard override, account precedence, skill merge and engine resolution.
- [ ] `dispatchToAgent()` uses `RuntimeAgentProfile`.
- [ ] PromptComposer team roster is runtime-driven and does not import static `AGENT_ROSTER` for TeamLayer.
- [ ] `/api/state` no longer hardcodes six preset agent IDs as the only skill hydration targets.
- [x] A2A communication uses `CommunicationPolicy`.
- [ ] TeamModeEngine is accessed through `WorkflowPolicy` in at least one real execution path.
- [ ] TeamPack roles are visible and configurable in account and skill binding UX.
- [ ] Tests cover preset runtime, TeamPack runtime, prompt roster, dispatch profile, skill hydration, communication policy and workflow policy.
- [ ] Architecture, store and daemon docs are updated to match the final behavior.
- [ ] No primary UX copy exposes internal terms such as `runtime`, `channel`, `routing`, `bridge`, `providerHints` or `session`.
