# Prompt Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered inline prompt assembly with a layered PromptComposer that separates system prompt (role/project/team) from user prompt (history/task/message/behavior).

**Architecture:** Seven layer builder functions under `src/lib/agent-context/layers/`, orchestrated by a single `PromptComposer.ts` module. Two callers (`dispatchToAgent` and `simulateCliExecution`) migrate to use the composer, replacing all inline prompt construction.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/lib/agent-context/PromptComposer.ts` | ComposeOptions type + composeSystemPrompt + composeUserPrompt |
| Create | `src/lib/agent-context/layers/roleLayer.ts` | buildRoleLayer — persona 5 dims + constraints |
| Create | `src/lib/agent-context/layers/projectLayer.ts` | buildProjectLayer — project name/path/spec files |
| Create | `src/lib/agent-context/layers/teamLayer.ts` | buildTeamLayer — roster table + collaboration rules |
| Create | `src/lib/agent-context/layers/historyLayer.ts` | buildHistoryLayer — recent conversation history |
| Create | `src/lib/agent-context/layers/taskContextLayer.ts` | buildTaskContextLayer — task/phase context |
| Create | `src/lib/agent-context/layers/userMessageLayer.ts` | buildUserMessageLayer — @mention strip + fallback |
| Create | `src/lib/agent-context/layers/behaviorLayer.ts` | buildBehaviorLayer — decision nudge |
| Create | `src/__tests__/agent-context/promptComposer.test.ts` | Tests for all layers + composer |
| Modify | `src/store/taskHubStore.ts:11-12` | Replace imports |
| Modify | `src/store/taskHubStore.ts:1400-1444` | dispatchToAgent prompt assembly → composer |
| Modify | `src/store/taskHubStore.ts:1578-1594` | simulateCliExecution prompt assembly → composer |
| Modify | `src/components/task-hub/TaskDetailPanel.tsx:319` | Fix sessionId arg to undefined |
| Delete | `src/lib/agent-context/buildSystemPrompt.ts` | Replaced by PromptComposer |
| Delete | `src/lib/agent-context/buildTeamRoster.ts` | Replaced by teamLayer |
| Delete | `src/lib/agent-context/buildConversationHistory.ts` | Replaced by historyLayer |

---

## Task 1: Create ComposeOptions type and PromptComposer skeleton

**Files:**
- Create: `src/lib/agent-context/PromptComposer.ts`
- Create: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write the test for composeSystemPrompt returning undefined when not first wake**

```typescript
// src/__tests__/agent-context/promptComposer.test.ts
import { describe, it, expect } from 'vitest';
import { composeSystemPrompt, composeUserPrompt } from '@/lib/agent-context/PromptComposer';
import type { RoleCard } from '@/types/roleCard';

const makeRoleCard = (overrides: Partial<RoleCard> = {}): RoleCard => ({
  id: 'preset-planner',
  name: 'planner',
  displayName: '项目统筹',
  description: 'Test role',
  category: 'planner',
  tags: [],
  applicableScenarios: [],
  responsibilities: ['拆解任务'],
  nonResponsibilities: [],
  successCriteria: [],
  clarifyBeforeExecute: 'when_ambiguous',
  outputStyle: 'structured',
  preferStructuredOutput: true,
  allowedActions: ['can_modify_code'],
  requiresConfirmation: [],
  forbiddenActions: [],
  preferredEngines: [],
  allowedTools: [],
  accountIds: [],
  outputFormat: 'structured_list',
  requiresEvidence: false,
  riskGrading: 'none',
  persona: {
    introduction: '你是 Mario，这个项目的统筹。',
    voice: '简短有力',
    mindset: '直接行动',
    habits: '先拆解再执行',
    collaboration: '善于交接',
  },
  isPreset: true,
  version: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
});

const baseOpts = {
  agent: { id: 'mario', name: 'Mario' },
  roleCard: makeRoleCard(),
  allRoleCards: [] as RoleCard[],
  project: { name: 'Test Project', path: '/tmp/test' },
  rawPrompt: '@mario 你好',
};

