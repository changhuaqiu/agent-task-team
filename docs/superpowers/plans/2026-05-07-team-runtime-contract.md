# Team Runtime Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared Team Runtime Contract layer so UI, prompt composition, dispatch, skill hydration, A2A, and workflow decisions all resolve the same project-level team facts.

**Architecture:** Add `src/lib/team-runtime/` as a pure domain resolver layer. Existing store helpers delegate to it first, then PromptComposer, `/api/state`, A2A, and workflow dispatch are migrated to consume the contract instead of rebuilding team identity from `AGENT_ROSTER` or TeamPack roles independently.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zustand 5, Vitest, SQLite repositories, Socket.io daemon.

---

## Preconditions

- The worktree currently has unrelated uncommitted TeamPack and role-binding changes. Do not revert or overwrite them.
- Run `git status --short` before each task and only stage files explicitly owned by that task.
- Keep the spec in `specs/team-runtime-contract/` as the contract source.

## File Structure

- Create `src/lib/team-runtime/types.ts`: runtime contract interfaces and input context types.
- Create `src/lib/team-runtime/resolveTeamRuntime.ts`: pure resolver for preset roster and TeamPack roster.
- Create `src/lib/team-runtime/resolveRuntimeAgentProfile.ts`: pure resolver for roleCard, account IDs, skills, and execution engine.
- Create `src/lib/team-runtime/resolveCommunicationPolicy.ts`: TeamPack communication matrix policy.
- Create `src/lib/team-runtime/resolveWorkflowPolicy.ts`: `TeamModeEngine` adapter.
- Create `src/lib/team-runtime/index.ts`: public exports.
- Create `src/__tests__/lib/team-runtime/team-runtime.test.ts`: contract resolver tests.
- Modify `src/store/taskHubStore.ts`: delegate `getEffectiveRoster()` and `getAgentRuntimeProfile()` to `team-runtime`.
- Modify `src/store/daemonStore.ts`: dispatch using `RuntimeAgentProfile` and pass runtime roster to PromptComposer.
- Modify `src/lib/agent-context/PromptComposer.ts`: accept runtime roster and remove static TeamLayer dependency on `AGENT_ROSTER`.
- Modify `src/pages/api/state.ts`: stop hardcoding only preset agent IDs for skill hydration.
- Modify A2A files after identifying the current dispatch point: expected files are `src/server/a2a/orchestrator.ts`, `src/server/a2a/scanner.ts`, or `src/server/a2a/context-builder.ts`.
- Modify docs after code lands: `docs/wiki/01-architecture.md`, `docs/wiki/03-store-model.md`, `docs/wiki/04-backend-daemon.md`, and the relevant TeamPack/RoleCard product doc.

---

### Task 1: Create Team Runtime Contract Types

**Files:**
- Create: `src/lib/team-runtime/types.ts`
- Create: `src/lib/team-runtime/index.ts`
- Test: `src/__tests__/lib/team-runtime/team-runtime.test.ts`

- [ ] **Step 1: Write the failing type/import smoke test**

Create `src/__tests__/lib/team-runtime/team-runtime.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { TeamRuntime, RuntimeAgent, RuntimeAgentProfile } from '@/lib/team-runtime';

describe('team-runtime public contract', () => {
  it('exports runtime contract types through the public index', () => {
    const agent: RuntimeAgent = {
      id: 'planner',
      displayName: 'Planner',
      source: 'team-pack-role',
      accountIds: [],
      skills: [],
    };

    const runtime: TeamRuntime = {
      conversationId: 'conv-1',
      roster: [agent],
      communicationPolicy: {
        canSend: () => true,
        explainBlock: () => undefined,
      },
      workflowPolicy: {
        assignInitialTask: () => null,
        getNextAgent: () => null,
      },
    };

    const profile: RuntimeAgentProfile = {
      agent,
      execution: { engine: 'opencode' },
      prompt: { skills: [], roster: runtime.roster },
    };

    expect(profile.agent.id).toBe('planner');
    expect(runtime.roster).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts
```

Expected: FAIL because `@/lib/team-runtime` does not exist.

- [ ] **Step 3: Add contract types**

Create `src/lib/team-runtime/types.ts`:

```typescript
import type { AgentTheme } from '@/store/agentStore';
import type { CliEngine } from '@/server/types';
import type { RoleCard } from '@/types/roleCard';
import type { TeamPack } from '@/types/teamPack';
import type { SkillSummary } from '@/lib/agent-context/PromptComposer';

export type RuntimeAgentSource = 'preset-agent' | 'team-pack-role';

export interface RuntimeAgent {
  id: string;
  displayName: string;
  source: RuntimeAgentSource;
  roleCardId?: string;
  roleCard?: RoleCard;
  accountIds: string[];
  skills: SkillSummary[];
  cliEngine?: CliEngine;
  emoji?: string;
  theme?: AgentTheme;
  canModifyCode?: boolean;
  canReview?: boolean;
}

export interface CommunicationPolicy {
  canSend(fromAgentId: string, toAgentId: string): boolean;
  explainBlock(fromAgentId: string, toAgentId: string): string | undefined;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  roleId: string;
  assignedAt: string;
}

export interface WorkflowPolicy {
  assignInitialTask(task: { id: string; description?: string; status?: string }): TaskAssignment | null;
  getNextAgent(currentAgentId: string, taskResult: unknown): string | null;
}

export interface TeamRuntime {
  conversationId: string;
  teamPack?: TeamPack;
  roster: RuntimeAgent[];
  communicationPolicy: CommunicationPolicy;
  workflowPolicy: WorkflowPolicy;
}

export interface RuntimeAgentProfile {
  agent: RuntimeAgent;
  execution: {
    engine: CliEngine;
    accountId?: string;
    runtimeId?: string;
  };
  prompt: {
    roleCard?: RoleCard;
    skills: SkillSummary[];
    teamPack?: TeamPack;
    roster: RuntimeAgent[];
  };
}
```

