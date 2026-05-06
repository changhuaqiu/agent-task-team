# Team-First Role Card Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TeamPack the runtime owner of project roles while keeping the existing RoleCard library as a compatibility/material source.

**Architecture:** Implement the first migration stage from `docs/superpowers/specs/2026-05-06-team-first-role-card-fusion-design.md`: extend TeamPackRole with role snapshots and member bindings, persist those fields through the repository/API, and update runtime profile resolution so selected projects read role identity, accounts, and skills from the current TeamPack role first. Keep global RoleCard, AGENT_ROSTER, and existing overrides as compatibility fallbacks.

**Tech Stack:** TypeScript, Zustand, Next.js Pages API, better-sqlite3, Vitest

---

## Scope

This plan implements **Phase 1: compatible team-first runtime**.

Included:

- TeamPackRole supports `roleCardSnapshot`, `accountIds`, and `skillIds`.
- SQLite stores those fields on `team_pack_role`.
- Repository and API can persist team member config.
- Runtime profile resolves from the current TeamPack role first.
- AgentBindingPanel writes member account/skill/role changes to TeamPackRole when a TeamPack role exists.
- Existing global RoleCard library remains available.

Excluded:

- Removing the RoleCard tab.
- Bulk migration of all historical TeamPacks into snapshots.
- Team marketplace/export UI.
- Full team member editor redesign beyond the current avatar panel.

## File Map

| File | Responsibility |
|------|----------------|
| `src/types/teamPack.ts` | Add `RoleCardSnapshot`, `roleCardSnapshot`, `accountIds`, `skillIds` |
| `src/server/db/schema.ts` | Add Drizzle schema columns for team member role data |
| `src/server/db/migrate.ts` | Add migration v14 for existing SQLite DBs |
| `src/server/repositories/team-pack-repo.ts` | Read/write new role fields and expose `updateRoleConfig` |
| `src/pages/api/team-packs/[packId]/roles/[roleId].ts` | New API for member config patching |
| `src/store/taskHubStore.ts` | Team-first runtime profile, local currentTeamPack role updates |
| `src/store/agentStore.ts` | Persist member account/skill/role changes through TeamPack API |
| `src/components/task-hub/AgentBindingPanel.tsx` | Rename concept to member config and keep handlers using store APIs |
| `src/__tests__/repositories/team-pack-repo.test.ts` | Repository coverage for role snapshot/bindings |
| `src/__tests__/api/team-packs/role-config.test.ts` | API coverage for member config patch |
| `src/__tests__/store/team-role-card-compatibility.test.ts` | Runtime profile and binding coverage |
| `docs/superpowers/specs/2026-05-05-team-pack-ecosystem-status.md` | Document actual phase-1 behavior |

---

### Task 1: Extend TeamPackRole Types