describe('composeSystemPrompt', () => {
  it('returns undefined when not first wake', () => {
    const result = composeSystemPrompt({ ...baseOpts, isFirstWake: false });
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create PromptComposer.ts with ComposeOptions and stub functions**

```typescript
// src/lib/agent-context/PromptComposer.ts
import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/taskHubStore';
import { buildRoleLayer } from './layers/roleLayer';
import { buildProjectLayer } from './layers/projectLayer';
import { buildTeamLayer } from './layers/teamLayer';
import { buildHistoryLayer } from './layers/historyLayer';
import { buildTaskContextLayer } from './layers/taskContextLayer';
import { buildUserMessageLayer } from './layers/userMessageLayer';
import { buildBehaviorLayer } from './layers/behaviorLayer';

export interface ComposeOptions {
  agent: { id: string; name: string };
  roleCard?: RoleCard;       // optional — roleLayer returns '' if missing
  allRoleCards: RoleCard[];
  project: { name: string; path: string };
  isFirstWake: boolean;
  messages?: ChatMessage[];
  task?: { id: string; title: string; description?: string; phase?: { title: string } };
  rawPrompt: string;
}

export function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;
  return [
    buildRoleLayer(opts.agent, opts.roleCard),
    buildProjectLayer(opts.project),
    buildTeamLayer(opts.agent.id, opts.allRoleCards),
  ]
    .filter(Boolean)
    .join('\n\n');
}

// composeUserPrompt remains unchanged — it does not read roleCard

export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];
  if (opts.isFirstWake) {
    const history = buildHistoryLayer(opts.messages ?? [], opts.agent.id);
    if (history) parts.push(history);
  }
  if (opts.task) {
    parts.push(buildTaskContextLayer(opts.task));
  }
  parts.push(buildUserMessageLayer(opts.rawPrompt));
  parts.push(buildBehaviorLayer());
  return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 4: Create stub layer files so imports resolve**

Create `src/lib/agent-context/layers/` directory, then create each file with a stub:

```typescript
// src/lib/agent-context/layers/roleLayer.ts
import type { RoleCard } from '@/types/roleCard';

export function buildRoleLayer(agent: { id: string; name: string }, roleCard?: RoleCard): string {
  if (!roleCard) return '';
  return '';
}
```

```typescript
// src/lib/agent-context/layers/projectLayer.ts
export function buildProjectLayer(project: { name: string; path: string }): string {
  return '';
}
```

```typescript
// src/lib/agent-context/layers/teamLayer.ts
import type { RoleCard } from '@/types/roleCard';

export function buildTeamLayer(selfId: string, allRoleCards: RoleCard[]): string {
  return '';
}
```

```typescript
// src/lib/agent-context/layers/historyLayer.ts
import type { ChatMessage } from '@/store/taskHubStore';

export function buildHistoryLayer(messages: ChatMessage[], selfId: string): string {
  return '';
}
```

```typescript
// src/lib/agent-context/layers/taskContextLayer.ts
export function buildTaskContextLayer(task: { id: string; title: string; description?: string; phase?: { title: string } }): string {
  return '';
}
```

```typescript
// src/lib/agent-context/layers/userMessageLayer.ts
export function buildUserMessageLayer(rawPrompt: string): string {
  return '';
}
```

```typescript
// src/lib/agent-context/layers/behaviorLayer.ts
export function buildBehaviorLayer(): string {
  return '';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-context/PromptComposer.ts src/lib/agent-context/layers/ src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: add PromptComposer skeleton with ComposeOptions and stub layers"
```

---

## Task 2: Implement roleLayer

**Files:**
- Modify: `src/lib/agent-context/layers/roleLayer.ts`
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write tests for roleLayer**

Add to `promptComposer.test.ts`:

```typescript
describe('buildRoleLayer', () => {
  it('includes introduction and persona dimensions', () => {
    const result = buildRoleLayer(
      { id: 'mario', name: 'Mario' },
      makeRoleCard({
        persona: {
          introduction: '你是 Mario，项目统筹。',
          voice: '简短有力',
          mindset: '直接行动',
          habits: '先拆解再执行',
          collaboration: '善于交接',
        },
      }),
    );
    expect(result).toContain('你是 Mario，项目统筹。');
    expect(result).toContain('## 语气风格\n简短有力');
    expect(result).toContain('## 思维模式\n直接行动');
    expect(result).toContain('## 工作习惯\n先拆解再执行');
    expect(result).toContain('## 协作风格\n善于交接');
  });

  it('omits empty persona dimensions', () => {
    const result = buildRoleLayer(
      { id: 'mario', name: 'Mario' },
      makeRoleCard({
        persona: {
          introduction: '你是 Mario。',
          voice: '',
          mindset: '',
          habits: '',
          collaboration: '',
        },
      }),
    );
    expect(result).toContain('你是 Mario。');
    expect(result).not.toContain('## 语气风格');
    expect(result).not.toContain('## 思维模式');
  });

  it('includes constraints section', () => {
    const result = buildRoleLayer(
      { id: 'mario', name: 'Mario' },
      makeRoleCard({
        responsibilities: ['拆解任务', '排列优先级'],
        nonResponsibilities: ['直接写代码'],
        forbiddenActions: ['删除数据库'],
        outputFormat: 'structured_list',
        requiresEvidence: true,
        requiresConfirmation: ['数据库变更'],
        allowedActions: ['can_propose_only'],
      }),
    );
    expect(result).toContain('## 角色约束');
    expect(result).toContain('职责：拆解任务、排列优先级');
    expect(result).toContain('非职责：直接写代码');
    expect(result).toContain('禁止：删除数据库');
    expect(result).toContain('输出格式：结构化列表');
    expect(result).toContain('评审/建议必须附带具体证据');
    expect(result).toContain('只能提出建议，不能直接修改代码');
    expect(result).toContain('以下操作需用户确认：数据库变更');
  });

  it('omits constraints section when no constraints apply', () => {
    const result = buildRoleLayer(
      { id: 'mario', name: 'Mario' },
      makeRoleCard({
        responsibilities: [],
        nonResponsibilities: [],
        forbiddenActions: [],
        outputFormat: 'freeform',
        requiresEvidence: false,
        requiresConfirmation: [],
        allowedActions: ['can_modify_code'],
      }),
    );
    expect(result).not.toContain('## 角色约束');
  });
});
```

Add import at top of test file:
```typescript
import { buildRoleLayer } from '@/lib/agent-context/layers/roleLayer';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: FAIL — buildRoleLayer returns empty string

- [ ] **Step 3: Implement roleLayer**

```typescript
// src/lib/agent-context/layers/roleLayer.ts
import type { RoleCard } from '@/types/roleCard';

const FORMAT_LABELS: Record<string, string> = {
  structured_list: '结构化列表',
  report: '报告',
  checklist: '检查清单',
};

export function buildRoleLayer(agent: { id: string; name: string }, roleCard?: RoleCard): string {
  if (!roleCard) return '';
  const parts: string[] = [];

  // Persona introduction
  if (roleCard.persona?.introduction) {
    parts.push(roleCard.persona.introduction);
  }

  // Constraints
  const constraints: string[] = [];
  if (roleCard.responsibilities.length) {
    constraints.push(`- 职责：${roleCard.responsibilities.join('、')}`);
  }
  if (roleCard.nonResponsibilities.length) {
    constraints.push(`- 非职责：${roleCard.nonResponsibilities.join('、')}`);
  }
  if (roleCard.forbiddenActions.length) {
    constraints.push(`- 禁止：${roleCard.forbiddenActions.join('、')}`);
  }
  if (roleCard.requiresEvidence) {
    constraints.push('- 评审/建议必须附带具体证据和文件引用');
  }
  if (roleCard.outputFormat !== 'freeform') {
    constraints.push(`- 输出格式：${FORMAT_LABELS[roleCard.outputFormat] ?? roleCard.outputFormat}`);
  }
  if (roleCard.allowedActions.includes('can_propose_only') && !roleCard.allowedActions.includes('can_modify_code')) {
    constraints.push('- 只能提出建议，不能直接修改代码');
  }
  if (roleCard.requiresConfirmation.length) {
    constraints.push(`- 以下操作需用户确认：${roleCard.requiresConfirmation.join('、')}`);
  }
  if (constraints.length > 0) {
    parts.push('## 角色约束\n' + constraints.join('\n'));
  }

  // Extended persona dimensions
  if (roleCard.persona?.voice) {
    parts.push(`## 语气风格\n${roleCard.persona.voice}`);
  }
  if (roleCard.persona?.mindset) {
    parts.push(`## 思维模式\n${roleCard.persona.mindset}`);
  }
  if (roleCard.persona?.habits) {
    parts.push(`## 工作习惯\n${roleCard.persona.habits}`);
  }
  if (roleCard.persona?.collaboration) {
    parts.push(`## 协作风格\n${roleCard.persona.collaboration}`);
  }

  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/layers/roleLayer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: implement roleLayer with persona 5 dimensions and constraints"
```

---

## Task 3: Implement projectLayer

**Files:**
- Modify: `src/lib/agent-context/layers/projectLayer.ts`
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write tests for projectLayer**

```typescript
describe('buildProjectLayer', () => {
  it('includes project name, path, and spec file reminder', () => {
    const result = buildProjectLayer({ name: 'My App', path: '/home/user/myapp' });
    expect(result).toContain('## 项目上下文');
    expect(result).toContain('- 项目：My App');
    expect(result).toContain('- 工作目录：/home/user/myapp');
    expect(result).toContain('CLAUDE.md / AGENTS.md');
  });

  it('omits project name when empty', () => {
    const result = buildProjectLayer({ name: '', path: '/tmp' });
    expect(result).not.toContain('- 项目：');
    expect(result).toContain('- 工作目录：/tmp');
  });
});
```

Add import: `import { buildProjectLayer } from '@/lib/agent-context/layers/projectLayer';`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 3: Implement projectLayer**

```typescript
// src/lib/agent-context/layers/projectLayer.ts
export function buildProjectLayer(project: { name: string; path: string }): string {
  const lines: string[] = ['## 项目上下文'];
  if (project.name) {
    lines.push(`- 项目：${project.name}`);
  }
  if (project.path) {
    lines.push(`- 工作目录：${project.path}`);
  }
  lines.push('- 项目根目录有 CLAUDE.md / AGENTS.md 规范文件，请遵循');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/layers/projectLayer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: implement projectLayer"
```

---

## Task 4: Implement teamLayer

**Files:**
- Modify: `src/lib/agent-context/layers/teamLayer.ts`
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write tests for teamLayer**

```typescript
describe('buildTeamLayer', () => {
  it('returns empty string when no role cards', () => {
    const result = buildTeamLayer('mario', []);
    expect(result).toBe('');
  });

  it('builds roster table excluding self and includes collaboration rules', () => {
    const roleCards: RoleCard[] = [
      makeRoleCard({ id: 'preset-planner', displayName: '项目统筹', category: 'planner', responsibilities: ['拆解任务', '排列优先级'] }),
      makeRoleCard({ id: 'preset-frontend', displayName: '前端实现', category: 'frontend', responsibilities: ['UI开发'] }),
    ];
    // When self is mario (planner), only luigi (frontend) should appear
    const result = buildTeamLayer('mario', roleCards);
    expect(result).toContain('## 团队名册');
    expect(result).toContain('| @mention |');
    expect(result).toContain('## 协作规则');
    expect(result).toContain('@mention 交接');
  });
});
```

Add import: `import { buildTeamLayer } from '@/lib/agent-context/layers/teamLayer';`

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement teamLayer**

```typescript
// src/lib/agent-context/layers/teamLayer.ts
import { AGENT_ROSTER } from '@/store/taskHubStore';
import type { RoleCard } from '@/types/roleCard';

const ROLE_LABELS: Record<string, string> = {
  planner: '规划',
  frontend: '实现',
  backend: '实现',
  code_reviewer: '评审',
  arch_reviewer: '评审',
  qa: '测试',
};

const COLLABORATION_RULES = `## 协作规则
- 遇到超出职责范围的工作，使用 @mention 交接给对应角色（另起一行行首写 @agentId）
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在回复中另起一行写 @agentId + 请求内容`;

export function buildTeamLayer(selfId: string, allRoleCards: RoleCard[]): string {
  const entries = AGENT_ROSTER.map((agent) => {
    const rc = allRoleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: rc?.displayName ?? agent.roleLabel,
      emoji: agent.emoji,
      roleLabel: rc?.category ? ROLE_LABELS[rc.category] ?? agent.roleLabel : agent.roleLabel,
      strengths: rc?.responsibilities.slice(0, 3) ?? [],
    };
  });

  const teammates = entries.filter((e) => e.id !== selfId);
  if (teammates.length === 0) return '';

  const header = '| @mention | 名字 | 角色 | 擅长 |';
  const sep = '|----------|------|------|------|';
  const rows = teammates.map(
    (t) => `| @${t.id} | ${t.emoji} ${t.name} | ${t.roleLabel} | ${t.strengths.join('、')} |`,
  );

  return `## 团队名册\n\n${header}\n${sep}\n${rows.join('\n')}\n\n${COLLABORATION_RULES}`;
}
```

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/layers/teamLayer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: implement teamLayer with roster table and collaboration rules"
```

---

## Task 5: Implement historyLayer

**Files:**
- Modify: `src/lib/agent-context/layers/historyLayer.ts`
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write tests for historyLayer**

```typescript
describe('buildHistoryLayer', () => {
  it('returns empty string for empty messages', () => {
    const result = buildHistoryLayer([], 'mario');
    expect(result).toBe('');
  });

  it('formats messages with timestamps and sender labels', () => {
    const messages: ChatMessage[] = [
      { id: '1', agentId: 'human', content: '你好', timestamp: '2026-05-03T10:00:00Z' },
      { id: '2', agentId: 'mario', content: '收到', timestamp: '2026-05-03T10:01:00Z' },
    ];
    const result = buildHistoryLayer(messages, 'mario');
    expect(result).toContain('[对话历史 - 最近 2 条]');
    expect(result).toContain('[10:00 用户] 你好');
    expect(result).toContain('[10:01 你（之前）] 收到');
    expect(result).toContain('[/对话历史]');
  });
});
```

Add import: `import { buildHistoryLayer } from '@/lib/agent-context/layers/historyLayer';`
Add `ChatMessage` to import from store: `import type { ChatMessage } from '@/store/taskHubStore';`

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement historyLayer**

```typescript
// src/lib/agent-context/layers/historyLayer.ts
import type { ChatMessage } from '@/store/taskHubStore';

const SENDER_LABELS: Record<string, string> = {
  human: '用户',
  system: '系统',
};

const MAX_MESSAGES = 10;
const MAX_CONTENT_LENGTH = 200;

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head - 15;
  return `${text.slice(0, head)}...[截断]...${text.slice(-tail)}`;
}

export function buildHistoryLayer(messages: ChatMessage[], selfId: string): string {
  if (messages.length === 0) return '';

  const recent = messages.slice(-MAX_MESSAGES);
  const lines = recent.map((msg) => {
    const time = formatTime(msg.timestamp);
    const sender = msg.agentId === selfId
      ? '你（之前）'
      : SENDER_LABELS[msg.agentId] ?? msg.agentId;
    const content = truncate(msg.content || '(工具调用)', MAX_CONTENT_LENGTH);
    return `[${time} ${sender}] ${content}`;
  });

  return `[对话历史 - 最近 ${lines.length} 条]\n${lines.join('\n')}\n[/对话历史]`;
}
```

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/layers/historyLayer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: implement historyLayer with message formatting and truncation"
```

---

## Task 6: Implement taskContextLayer, userMessageLayer, behaviorLayer

**Files:**
- Modify: `src/lib/agent-context/layers/taskContextLayer.ts`
- Modify: `src/lib/agent-context/layers/userMessageLayer.ts`
- Modify: `src/lib/agent-context/layers/behaviorLayer.ts`
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write tests for the three small layers**

```typescript
describe('buildTaskContextLayer', () => {
  it('wraps task id, title, and description', () => {
    const result = buildTaskContextLayer({
      id: 'task-1',
      title: 'Build auth',
      description: 'Implement JWT auth',
      phase: { title: 'Phase 1' },
    });
    expect(result).toContain('[任务: task-1 Build auth]');
    expect(result).toContain('[阶段: Phase 1]');
    expect(result).toContain('Implement JWT auth');
  });

  it('omits phase when not provided', () => {
    const result = buildTaskContextLayer({ id: 'task-2', title: 'Fix bug' });
    expect(result).not.toContain('[阶段:');
  });
});

describe('buildUserMessageLayer', () => {
  it('strips @mentions and trims', () => {
    expect(buildUserMessageLayer('@luigi 你好')).toBe('你好');
    expect(buildUserMessageLayer('  @mario help me  ')).toBe('help me');
  });

  it('falls back to greeting when empty after strip', () => {
    expect(buildUserMessageLayer('@mario ')).toBe('你好，请就绪并等待指令。');
    expect(buildUserMessageLayer('')).toBe('你好，请就绪并等待指令。');
  });
});

describe('buildBehaviorLayer', () => {
  it('returns the decision nudge', () => {
    const result = buildBehaviorLayer();
    expect(result).toContain('完成回复后思考');
    expect(result).toContain('交接给其他角色');
  });
});
```

Add imports:
```typescript
import { buildTaskContextLayer } from '@/lib/agent-context/layers/taskContextLayer';
import { buildUserMessageLayer } from '@/lib/agent-context/layers/userMessageLayer';
import { buildBehaviorLayer } from '@/lib/agent-context/layers/behaviorLayer';
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement taskContextLayer**

```typescript
// src/lib/agent-context/layers/taskContextLayer.ts
export function buildTaskContextLayer(task: {
  id: string;
  title: string;
  description?: string;
  phase?: { title: string };
}): string {
  const parts: string[] = [`[任务: ${task.id} ${task.title}]`];
  if (task.phase) {
    parts.push(`[阶段: ${task.phase.title}]`);
  }
  if (task.description) {
    parts.push(task.description);
  }
  return parts.join('\n');
}
```

- [ ] **Step 4: Implement userMessageLayer**

```typescript
// src/lib/agent-context/layers/userMessageLayer.ts
const FALLBACK_PROMPT = '你好，请就绪并等待指令。';

export function buildUserMessageLayer(rawPrompt: string): string {
  const cleaned = rawPrompt.replace(/@\w+\s*/g, '').trim();
  return cleaned || FALLBACK_PROMPT;
}
```

- [ ] **Step 5: Implement behaviorLayer**

```typescript
// src/lib/agent-context/layers/behaviorLayer.ts
export function buildBehaviorLayer(): string {
  return '完成回复后思考：是否需要交接给其他角色？是否需要请求用户确认？如不需要，正常结束即可。';
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent-context/layers/taskContextLayer.ts src/lib/agent-context/layers/userMessageLayer.ts src/lib/agent-context/layers/behaviorLayer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: implement taskContextLayer, userMessageLayer, and behaviorLayer"
```

---

## Task 7: Test the full composer integration

**Files:**
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write integration tests for composeSystemPrompt and composeUserPrompt**

```typescript
describe('composeSystemPrompt integration', () => {
  it('builds full system prompt on first wake', () => {
    const result = composeSystemPrompt({
      ...baseOpts,
      isFirstWake: true,
      allRoleCards: [baseOpts.roleCard],
    });
    expect(result).toBeDefined();
    expect(result!).toContain('你是 Mario，这个项目的统筹。');
    expect(result!).toContain('## 角色约束');
    expect(result!).toContain('## 项目上下文');
    expect(result!).toContain('## 团队名册');
    expect(result!).toContain('## 协作规则');
  });

  it('returns undefined on subsequent wake', () => {
    const result = composeSystemPrompt({ ...baseOpts, isFirstWake: false });
    expect(result).toBeUndefined();
  });
});

describe('composeUserPrompt integration', () => {
  it('builds user prompt with history, message, and behavior on first wake', () => {
    const messages: ChatMessage[] = [
      { id: '1', agentId: 'human', content: '之前的问题', timestamp: '2026-05-03T10:00:00Z' },
    ];
    const result = composeUserPrompt({
      ...baseOpts,
      isFirstWake: true,
      rawPrompt: '@mario 你好',
      messages,
    });
    expect(result).toContain('[对话历史');
    expect(result).toContain('之前的问题');
    expect(result).toContain('你好');
    expect(result).toContain('完成回复后思考');
    expect(result).not.toContain('@mario');
  });

  it('builds user prompt without history on subsequent wake', () => {
    const result = composeUserPrompt({
      ...baseOpts,
      isFirstWake: false,
      rawPrompt: '继续',
    });
    expect(result).not.toContain('[对话历史');
    expect(result).toContain('继续');
    expect(result).toContain('完成回复后思考');
  });

  it('includes task context when task provided', () => {
    const result = composeUserPrompt({
      ...baseOpts,
      isFirstWake: false,
      rawPrompt: '开始',
      task: { id: 'task-1', title: 'Auth', description: 'Build auth', phase: { title: 'Phase 1' } },
    });
    expect(result).toContain('[任务: task-1 Auth]');
    expect(result).toContain('[阶段: Phase 1]');
    expect(result).toContain('Build auth');
  });

  it('falls back to greeting for empty prompt', () => {
    const result = composeUserPrompt({
      ...baseOpts,
      isFirstWake: false,
      rawPrompt: '@mario ',
    });
    expect(result).toContain('你好，请就绪并等待指令。');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/agent-context/promptComposer.test.ts
git commit -m "test: add integration tests for composeSystemPrompt and composeUserPrompt"
```

---

## Task 8: Migrate dispatchToAgent to use composer

**Files:**
- Modify: `src/store/taskHubStore.ts:11-12` (imports)
- Modify: `src/store/taskHubStore.ts:1400-1444` (prompt assembly)

- [ ] **Step 1: Update imports**

Replace lines 11-12 in `src/store/taskHubStore.ts`:

```typescript
// FROM:
import { buildSystemPrompt } from '@/lib/agent-context/buildSystemPrompt';
import { buildConversationHistory } from '@/lib/agent-context/buildConversationHistory';

// TO:
import { composeSystemPrompt, composeUserPrompt } from '@/lib/agent-context/PromptComposer';
import type { ComposeOptions } from '@/lib/agent-context/PromptComposer';
```

- [ ] **Step 2: Replace inline prompt assembly in dispatchToAgent**

Replace the block from approximately line 1400 to 1444 (the section after engine/account resolution, before the `set()` call for agentStatus). The block starts at `// Strip @mentions` and ends at the `effectivePrompt +=` trailing nudge line.

```typescript
// FROM (lines ~1400-1444):
        // Strip @mentions — they're UI routing syntax, not task content
        const cleanedPrompt = prompt.replace(/@\w+\s*/g, '').trim() || '你好，请就绪并等待指令。';

        // Build system prompt from role card (only on first wake-up, session will carry context afterwards)
        let systemPrompt: string | undefined;
        let effectivePrompt = cleanedPrompt;
        if (agent?.roleCardId && !sessionId) {
          const rc = get().roleCards.find((c) => c.id === agent.roleCardId);
          if (rc) {
            const conv = get().conversations.find((c) => c.id === conversationId);
            systemPrompt = buildSystemPrompt({
              agentId,
              agentName: agent.name,
              roleCard: rc,
              allRoleCards: get().roleCards,
              projectName: conv?.title ?? '',
              projectPath: conv?.projectPath ?? '',
            });
          }
        }

        // Inject conversation history on first wake-up (agent enters existing conversation blind)
        if (!sessionId) {
          const existingMessages = get().chatMessagesByConversation[conversationId] ?? [];
          const history = buildConversationHistory(existingMessages, agentId);
          if (history) {
            effectivePrompt = `${history}\n\n---\n\n${effectivePrompt}`;
          }
        }

        // Inject task context if referencedTaskId exists
        if (referencedTaskId) {
          const task = get().getTaskById(referencedTaskId);
          if (task) {
            const phase = task.phaseId ? get().phases.find((p) => p.id === task.phaseId) : undefined;
            const contextParts: string[] = [`[任务: ${task.id} ${task.title}]`];
            if (phase) contextParts.push(`[阶段: ${phase.title}]`);
            if (task.description) contextParts.push(task.description);
            contextParts.push(effectivePrompt);
            effectivePrompt = contextParts.join('\n');
          }
        }

        // Trailing decision prompt — nudge agent to think about next steps
        effectivePrompt += '\n\n完成回复后思考：是否需要交接给其他角色？是否需要请求用户确认？如不需要，正常结束即可。';

// TO:
        // Build prompts via PromptComposer
        const roleCard = agent?.roleCardId ? get().roleCards.find((c) => c.id === agent.roleCardId) : undefined;
        const conv = get().conversations.find((c) => c.id === conversationId);
        const task = referencedTaskId ? get().getTaskById(referencedTaskId) : undefined;
        const phase = task?.phaseId ? get().phases.find((p) => p.id === task.phaseId) : undefined;

        const composeOpts: ComposeOptions = {
          agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
          roleCard: roleCard ?? makeRoleCard({ id: '__none__' }),
          allRoleCards: get().roleCards,
          project: { name: conv?.title ?? '', path: conv?.projectPath ?? '' },
          isFirstWake: !sessionId,
          messages: !sessionId ? (get().chatMessagesByConversation[conversationId] ?? []) : undefined,
          task: task ? { id: task.id, title: task.title, description: task.description, phase: phase ? { title: phase.title } : undefined } : undefined,
          rawPrompt: prompt,
        };

        const systemPrompt = roleCard ? composeSystemPrompt(composeOpts) : undefined;
        const effectivePrompt = composeUserPrompt(composeOpts);
```

Wait — we can't call `makeRoleCard` here (that's a test helper). Instead, when there's no roleCard, we should skip systemPrompt entirely (which the ternary `roleCard ? composeSystemPrompt(...) : undefined` already handles) and pass a dummy card to composeUserPrompt. Actually, composeUserPrompt doesn't use roleCard at all — it only uses rawPrompt, messages, task, and isFirstWake. So we can pass an empty object shape. But the type requires it.

Let me revise the approach: make `roleCard` optional in `ComposeOptions`, and handle the undefined case in `composeSystemPrompt`.

Actually the simplest fix: keep `roleCard` required in ComposeOptions, but in `dispatchToAgent`, only call `composeSystemPrompt` when roleCard exists (which we already do). For `composeUserPrompt`, we need a valid roleCard even though it's not used. We'll create a minimal fallback inline.

Revised approach — add a `MISSING_ROLE_CARD` constant:

No, even simpler — just make the condition work without it. The ComposeOptions type requires roleCard, but composeUserPrompt never reads it. So pass a dummy:

Actually, the cleanest approach is to make `roleCard` optional in ComposeOptions and only require it when `isFirstWake` is true. But that complicates the type.

**Simplest approach:** In dispatchToAgent, if no roleCard is found, don't compose at all — use the old inline behavior. But that defeats the purpose.

**Better approach:** Make roleCard optional in ComposeOptions. If missing, roleLayer returns empty string. composeUserPrompt doesn't need it.

Let me update the plan to reflect this: make `roleCard` optional.

Revised ComposeOptions:
```typescript
export interface ComposeOptions {
  agent: { id: string; name: string };
  roleCard?: RoleCard;        // optional — roleLayer returns '' if missing
  allRoleCards: RoleCard[];
  project: { name: string; path: string };
  isFirstWake: boolean;
  messages?: ChatMessage[];
  task?: { id: string; title: string; description?: string; phase?: { title: string } };
  rawPrompt: string;
}
```

And `buildRoleLayer` handles undefined:
```typescript
export function buildRoleLayer(agent: { id: string; name: string }, roleCard?: RoleCard): string {
  if (!roleCard) return '';
  // ... rest unchanged
}
```

This means `composeSystemPrompt` will produce an empty roleLayer if no card, which is correct — the system prompt just won't have role identity. And `composeUserPrompt` doesn't touch roleCard at all.

OK, let me finalize the replacement block:

```typescript
        // Build prompts via PromptComposer
        const roleCard = agent?.roleCardId ? get().roleCards.find((c) => c.id === agent.roleCardId) : undefined;
        const conv = get().conversations.find((c) => c.id === conversationId);
        const task = referencedTaskId ? get().getTaskById(referencedTaskId) : undefined;
        const phase = task?.phaseId ? get().phases.find((p) => p.id === task.phaseId) : undefined;

        const composeOpts: ComposeOptions = {
          agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
          roleCard,
          allRoleCards: get().roleCards,
          project: { name: conv?.title ?? '', path: conv?.projectPath ?? '' },
          isFirstWake: !sessionId,
          messages: !sessionId ? (get().chatMessagesByConversation[conversationId] ?? []) : undefined,
          task: task ? {
            id: task.id, title: task.title,
            description: task.description,
            phase: phase ? { title: phase.title } : undefined,
          } : undefined,
          rawPrompt: prompt,
        };

        const systemPrompt = composeSystemPrompt(composeOpts);
        const effectivePrompt = composeUserPrompt(composeOpts);
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "refactor: migrate dispatchToAgent to use PromptComposer"
```

---

## Task 9: Migrate simulateCliExecution to use composer

**Files:**
- Modify: `src/store/taskHubStore.ts:1578-1594` (inline systemPrompt builder)
- Modify: `src/components/task-hub/TaskDetailPanel.tsx:319` (fix sessionId)

- [ ] **Step 1: Replace inline systemPrompt in simulateCliExecution**

Replace the block from `// Build system prompt from role card` through the closing of the `if (agent?.roleCardId ...)` block (approximately lines 1578-1596):

```typescript
// FROM:
        // Build system prompt from role card (first wake-up only)
        let systemPrompt: string | undefined;
        if (agent?.roleCardId && !resolvedSessionId) {
          const rc = get().roleCards.find((c) => c.id === agent.roleCardId);
          if (rc) {
            const parts: string[] = [];
            if (rc.persona?.introduction) {
              parts.push(rc.persona.introduction);
            } else {
              parts.push(`[Role: ${rc.displayName}]`);
              if (rc.responsibilities.length) parts.push(`Responsibilities: ${rc.responsibilities.join(', ')}`);
              if (rc.nonResponsibilities.length) parts.push(`NOT responsible for: ${rc.nonResponsibilities.join(', ')}`);
              if (rc.outputFormat !== 'freeform') parts.push(`Output format: ${rc.outputFormat}`);
              if (rc.requiresEvidence) parts.push('Must provide evidence/references');
              if (rc.forbiddenActions.length) parts.push(`Forbidden: ${rc.forbiddenActions.join(', ')}`);
            }
            systemPrompt = parts.join('\n');
          }
        }

// TO:
        // Build prompts via PromptComposer
        const simRoleCard = agent?.roleCardId ? get().roleCards.find((c) => c.id === agent.roleCardId) : undefined;
        const simOpts: ComposeOptions = {
          agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
          roleCard: simRoleCard,
          allRoleCards: get().roleCards,
          project: { name: '', path: '' },
          isFirstWake: !resolvedSessionId,
          rawPrompt: prompt,
        };

        const systemPrompt = composeSystemPrompt(simOpts);
```

Note: `simulateCliExecution` does not have access to conversation history, task context, or project info from the conversation. The PromptComposer handles this gracefully — `composeSystemPrompt` will produce ProjectLayer with empty project name (still includes spec file reminder), and `composeUserPrompt` would add behavior nudge. But the current `simulateCliExecution` doesn't use `composeUserPrompt` — it passes `prompt` directly to the socket emit. We'll keep that as-is for now since `simulateCliExecution` is a simpler path.

Wait — looking at the current code, `simulateCliExecution` passes `prompt` directly to `socket.emit('terminal:start', { prompt, ... })` without any of the user prompt layers (no history, no task context, no behavior nudge). This is intentional — it's a simple "Run Engine" button that sends a raw progress check prompt. We should keep this behavior and only migrate the systemPrompt part.

- [ ] **Step 2: Fix TaskDetailPanel sessionId parameter**

In `src/components/task-hub/TaskDetailPanel.tsx` line 319, change the third argument from a hardcoded string to `undefined`:

```typescript
// FROM:
onClick={() => simulateCliExecution(task.id, `任务：${task.title}。请给出简短的进度更新。`, `agent-${agent.id}`)}

// TO:
onClick={() => simulateCliExecution(task.id, `任务：${task.title}。请给出简短的进度更新。`, undefined)}
```

- [ ] **Step 3: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/store/taskHubStore.ts src/components/task-hub/TaskDetailPanel.tsx
git commit -m "refactor: migrate simulateCliExecution to use PromptComposer and fix sessionId"
```

---

## Task 10: Delete old builder files and clean up

**Files:**
- Delete: `src/lib/agent-context/buildSystemPrompt.ts`
- Delete: `src/lib/agent-context/buildTeamRoster.ts`
- Delete: `src/lib/agent-context/buildConversationHistory.ts`

- [ ] **Step 1: Verify no remaining imports of old files**

Run: `grep -rn "buildSystemPrompt\|buildTeamRoster\|buildConversationHistory" src/ --include='*.ts' --include='*.tsx'`
Expected: Only references in the old files themselves (no imports elsewhere)

- [ ] **Step 2: Delete old files**

```bash
rm src/lib/agent-context/buildSystemPrompt.ts src/lib/agent-context/buildTeamRoster.ts src/lib/agent-context/buildConversationHistory.ts
```

- [ ] **Step 3: Run full type check and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors, all 261+ tests pass

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/agent-context/
git commit -m "chore: remove old buildSystemPrompt, buildTeamRoster, buildConversationHistory"
```

---

## Verification

- [ ] `npx tsc --noEmit` — no errors
- [ ] `npx vitest run` — all tests pass
- [ ] `pnpm build` — builds successfully
- [ ] Manual test: First @mention to an agent should include full system prompt with persona, project, team roster
- [ ] Manual test: Second message to same agent should NOT include system prompt (uses --session resume)
- [ ] Manual test: TaskDetailPanel "Run Engine" button should now inject role card system prompt on first use