Create `src/lib/team-runtime/index.ts`:

```typescript
export type {
  CommunicationPolicy,
  RuntimeAgent,
  RuntimeAgentProfile,
  RuntimeAgentSource,
  TaskAssignment,
  TeamRuntime,
  WorkflowPolicy,
} from './types';
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-runtime/types.ts src/lib/team-runtime/index.ts src/__tests__/lib/team-runtime/team-runtime.test.ts
git commit -m "feat: add team runtime contract types"
```

---

### Task 2: Implement Pure Runtime Resolution

**Files:**
- Create: `src/lib/team-runtime/resolveCommunicationPolicy.ts`
- Create: `src/lib/team-runtime/resolveWorkflowPolicy.ts`
- Create: `src/lib/team-runtime/resolveTeamRuntime.ts`
- Modify: `src/lib/team-runtime/index.ts`
- Test: `src/__tests__/lib/team-runtime/team-runtime.test.ts`

- [ ] **Step 1: Add failing resolver tests**

Append to `src/__tests__/lib/team-runtime/team-runtime.test.ts`:

```typescript
import { resolveTeamRuntime } from '@/lib/team-runtime';
import type { Agent } from '@/store/agentStore';
import type { TeamPack } from '@/types/teamPack';

const presetAgent: Agent = {
  id: 'mario',
  name: 'Mario',
  role: 'planner',
  roleLabel: 'Planner',
  roleCardId: 'rc-planner',
  theme: 'mario',
  emoji: '⭐',
  isOnline: true,
  accountIds: ['acc-agent'],
};

const teamPack: TeamPack = {
  id: 'pack-1',
  specVersion: 'team-pack/0.1',
  name: 'engineering-trio',
  displayName: 'Engineering Trio',
  description: 'Planner coder reviewer',
  version: '1.0.0',
  tags: [],
  category: 'engineering',
  roles: [
    { id: 'planner', displayName: 'Planner', soul: '', required: true, accountIds: ['acc-team'] },
    { id: 'reviewer', displayName: 'Reviewer', soul: '', required: true },
  ],
  teamMode: 'pipeline',
  workflow: {
    type: 'linear',
    steps: [
      { role: 'planner', action: 'plan', output: 'plan' },
      { role: 'reviewer', action: 'review', output: 'review' },
    ],
  },
  communicationMatrix: {
    planner: { canSendTo: ['reviewer'], canReceiveFrom: [] },
    reviewer: { canSendTo: [], canReceiveFrom: ['planner'] },
  },
  isPreset: false,
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
};

describe('resolveTeamRuntime', () => {
  it('uses preset roster when no TeamPack is bound', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-plain',
      presetAgents: [presetAgent],
      activeAgentIds: ['mario'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.roster).toEqual([
      expect.objectContaining({
        id: 'mario',
        displayName: 'Mario',
        source: 'preset-agent',
      }),
    ]);
  });

  it('uses TeamPack roles as the primary runtime roster when a TeamPack is bound', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner', 'reviewer'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.roster.map((agent) => agent.id)).toEqual(['planner', 'reviewer']);
    expect(runtime.roster[0]).toMatchObject({
      id: 'planner',
      displayName: 'Planner',
      source: 'team-pack-role',
      accountIds: ['acc-team'],
    });
  });

  it('enforces communication matrix for TeamPack runtime', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner', 'reviewer'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.communicationPolicy.canSend('planner', 'reviewer')).toBe(true);
    expect(runtime.communicationPolicy.canSend('reviewer', 'planner')).toBe(false);
    expect(runtime.communicationPolicy.explainBlock('reviewer', 'planner')).toBe('团队协作规则阻止了这次转交');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts
```

Expected: FAIL because `resolveTeamRuntime` is not exported.

- [ ] **Step 3: Implement policies and runtime resolver**

Create `src/lib/team-runtime/resolveCommunicationPolicy.ts`:

```typescript
import type { CommunicationPolicy } from './types';
import type { TeamPack } from '@/types/teamPack';

const BLOCK_REASON = '团队协作规则阻止了这次转交';

export function resolveCommunicationPolicy(teamPack?: TeamPack): CommunicationPolicy {
  return {
    canSend(fromAgentId: string, toAgentId: string) {
      if (!teamPack) return true;
      const row = teamPack.communicationMatrix[fromAgentId];
      if (!row) return false;
      return row.canSendTo.includes(toAgentId);
    },
    explainBlock(fromAgentId: string, toAgentId: string) {
      if (this.canSend(fromAgentId, toAgentId)) return undefined;
      return BLOCK_REASON;
    },
  };
}
```

Create `src/lib/team-runtime/resolveWorkflowPolicy.ts`:

