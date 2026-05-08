# Team Runtime Contract Tasks

## Phase 1: Contract and Resolver

- [ ] Create `src/lib/team-runtime/types.ts` with `TeamRuntime`, `RuntimeAgent`, `RuntimeAgentProfile`, `CommunicationPolicy`, and `WorkflowPolicy`.
- [ ] Create `src/lib/team-runtime/resolveTeamRuntime.ts` to resolve preset roster and TeamPack roster from existing state inputs.
- [ ] Create `src/lib/team-runtime/resolveRuntimeAgentProfile.ts` to resolve roleCard, account, engine and skills for one runtime agent.
- [ ] Create `src/lib/team-runtime/resolveCommunicationPolicy.ts` to enforce TeamPack communication matrix.
- [ ] Create `src/lib/team-runtime/resolveWorkflowPolicy.ts` to wrap `TeamModeEngine`.
- [ ] Add unit tests for preset agent resolution, TeamPack role resolution, roleCard override precedence, account precedence and skill merge behavior.

## Phase 2: Store and Dispatch Integration

- [ ] Move or delegate existing runtime-profile helper logic from `src/store/taskHubStore.ts` to `src/lib/team-runtime/`.
- [ ] Update `dispatchToAgent()` so it resolves `RuntimeAgentProfile` before composing prompts or emitting `terminal:start`.
- [ ] Ensure TeamPack roles can dispatch without falling back to static `AGENT_ROSTER`.
- [ ] Add focused tests for dispatching to `planner`, `coder`, and `reviewer` in an `engineering-trio` project.

## Phase 3: Prompt Integration

- [ ] Update `PromptComposer` compose options to accept runtime roster.
- [ ] Update TeamLayer construction so it uses runtime roster instead of static `AGENT_ROSTER`.
- [ ] Preserve existing TeamPackLayer behavior and ensure it receives the same TeamPack used by runtime resolution.
- [ ] Add tests proving TeamPack roles appear in prompt team roster.

## Phase 4: API Hydration Integration

- [ ] Update `/api/state` so skill hydration is not limited to preset agent IDs.
- [ ] Return all persisted `agentSkillIds`, or return runtime-aware skill bindings per conversation.
- [ ] Add API tests covering dynamic TeamPack role skill hydration.

## Phase 5: A2A and Workflow Integration

- [ ] Update A2A target resolution to use runtime roster.
- [x] Enforce `CommunicationPolicy` before enqueueing or dispatching A2A work.
- [x] Record blocked A2A attempts as audit/debug events.
- [ ] Route at least one task assignment or follow-up decision through `WorkflowPolicy`.
- [x] Add tests for allowed and blocked communication matrix cases.

## Phase 6: Documentation

- [ ] Update `docs/wiki/01-architecture.md` with Team Runtime Contract as the collaboration kernel.
- [ ] Update `docs/wiki/03-store-model.md` to describe store as runtime cache, not runtime fact source.
- [ ] Update `docs/wiki/04-backend-daemon.md` to clarify daemon receives resolved execution context and does not interpret TeamPack rules.
- [ ] Update role-card or TeamPack product docs with the final user-facing model.
