# Team Role Card Compatibility Checklist

- [x] `pnpm vitest run src/__tests__/store/team-pack-roster.test.ts src/__tests__/store/account-binding.test.ts`
- [x] `pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts`
- [x] `pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts` fails before implementation for the expected missing runtime profile and also exposes unrelated `KanbanCard` failures.
- [x] `pnpm tsc --noEmit`
- [ ] Manual check: create project with 工程三件套, click each avatar, bind account, add skill.
- [ ] Manual check: dispatch to planner/coder/reviewer uses selected account and includes Team Pack context.
- [x] Documentation updated in `docs/superpowers/specs/2026-05-05-team-pack-ecosystem-status.md`.
- [x] `pnpm test`