```typescript
import { TeamModeEngine } from '@/lib/orchestration/TeamModeEngine';
import type { TeamPack } from '@/types/teamPack';
import type { WorkflowPolicy } from './types';

export function resolveWorkflowPolicy(teamPack: TeamPack | undefined, availableAgentIds: string[]): WorkflowPolicy {
  return {
    assignInitialTask(task) {
      if (!teamPack) return null;
      const engine = new TeamModeEngine();
      return engine.assignTask(
        {
          id: task.id,
          description: task.description ?? '',
          status: task.status === 'done' ? 'completed' : 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        teamPack,
        availableAgentIds,
      );
    },
    getNextAgent(currentAgentId, taskResult) {
      if (!teamPack) return null;
      const engine = new TeamModeEngine();
      return engine.getNextRole(currentAgentId, taskResult, teamPack, availableAgentIds);
    },
  };
}
```

Create `src/lib/team-runtime/resolveTeamRuntime.ts`:

```typescript
import type { Agent } from '@/store/agentStore';
import type { RoleCard } from '@/types/roleCard';
import type { TeamPack } from '@/types/teamPack';
import type { SkillSummary } from '@/lib/agent-context/PromptComposer';
import type { RuntimeAgent, TeamRuntime } from './types';
import { resolveCommunicationPolicy } from './resolveCommunicationPolicy';
import { resolveWorkflowPolicy } from './resolveWorkflowPolicy';

export interface ResolveTeamRuntimeInput {
  conversationId: string;
  teamPack?: TeamPack;
  presetAgents: Agent[];
  activeAgentIds: string[];
  roleCards: RoleCard[];
  skillsMap: Record<string, SkillSummary>;
  agentSkillIds: Record<string, string[]>;
  agentAccountOverrides: Record<string, string[]>;
  agentRoleCardOverrides: Record<string, string>;
}

function skillsFromIds(ids: string[] | undefined, skillsMap: Record<string, SkillSummary>): SkillSummary[] {
  return Array.from(new Set(ids ?? [])).map((id) => skillsMap[id]).filter(Boolean);
}

function roleCardById(roleCards: RoleCard[], id: string | undefined): RoleCard | undefined {
  if (!id) return undefined;
  return roleCards.find((card) => card.id === id);
}

function presetRuntimeAgent(agent: Agent, input: ResolveTeamRuntimeInput): RuntimeAgent {
  const roleCardId = input.agentRoleCardOverrides[agent.id] ?? agent.roleCardId;
  const roleCard = roleCardById(input.roleCards, roleCardId);
  const accountIds = roleCard?.accountIds?.length
    ? roleCard.accountIds
    : (input.agentAccountOverrides[agent.id] ?? agent.accountIds ?? []);
  return {
    id: agent.id,
    displayName: roleCard?.displayName ?? agent.name,
    source: 'preset-agent',
    roleCardId,
    roleCard,
    accountIds,
    skills: skillsFromIds(input.agentSkillIds[agent.id], input.skillsMap),
    cliEngine: agent.cliEngine,
    emoji: agent.emoji,
    theme: agent.theme,
  };
}

function teamRoleRuntimeAgents(input: ResolveTeamRuntimeInput): RuntimeAgent[] {
  const teamPack = input.teamPack;
  if (!teamPack) return [];
  return teamPack.roles.map((role) => {
    const overrideRoleCardId = input.agentRoleCardOverrides[role.id];
    const roleCardId = role.roleCardId ?? overrideRoleCardId;
    const globalRoleCard = roleCardById(input.roleCards, roleCardId);
    const roleCard = role.roleCardSnapshot
      ? {
          ...role.roleCardSnapshot,
          id: `team-role-snapshot-${role.id}`,
          isPreset: false,
          version: role.roleCardSnapshot.snapshotVersion,
          createdAt: role.roleCardSnapshot.snapshottedAt,
          updatedAt: role.roleCardSnapshot.snapshottedAt,
        }
      : globalRoleCard;
    const accountIds = role.accountIds?.length
      ? role.accountIds
      : roleCard?.accountIds?.length
      ? roleCard.accountIds
      : (input.agentAccountOverrides[role.id] ?? []);

    return {
      id: role.id,
      displayName: roleCard?.displayName ?? role.displayName,
      source: 'team-pack-role',
      roleCardId: roleCard?.id ?? roleCardId,
      roleCard,
      accountIds,
      skills: skillsFromIds([...(role.skillIds ?? []), ...(input.agentSkillIds[role.id] ?? [])], input.skillsMap),
    };
  });
}

export function resolveTeamRuntime(input: ResolveTeamRuntimeInput): TeamRuntime {
  const roster = input.teamPack
    ? teamRoleRuntimeAgents(input)
    : input.presetAgents.map((agent) => presetRuntimeAgent(agent, input));

  const active = new Set(input.activeAgentIds);
  const orderedRoster = [
    ...roster.filter((agent) => active.has(agent.id)),
    ...roster.filter((agent) => !active.has(agent.id)),
  ];

  return {
    conversationId: input.conversationId,
    teamPack: input.teamPack,
    roster: orderedRoster,
    communicationPolicy: resolveCommunicationPolicy(input.teamPack),
    workflowPolicy: resolveWorkflowPolicy(input.teamPack, orderedRoster.map((agent) => agent.id)),
  };
}
```

Update `src/lib/team-runtime/index.ts`:

```typescript
export { resolveCommunicationPolicy } from './resolveCommunicationPolicy';
export { resolveTeamRuntime } from './resolveTeamRuntime';
export type { ResolveTeamRuntimeInput } from './resolveTeamRuntime';
export { resolveWorkflowPolicy } from './resolveWorkflowPolicy';
export type {
  CommunicationPolicy,
  RuntimeAgent,
  RuntimeAgentProfile,
  RuntimeAgentSource,
  TaskAssignment,
  TeamRuntime,
  WorkflowPolicy,
} from './types';
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-runtime src/__tests__/lib/team-runtime/team-runtime.test.ts
git commit -m "feat: resolve team runtime roster and policies"
```

