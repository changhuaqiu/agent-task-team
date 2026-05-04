# Intelligent Dispatch System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Mario (planner) to intelligently dispatch tasks to the right agent based on structured capability profiles and a programmatic matching engine.

**Architecture:** Add a `CapabilityProfile` dimension to RoleCards, create a `DispatchAdvisor` module that ranks agents per task using keyword-based domain/skill matching, and enhance TeamLayer + RoleLayer prompts to give Mario full team awareness. The advisor runs between Mario's breakdown output and final dispatch — programmatic matching as a safety net, LLM flexibility preserved.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM (SQLite), existing PromptComposer layers

**Spec:** `docs/superpowers/specs/2026-05-04-intelligent-dispatch-design.md`

**Phases:**
- Phase 1 (Tasks 1–8): Core intelligence — capability types, matching engine, prompt enhancements, project status layer, integration
- Phase 2 (Tasks 9–11): Configurable roles — DB persistence, dynamic mention parsing

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/types/capabilityProfile.ts` | CapabilityProfile type + DOMAIN_KEYWORDS |
| Modify | `src/types/roleCard.ts:28` | Add optional `capabilities` field |
| Modify | `src/data/presetRoleCards.ts:31` | Add capabilities to 6 preset cards |
| Create | `src/lib/dispatchAdvisor/matcher.ts` | Task-to-agent matching algorithm |
| Create | `src/lib/dispatchAdvisor/matcher.test.ts` | Tests for matching algorithm |
| Create | `src/lib/dispatchAdvisor/index.ts` | DispatchAdvisor facade |
| Create | `src/lib/dispatchAdvisor/index.test.ts` | Tests for facade |
| Create | `src/lib/agent-context/layers/projectStatusLayer.ts` | Project task board layer |
| Create | `src/lib/agent-context/layers/projectStatusLayer.test.ts` | Tests for project status layer |
| Modify | `src/lib/agent-context/layers/teamLayer.ts:19` | Enhanced team roster output |
| Modify | `src/lib/agent-context/layers/roleLayer.ts:9` | Mario planner dispatch prompt |
| Modify | `src/store/taskHubStore.ts:1265` | Wire advisor into confirmBreakdown |
| Modify | `src/server/db/schema.ts` | Add role_cards table |
| Modify | `src/server/db/migrate.ts:4` | Migration v2 for role_cards |
| Modify | `src/server/routing/mention-parser.ts:18` | Dynamic AGENT_IDS |

---

## Phase 1: Core Intelligence

### Task 1: CapabilityProfile Type

**Files:**
- Create: `src/types/capabilityProfile.ts`
- Modify: `src/types/roleCard.ts`

- [ ] **Step 1: Create the CapabilityProfile type**

```typescript
// src/types/capabilityProfile.ts

export type Seniority = 'junior' | 'mid' | 'senior' | 'lead';

export interface CapabilityProfile {
  /** Domains this role covers: frontend, backend, qa, review, devops, planning */
  domains: string[];
  /** Concrete skills: react, typescript, sql, testing, etc. */
  skills: string[];
  /** Experience level */
  seniority: Seniority;
  /** Max tasks this agent can handle concurrently */
  maxConcurrentTasks: number;
}

export const DOMAIN_KEYWORDS: Record<string, string[]> = {
  frontend: ['ui', '页面', '组件', 'css', 'react', '样式', 'layout', 'button', '前端', 'frontend', 'tailwind', '交互', '动画', '表单', 'modal'],
  backend: ['api', '接口', '数据库', 'sql', 'server', '路由', 'endpoint', '后端', 'backend', 'orm', 'schema', 'migration', 'drizzle', '服务端'],
  qa: ['测试', 'test', 'e2e', '单元测试', '覆盖率', 'bug', '质量', '回归', 'vitest', 'spec', '断言'],
  review: ['审查', 'review', '代码审查', 'pr', 'cr', '评审', '质量门', '规范'],
  devops: ['部署', 'deploy', 'ci', 'pipeline', 'docker', '运维', '监控', '日志'],
  planning: ['规划', '分解', '计划', 'plan', '方案', '里程碑', '排期', '依赖', '优先级'],
};
```

- [ ] **Step 2: Add capabilities field to RoleCard interface**

In `src/types/roleCard.ts`, add after line 62 (after `riskGrading`):

```typescript
  // Dimension 8: Capability Profile
  capabilities?: CapabilityProfile;
```

And add the import at the top:

```typescript
import type { CapabilityProfile } from './capabilityProfile';
```

Update the comment at line 2 to reflect 8 dimensions:

```typescript
// 8 dimensions: Identity, Responsibility, Work Style, Action Boundaries,
// Capability Binding, Output & Quality, Persona, Capability Profile
```

- [ ] **Step 3: Commit**

```bash
git add src/types/capabilityProfile.ts src/types/roleCard.ts
git commit -m "feat: add CapabilityProfile type and extend RoleCard with capabilities"
```

---

### Task 2: Add Capabilities to Preset Role Cards

**Files:**
- Modify: `src/data/presetRoleCards.ts`

- [ ] **Step 1: Add import and capabilities to each preset card**

Add import at the top of `src/data/presetRoleCards.ts`:

```typescript
import type { CapabilityProfile } from '@/types/capabilityProfile';
```

Add a `capabilities` field to each of the 6 preset cards. The card positions are:

**preset-planner (Mario)** — after line 49 (`riskGrading: 'optional'`):

```typescript
    capabilities: {
      domains: ['planning'],
      skills: ['wbs', 'task-decomposition', 'project-management', 'priority-ranking', 'dependency-analysis'],
      seniority: 'lead',
      maxConcurrentTasks: 2,
    } satisfies CapabilityProfile,
