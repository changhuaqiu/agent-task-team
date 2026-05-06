# Team Role Card Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Team Pack roles fully compatible with the original role/account/skill interactions so clicking a Team Pack avatar can bind accounts, switch role cards, assign skills, and dispatch with the correct execution context.

**Architecture:** Keep `getEffectiveRoster()` as the roster source of truth, then add a runtime profile resolver that all UI and dispatch paths use. Dynamic Team Pack roles remain independent agent IDs; compatibility is provided through per-agent overrides and fallback account bindings instead of forcing imported packs to use local Mario IDs.

**Tech Stack:** TypeScript, Zustand, React, Vitest

---

## Root Cause Summary

The previous `effectiveRoster` work made Team Pack roles visible, but old paths still depend on hardcoded `AGENT_ROSTER` or existing `RoleCard` rows. Synthesized roles such as `planner` get a synthetic `roleCardId` like `team-role-planner`; because that RoleCard does not exist, `AgentBindingPanel` calculates `currentRoleCard = null`, `handleBind()` returns early, and avatar binding cannot add accounts. Dispatch has the same class of issue because it looks up `AGENT_ROSTER.find(...)`, so Team Pack roles are unknown at execution time.

## File Map

| File | Responsibility |
|------|----------------|
| `specs/team-role-card-compatibility/spec.md` | Active implementation contract |
| `src/store/taskHubStore.ts` | Add runtime profile selector and state fields |
| `src/store/agentStore.ts` | Make role switching work for dynamic roles and skill hydration include effective roster |
| `src/components/task-hub/AgentBindingPanel.tsx` | Use runtime profile fallback for accounts and role card switching |
| `src/components/task-hub/AgentBar.tsx` | Use runtime profile for account status dot |
| `src/store/daemonStore.ts` | Dispatch dynamic Team Pack roles through runtime profile |
| `src/__tests__/store/team-role-card-compatibility.test.ts` | New focused regression tests |
| `docs/superpowers/specs/2026-05-05-team-pack-ecosystem-status.md` | Document final compatibility behavior |

---

### Task 1: Add Runtime Profile State and Selector

**Files:**
- Modify: `src/store/taskHubStore.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Write failing selector tests**

Create `src/__tests__/store/team-role-card-compatibility.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';
import type { TeamPack, TeamPackRole } from '@/types/teamPack';

function makeRole(overrides: Partial<TeamPackRole> & { id: string }): TeamPackRole {
  return { displayName: overrides.id, soul: '', required: true, ...overrides };
}

function makeTeamPack(id: string, roles: TeamPackRole[]): TeamPack {
  return {
    id,
    specVersion: 'team-pack/0.1',
    name: id,
    displayName: id,
    description: '',
    version: '1.0.0',
    tags: [],
    category: 'test',
    roles,
    teamMode: 'pipeline',
    workflow: { type: 'linear' },
    communicationMatrix: {},
    isPreset: false,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
  };
}

function makeAccount(id: string): Account {
  return {
    id,
    name: id,
    authMode: 'api_key',
    provider: 'openai',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
  };
}

beforeEach(() => {
  useTaskHubStore.setState({
    conversations: [{
      id: 'conv-team',
      title: 'Team project',
      goal: 'Test',
      status: 'active',
      priority: 'p1',
      projectPath: '',
      breakdownStatus: 'none',
      teamPackId: 'pack-team',
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    }],
    selectedConversationId: 'conv-team',
    selectedProjectId: 'conv-team',
    activeAgentIds: ['planner'],
    currentTeamPack: makeTeamPack('pack-team', [makeRole({ id: 'planner', displayName: '规划师' })]),
    accounts: [makeAccount('acc-openai')],
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
    agentSkillIds: {},
  });
});