---

### Task 3: Resolve Runtime Agent Profiles

**Files:**
- Create: `src/lib/team-runtime/resolveRuntimeAgentProfile.ts`
- Modify: `src/lib/team-runtime/index.ts`
- Test: `src/__tests__/lib/team-runtime/team-runtime.test.ts`

- [ ] **Step 1: Add failing profile tests**

Append to `src/__tests__/lib/team-runtime/team-runtime.test.ts`:

```typescript
import { resolveRuntimeAgentProfile } from '@/lib/team-runtime';

describe('resolveRuntimeAgentProfile', () => {
  it('resolves execution engine and account from the first enabled account', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    const profile = resolveRuntimeAgentProfile(runtime, 'planner', [
      {
        id: 'acc-team',
        name: 'OpenAI',
        authMode: 'api_key',
        provider: 'openai',
        models: ['gpt-5.4'],
        enabled: true,
        status: 'valid',
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      },
    ]);

    expect(profile).toMatchObject({
      agent: { id: 'planner' },
      execution: { engine: 'codex', accountId: 'acc-team' },
      prompt: { teamPack: { id: 'pack-1' } },
    });
  });

  it('returns null when the runtime agent does not exist', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(resolveRuntimeAgentProfile(runtime, 'ghost', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts
```

Expected: FAIL because `resolveRuntimeAgentProfile` is not exported.

- [ ] **Step 3: Implement profile resolver**

Create `src/lib/team-runtime/resolveRuntimeAgentProfile.ts`:

```typescript
import { providerToEngine, type Account } from '@/store/agentStore';
import type { RuntimeAgentProfile, TeamRuntime } from './types';

export function resolveRuntimeAgentProfile(
  runtime: TeamRuntime,
  agentId: string,
  accounts: Account[],
): RuntimeAgentProfile | null {
  const agent = runtime.roster.find((item) => item.id === agentId);
  if (!agent) return null;

  const enabledAccount = agent.accountIds
    .map((id) => accounts.find((account) => account.id === id && account.enabled))
    .find(Boolean);

  const engine = enabledAccount
    ? providerToEngine(enabledAccount.provider)
    : (agent.cliEngine ?? 'opencode');

  return {
    agent,
    execution: {
      engine,
      accountId: enabledAccount?.id,
    },
    prompt: {
      roleCard: agent.roleCard,
      skills: agent.skills,
      teamPack: runtime.teamPack,
      roster: runtime.roster,
    },
  };
}
```

Update `src/lib/team-runtime/index.ts`:

```typescript
export { resolveCommunicationPolicy } from './resolveCommunicationPolicy';
export { resolveRuntimeAgentProfile } from './resolveRuntimeAgentProfile';
export { resolveTeamRuntime } from './resolveTeamRuntime';
export type { ResolveTeamRuntimeInput } from './resolveTeamRuntime';
export { resolveWorkflowPolicy } from './resolveWorkflowPolicy';
export type {
  CommunicationPolicy,
  RuntimeAgent,
  RuntimeAgentProfile,
  RuntimeAgentSource,
  TaskAssignment,
  TeamRuntime,
  WorkflowPolicy,
} from './types';
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/store/account-binding.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-runtime src/__tests__/lib/team-runtime/team-runtime.test.ts
git commit -m "feat: resolve runtime agent execution profiles"
```

---

### Task 4: Delegate Store Runtime Helpers

**Files:**
- Modify: `src/store/taskHubStore.ts`
- Test: `src/__tests__/store/team-pack-roster.test.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`
- Test: `src/__tests__/lib/team-runtime/team-runtime.test.ts`

- [ ] **Step 1: Add regression assertion for store delegation behavior**

In `src/__tests__/store/team-role-card-compatibility.test.ts`, add an assertion to the existing `resolves a dynamic Team Pack role from effective roster` test:

```typescript
expect(profile?.prompt?.roster?.map((agent) => agent.id)).toContain('planner');
expect(profile?.execution.engine).toBe('opencode');
```

If the current store profile type does not expose `prompt` and `execution`, the test should fail before implementation.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: FAIL because store `getAgentRuntimeProfile()` still returns the older profile shape.

- [ ] **Step 3: Delegate store helpers**

In `src/store/taskHubStore.ts`, import the new resolvers:

```typescript
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { RuntimeAgentProfile } from '@/lib/team-runtime';
import type { AgentRole } from './agentStore';
```

Replace the `AgentRuntimeProfile` interface in `taskHubStore.ts` with the imported type, and update `getEffectiveRoster()` to map runtime roster back to the existing `Agent[]` shape:

