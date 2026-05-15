# Frontend Runtime Performance Refactor Tasks

## Phase 1: Runtime Cache

- [x] Add a module-local Team Runtime cache in `src/store/taskHubStore.ts`.
- [x] Invalidate the runtime cache on Team Runtime input reference changes.
- [x] Include a preset roster signature so existing `AGENT_ROSTER` mutations do not become stale.
- [x] Reuse cached `TeamRuntime` in `getEffectiveRoster()`, `getAgentRuntimeProfile()` and existing internal call sites.
- [x] Cache the legacy-compatible `Agent[]` roster returned by `getEffectiveRoster()`.
- [x] Cache per-agent runtime profiles and invalidate them when `accounts` changes.

## Phase 2: Agent Binding Panel

- [x] Replace independent store subscriptions in `AgentBindingPanel` with a shallow grouped selector.
- [x] Keep existing user-facing labels and interaction behavior unchanged.
- [x] Preserve debug session display as a secondary diagnostic section.

## Phase 3: Validation

- [x] Add or update focused tests for stable runtime cache returns.
- [x] Run Team Runtime and Team Role Card compatibility tests.
- [x] Run type checking if available and practical.

## Later Work

- [ ] Split `AgentBindingPanel` into role, skill, account and diagnostics subcomponents.
- [ ] Split Settings tabs into independent components.
- [ ] Define the long-term owner for preset roster facts before moving `AGENT_ROSTER`.
- [ ] Evaluate task and conversation Map indexes using profiler data.
- [ ] Consider account, integration and worktree stores only after fact-source ownership is documented.
