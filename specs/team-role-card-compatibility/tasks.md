# Team Role Card Compatibility Tasks

- [ ] Add `agentRoleCardOverrides` state and apply it in `getEffectiveRoster()`.
- [ ] Add `getAgentRuntimeProfile(agentId)` to `TaskHubState`.
- [ ] Update `AgentBindingPanel` to bind accounts through runtime profile fallback rules.
- [ ] Update `setAgentRoleCardId()` so dynamic Team Pack roles are stored in `agentRoleCardOverrides`, not only in `AGENT_ROSTER`.
- [ ] Update `loadSkills()` to hydrate hardcoded and effective roster IDs.
- [ ] Update `daemonStore.dispatchToAgent()` and `simulateCliExecution()` to use `getAgentRuntimeProfile()`.
- [ ] Add focused Vitest coverage for dynamic Team Pack role binding, skills, and dispatch profile resolution.
- [ ] Update Team Pack ecosystem documentation with the final compatibility model.