```typescript
getEffectiveRoster: () => {
  const state = get();
  const conv = state.conversations.find((c) => c.id === state.selectedConversationId);
  const runtime = resolveTeamRuntime({
    conversationId: conv?.id ?? state.selectedConversationId ?? 'default',
    teamPack: conv?.teamPackId ? state.currentTeamPack ?? undefined : undefined,
    presetAgents: AGENT_ROSTER,
    activeAgentIds: state.activeAgentIds,
    roleCards: state.roleCards,
    skillsMap: state.skillsMap,
    agentSkillIds: state.agentSkillIds,
    agentAccountOverrides: state.agentAccountOverrides,
    agentRoleCardOverrides: state.agentRoleCardOverrides ?? {},
  });

  return runtime.roster.map((agent) => ({
    id: agent.id,
    name: agent.displayName,
    role: 'worker' as AgentRole,
    roleLabel: agent.roleCard?.displayName ?? agent.displayName,
    roleCardId: agent.roleCardId ?? `team-role-${agent.id}`,
    theme: agent.theme ?? 'mario',
    emoji: agent.emoji ?? '🤖',
    isOnline: true,
    cliEngine: agent.cliEngine,
    accountIds: agent.accountIds,
  }));
},
```

Update `getAgentRuntimeProfile()`:

```typescript
getAgentRuntimeProfile: (agentId: string) => {
  const state = get();
  const conv = state.conversations.find((c) => c.id === state.selectedConversationId);
  const runtime = resolveTeamRuntime({
    conversationId: conv?.id ?? state.selectedConversationId ?? 'default',
    teamPack: conv?.teamPackId ? state.currentTeamPack ?? undefined : undefined,
    presetAgents: AGENT_ROSTER,
    activeAgentIds: state.activeAgentIds,
    roleCards: state.roleCards,
    skillsMap: state.skillsMap,
    agentSkillIds: state.agentSkillIds,
    agentAccountOverrides: state.agentAccountOverrides,
    agentRoleCardOverrides: state.agentRoleCardOverrides ?? {},
  });
  return resolveRuntimeAgentProfile(runtime, agentId, state.accounts);
},
```

- [ ] **Step 4: Adjust components for profile shape**

Where components read `profile.accountIds`, change to `profile.agent.accountIds`.

Expected files from current search:

```typescript
// src/components/task-hub/AgentBindingPanel.tsx
const boundIds = profile?.agent.accountIds ?? [];
const currentRoleCard = profile?.prompt.roleCard ?? null;
const currentSkillIds = profile?.prompt.skills
  ? Object.entries(skillsMap)
      .filter(([, skill]) => profile.prompt.skills.some((item) => item.name === skill.name && item.content === skill.content))
      .map(([id]) => id)
  : (agentSkillIds[agentId] ?? []);
```

```typescript
// src/components/task-hub/AgentBar.tsx
const boundCount = profile?.agent.accountIds.length ?? 0;
```

Use `rg -n "profile\\?\\.accountIds|profile\\?\\.roleCard|profile\\.skills" src` and update all matches to the new shape.

- [ ] **Step 5: Run store and component-adjacent tests**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/store/team-pack-roster.test.ts src/__tests__/store/team-role-card-compatibility.test.ts src/__tests__/store/account-binding.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/taskHubStore.ts src/components/task-hub/AgentBindingPanel.tsx src/components/task-hub/AgentBar.tsx src/__tests__/store/team-role-card-compatibility.test.ts
git commit -m "refactor: delegate store runtime profiles"
```

---

### Task 5: Dispatch and Prompt Use Runtime Profile

**Files:**
- Modify: `src/store/daemonStore.ts`
- Modify: `src/lib/agent-context/PromptComposer.ts`
- Test: `src/__tests__/agent-context/promptComposer.test.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts`

- [ ] **Step 1: Add failing PromptComposer test**

In `src/__tests__/agent-context/promptComposer.test.ts`, add:

```typescript
import { composeUserPrompt } from '@/lib/agent-context/PromptComposer';

it('uses runtime roster when building the team layer', () => {
  const prompt = composeUserPrompt({
    agent: { id: 'planner', name: 'Planner' },
    allRoleCards: [],
    project: { name: 'Runtime Project', path: '/tmp/runtime' },
    isFirstWake: false,
    rawPrompt: 'Plan this work',
    runtimeRoster: [
      { id: 'planner', displayName: 'Planner', source: 'team-pack-role', accountIds: [], skills: [] },
      { id: 'reviewer', displayName: 'Reviewer', source: 'team-pack-role', accountIds: [], skills: [] },
    ],
  });

  expect(prompt).toContain('Planner');
  expect(prompt).toContain('Reviewer');
});
```

- [ ] **Step 2: Run PromptComposer test to verify failure**

Run:

```bash
pnpm vitest run src/__tests__/agent-context/promptComposer.test.ts
```

Expected: FAIL because `ComposeOptions` does not accept `runtimeRoster` and TeamLayer still uses static role cards.

- [ ] **Step 3: Update PromptComposer options and TeamLayer input**

In `src/lib/agent-context/PromptComposer.ts`, import the runtime type:

```typescript
import type { RuntimeAgent } from '@/lib/team-runtime';
```

Add to `ComposeOptions`:

```typescript
runtimeRoster?: RuntimeAgent[];
```

Update `composeSystemPrompt()` project status roster:

```typescript
const rosterForStatus = opts.runtimeRoster?.map((a) => ({
  id: a.id,
  name: a.displayName,
  emoji: a.emoji ?? '🤖',
})) ?? AGENT_ROSTER.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji }));
```

Use `rosterForStatus` in `buildProjectStatusLayer()`.

Update `composeUserPrompt()` TeamLayer input. If `buildTeamLayer()` only accepts role cards today, add a small adapter in PromptComposer:

```typescript
const team = opts.runtimeRoster?.length
  ? [
      '## 当前团队',
      ...opts.runtimeRoster.map((member) => {
        const marker = member.id === opts.agent.id ? '（当前角色）' : '';
        return `- ${member.displayName} @${member.id}${marker}`;
      }),
    ].join('\n')
  : buildTeamLayer(opts.agent.id, opts.allRoleCards, opts.currentLoad);
