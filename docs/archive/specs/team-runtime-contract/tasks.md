# Team Runtime Contract Tasks

## Phase 1: Contract and Resolver

- [x] Create `src/lib/team-runtime/types.ts` with `TeamRuntime`, `RuntimeAgent`, `RuntimeAgentProfile`, `CommunicationPolicy`, and `WorkflowPolicy`.
- [x] Create `src/lib/team-runtime/resolveTeamRuntime.ts` to resolve preset roster and TeamPack roster from existing state inputs.
- [x] Create `src/lib/team-runtime/resolveRuntimeAgentProfile.ts` to resolve roleCard, account, engine and skills for one runtime agent.
- [x] Create `src/lib/team-runtime/resolveCommunicationPolicy.ts` to enforce TeamPack communication matrix.
- [x] Create `src/lib/team-runtime/resolveWorkflowPolicy.ts` to wrap `TeamModeEngine`.
- [x] Add unit tests for preset agent resolution, TeamPack role resolution, roleCard override precedence, account precedence and skill merge behavior.

## Phase 2: Store and Dispatch Integration

- [x] Move or delegate existing runtime-profile helper logic from `src/store/taskHubStore.ts` to `src/lib/team-runtime/`.
- [x] Update `dispatchToAgent()` so it resolves `RuntimeAgentProfile` before composing prompts or emitting `terminal:start`.
- [x] Ensure TeamPack roles can dispatch without falling back to static `AGENT_ROSTER`.
- [x] Add focused tests for dispatching to `planner`, `coder`, and `reviewer` in an `engineering-trio` project.

## Phase 3: Prompt Integration

- [x] Update `PromptComposer` compose options to accept runtime roster.
- [x] Update TeamLayer construction so it uses runtime roster instead of static `AGENT_ROSTER`.
- [x] Preserve existing TeamPackLayer behavior and ensure it receives the same TeamPack used by runtime resolution.
- [x] Add tests proving TeamPack roles appear in prompt team roster.

## Phase 4: API Hydration Integration

- [x] Update `/api/state` so skill hydration is not limited to preset agent IDs.
- [x] Return all persisted `agentSkillIds`, or return runtime-aware skill bindings per conversation.
- [x] Add API tests covering dynamic TeamPack role skill hydration.

## Phase 5: A2A and Workflow Integration

- [x] Update A2A target resolution to use runtime roster.
- [x] Enforce `CommunicationPolicy` before enqueueing or dispatching A2A work.
- [x] Record blocked A2A attempts as audit/debug events.
- [x] Route at least one task assignment or follow-up decision through `WorkflowPolicy`.
- [x] Add tests for allowed and blocked communication matrix cases.

## Phase 6: Documentation

- [x] Update `docs/wiki/01-architecture.md` with Team Runtime Contract as the collaboration kernel.
- [x] Update `docs/wiki/03-store-model.md` to describe store as runtime cache, not runtime fact source.
- [x] Update `docs/wiki/04-backend-daemon.md` to clarify daemon receives resolved execution context and does not interpret TeamPack rules.
- [x] Update role-card or TeamPack product docs with the final user-facing model.