**Files:**
- Modify: `src/types/teamPack.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Add failing type-backed runtime test**

Append this test to `src/__tests__/store/team-role-card-compatibility.test.ts`:

```typescript
it('prefers TeamPack role snapshot and member bindings over global role cards', () => {
  useTaskHubStore.setState({
    currentTeamPack: makeTeamPack('pack-team', [{
      ...makeRole({ id: 'planner', displayName: '规划师' }),
      roleCardId: useTaskHubStore.getState().roleCards[0].id,
      roleCardSnapshot: {
        ...useTaskHubStore.getState().roleCards[0],
        displayName: '团队内规划师',
        accountIds: ['acc-snapshot'],
        sourceRoleCardId: useTaskHubStore.getState().roleCards[0].id,
        snapshotVersion: 1,
        snapshottedAt: '2026-05-06T00:00:00.000Z',
      },
      accountIds: ['acc-team'],
      skillIds: ['skill-team'],
    }],
    skillsMap: {
      'skill-team': {
        name: 'Team Skill',
        content: 'Use team-owned skill.',
      },
    },
  });

  const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

  expect(profile?.roleCard?.displayName).toBe('团队内规划师');
  expect(profile?.accountIds).toEqual(['acc-team']);
  expect(profile?.skills.map((s) => s.name)).toEqual(['Team Skill']);
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: fail at TypeScript transform/type usage or runtime because `roleCardSnapshot`, `accountIds`, and `skillIds` are not part of `TeamPackRole` and runtime profile does not read them.

- [ ] **Step 3: Add snapshot types**

Modify `src/types/teamPack.ts`:

```typescript
import type { RoleCard } from './roleCard';

export type RoleCardSnapshot = Omit<RoleCard, 'id' | 'isPreset' | 'version' | 'createdAt' | 'updatedAt'> & {
  sourceRoleCardId?: string;
  snapshotVersion: number;
  snapshottedAt: string;
};
```

Update `TeamPackRole`:

```typescript
export interface TeamPackRole {
  id: string;
  displayName: string;
  soul: string;
  required: boolean;
  description?: string;
  roleCardId?: string;
  roleCardSnapshot?: RoleCardSnapshot;
  accountIds?: string[];
  skillIds?: string[];
}
```

- [ ] **Step 4: Run focused test**

Run:

```bash
pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: still fail because runtime profile does not use TeamPack role fields yet.

- [ ] **Step 5: Commit**

```bash
git add src/types/teamPack.ts src/__tests__/store/team-role-card-compatibility.test.ts
git commit -m "test: define team-owned role runtime expectations"
```

---

### Task 2: Persist Team Member Role Fields

**Files:**
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/migrate.ts`
- Modify: `src/server/repositories/team-pack-repo.ts`
- Test: `src/__tests__/repositories/team-pack-repo.test.ts`

- [ ] **Step 1: Add failing repository test**

Append to `src/__tests__/repositories/team-pack-repo.test.ts`:

```typescript
it('persists role snapshot, account IDs, and skill IDs on team pack roles', () => {
  const pack = teamPackRepo.create({
    name: 'role-snapshot-pack',
    displayName: 'Role Snapshot Pack',
    description: 'Stores member config',
    roles: [{
      id: 'planner',
      displayName: '规划师',
      soul: '# 规划师',
      required: true,
      roleCardSnapshot: {
        name: 'planner',
        displayName: '团队内规划师',
        description: 'Plans work',
        category: 'planner',
        tags: [],
        applicableScenarios: [],
        responsibilities: ['Plan'],
        nonResponsibilities: [],
        successCriteria: [],
        clarifyBeforeExecute: 'when_ambiguous',
        outputStyle: 'structured',
        preferStructuredOutput: true,
        allowedActions: ['can_propose_only'],
        requiresConfirmation: [],
        forbiddenActions: [],
        preferredEngines: [],
        allowedTools: [],
        accountIds: [],
        outputFormat: 'checklist',
        requiresEvidence: true,
        riskGrading: 'optional',
        sourceRoleCardId: 'preset-planner',
        snapshotVersion: 1,
        snapshottedAt: '2026-05-06T00:00:00.000Z',
      },
      accountIds: ['acc-1'],
      skillIds: ['skill-1'],
    }],
    workflow: { type: 'linear' },
    communicationMatrix: {},
  });

  const fetched = teamPackRepo.getById(pack.id)!;
  expect(fetched.roles[0].roleCardSnapshot?.displayName).toBe('团队内规划师');
  expect(fetched.roles[0].accountIds).toEqual(['acc-1']);
  expect(fetched.roles[0].skillIds).toEqual(['skill-1']);
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm vitest run src/__tests__/repositories/team-pack-repo.test.ts
```

Expected: fail because repository drops the new role fields.

- [ ] **Step 3: Add DB columns**

In `src/server/db/schema.ts`, extend `teamPackRole`:

```typescript
  roleCardSnapshot: text('role_card_snapshot'),
  accountIds: text('account_ids'),
  skillIds: text('skill_ids'),
```

In `src/server/db/migrate.ts`, add migration after version 13:

```typescript
  {
    version: 14,
    sql: `
    ALTER TABLE team_pack_role ADD COLUMN role_card_snapshot TEXT;
    ALTER TABLE team_pack_role ADD COLUMN account_ids TEXT;
    ALTER TABLE team_pack_role ADD COLUMN skill_ids TEXT;
  `,
  },
```

- [ ] **Step 4: Update repository row mapping**

In `src/server/repositories/team-pack-repo.ts`, extend `TeamPackRoleRow`:

```typescript
  role_card_snapshot: string | null;
  account_ids: string | null;
  skill_ids: string | null;
```

Update `rowToTeamPack()` role mapping:

```typescript
roles: roles.map(r => ({
  id: r.role_id,
  displayName: r.display_name,
  soul: r.soul,
  required: r.required === 1,
  description: r.description ?? undefined,
  roleCardId: r.role_card_id ?? undefined,
  roleCardSnapshot: r.role_card_snapshot ? JSON.parse(r.role_card_snapshot) : undefined,
  accountIds: r.account_ids ? JSON.parse(r.account_ids) : undefined,
  skillIds: r.skill_ids ? JSON.parse(r.skill_ids) : undefined,
})),
```

- [ ] **Step 5: Update create/addRole inserts**

Replace the `team_pack_role` insert column list in both `create()` and `addRole()` with:

```sql
INSERT INTO team_pack_role (
  id, pack_id, role_id, display_name, soul, required, description,
  role_card_id, role_card_snapshot, account_ids, skill_ids, created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Use these values:

```typescript
role.roleCardId ?? null,
role.roleCardSnapshot ? JSON.stringify(role.roleCardSnapshot) : null,
role.accountIds ? JSON.stringify(role.accountIds) : null,
role.skillIds ? JSON.stringify(role.skillIds) : null,
now
```

- [ ] **Step 6: Add `updateRoleConfig`**

Add to `teamPackRepo`:

```typescript
updateRoleConfig(
  packId: string,
  roleId: string,
  patch: Pick<Partial<TeamPackRole>, 'roleCardId' | 'roleCardSnapshot' | 'accountIds' | 'skillIds'>,
): TeamPackRole | undefined {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.roleCardId !== undefined) {
    sets.push('role_card_id = ?');
    values.push(patch.roleCardId ?? null);
  }
  if (patch.roleCardSnapshot !== undefined) {
    sets.push('role_card_snapshot = ?');
    values.push(patch.roleCardSnapshot ? JSON.stringify(patch.roleCardSnapshot) : null);
  }
  if (patch.accountIds !== undefined) {
    sets.push('account_ids = ?');
    values.push(JSON.stringify(patch.accountIds));
  }
  if (patch.skillIds !== undefined) {
    sets.push('skill_ids = ?');
    values.push(JSON.stringify(patch.skillIds));
  }
  if (sets.length === 0) {
    return teamPackRepo.getById(packId)?.roles.find((role) => role.id === roleId);
  }

  values.push(packId, roleId);
  getDb().prepare(`UPDATE team_pack_role SET ${sets.join(', ')} WHERE pack_id = ? AND role_id = ?`).run(...values);
  return teamPackRepo.getById(packId)?.roles.find((role) => role.id === roleId);
},
```

- [ ] **Step 7: Run repository test**

Run:

```bash
pnpm vitest run src/__tests__/repositories/team-pack-repo.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/db/schema.ts src/server/db/migrate.ts src/server/repositories/team-pack-repo.ts src/__tests__/repositories/team-pack-repo.test.ts
git commit -m "feat: persist team pack role snapshots and bindings"
```

---

### Task 3: Add Team Member Config API

**Files:**
- Create: `src/pages/api/team-packs/[packId]/roles/[roleId].ts`
- Test: `src/__tests__/api/team-packs/role-config.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `src/__tests__/api/team-packs/role-config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '@/pages/api/team-packs/[packId]/roles/[roleId]';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  return res;
}

describe('/api/team-packs/[packId]/roles/[roleId]', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('patches role account and skill IDs', () => {
    const updatedRole = {
      id: 'planner',
      displayName: '规划师',
      soul: '# 规划师',
      required: true,
      accountIds: ['acc-1'],
      skillIds: ['skill-1'],
    };
    vi.spyOn(teamPackRepo, 'updateRoleConfig').mockReturnValue(updatedRole as any);

    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: { accountIds: ['acc-1'], skillIds: ['skill-1'] },
    };
    const res = mockRes();

    handler(req, res);

    expect(teamPackRepo.updateRoleConfig).toHaveBeenCalledWith('pack-1', 'planner', {
      accountIds: ['acc-1'],
      skillIds: ['skill-1'],
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ role: updatedRole });
  });

  it('rejects unknown fields', () => {
    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: { runtime: 'internal' },
    };
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: '不允许更新字段: runtime' });
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm vitest run src/__tests__/api/team-packs/role-config.test.ts
```

Expected: fail because the API file does not exist.

- [ ] **Step 3: Implement API route**

Create `src/pages/api/team-packs/[packId]/roles/[roleId].ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import type { TeamPackRole } from '@/types/teamPack';

type PatchBody = Pick<Partial<TeamPackRole>, 'roleCardId' | 'roleCardSnapshot' | 'accountIds' | 'skillIds'>;

function validatePatch(input: Record<string, unknown>): { valid: boolean; error?: string } {
  const allowedFields = ['roleCardId', 'roleCardSnapshot', 'accountIds', 'skillIds'];
  const invalidKeys = Object.keys(input).filter((key) => !allowedFields.includes(key));
  if (invalidKeys.length > 0) {
    return { valid: false, error: `不允许更新字段: ${invalidKeys.join(', ')}` };
  }
  if (input.accountIds !== undefined && !Array.isArray(input.accountIds)) {
    return { valid: false, error: 'accountIds 必须是数组' };
  }
  if (input.skillIds !== undefined && !Array.isArray(input.skillIds)) {
    return { valid: false, error: 'skillIds 必须是数组' };
  }
  if (input.roleCardId !== undefined && typeof input.roleCardId !== 'string') {
    return { valid: false, error: 'roleCardId 必须是字符串' };
  }
  if (input.roleCardSnapshot !== undefined && typeof input.roleCardSnapshot !== 'object') {
    return { valid: false, error: 'roleCardSnapshot 必须是对象' };
  }
  return { valid: true };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { packId, roleId } = req.query as { packId: string; roleId: string };

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).end();
  }

  const validation = validatePatch(req.body ?? {});
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const role = teamPackRepo.updateRoleConfig(packId, roleId, req.body as PatchBody);
  if (!role) {
    return res.status(404).json({ error: 'Team pack role not found' });
  }
  return res.status(200).json({ role });
}
```

- [ ] **Step 4: Run API test**

Run:

```bash
pnpm vitest run src/__tests__/api/team-packs/role-config.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/team-packs/[packId]/roles/[roleId].ts src/__tests__/api/team-packs/role-config.test.ts
git commit -m "feat: add team pack role config API"
```

---

### Task 4: Resolve Runtime Profile From TeamPackRole First

**Files:**
- Modify: `src/store/taskHubStore.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Confirm failing test from Task 1**

Run:

```bash
pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected before implementation: the new snapshot-priority test fails because `getAgentRuntimeProfile()` still uses agent roleCard/global overrides first.

- [ ] **Step 2: Add helper to find current team role**

In `src/store/taskHubStore.ts`, add near helper selectors:

```typescript
function findCurrentTeamRole(state: TaskHubState, agentId: string): TeamPackRole | undefined {
  const conv = state.conversations.find((c) => c.id === state.selectedConversationId);
  if (!conv?.teamPackId || !state.currentTeamPack || state.currentTeamPack.id !== conv.teamPackId) {
    return undefined;
  }
  return state.currentTeamPack.roles.find((role) => role.id === agentId);
}
```

- [ ] **Step 3: Update synthesized agent roleCardId**

Change `synthesizeAgentFromRole()`:

```typescript
roleCardId: role.roleCardSnapshot
  ? `team-role-snapshot-${role.id}`
  : (role.roleCardId ?? `team-role-${role.id}`),
```

- [ ] **Step 4: Update `getAgentRuntimeProfile()`**

Replace the roleCard/account/skills portion with:

```typescript
const teamRole = findCurrentTeamRole(state, agentId);
const overrideRoleCardId = state.agentRoleCardOverrides?.[agentId];
const roleCardId = teamRole?.roleCardId ?? overrideRoleCardId ?? agent.roleCardId;
const globalRoleCard = roleCardId
  ? state.roleCards.find((card: RoleCard) => card.id === roleCardId)
  : undefined;
const roleCard = teamRole?.roleCardSnapshot
  ? {
      ...teamRole.roleCardSnapshot,
      id: `team-role-snapshot-${teamRole.id}`,
      isPreset: false,
      version: teamRole.roleCardSnapshot.snapshotVersion,
      createdAt: teamRole.roleCardSnapshot.snapshottedAt,
      updatedAt: teamRole.roleCardSnapshot.snapshottedAt,
    } satisfies RoleCard
  : globalRoleCard;
const accountIds = teamRole?.accountIds && teamRole.accountIds.length > 0
  ? teamRole.accountIds
  : roleCard && roleCard.accountIds.length > 0
    ? roleCard.accountIds
    : (state.agentAccountOverrides[agentId] ?? agent.accountIds ?? []);
const skillIds = teamRole?.skillIds ?? state.agentSkillIds[agentId] ?? [];
const skills = skillIds.map((id: string) => state.skillsMap[id]).filter(Boolean);
```

Return:

```typescript
return {
  agent: roleCard
    ? { ...agent, roleCardId: roleCard.id, roleLabel: roleCard.displayName }
    : agent,
  roleCard,
  accountIds,
  skills,
};
```

- [ ] **Step 5: Run runtime tests**

Run:

```bash
pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts src/__tests__/store/team-pack-roster.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/store/taskHubStore.ts src/__tests__/store/team-role-card-compatibility.test.ts
git commit -m "feat: resolve runtime roles from team packs first"
```

---

### Task 5: Persist Member Config From Store Actions

**Files:**
- Modify: `src/store/agentStore.ts`
- Modify: `src/store/taskHubStore.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Add failing store action test**

Append to `src/__tests__/store/team-role-card-compatibility.test.ts`:

```typescript
it('persists dynamic team role account bindings through the team role API', async () => {
  const calls: Array<{ url: string; body: any }> = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({
      role: {
        ...useTaskHubStore.getState().currentTeamPack!.roles[0],
        accountIds: ['acc-openai'],
      },
    }), { status: 200 });
  }) as typeof fetch;

  await useTaskHubStore.getState().setTeamRoleAccountIds('planner', ['acc-openai']);

  expect(calls).toEqual([{
    url: '/api/team-packs/pack-team/roles/planner',
    body: { accountIds: ['acc-openai'] },
  }]);
  expect(useTaskHubStore.getState().currentTeamPack?.roles[0].accountIds).toEqual(['acc-openai']);
});
```

- [ ] **Step 2: Add store method types**

In `TaskHubState`, add:

```typescript
setTeamRoleAccountIds: (agentId: string, accountIds: string[]) => Promise<void>;
setTeamRoleSkillIds: (agentId: string, skillIds: string[]) => Promise<void>;
setTeamRoleCardSnapshot: (agentId: string, roleCardId: string) => Promise<void>;
```

- [ ] **Step 3: Add local updater helper**

In `src/store/taskHubStore.ts`, add:

```typescript
function updateCurrentTeamRole(
  state: TaskHubState,
  agentId: string,
  patch: Partial<TeamPackRole>,
): Pick<TaskHubState, 'currentTeamPack'> {
  if (!state.currentTeamPack) return { currentTeamPack: state.currentTeamPack };
  return {
    currentTeamPack: {
      ...state.currentTeamPack,
      roles: state.currentTeamPack.roles.map((role) =>
        role.id === agentId ? { ...role, ...patch } : role
      ),
    },
  };
}
```

- [ ] **Step 4: Implement team role actions**

Add actions in the store initializer:

```typescript
setTeamRoleAccountIds: async (agentId: string, accountIds: string[]) => {
  const packId = get().currentTeamPack?.id;
  if (!packId) {
    get().setAgentAccountIds(agentId, accountIds);
    return;
  }
  const res = await fetch(`/api/team-packs/${packId}/roles/${agentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountIds }),
  });
  if (!res.ok) throw new Error('Failed to update team member accounts');
  const data = await res.json();
  set((state: TaskHubState) => updateCurrentTeamRole(state, agentId, data.role));
},
setTeamRoleSkillIds: async (agentId: string, skillIds: string[]) => {
  const packId = get().currentTeamPack?.id;
  if (!packId) {
    await get().assignSkillsToAgent(agentId, skillIds);
    return;
  }
  const res = await fetch(`/api/team-packs/${packId}/roles/${agentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skillIds }),
  });
  if (!res.ok) throw new Error('Failed to update team member skills');
  const data = await res.json();
  set((state: TaskHubState) => updateCurrentTeamRole(state, agentId, data.role));
},
setTeamRoleCardSnapshot: async (agentId: string, roleCardId: string) => {
  const packId = get().currentTeamPack?.id;
  const card = get().roleCards.find((item: RoleCard) => item.id === roleCardId);
  if (!packId || !card) {
    get().setAgentRoleCardId(agentId, roleCardId);
    return;
  }
  const { id, isPreset, version, createdAt, updatedAt, ...snapshotBase } = card;
  const roleCardSnapshot = {
    ...snapshotBase,
    sourceRoleCardId: id,
    snapshotVersion: version,
    snapshottedAt: new Date().toISOString(),
  };
  const res = await fetch(`/api/team-packs/${packId}/roles/${agentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roleCardId, roleCardSnapshot }),
  });
  if (!res.ok) throw new Error('Failed to update team member role');
  const data = await res.json();
  set((state: TaskHubState) => updateCurrentTeamRole(state, agentId, data.role));
},
```

- [ ] **Step 5: Route existing actions to team role actions**

In `src/store/agentStore.ts`, update `setAgentAccountIds`:

```typescript
setAgentAccountIds: (agentId: string, accountIds: string[]) => {
  const teamRole = typeof get().getSelectedConversation === 'function'
    ? get().currentTeamPack?.roles?.find((role: TeamPackRole) => role.id === agentId)
    : undefined;
  if (teamRole && typeof get().setTeamRoleAccountIds === 'function') {
    void get().setTeamRoleAccountIds(agentId, accountIds);
    return;
  }
  set((state: any) => ({
    agentAccountOverrides: {
      ...state.agentAccountOverrides,
      [agentId]: accountIds,
    },
  }));
},
```

Import `TeamPackRole` type at the top:

```typescript
import type { TeamPackRole } from '@/types/teamPack';
```

- [ ] **Step 6: Run store tests**

Run:

```bash
pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/store/taskHubStore.ts src/store/agentStore.ts src/__tests__/store/team-role-card-compatibility.test.ts
git commit -m "feat: persist team member bindings from store actions"
```

---

### Task 6: Update Binding Panel to Use Team Member Actions

**Files:**
- Modify: `src/components/task-hub/AgentBindingPanel.tsx`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Update action selectors**

In `AgentBindingPanel`, add:

```typescript
const setTeamRoleAccountIds = useTaskHubStore((s) => s.setTeamRoleAccountIds);
const setTeamRoleSkillIds = useTaskHubStore((s) => s.setTeamRoleSkillIds);
const setTeamRoleCardSnapshot = useTaskHubStore((s) => s.setTeamRoleCardSnapshot);
```

- [ ] **Step 2: Rename visible section label**

Change the top role section label from:

```tsx
当前角色
```

to:

```tsx
团队成员
```

Keep the role picker button text `换角色` for now.

- [ ] **Step 3: Update account binding writer**

Replace `writeAccountBinding` with:

```typescript
const writeAccountBinding = (nextIds: string[]) => {
  void setTeamRoleAccountIds(agentId, nextIds);
};
```

This delegates fallback behavior to the store action.

- [ ] **Step 4: Update role switching handler**

Replace `handleSwitchRole` with:

```typescript
const handleSwitchRole = (cardId: string) => {
  void setTeamRoleCardSnapshot(agentId, cardId);
  setShowRolePicker(false);
};
```

- [ ] **Step 5: Update skill handlers**

Replace skill handlers:

```typescript
const handleRemoveSkill = (skillId: string) => {
  const next = currentSkillIds.filter((id) => id !== skillId);
  void setTeamRoleSkillIds(agentId, next);
};

const handleAddSkill = (skillId: string) => {
  const next = [...currentSkillIds, skillId];
  void setTeamRoleSkillIds(agentId, next);
  setShowSkillPicker(false);
};
```

- [ ] **Step 6: Derive current skill IDs from profile**

Replace:

```typescript
const currentSkillIds = agentSkillIds[agentId] ?? [];
```

with:

```typescript
const currentSkillIds = profile?.skills
  ? Object.entries(skillsMap)
      .filter(([, skill]) => profile.skills.some((item) => item.name === skill.name && item.content === skill.content))
      .map(([id]) => id)
  : (agentSkillIds[agentId] ?? []);
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts
pnpm tsc --noEmit
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/task-hub/AgentBindingPanel.tsx
git commit -m "feat: route member panel edits to team roles"
```

---

### Task 7: Update Documentation and Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-05-team-pack-ecosystem-status.md`
- Modify: `docs/superpowers/specs/2026-05-06-team-first-role-card-fusion-design.md`

- [ ] **Step 1: Document implemented Phase 1**

Add this section to `docs/superpowers/specs/2026-05-05-team-pack-ecosystem-status.md`:

```markdown
### 4.5 团队优先角色身份 Phase 1

**状态**：已进入兼容运行阶段。

TeamPackRole 支持保存 `roleCardSnapshot`、`accountIds`、`skillIds`。项目运行时通过 `getAgentRuntimeProfile(agentId)` 优先读取当前 TeamPack 成员定义；全局 RoleCard 和 Agent overrides 仅作为兼容 fallback。成员头像配置面板写入 TeamPackRole，使团队套件逐步成为角色身份、账号和技能绑定的事实来源。
```

- [ ] **Step 2: Mark design status**

In `docs/superpowers/specs/2026-05-06-team-first-role-card-fusion-design.md`, change:

```markdown
> 状态：设计稿
```

to:

```markdown
> 状态：Phase 1 implementation planned
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm vitest run src/__tests__/repositories/team-pack-repo.test.ts src/__tests__/api/team-packs/role-config.test.ts src/__tests__/store/team-role-card-compatibility.test.ts
pnpm tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
```

Expected: pass.

- [ ] **Step 5: Commit docs**

```bash
git add docs/superpowers/specs/2026-05-05-team-pack-ecosystem-status.md docs/superpowers/specs/2026-05-06-team-first-role-card-fusion-design.md
git commit -m "docs: record team-first role runtime phase"
```

---

## Self-Review

Spec coverage:

- TeamPack owns runtime role identity: Tasks 1, 4, 5, 6.
- RoleCard remains compatibility/material library: Tasks 4 and 6 keep global RoleCard fallback and role picker.
- TeamPackRole stores snapshot/accounts/skills: Tasks 1, 2, 3.
- Store/runtime reads TeamPack first: Task 4.
- UI writes member config back to TeamPackRole: Tasks 5 and 6.
- Documentation updated: Task 7.

Scope check:

- This is focused on Phase 1 compatibility. It intentionally does not remove RoleCard UI, build a marketplace, or run a bulk migration.

Placeholder scan:

- No deferred implementation markers are present.

Type consistency:

- `RoleCardSnapshot`, `roleCardSnapshot`, `accountIds`, `skillIds`, `setTeamRoleAccountIds`, `setTeamRoleSkillIds`, and `setTeamRoleCardSnapshot` are used consistently across tasks.