```

Keep the rest of `composeUserPrompt()` unchanged.

- [ ] **Step 4: Update daemon dispatch compose options**

In `src/store/daemonStore.ts`, replace old profile usage:

```typescript
const profile = get().getAgentRuntimeProfile(agentId);
const runtimeAgent = profile?.agent;
const effectiveIds = runtimeAgent?.accountIds ?? [];
const resolvedEngine = profile?.execution.engine ?? 'opencode';
const resolvedAccountId = profile?.execution.accountId ?? '';
```

Update compose options:

```typescript
const composeOpts: ComposeOptions = {
  agent: runtimeAgent
    ? { id: runtimeAgent.id, name: runtimeAgent.displayName }
    : { id: agentId, name: agentId },
  roleCard: profile?.prompt.roleCard,
  allRoleCards: get().roleCards,
  project: { name: conv?.title ?? '', path: conv?.projectPath ?? '' },
  isFirstWake,
  messages: get().chatMessagesByConversation[conversationId] ?? [],
  task: task ? {
    id: task.id,
    title: task.title,
    description: task.description,
    phase: phase ? { title: phase.title } : undefined,
  } : undefined,
  rawPrompt: prompt,
  currentLoad: Object.fromEntries(
    (profile?.prompt.roster ?? []).map((rosterAgent) => [
      rosterAgent.id,
      get().tasks.filter(
        (t: any) =>
          t.agentId === rosterAgent.id &&
          (t.status === 'in_progress' || t.status === 'pending'),
      ).length,
    ]),
  ),
  tasks: get().tasks
    .filter((t: any) => t.conversationId === conversationId)
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      agentId: t.agentId,
      status: t.status,
    })),
  skills: profile?.prompt.skills ?? [],
  runtimeRoster: profile?.prompt.roster ?? [],
  a2a: source === 'a2a' && fromAgentId ? {
    from: fromAgentId,
    content: prompt,
  } : undefined,
  teamPack: profile?.prompt.teamPack,
};
```

Update socket payload:

```typescript
socket.emit('terminal:start', {
  projectId,
  taskId: referencedTaskId,
  conversationId,
  agentId,
  prompt: effectivePrompt,
  systemPrompt,
  sessionId,
  allowMockRunner: get().enableMockRunner,
  opencodeBridgeUrl: undefined,
  engine: resolvedEngine,
  accountIds: effectiveIds,
  accountId: resolvedAccountId,
});
```

Apply the same profile-shape update to `simulateCliExecution()`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run src/__tests__/agent-context/promptComposer.test.ts src/__tests__/store/team-role-card-compatibility.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/daemonStore.ts src/lib/agent-context/PromptComposer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "refactor: compose and dispatch from runtime profiles"
```

---

### Task 6: API State Skill Hydration

**Files:**
- Modify: `src/pages/api/state.ts`
- Test: `src/__tests__/api/state/state.test.ts`
- Possibly modify: `src/server/repositories/skill-repo.ts`

- [ ] **Step 1: Add failing API test**

In `src/__tests__/api/state/state.test.ts`, add a test that seeds or mocks a dynamic agent skill binding for `planner` and expects it in `/api/state`:

```typescript
it('returns dynamic agent skill bindings instead of only preset agent IDs', async () => {
  const { skillRepo } = await import('@/server/repositories/skill-repo');
  const skill = skillRepo.create({
    name: 'Planner Skill',
    content: 'Use planner skill.',
    files: [],
  });
  skillRepo.setAgentSkills('planner', [skill.id]);

  const req = mockReq('GET');
  const res = mockRes();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res._json.agentSkillIds.planner).toEqual([skill.id]);
});
```

This uses the existing `skillRepo.setAgentSkills()` helper.

- [ ] **Step 2: Run the API state test**

Run:

```bash
pnpm vitest run src/__tests__/api/state/state.test.ts
```

Expected: FAIL because `/api/state` only returns preset IDs.

- [ ] **Step 3: Add repository helper if needed**

If `skillRepo` lacks a list-all-bindings helper, add this to `src/server/repositories/skill-repo.ts`:

```typescript
getAllAgentSkillIds(): Record<string, string[]> {
  const rows = getDb().prepare('SELECT agent_id, skill_id FROM agent_skill ORDER BY agent_id, skill_id').all() as {
    agent_id: string;
    skill_id: string;
  }[];
  const result: Record<string, string[]> = {};
  for (const row of rows) {
    result[row.agent_id] = [...(result[row.agent_id] ?? []), row.skill_id];
  }
  return result;
}
```

- [ ] **Step 4: Update `/api/state`**

Replace the hardcoded block in `src/pages/api/state.ts`:

```typescript
agentSkillIds: Object.fromEntries(
  ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'].map((id) => [
    id,
    skillRepo.getSkillIdsForAgent(id),
  ]),
),
```

with:

```typescript
agentSkillIds: typeof skillRepo.getAllAgentSkillIds === 'function'
  ? skillRepo.getAllAgentSkillIds()
  : {},
```

If TypeScript rejects feature detection, call the new helper directly:

```typescript
agentSkillIds: skillRepo.getAllAgentSkillIds(),
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm vitest run src/__tests__/api/state/state.test.ts src/__tests__/api/skills/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/state.ts src/server/repositories/skill-repo.ts src/__tests__/api/state/state.test.ts
git commit -m "fix: hydrate dynamic agent skill bindings"
```

