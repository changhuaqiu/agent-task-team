# Frontend Runtime Performance Refactor Checklist

- [x] Runtime cache is documented as a derived cache, not a source of truth.
- [x] `getEffectiveRoster()` reuses a stable array when relevant inputs do not change.
- [x] `getAgentRuntimeProfile()` reuses a stable profile when runtime and accounts do not change.
- [x] Cache invalidation covers TeamPack, RoleCard, Skill, account override and active roster changes.
- [x] Existing TeamPack dynamic role behavior still works.
- [x] Agent binding UI behavior remains unchanged.
- [x] Relevant tests pass or any skipped validation is explained.
