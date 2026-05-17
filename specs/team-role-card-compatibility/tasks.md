# Team Role Card Compatibility Tasks

- [x] Add `agentRoleCardOverrides` state and apply it in `getEffectiveRoster()`.
- [x] Add `getAgentRuntimeProfile(agentId)` to `TaskHubState`.
- [x] Update `AgentBindingPanel` to bind accounts through runtime profile fallback rules.
- [x] Update `setAgentRoleCardId()` so dynamic Team Pack roles are stored in `agentRoleCardOverrides`, not only in `AGENT_ROSTER`.
- [x] Update `loadSkills()` to hydrate hardcoded and effective roster IDs.
- [x] Update `daemonStore.dispatchToAgent()` and `simulateCliExecution()` to use `getAgentRuntimeProfile()`.
- [x] Add focused Vitest coverage for dynamic Team Pack role binding, skills, and dispatch profile resolution.
- [x] Add TeamPack role snapshot materialization and self-contained export.
- [x] Preserve implementation permissions when synthesizing TeamPack role snapshots.
- [x] Backfill preset TeamPack roles to matching preset RoleCards on seed.
- [x] Downgrade the independent RoleCard entry to role material wording and add member-to-material saving.
- [x] Update Team Pack ecosystem documentation with the final compatibility model.