---

### Task 7: A2A Communication Policy Integration

**Status:** Implemented on 2026-05-08. A2A agent-to-agent mention dispatch now accepts an optional Team Runtime `CommunicationPolicy` through `KanbanSnapshotProvider.getCommunicationPolicy(conversationId)`, blocks disallowed handoffs before worklist insertion, records `dispatch_blocked`, and emits the existing non-silent system event. Direct user-to-agent dispatch remains allowed.

**Files:**
- Inspect and modify the actual A2A dispatch file found by `rg -n "AgentMessenger|requestDispatch|onAgentDone|@mention|mention" src/server/a2a src/server/daemon.ts`.
- Expected modify: `src/server/a2a/orchestrator.ts`
- Expected modify: `src/server/a2a/scanner.ts`
- Test: `src/__tests__/server/a2a/integration.test.ts` or `src/__tests__/server/a2a/scanner.test.ts`

- [x] **Step 1: Locate the A2A enqueue decision**

Run:

```bash
rg -n "AgentMessenger|requestDispatch|onAgentDone|mention|worklist|mailbox|dispatch" src/server/a2a src/server/daemon.ts
```

Expected: Identify the single function that turns a detected mention into a mailbox/worklist/dispatch entry.

- [x] **Step 2: Add failing policy test**

In the A2A test file closest to the enqueue function, add a test with a TeamPack communication matrix:

```typescript
it('blocks A2A dispatch when TeamPack communication policy disallows the target', () => {
  const runtime = resolveTeamRuntime({
    conversationId: 'conv-a2a',
    teamPack: {
      id: 'pack-a2a',
      specVersion: 'team-pack/0.1',
      name: 'a2a-pack',
      displayName: 'A2A Pack',
      description: '',
      version: '1.0.0',
      tags: [],
      category: 'test',
      roles: [
        { id: 'planner', displayName: 'Planner', soul: '', required: true },
        { id: 'reviewer', displayName: 'Reviewer', soul: '', required: true },
      ],
      teamMode: 'pipeline',
      workflow: { type: 'linear' },
      communicationMatrix: {
        planner: { canSendTo: [], canReceiveFrom: [] },
        reviewer: { canSendTo: [], canReceiveFrom: [] },
      },
      isPreset: false,
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
    },
    presetAgents: [],
    activeAgentIds: ['planner', 'reviewer'],
    roleCards: [],
    skillsMap: {},
    agentSkillIds: {},
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
  });

  expect(runtime.communicationPolicy.canSend('planner', 'reviewer')).toBe(false);
  expect(runtime.communicationPolicy.explainBlock('planner', 'reviewer')).toBe('团队协作规则阻止了这次转交');
});
```

This first test can live in `src/__tests__/lib/team-runtime/team-runtime.test.ts` if the server A2A code is hard to isolate. Then add an integration test once the enqueue function accepts policy input.

- [x] **Step 3: Wire communication policy into enqueue**

At the A2A enqueue decision point, resolve or accept a `CommunicationPolicy`. The implementation should perform this check before inserting mailbox/worklist rows:

```typescript
if (!communicationPolicy.canSend(fromAgentId, toAgentId)) {
  audit({
    conversationId,
    eventType: 'a2a.blocked',
    fromAgentId,
    toAgentId,
    reason: communicationPolicy.explainBlock(fromAgentId, toAgentId),
  });
  return { allowed: false, reason: communicationPolicy.explainBlock(fromAgentId, toAgentId) };
}
```

If the current A2A path cannot access TeamPack yet, pass `CommunicationPolicy` from daemon/store in the narrowest existing boundary rather than importing UI store into server code.

- [x] **Step 4: Run A2A tests**

Run:

```bash
pnpm vitest run src/__tests__/server/a2a/scanner.test.ts src/__tests__/server/a2a/integration.test.ts src/__tests__/lib/team-runtime/team-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/a2a src/server/daemon.ts src/__tests__/server/a2a src/__tests__/lib/team-runtime/team-runtime.test.ts
git commit -m "feat: enforce team communication policy for a2a"
```

---

### Task 8: Workflow Policy Real Decision Path

**Files:**
- Modify a task assignment path after inspection.
- Expected modify: `src/store/taskStore.ts` or `src/store/daemonStore.ts`
- Test: `src/__tests__/store/team-role-card-compatibility.test.ts` or a new `src/__tests__/lib/team-runtime/workflow-policy.test.ts`

- [x] **Step 1: Add focused workflow test**

Add to `src/__tests__/lib/team-runtime/team-runtime.test.ts`:

```typescript
it('delegates initial task assignment to TeamModeEngine through workflow policy', () => {
  const runtime = resolveTeamRuntime({
    conversationId: 'conv-workflow',
    teamPack,
    presetAgents: [presetAgent],
    activeAgentIds: ['planner', 'reviewer'],
    roleCards: [],
    skillsMap: {},
    agentSkillIds: {},
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
  });

  const assignment = runtime.workflowPolicy.assignInitialTask({
    id: 'TASK-001',
    description: 'Plan and review this work',
    status: 'pending',
  });

  expect(assignment).toMatchObject({
    taskId: 'TASK-001',
    agentId: 'planner',
    roleId: 'planner',
  });
});
```