```

**preset-frontend (Luigi)** — after line 74 (`riskGrading: 'optional'`):

```typescript
    capabilities: {
      domains: ['frontend'],
      skills: ['react', 'typescript', 'css', 'tailwind', 'component-design', 'state-management'],
      seniority: 'senior',
      maxConcurrentTasks: 2,
    } satisfies CapabilityProfile,
```

**preset-backend (Toad)** — after line 101 (`riskGrading: 'required'`):

```typescript
    capabilities: {
      domains: ['backend'],
      skills: ['node', 'sql', 'api-design', 'drizzle', 'schema-design', 'performance'],
      seniority: 'senior',
      maxConcurrentTasks: 2,
    } satisfies CapabilityProfile,
```

**preset-code-reviewer (Peach)** — after line 128 (`riskGrading: 'required'`):

```typescript
    capabilities: {
      domains: ['review'],
      skills: ['code-review', 'security-audit', 'test-coverage', 'coding-standards', 'best-practices'],
      seniority: 'senior',
      maxConcurrentTasks: 3,
    } satisfies CapabilityProfile,
```

**preset-arch-reviewer (DK)** — after line 154 (`riskGrading: 'required'`):

```typescript
    capabilities: {
      domains: ['review', 'backend'],
      skills: ['system-design', 'performance', 'scalability', 'tech-selection', 'architecture-patterns'],
      seniority: 'senior',
      maxConcurrentTasks: 2,
    } satisfies CapabilityProfile,
```

**preset-qa (Yoshi)** — after line 183 (`riskGrading: 'required'`):

```typescript
    capabilities: {
      domains: ['qa'],
      skills: ['testing', 'e2e', 'coverage', 'vitest', 'regression', 'edge-cases'],
      seniority: 'mid',
      maxConcurrentTasks: 2,
    } satisfies CapabilityProfile,
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/data/presetRoleCards.ts
git commit -m "feat: add capability profiles to all 6 preset role cards"
```

---

### Task 3: DispatchAdvisor Matcher (TDD)

**Files:**
- Create: `src/lib/dispatchAdvisor/matcher.ts`
- Create: `src/lib/dispatchAdvisor/matcher.test.ts`

- [ ] **Step 1: Write failing tests for the matcher**

```typescript
// src/lib/dispatchAdvisor/matcher.test.ts
import { describe, it, expect } from 'vitest';
import { matchTaskToAgent } from './matcher';
import type { AgentProfile } from './matcher';
import type { CapabilityProfile } from '@/types/capabilityProfile';

const makeAgent = (id: string, caps: Partial<CapabilityProfile>, forbidden: string[] = []): AgentProfile => ({
  id,
  forbiddenActions: forbidden,
  capabilities: {
    domains: [],
    skills: [],
    seniority: 'mid',
    maxConcurrentTasks: 1,
    ...caps,
  },
});