describe('team role runtime profile', () => {
  it('resolves a dynamic Team Pack role from effective roster', () => {
    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.agent.id).toBe('planner');
    expect(profile?.agent.name).toBe('规划师');
    expect(profile?.roleCard).toBeUndefined();
    expect(profile?.accountIds).toEqual([]);
  });

  it('uses agent account overrides when no RoleCard exists', () => {
    useTaskHubStore.setState({ agentAccountOverrides: { planner: ['acc-openai'] } });

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.accountIds).toEqual(['acc-openai']);
  });

  it('uses role card override accounts before agent account overrides', () => {
    useTaskHubStore.setState((state) => ({
      roleCards: [{
        ...state.roleCards[0],
        id: 'rc-planner',
        displayName: 'Planner Card',
        accountIds: ['acc-role'],
      }, ...state.roleCards],
      agentRoleCardOverrides: { planner: 'rc-planner' },
      agentAccountOverrides: { planner: ['acc-openai'] },
    }));

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.roleCard?.id).toBe('rc-planner');
    expect(profile?.accountIds).toEqual(['acc-role']);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: fail because `agentRoleCardOverrides` and `getAgentRuntimeProfile` do not exist yet.

- [ ] **Step 3: Add state and selector types**

In `src/store/taskHubStore.ts`, add imports and interface fields near the existing store declarations:

```typescript
import type { RoleCard } from '@/types/roleCard';

export interface AgentRuntimeProfile {
  agent: Agent;
  roleCard?: RoleCard;
  accountIds: string[];
  skills: SkillSummary[];
}
```

Add to `TaskHubState`:

```typescript
agentRoleCardOverrides: Record<string, string>;
getAgentRuntimeProfile: (agentId: string) => AgentRuntimeProfile | null;
```

- [ ] **Step 4: Add initial state and runtime selector**

In the store initializer near `agentAccountOverrides`, add:

```typescript
agentRoleCardOverrides: {} as Record<string, string>,
```

In the helper selector section after `getEffectiveRoster`, add:

```typescript
getAgentRuntimeProfile: (agentId: string) => {
  const state = get();
  const agent = state.getEffectiveRoster().find((item: Agent) => item.id === agentId);
  if (!agent) return null;

  const overrideRoleCardId = state.agentRoleCardOverrides[agentId];
  const roleCardId = overrideRoleCardId ?? agent.roleCardId;
  const roleCard = roleCardId
    ? state.roleCards.find((card: RoleCard) => card.id === roleCardId)
    : undefined;

  const accountIds = roleCard && roleCard.accountIds.length > 0
    ? roleCard.accountIds
    : (state.agentAccountOverrides[agentId] ?? agent.accountIds ?? []);

  return {
    agent: roleCard
      ? {
          ...agent,
          roleCardId: roleCard.id,
          roleLabel: roleCard.displayName,
        }
      : agent,
    roleCard,
    accountIds,
    skills: state.getSkillsForAgent(agentId),
  };
},
```

- [ ] **Step 5: Run selector tests**

Run:

```bash
pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: pass.

---

### Task 2: Make Avatar Binding Work Without a RoleCard

**Files:**
- Modify: `src/components/task-hub/AgentBindingPanel.tsx`
- Modify: `src/components/task-hub/AgentBar.tsx`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Add store-level account binding regression test**

Append to `src/__tests__/store/team-role-card-compatibility.test.ts`:

```typescript
it('binds accounts to dynamic roles through agent overrides when no RoleCard exists', () => {
  const store = useTaskHubStore.getState();

  store.setAgentAccountIds('planner', ['acc-openai']);

  const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');
  expect(profile?.accountIds).toEqual(['acc-openai']);
});
```

- [ ] **Step 2: Update `AgentBindingPanel` selectors**

In `src/components/task-hub/AgentBindingPanel.tsx`, add:

```typescript
const setAgentAccountIds = useTaskHubStore((s) => s.setAgentAccountIds);
const getAgentRuntimeProfile = useTaskHubStore((s) => s.getAgentRuntimeProfile);
const profile = getAgentRuntimeProfile(agentId);
```

Replace the local `agent`, `currentRoleCard`, and `boundIds` derivation with:

```typescript
const agent = profile?.agent;
const currentRoleCard = profile?.roleCard ?? null;
const boundIds = profile?.accountIds ?? [];
```

- [ ] **Step 3: Update bind/unbind handlers**

Replace `handleUnbind` and `handleBind` with:

```typescript
const writeAccountBinding = (nextIds: string[]) => {
  if (currentRoleCard) {
    setRoleCardAccountIds(currentRoleCard.id, nextIds);
    return;
  }
  setAgentAccountIds(agentId, nextIds);
};

const handleUnbind = (accountId: string) => {
  writeAccountBinding(boundIds.filter((id) => id !== accountId));
};

const handleBind = (accountId: string) => {
  writeAccountBinding([...boundIds, accountId]);
  setShowAdd(false);
};
```

- [ ] **Step 4: Update AgentBar status dot**

In `src/components/task-hub/AgentBar.tsx`, select the runtime profile:

```typescript
const getAgentRuntimeProfile = useTaskHubStore((s) => s.getAgentRuntimeProfile);
```

Inside the `activeAgents.map`, replace RoleCard-only account status with:

```typescript
const profile = getAgentRuntimeProfile(agent.id);
const roleCard = profile?.roleCard ?? null;
const boundIds = profile?.accountIds ?? [];
const boundCount = boundIds.length;
const hasValidAccount = boundIds.some((id) => {
  const acc = accounts.find((a) => a.id === id);
  return acc?.status === 'valid';
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: pass.

---

### Task 3: Make Role Switching Work for Dynamic Roles

**Files:**
- Modify: `src/store/agentStore.ts`
- Modify: `src/store/taskHubStore.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Add failing role switch test**

Append:

```typescript
it('stores role card switching for dynamic roles in overrides', () => {
  const cardId = useTaskHubStore.getState().roleCards[0].id;

  useTaskHubStore.getState().setAgentRoleCardId('planner', cardId);

  const state = useTaskHubStore.getState();
  expect(state.agentRoleCardOverrides.planner).toBe(cardId);
  expect(state.getAgentRuntimeProfile('planner')?.roleCard?.id).toBe(cardId);
});
```

- [ ] **Step 2: Update `setAgentRoleCardId`**

In `src/store/agentStore.ts`, replace the current implementation with:

```typescript
setAgentRoleCardId: (agentId: string, roleCardId: string) => {
  const idx = AGENT_ROSTER.findIndex((a) => a.id === agentId);
  if (idx !== -1) {
    (AGENT_ROSTER as Agent[])[idx].roleCardId = roleCardId;
  }
  set((state: any) => ({
    agentRoleCardOverrides: {
      ...(state.agentRoleCardOverrides ?? {}),
      [agentId]: roleCardId,
    },
  }));
},
```

- [ ] **Step 3: Apply override in `getEffectiveRoster`**

Inside `getEffectiveRoster()`, before returning active/inactive entries, apply:

```typescript
const withOverride = (agent: Agent): Agent => {
  const overrideRoleCardId = state.agentRoleCardOverrides[agent.id];
  if (!overrideRoleCardId) return agent;
  const card = state.roleCards.find((item: RoleCard) => item.id === overrideRoleCardId);
  return {
    ...agent,
    roleCardId: overrideRoleCardId,
    roleLabel: card?.displayName ?? agent.roleLabel,
  };
};
```

When pushing agents:

```typescript
const resolvedAgent = withOverride(agent);
if (activeIds.has(resolvedAgent.id)) {
  active.push(resolvedAgent);
} else {
  inactive.push(resolvedAgent);
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: pass.

---

### Task 4: Hydrate Skills for Effective Roster IDs

**Files:**
- Modify: `src/store/agentStore.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Add fetch coverage for dynamic role IDs**

Append:

```typescript
it('loads skill assignments for effective roster IDs', async () => {
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === '/api/skills') {
      return new Response(JSON.stringify([{ id: 'skill-1', name: 'Skill 1', content: 'Use skill 1', files: [] }]), { status: 200 });
    }
    if (url === '/api/agents/planner/skills') {
      return new Response(JSON.stringify([{ id: 'skill-1', name: 'Skill 1', content: 'Use skill 1', files: [] }]), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;

  try {
    await useTaskHubStore.getState().loadSkills();
  } finally {
    global.fetch = originalFetch;
  }

  expect(calls).toContain('/api/agents/planner/skills');
  expect(useTaskHubStore.getState().agentSkillIds.planner).toEqual(['skill-1']);
});
```

- [ ] **Step 2: Update `loadSkills()`**

In `src/store/agentStore.ts`, replace:

```typescript
const agentIds = AGENT_ROSTER.map((a) => a.id);
```

with:

```typescript
const effectiveRoster = typeof get().getEffectiveRoster === 'function'
  ? get().getEffectiveRoster()
  : AGENT_ROSTER;
const agentIds = Array.from(new Set(effectiveRoster.map((a: Agent) => a.id)));
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: pass.

---

### Task 5: Dispatch Dynamic Team Roles Through Runtime Profile

**Files:**
- Modify: `src/store/daemonStore.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Add a dispatch resolution unit test**

Append:

```typescript
it('runtime profile provides account IDs needed by dispatch for a dynamic role', () => {
  useTaskHubStore.getState().setAgentAccountIds('planner', ['acc-openai']);

  const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

  expect(profile?.agent.id).toBe('planner');
  expect(profile?.accountIds).toEqual(['acc-openai']);
});
```

- [ ] **Step 2: Update `dispatchToAgent()`**

In `src/store/daemonStore.ts`, replace the `AGENT_ROSTER.find(...)` and `effectiveIds` block with:

```typescript
const profile = get().getAgentRuntimeProfile(agentId);
const agent = profile?.agent;
const effectiveIds = profile?.accountIds ?? [];
const resolvedBinding = agent ? resolveAgentEngine({ ...agent, accountIds: effectiveIds }, get().accounts) : null;
const agentEngine = agent?.cliEngine ?? 'opencode';
const resolvedEngine = resolvedBinding?.engine ?? agentEngine;
const roleCard = profile?.roleCard;
```

Use `roleCard` in `composeOpts`.

- [ ] **Step 3: Update current load composition**

Replace current load source:

```typescript
AGENT_ROSTER.map((rosterAgent) => [
```

with:

```typescript
get().getEffectiveRoster().map((rosterAgent: Agent) => [
```

- [ ] **Step 4: Update `simulateCliExecution()` the same way**

Use the same runtime profile block in `simulateCliExecution()` so manual simulation does not diverge from real dispatch.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts
pnpm test -- src/__tests__/store/team-pack-roster.test.ts src/__tests__/store/account-binding.test.ts
```

Expected: pass.

---

### Task 6: Update Documentation and Run Gates

**Files:**
- Modify: `docs/superpowers/specs/2026-05-05-team-pack-ecosystem-status.md`
- Modify: `specs/team-role-card-compatibility/checklist.md`

- [ ] **Step 1: Update ecosystem status doc**

Add a subsection under `四、技术债务`:

```markdown
### 4.4 Team Pack 角色与旧角色卡绑定兼容

**问题**：动态 Team Pack 角色已能显示在 AgentBar，但旧的账号、技能、角色卡切换、dispatch 链路仍有部分路径依赖 `AGENT_ROSTER` 或已存在的 RoleCard。

**方案**：通过 `getAgentRuntimeProfile(agentId)` 统一解析运行时角色。解析器优先读取 `getEffectiveRoster()`，再应用 `agentRoleCardOverrides`、RoleCard 账号、agent 账号覆盖和技能绑定。UI 与 dispatch 共用该解析器，保证 Team Pack 角色和预设角色行为一致。
```

- [ ] **Step 2: Run verification**

Run:

```bash
pnpm test -- src/__tests__/store/team-role-card-compatibility.test.ts
pnpm test -- src/__tests__/store/team-pack-roster.test.ts src/__tests__/store/account-binding.test.ts
pnpm tsc --noEmit
```

Expected: all pass.

- [ ] **Step 3: Manual verification**

Start the app:

```bash
pnpm dev
```

Manual checks:

- Create a project with `工程三件套`.
- Confirm AgentBar shows `规划师`, `实现者`, `审查者`.
- Click `规划师` avatar.
- Bind an existing model account.
- Add a skill.
- Switch to an existing role card.
- Dispatch a message to `@planner`.
- Confirm the terminal start payload includes the selected account and prompt contains Team Pack context.

---

## Self-Review

- Spec coverage: covers avatar click, account binding, skills, role card switching, dispatch, and docs.
- Placeholder scan: no deferred-work markers.
- Type consistency: `agentRoleCardOverrides`, `getAgentRuntimeProfile`, `AgentRuntimeProfile`, `accountIds`, and `skills` names are consistent across tasks.