- [x] **Step 2: Run test**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts
```

Expected: PASS if Task 2 already implemented the adapter. If it fails, fix `resolveWorkflowPolicy.ts`.

- [x] **Step 3: Wire one real path**

Choose the least invasive existing path. Recommended: in task creation/confirmation where `DispatchAdvisor` assigns tasks, when a selected conversation has `teamPackId`, resolve runtime and ask `workflowPolicy.assignInitialTask()` before falling back to advisor.

The integration should look like:

```typescript
const runtime = resolveTeamRuntime({
  conversationId,
  teamPack: currentTeamPack ?? undefined,
  presetAgents: AGENT_ROSTER,
  activeAgentIds: get().activeAgentIds,
  roleCards: get().roleCards,
  skillsMap: get().skillsMap,
  agentSkillIds: get().agentSkillIds,
  agentAccountOverrides: get().agentAccountOverrides,
  agentRoleCardOverrides: get().agentRoleCardOverrides ?? {},
});
const assignment = runtime.workflowPolicy.assignInitialTask({
  id: taskId,
  description,
  status: 'pending',
});
const agentId = assignment?.agentId ?? advisorSuggestedAgentId;
```

- [x] **Step 4: Run related tests**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/store/team-role-card-compatibility.test.ts src/__tests__/project/kanban-integration.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/store/taskStore.ts src/store/taskHubStore.ts src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/store/team-role-card-compatibility.test.ts
git commit -m "feat: route team assignments through workflow policy"
```

---

### Task 9: Documentation and Spec Sync

**Files:**
- Modify: `docs/wiki/01-architecture.md`
- Modify: `docs/wiki/03-store-model.md`
- Modify: `docs/wiki/04-backend-daemon.md`
- Modify: `docs/product/business/2026-05-05-role-card-ecosystem-analysis.md`
- Modify: `specs/team-runtime-contract/checklist.md`

- [x] **Step 1: Update architecture doc**

In `docs/wiki/01-architecture.md`, add Team Runtime Contract between Store and Repositories:

```markdown
### Team Runtime Contract

Team Runtime Contract 是项目级协作内核。它从 Conversation、TeamPack、RoleCard、Account、Skill 和 preset roster 解析出当前项目可运行团队，供 UI、PromptComposer、Dispatch、A2A 和 workflow policy 共同使用。
```

- [x] **Step 2: Update store model doc**

In `docs/wiki/03-store-model.md`, add:

```markdown
Store 缓存 TeamRuntime 的结果，但不拥有团队解析规则。团队解析规则位于 `src/lib/team-runtime/`，store helper 只负责把当前 state 传入 resolver 并把结果提供给 UI。
```

- [x] **Step 3: Update daemon doc**

In `docs/wiki/04-backend-daemon.md`, add:

```markdown
Daemon 接收已经解析好的 `engine`、`accountId`、`prompt` 和 `systemPrompt`。TeamPack workflow、通信规则和角色解析不在 daemon 内解释，daemon 只负责执行上下文、session、invocation、credential、timeout、backend 和事件转发。
```

- [x] **Step 4: Update product doc**

In `docs/product/business/2026-05-05-role-card-ecosystem-analysis.md`, add:

```markdown
TeamRuntime 是 TeamPack 落地为可运行团队的产品边界：用户看到的是团队、角色、账号、技能和协作规则；系统内部通过 TeamRuntime 把这些对象解析为统一运行时。
```

- [x] **Step 5: Update checklist**

In `specs/team-runtime-contract/checklist.md`, mark only completed items as checked after verifying code and tests.

- [x] **Step 6: Run docs/spec grep**

Run:

```bash
rg -n "Team Runtime|TeamRuntime|team-runtime|runtime fact source|AGENT_ROSTER" docs/wiki docs/product specs/team-runtime-contract
```

Expected: The docs consistently describe Team Runtime as the collaboration kernel, and any `AGENT_ROSTER` mention is framed as preset fallback only.

- [ ] **Step 7: Commit**

```bash
git add docs/wiki/01-architecture.md docs/wiki/03-store-model.md docs/wiki/04-backend-daemon.md docs/product/business/2026-05-05-role-card-ecosystem-analysis.md specs/team-runtime-contract/checklist.md
git commit -m "docs: document team runtime contract implementation"
```

---

### Task 10: Final Verification

**Files:**
- No code changes expected.

- [x] **Step 1: Run targeted test suite**

Run:

```bash
pnpm vitest run src/__tests__/lib/team-runtime/team-runtime.test.ts src/__tests__/store/team-pack-roster.test.ts src/__tests__/store/team-role-card-compatibility.test.ts src/__tests__/store/account-binding.test.ts src/__tests__/agent-context/promptComposer.test.ts src/__tests__/api/state/state.test.ts src/__tests__/server/a2a/scanner.test.ts src/__tests__/server/a2a/integration.test.ts
```

Expected: PASS.

- [x] **Step 2: Run typecheck**

Run:

```bash
pnpm tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [x] **Step 3: Run full tests if targeted suite passes**

Run:

```bash
pnpm test
```

Expected: PASS. If unrelated pre-existing failures appear, capture exact failing test names and evidence before final handoff.

- [ ] **Step 4: Inspect runtime terminology in primary UX**

Run:

```bash
rg -n "runtime|channel|routing|bridge|providerHints|session" src/components src/app
```

Expected: No new primary UX copy exposes these terms. Technical files and developer-only docs may still contain them.

- [ ] **Step 5: Final git status**

Run:

```bash
git status --short
```

Expected: Only intentionally uncommitted user changes remain, or the working tree is clean if all task commits were made.