describe('matchTaskToAgent', () => {
  it('matches frontend task to frontend agent', () => {
    const frontend = makeAgent('luigi', { domains: ['frontend'], skills: ['react', 'typescript'] });
    const backend = makeAgent('toad', { domains: ['backend'], skills: ['node', 'sql'] });

    const result = matchTaskToAgent(
      { title: '实现登录页面的 React 组件', description: '使用 Tailwind CSS 构建登录表单' },
      [frontend, backend],
      {},
    );

    expect(result[0].agentId).toBe('luigi');
    expect(result[0].score).toBeGreaterThan(0);
  });

  it('matches backend task to backend agent', () => {
    const frontend = makeAgent('luigi', { domains: ['frontend'], skills: ['react'] });
    const backend = makeAgent('toad', { domains: ['backend'], skills: ['node', 'sql'] });

    const result = matchTaskToAgent(
      { title: '实现用户 API 接口', description: '设计 RESTful API 并编写数据库查询' },
      [frontend, backend],
      {},
    );

    expect(result[0].agentId).toBe('toad');
  });

  it('zero-scores agent whose maxConcurrentTasks is reached', () => {
    const luigi = makeAgent('luigi', { domains: ['frontend'], maxConcurrentTasks: 1 });

    const result = matchTaskToAgent(
      { title: '实现前端页面', description: '' },
      [luigi],
      { luigi: 1 },
    );

    expect(result[0].score).toBe(0);
  });

  it('zero-scores agent with matching forbidden action', () => {
    const reviewer = makeAgent('peach', { domains: ['review'] }, ['直接修改代码']);

    const result = matchTaskToAgent(
      { title: '修改代码实现功能', description: '需要直接修改源代码' },
      [reviewer],
      {},
    );

    expect(result[0].score).toBe(0);
  });

  it('ranks by combined domain + skill score', () => {
    const weak = makeAgent('weak', { domains: ['frontend'], skills: ['css'] });
    const strong = makeAgent('strong', { domains: ['frontend'], skills: ['react', 'typescript', 'tailwind'] });

    const result = matchTaskToAgent(
      { title: '使用 React 和 Tailwind 开发组件', description: 'typescript 组件' },
      [weak, strong],
      {},
    );

    expect(result[0].agentId).toBe('strong');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('returns all agents ranked by score descending', () => {
    const a = makeAgent('a', { domains: ['backend'], skills: ['sql'] });
    const b = makeAgent('b', { domains: ['frontend'], skills: ['react'] });
    const c = makeAgent('c', { domains: ['backend', 'frontend'], skills: ['react', 'sql'] });

    const result = matchTaskToAgent(
      { title: '数据库查询和前端展示', description: 'sql react' },
      [a, b, c],
      {},
    );

    expect(result).toHaveLength(3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it('provides reason string explaining the match', () => {
    const agent = makeAgent('luigi', { domains: ['frontend'], skills: ['react'] });

    const result = matchTaskToAgent(
      { title: '开发 React 组件', description: '' },
      [agent],
      {},
    );

    expect(result[0].reason).toContain('frontend');
  });

  it('handles agent without capabilities gracefully', () => {
    const agent = makeAgent('unknown', {});

    const result = matchTaskToAgent(
      { title: '做点什么', description: '' },
      [agent],
      {},
    );

    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dispatchAdvisor/matcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the matcher**

```typescript
// src/lib/dispatchAdvisor/matcher.ts
import type { CapabilityProfile } from '@/types/capabilityProfile';
import { DOMAIN_KEYWORDS } from '@/types/capabilityProfile';

/** Minimal agent profile for matching — decoupled from RoleCard */
export interface AgentProfile {
  /** Agent ID from roster: mario, luigi, toad, peach, dk, yoshi */
  id: string;
  forbiddenActions: string[];
  capabilities?: CapabilityProfile;
}

export interface RankedMatch {
  agentId: string;
  score: number;
  reason: string;
}

interface TaskInput {
  title: string;
  description: string;
}

const DEFAULT_CAPABILITIES: CapabilityProfile = {
  domains: [],
  skills: [],
  seniority: 'mid',
  maxConcurrentTasks: 1,
};

function extractKeywords(text: string): Set<string> {
  const lower = text.toLowerCase();
  const words = lower.match(/[\w一-鿿]+/g) ?? [];
  return new Set(words);
}

function domainScore(taskKeywords: Set<string>, domains: string[]): number {
  let matched = 0;
  let total = 0;
  for (const domain of domains) {
    const keywords = DOMAIN_KEYWORDS[domain] ?? [];
    if (keywords.length === 0) continue;
    total += keywords.length;
    for (const kw of keywords) {
      if (taskKeywords.has(kw.toLowerCase())) matched++;
    }
  }
  if (total === 0) return 0;
  return matched / total;
}

function skillScore(taskKeywords: Set<string>, skills: string[]): number {
  if (skills.length === 0) return 0;
  let matched = 0;
  for (const skill of skills) {
    if (taskKeywords.has(skill.toLowerCase())) matched++;
  }
  return matched / skills.length;
}

function isForbidden(taskText: string, forbiddenActions: string[]): boolean {
  const lower = taskText.toLowerCase();
  return forbiddenActions.some((action) => lower.includes(action.toLowerCase()));
}

export function matchTaskToAgent(
  task: TaskInput,
  agents: AgentProfile[],
  currentLoad: Record<string, number>,
): RankedMatch[] {
  const taskText = `${task.title} ${task.description}`;
  const taskKeywords = extractKeywords(taskText);

  const results: RankedMatch[] = agents.map((agent) => {
    const caps = agent.capabilities ?? DEFAULT_CAPABILITIES;
    const load = currentLoad[agent.id] ?? 0;

    // Load check: if at max capacity, score is 0
    if (load >= caps.maxConcurrentTasks) {
      return { agentId: agent.id, score: 0, reason: `负载已满 (${load}/${caps.maxConcurrentTasks})` };
    }

    // Forbidden action check
    if (isForbidden(taskText, agent.forbiddenActions)) {
      return { agentId: agent.id, score: 0, reason: `命中禁止项: ${agent.forbiddenActions.find((a) => taskText.toLowerCase().includes(a.toLowerCase()))}` };
    }

    const dScore = domainScore(taskKeywords, caps.domains);
    const sScore = skillScore(taskKeywords, caps.skills);
    const total = dScore * 0.5 + sScore * 0.5;

    const matchedDomains = caps.domains.filter((d) => {
      const kws = DOMAIN_KEYWORDS[d] ?? [];
      return kws.some((kw) => taskKeywords.has(kw.toLowerCase()));
    });
    const matchedSkills = caps.skills.filter((s) => taskKeywords.has(s.toLowerCase()));

    const reasonParts: string[] = [];
    if (matchedDomains.length) reasonParts.push(`领域匹配: ${matchedDomains.join(', ')}`);
    if (matchedSkills.length) reasonParts.push(`技能匹配: ${matchedSkills.join(', ')}`);
    if (!reasonParts.length) reasonParts.push('无精确匹配');

    return {
      agentId: agent.id,
      score: total,
      reason: reasonParts.join(', '),
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dispatchAdvisor/matcher.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dispatchAdvisor/matcher.ts src/lib/dispatchAdvisor/matcher.test.ts
git commit -m "feat: add DispatchAdvisor matcher with domain+skill scoring"
```

---

### Task 4: DispatchAdvisor Facade (TDD)

**Files:**
- Create: `src/lib/dispatchAdvisor/index.ts`
- Create: `src/lib/dispatchAdvisor/index.test.ts`

- [ ] **Step 1: Write failing tests for the facade**

```typescript
// src/lib/dispatchAdvisor/index.test.ts
import { describe, it, expect } from 'vitest';
import { DispatchAdvisor } from './index';
import type { AgentProfile } from './matcher';
import type { CapabilityProfile } from '@/types/capabilityProfile';
import type { PhaseProposal } from '@/lib/breakdownParser';

const makeAgent = (id: string, caps: Partial<CapabilityProfile>, forbidden: string[] = []): AgentProfile => ({
  id,
  forbiddenActions: forbidden,
  capabilities: {
    domains: [],
    skills: [],
    seniority: 'mid',
    maxConcurrentTasks: 1,
    ...caps,
  },
});

describe('DispatchAdvisor', () => {
  it('enriches task proposals with suggested agentId', () => {
    const advisor = new DispatchAdvisor(
      [makeAgent('luigi', { domains: ['frontend'], skills: ['react'] }),
       makeAgent('toad', { domains: ['backend'], skills: ['sql'] })],
    );

    const phases: PhaseProposal[] = [
      {
        title: 'Phase 1',
        description: '',
        tasks: [
          { title: '实现 React 组件', description: '前端页面开发' },
          { title: '设计数据库 schema', description: 'SQL 建表' },
        ],
      },
    ];

    const result = advisor.suggest(phases, {});
    expect(result[0].tasks[0].agentId).toBe('luigi');
    expect(result[0].tasks[1].agentId).toBe('toad');
  });

  it('preserves existing agentId if already set', () => {
    const advisor = new DispatchAdvisor(
      [makeAgent('luigi', { domains: ['frontend'] })],
    );

    const phases: PhaseProposal[] = [
      {
        title: 'Phase 1',
        description: '',
        tasks: [
          { title: 'Some task', description: '', agentId: 'toad' },
        ],
      },
    ];

    const result = advisor.suggest(phases, {});
    expect(result[0].tasks[0].agentId).toBe('toad');
  });

  it('generates suggestion report for planner prompt', () => {
    const advisor = new DispatchAdvisor(
      [makeAgent('luigi', { domains: ['frontend'], skills: ['react'] }),
       makeAgent('toad', { domains: ['backend'], skills: ['sql'] })],
    );

    const phases: PhaseProposal[] = [
      {
        title: 'Phase 1',
        description: '',
        tasks: [
          { title: '实现 React 页面', description: '' },
        ],
      },
    ];

    const report = advisor.suggestReport(phases, {});
    expect(report).toContain('luigi');
    expect(report).toContain('实现 React 页面');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dispatchAdvisor/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the facade**

```typescript
// src/lib/dispatchAdvisor/index.ts
import type { AgentProfile } from './matcher';
import type { PhaseProposal } from '@/lib/breakdownParser';
import { matchTaskToAgent } from './matcher';

export class DispatchAdvisor {
  private agents: AgentProfile[];

  constructor(agents: AgentProfile[]) {
    this.agents = agents;
  }

  /**
   * Enrich each task with a suggested agentId based on capability matching.
   * Preserves existing agentId if already set.
   */
  suggest(phases: PhaseProposal[], currentLoad: Record<string, number>): PhaseProposal[] {
    return phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => {
        if (task.agentId) return task;
        const ranked = matchTaskToAgent(task, this.agents, currentLoad);
        const best = ranked[0];
        return {
          ...task,
          agentId: best && best.score > 0 ? best.agentId : undefined,
        };
      }),
    });
  }

  /**
   * Generate a markdown report for embedding in the planner prompt.
   * Shows suggested assignment for each task with reasoning.
   */
  suggestReport(phases: PhaseProposal[], currentLoad: Record<string, number>): string {
    const lines: string[] = ['## 分派建议\n'];

    for (const phase of phases) {
      for (const task of phase.tasks) {
        const ranked = matchTaskToAgent(task, this.agents, currentLoad);
        const best = ranked[0];
        if (task.agentId) {
          lines.push(`- "${task.title}" → @${task.agentId} (已指定)`);
        } else if (best && best.score > 0) {
          lines.push(`- "${task.title}" → @${best.agentId} (${best.reason})`);
        } else {
          lines.push(`- "${task.title}" → 无匹配角色`);
        }
      }
    }

    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dispatchAdvisor/index.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run all dispatchAdvisor tests together**

Run: `npx vitest run src/lib/dispatchAdvisor/`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/dispatchAdvisor/index.ts src/lib/dispatchAdvisor/index.test.ts
git commit -m "feat: add DispatchAdvisor facade with suggest and report"
```

---

### Task 5: Enhance TeamLayer

**Files:**
- Modify: `src/lib/agent-context/layers/teamLayer.ts`

- [ ] **Step 1: Update buildTeamLayer to include capability info**

Replace the entire contents of `src/lib/agent-context/layers/teamLayer.ts` with:

```typescript
import { AGENT_ROSTER } from '@/store/taskHubStore';
import type { RoleCard } from '@/types/roleCard';

const ROLE_LABELS: Record<string, string> = {
  planner: '统筹',
  frontend: '实现',
  backend: '实现',
  code_reviewer: '评审',
  arch_reviewer: '评审',
  qa: '测试',
};

const DISPATCH_RULES = `## 分派规则
- 严格按领域匹配：前端任务 → frontend 域角色，后端任务 → backend 域角色
- 负载已满的角色不可分派（当前负载 = 并行上限）
- 无精确领域匹配时，选择 skills 交集最大的角色
- 每个 TASK 必须指定 @agentId，不允许空缺
- 一个 TASK = 一个角色的一次独立交付；涉及两个领域的必须拆成两个 TASK`;

const COLLABORATION_RULES = `## 协作规则
- 遇到超出职责范围的工作，使用 @mention 交接给对应角色（另起一行行首写 @agentId）
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在回复中另起一行写 @agentId + 请求内容`;

export function buildTeamLayer(selfId: string, allRoleCards: RoleCard[], currentLoad: Record<string, number> = {}): string {
  const entries = AGENT_ROSTER.map((agent) => {
    const rc = allRoleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: rc?.displayName ?? agent.roleLabel,
      emoji: agent.emoji,
      roleLabel: rc?.category ? ROLE_LABELS[rc.category] ?? agent.roleLabel : agent.roleLabel,
      strengths: rc?.responsibilities.slice(0, 3) ?? [],
      domains: rc?.capabilities?.domains ?? [],
      skills: rc?.capabilities?.skills ?? [],
      seniority: rc?.capabilities?.seniority ?? 'mid',
      maxConcurrent: rc?.capabilities?.maxConcurrentTasks ?? 1,
      currentLoad: currentLoad[agent.id] ?? 0,
    };
  });

  const teammates = entries.filter((e) => e.id !== selfId);
  if (teammates.length === 0) return '';

  const header = '| @mention | 名字 | 角色 | 领域 | 核心技能 | 资历 | 并行上限 | 当前负载 |';
  const sep = '|----------|------|------|------|---------|------|---------|---------|';
  const rows = teammates.map(
    (t) => `| @${t.id} | ${t.emoji} ${t.name} | ${t.roleLabel} | ${t.domains.join(', ')} | ${t.skills.slice(0, 4).join(', ')} | ${t.seniority} | ${t.maxConcurrent} | ${t.currentLoad}/${t.maxConcurrent} |`,
  );

  return [
    `## 团队花名册`,
    '',
    header,
    sep,
    ...rows,
    '',
    DISPATCH_RULES,
    '',
    COLLABORATION_RULES,
  ].join('\n');
}
```

- [ ] **Step 2: Update the PromptComposer to pass load info**

In `src/lib/agent-context/PromptComposer.ts`, the `ComposeOptions` interface needs a `currentLoad` field, and `buildTeamLayer` needs to receive it.

Add to `ComposeOptions` interface:

```typescript
  currentLoad?: Record<string, number>;
```

Update the `buildTeamLayer` call inside `composeSystemPrompt` to pass `currentLoad`:

```typescript
buildTeamLayer(opts.agent.id, opts.allRoleCards, opts.currentLoad)
```

- [ ] **Step 3: Update existing tests**

In `src/__tests__/agent-context/promptComposer.test.ts`, find any test that calls `buildTeamLayer` or `composeSystemPrompt` and ensure it still passes. If any test asserts on the exact team layer output, update the expected output to include the new columns.

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: All tests PASS (or update assertions for new table format)

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent-context/layers/teamLayer.ts src/lib/agent-context/PromptComposer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: enhance TeamLayer with capability domains, skills, and load info"
```

---

### Task 6: Enhance RoleLayer for Mario Planner

**Files:**
- Modify: `src/lib/agent-context/layers/roleLayer.ts`

- [ ] **Step 1: Add planner dispatch prompt for Mario**

In `src/lib/agent-context/layers/roleLayer.ts`, after the persona sections and before the final return, add a conditional block that injects dispatch-specific guidance when the agent is a planner:

Add before the final `return parts.join('\n\n');`:

```typescript
  // Planner-specific dispatch instructions
  if (roleCard.category === 'planner') {
    parts.push(`## 分派职责
你是项目统筹，核心职责：
1. 将用户目标分解为 PHASE → TASK，每个 TASK 粒度控制在单角色可独立完成
2. 分派时参考团队花名册的领域和技能匹配
3. 如果 Advisor 给出了建议分派，优先采纳；有异议时说明理由
4. 每个 TASK 输出格式：TASK: <描述> @<agentId>

## TASK 粒度标准
- 一个 TASK = 一个角色的一次独立交付
- 涉及两个领域的 TASK 必须拆成两个
- 单个 TASK 预估工作量不超过项目总量的 1/5
- 有依赖关系的 TASK 放在同一 PHASE 内，按顺序排列`);
  }
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: All tests PASS. The new planner section only appears when `roleCard.category === 'planner'`, so non-planner tests should be unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-context/layers/roleLayer.ts
git commit -m "feat: add planner dispatch instructions to RoleLayer for Mario"
```

---

### Task 7: Wire DispatchAdvisor into Breakdown Flow

**Files:**
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Add DispatchAdvisor import**

At the top of `src/store/taskHubStore.ts`, add:

```typescript
import { DispatchAdvisor } from '@/lib/dispatchAdvisor';
```

- [ ] **Step 2: Modify confirmBreakdown to run advisor**

In the `confirmBreakdown` function (starting at line 1265), before the task creation loop, insert the advisor logic. Replace:

```typescript
confirmBreakdown: (conversationId, proposals) => {
  let taskSeq = get().tasks.length;
  for (let pi = 0; pi < proposals.length; pi++) {
```

With:

```typescript
confirmBreakdown: (conversationId, proposals) => {
  // Build AgentProfile list from AGENT_ROSTER + RoleCards
  const allRoleCards = get().roleCards;
  const agentProfiles = AGENT_ROSTER.map((agent) => {
    const rc = allRoleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,  // mario, luigi, etc. — NOT the RoleCard ID
      forbiddenActions: rc?.forbiddenActions ?? [],
      capabilities: rc?.capabilities,
    };
  });

  // Count current load per agent
  const currentTasks = get().tasks;
  const currentLoad: Record<string, number> = {};
  for (const t of currentTasks) {
    if (t.status === 'in_progress' || t.status === 'pending') {
      currentLoad[t.agentId] = (currentLoad[t.agentId] ?? 0) + 1;
    }
  }

  const advisor = new DispatchAdvisor(agentProfiles);
  const enriched = advisor.suggest(proposals, currentLoad);

  let taskSeq = get().tasks.length;
  for (let pi = 0; pi < enriched.length; pi++) {
    const prop = enriched[pi];
```

The existing fallback `agentId: taskProp.agentId || 'mario'` stays unchanged — the advisor fills in agentId where possible, and the fallback to 'mario' handles any remaining gaps.

- [ ] **Step 2: Update the system feedback message to show assignment**

In the same `confirmBreakdown` function, update the system message to include agent assignments. Find:

```typescript
const phaseSummary = proposals.map((p, i) =>
  `阶段 ${i + 1}: ${p.tasks.length} 任务 ${i === 0 ? '✓ 已派发' : '⏳ 等待前置阶段'}`
).join('\n');
```

Replace with:

```typescript
const phaseSummary = enriched.map((p, i) => {
  const taskLines = p.tasks.map((t) => {
    const agentName = t.agentId ? `→ @${t.agentId}` : '→ 未分配';
    return `  - ${t.title} ${agentName}`;
  }).join('\n');
  return `阶段 ${i + 1}:\n${taskLines}`;
}).join('\n\n');
```

- [ ] **Step 3: Verify the store compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: wire DispatchAdvisor into confirmBreakdown flow"
```

---

### Task 7.5: ProjectStatusLayer — Project Task Board

**Files:**
- Create: `src/lib/agent-context/layers/projectStatusLayer.ts`
- Create: `src/lib/agent-context/layers/projectStatusLayer.test.ts`
- Modify: `src/lib/agent-context/PromptComposer.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/agent-context/layers/projectStatusLayer.test.ts
import { describe, it, expect } from 'vitest';
import { buildProjectStatusLayer } from './projectStatusLayer';

describe('buildProjectStatusLayer', () => {
  const agents = [
    { id: 'mario', name: 'Mario', emoji: '⭐' },
    { id: 'luigi', name: 'Luigi', emoji: '⚡' },
    { id: 'toad', name: 'Toad', emoji: '🛡️' },
  ];

  const tasks = [
    { id: 'TASK-001', title: '设计架构', agentId: 'mario', status: 'done' as const },
    { id: 'TASK-002', title: '实现登录页', agentId: 'luigi', status: 'in_progress' as const },
    { id: 'TASK-003', title: '实现用户API', agentId: 'toad', status: 'in_progress' as const },
    { id: 'TASK-004', title: '实现注册页', agentId: 'luigi', status: 'pending' as const },
    { id: 'TASK-005', title: '数据库迁移', agentId: 'toad', status: 'pending' as const },
    { id: 'TASK-006', title: '单元测试', agentId: '', status: 'pending' as const },
  ];

  it('renders project task board with summary', () => {
    const result = buildProjectStatusLayer(agents, tasks);
    expect(result).toContain('项目任务看板');
    expect(result).toContain('6 个任务');
    expect(result).toContain('1 完成');
    expect(result).toContain('2 进行中');
    expect(result).toContain('3 待处理');
  });

  it('groups tasks by agent', () => {
    const result = buildProjectStatusLayer(agents, tasks);
    expect(result).toContain('Mario');
    expect(result).toContain('Luigi');
    expect(result).toContain('TASK-002');
  });

  it('shows unassigned tasks', () => {
    const result = buildProjectStatusLayer(agents, tasks);
    expect(result).toContain('TASK-006');
  });

  it('returns empty string when no tasks', () => {
    const result = buildProjectStatusLayer(agents, []);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/agent-context/layers/projectStatusLayer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the layer**

```typescript
// src/lib/agent-context/layers/projectStatusLayer.ts

interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
}

interface TaskInfo {
  id: string;
  title: string;
  agentId: string;
  status: 'pending' | 'in_progress' | 'done';
}

const STATUS_LABELS: Record<string, string> = {
  done: '✓',
  in_progress: '进行中',
  pending: '待处理',
};

export function buildProjectStatusLayer(
  agents: AgentInfo[],
  tasks: TaskInfo[],
): string {
  if (tasks.length === 0) return '';

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;

  // Group tasks by agent
  const byAgent = new Map<string, TaskInfo[]>();
  const unassigned: TaskInfo[] = [];

  for (const task of tasks) {
    if (!task.agentId) {
      unassigned.push(task);
    } else {
      const list = byAgent.get(task.agentId) ?? [];
      list.push(task);
      byAgent.set(task.agentId, list);
    }
  }

  const lines: string[] = [
    `## 项目任务看板`,
    '',
    `总进度：${total} 个任务 | ${done} 完成 | ${inProgress} 进行中 | ${pending} 待处理`,
    '',
  ];

  // Agent sections — in roster order
  for (const agent of agents) {
    const agentTasks = byAgent.get(agent.id);
    if (!agentTasks || agentTasks.length === 0) {
      lines.push(`${agent.emoji} ${agent.name}: 无任务`);
    } else {
      const taskLines = agentTasks
        .map((t) => `${t.id} ${STATUS_LABELS[t.status]} ${t.title}`)
        .join(', ');
      lines.push(`${agent.emoji} ${agent.name}: ${taskLines}`);
    }
  }

  // Unassigned section
  if (unassigned.length > 0) {
    const unassignedLines = unassigned
      .map((t) => `${t.id} ${STATUS_LABELS[t.status]} ${t.title}`)
      .join(', ');
    lines.push(`未分配: ${unassignedLines}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/agent-context/layers/projectStatusLayer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Wire into PromptComposer**

In `src/lib/agent-context/PromptComposer.ts`:

Add import:
```typescript
import { buildProjectStatusLayer } from './layers/projectStatusLayer';
```

Add `tasks` field to `ComposeOptions` interface:
```typescript
  tasks?: { id: string; title: string; agentId: string; status: string }[];
```

Add `buildProjectStatusLayer` call in `composeSystemPrompt`, after `buildTeamLayer`:
```typescript
const projectStatus = opts.tasks
  ? buildProjectStatusLayer(
      AGENT_ROSTER.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji })),
      opts.tasks as Parameters<typeof buildProjectStatusLayer>[1],
    )
  : '';

const parts = [roleLayer, projectLayer, teamLayer, projectStatus].filter(Boolean);
return parts.join('\n\n');
```

- [ ] **Step 6: Verify existing tests still pass**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: All tests PASS (projectStatus only renders when tasks are provided)

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent-context/layers/projectStatusLayer.ts src/lib/agent-context/layers/projectStatusLayer.test.ts src/lib/agent-context/PromptComposer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: add ProjectStatusLayer with per-agent task board"
```

---

## Phase 2: Configurable Roles

### Task 8: DB Persistence for Role Cards

**Files:**
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/migrate.ts`

- [ ] **Step 1: Add role_cards table to Drizzle schema**

In `src/server/db/schema.ts`, after the `agentEvent` table definition (after line 129), add:

```typescript
// ──────────────────────────────────────────────
// role_cards
// ──────────────────────────────────────────────
export const roleCards = sqliteTable('role_cards', {
  id: text('id').primaryKey(),
  data: text('data').notNull(), // Full RoleCard JSON including capabilities
  isPreset: integer('is_preset', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type RoleCardRow = InferSelectModel<typeof roleCards>;
export type NewRoleCardRow = InferInsertModel<typeof roleCards>;
```

- [ ] **Step 2: Add migration v2**

In `src/server/db/migrate.ts`, add a second entry to the `MIGRATIONS` array after the v1 object:

```typescript
  {
    version: 2,
    sql: `
CREATE TABLE IF NOT EXISTS role_cards (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  is_preset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.ts src/server/db/migrate.ts
git commit -m "feat: add role_cards table schema and migration v2"
```

---

### Task 9: Role Card DB Queries

**Files:**
- Create: `src/server/db/roleCardQueries.ts`
- Create: `src/server/db/roleCardQueries.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/db/roleCardQueries.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from './index';
import type * as schema from './schema';
import { upsertRoleCard, loadAllRoleCards, deleteRoleCard } from './roleCardQueries';
import type { RoleCard } from '@/types/roleCard';

const makeCard = (id: string): RoleCard => ({
  id,
  name: id,
  displayName: `Display ${id}`,
  description: 'test',
  category: 'frontend',
  tags: [],
  applicableScenarios: [],
  responsibilities: [],
  nonResponsibilities: [],
  successCriteria: [],
  clarifyBeforeExecute: 'when_ambiguous',
  outputStyle: 'concise',
  preferStructuredOutput: false,
  allowedActions: [],
  requiresConfirmation: [],
  forbiddenActions: [],
  preferredEngines: [],
  allowedTools: [],
  accountIds: [],
  outputFormat: 'freeform',
  requiresEvidence: false,
  riskGrading: 'none',
  isPreset: false,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('roleCardQueries', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
  });

  it('upserts and loads a role card', () => {
    const card = makeCard('test-card');
    upsertRoleCard(card);

    const loaded = loadAllRoleCards();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test-card');
    expect(loaded[0].displayName).toBe('Display test-card');
  });

  it('updates existing card on upsert', () => {
    const card = makeCard('test-card');
    upsertRoleCard(card);

    const updated = { ...card, displayName: 'Updated' };
    upsertRoleCard(updated);

    const loaded = loadAllRoleCards();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].displayName).toBe('Updated');
  });

  it('deletes a non-preset role card', () => {
    const card = makeCard('custom-card');
    upsertRoleCard(card);

    deleteRoleCard('custom-card');

    const loaded = loadAllRoleCards();
    expect(loaded).toHaveLength(0);
  });

  it('preserves capabilities through round-trip', () => {
    const card: RoleCard = {
      ...makeCard('cap-card'),
      capabilities: {
        domains: ['frontend', 'backend'],
        skills: ['react', 'sql'],
        seniority: 'senior',
        maxConcurrentTasks: 3,
      },
    };

    upsertRoleCard(card);
    const loaded = loadAllRoleCards();
    expect(loaded[0].capabilities?.domains).toEqual(['frontend', 'backend']);
    expect(loaded[0].capabilities?.maxConcurrentTasks).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/db/roleCardQueries.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the queries**

```typescript
// src/server/db/roleCardQueries.ts
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import { roleCards } from './schema';
import type { RoleCard } from '@/types/roleCard';

export function upsertRoleCard(card: RoleCard): void {
  const db = getDb();
  const now = new Date().toISOString();
  const data = JSON.stringify(card);

  db.insert(roleCards)
    .values({
      id: card.id,
      data,
      isPreset: card.isPreset,
      createdAt: card.createdAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: roleCards.id,
      set: { data, isPreset: card.isPreset, updatedAt: now },
    })
    .run();
}

export function loadAllRoleCards(): RoleCard[] {
  const db = getDb();
  const rows = db.select().from(roleCards).all();
  return rows.map((row) => JSON.parse(row.data) as RoleCard);
}

export function deleteRoleCard(id: string): void {
  const db = getDb();
  db.delete(roleCards).where(eq(roleCards.id, id)).run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/db/roleCardQueries.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/db/roleCardQueries.ts src/server/db/roleCardQueries.test.ts
git commit -m "feat: add role card DB queries (upsert, loadAll, delete)"
```

---

### Task 10: Dynamic Agent IDs in Mention Parser

**Files:**
- Modify: `src/server/routing/mention-parser.ts`

- [ ] **Step 1: Replace hardcoded AGENT_IDS with a settable registry**

In `src/server/routing/mention-parser.ts`, replace the hardcoded `AGENT_IDS` (line 18) with a dynamic registry:

```typescript
/** Default agent IDs — always present */
const DEFAULT_AGENT_IDS = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'];

/** Dynamic agent ID registry (starts with defaults) */
let agentIdRegistry: string[] = [...DEFAULT_AGENT_IDS];

/** Register additional agent IDs (for custom roles) */
export function registerAgentIds(ids: string[]): void {
  const combined = new Set([...DEFAULT_AGENT_IDS, ...ids]);
  agentIdRegistry = [...combined];
}

/** Get current agent IDs (for testing) */
export function getAgentIds(): string[] {
  return [...agentIdRegistry];
}
```

Then update `parseMentions` to use `agentIdRegistry` instead of `AGENT_IDS`:

Replace line 36:

```typescript
  participants: string[] = [...AGENT_IDS],
```

With:

```typescript
  participants: string[] = [...agentIdRegistry],
```

Replace line 66:

```typescript
  const sortedAgentIds = [...AGENT_IDS].sort((a, b) => b.length - a.length);
```

With:

```typescript
  const sortedAgentIds = [...agentIdRegistry].sort((a, b) => b.length - a.length);
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run src/server/routing/routing.test.ts`
Expected: All tests PASS — the default IDs are unchanged

- [ ] **Step 3: Commit**

```bash
git add src/server/routing/mention-parser.ts
git commit -m "feat: make mention-parser agent IDs dynamically extensible"
```

---

## Deferred to Follow-up Plan

The following from the spec are **not included** in this plan and should be addressed in a separate plan:

- **Module 4: Role Management UI** — The full CRUD interface for managing roles, capabilities, and domain keywords. Depends on Task 8-10 (DB persistence + dynamic mention parsing) being complete first.
- **Domain Keywords Editor UI** — Allowing users to extend `DOMAIN_KEYWORDS` through the interface.
- **Seed Data Migration** — Auto-populating the `role_cards` table from `presetRoleCards.ts` on first run.
