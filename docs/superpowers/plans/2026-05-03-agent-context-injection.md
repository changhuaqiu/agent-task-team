# Agent Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent is first @mentioned in a conversation, inject a rich system prompt with role identity, team roster, collaboration rules, project context, and recent conversation history — so the agent knows who it is, who its teammates are, and what's been discussed.

**Architecture:** Create a `src/lib/agent-context/` module with three pure functions: `buildSystemPrompt()` assembles the static identity block (role + roster + rules + project), `buildConversationHistory()` formats recent chat messages as `[HH:MM sender] content`, and `buildTeamRoster()` generates the teammate table. The `dispatchToAgent` function in taskHubStore.ts calls these to assemble both `systemPrompt` and an enriched `userPrompt` on first wake-up.

**Tech Stack:** TypeScript, Zustand store, pure functions (no React)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/agent-context/buildSystemPrompt.ts` | Assembles full systemPrompt from RoleCard + team roster + project context |
| `src/lib/agent-context/buildTeamRoster.ts` | Generates teammate roster table from AGENT_ROSTER |
| `src/lib/agent-context/buildConversationHistory.ts` | Formats last N ChatMessages as `[HH:MM sender] content` |
| `src/store/taskHubStore.ts` (modify) | Replaces inline systemPrompt logic in `dispatchToAgent` with calls to the above |

---

### Task 1: Create buildTeamRoster

**Files:**
- Create: `src/lib/agent-context/buildTeamRoster.ts`

- [ ] **Step 1: Create the file**

Create `src/lib/agent-context/buildTeamRoster.ts`:

```ts
import { AGENT_ROSTER } from '@/store/taskHubStore';
import type { RoleCard } from '@/types/roleCard';

const ROLE_LABELS: Record<string, string> = {
  planner: '规划',
  worker: '实现',
  reviewer: '评审',
};

interface RosterEntry {
  id: string;
  name: string;
  displayName: string;
  emoji: string;
  roleLabel: string;
  strengths: string[];
}

function getRosterEntries(roleCards: RoleCard[]): RosterEntry[] {
  return AGENT_ROSTER.map((agent) => {
    const rc = roleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: rc?.displayName ?? agent.roleLabel,
      emoji: agent.emoji,
      roleLabel: rc?.category ? ROLE_LABELS[rc.category] ?? agent.roleLabel : agent.roleLabel,
      strengths: rc?.responsibilities.slice(0, 3) ?? [],
    };
  });
}

export function buildTeamRoster(selfId: string, roleCards: RoleCard[]): string {
  const entries = getRosterEntries(roleCards);
  const teammates = entries.filter((e) => e.id !== selfId);

  if (teammates.length === 0) return '';

  const header = '| @mention | 名字 | 角色 | 擅长 |';
  const sep =     '|----------|------|------|------|';
  const rows = teammates.map(
    (t) => `| @${t.id} | ${t.emoji} ${t.name} | ${t.roleLabel} | ${t.strengths.join('、')} |`,
  );

  return `## 团队名册\n\n${header}\n${sep}\n${rows.join('\n')}`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-context/buildTeamRoster.ts
git commit -m "feat: add buildTeamRoster for agent context injection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Create buildConversationHistory

**Files:**
- Create: `src/lib/agent-context/buildConversationHistory.ts`

- [ ] **Step 1: Create the file**

Create `src/lib/agent-context/buildConversationHistory.ts`:

```ts
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

export function buildConversationHistory(
  messages: ChatMessage[],
  selfId: string,
): string {
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

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-context/buildConversationHistory.ts
git commit -m "feat: add buildConversationHistory for agent context injection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Create buildSystemPrompt

**Files:**
- Create: `src/lib/agent-context/buildSystemPrompt.ts`

- [ ] **Step 1: Create the file**

Create `src/lib/agent-context/buildSystemPrompt.ts`:

```ts
import type { RoleCard } from '@/types/roleCard';
import { buildTeamRoster } from './buildTeamRoster';

export interface SystemPromptContext {
  agentId: string;
  agentName: string;
  roleCard: RoleCard;
  allRoleCards: RoleCard[];
  projectName: string;
  projectPath: string;
}

function buildRoleIdentity(rc: RoleCard): string {
  const parts: string[] = [];

  if (rc.persona?.introduction) {
    parts.push(rc.persona.introduction);
  }

  const constraints: string[] = [];
  if (rc.responsibilities.length) {
    constraints.push(`- 职责：${rc.responsibilities.join('、')}`);
  }
  if (rc.nonResponsibilities.length) {
    constraints.push(`- 非职责：${rc.nonResponsibilities.join('、')}`);
  }
  if (rc.forbiddenActions.length) {
    constraints.push(`- 禁止：${rc.forbiddenActions.join('、')}`);
  }
  if (rc.requiresEvidence) {
    constraints.push('- 评审/建议必须附带具体证据和文件引用');
  }
  if (rc.outputFormat !== 'freeform') {
    const formatLabels: Record<string, string> = {
      structured_list: '结构化列表',
      report: '报告',
      checklist: '检查清单',
    };
    constraints.push(`- 输出格式：${formatLabels[rc.outputFormat] ?? rc.outputFormat}`);
  }
  if (rc.allowedActions.includes('can_propose_only') && !rc.allowedActions.includes('can_modify_code')) {
    constraints.push('- 只能提出建议，不能直接修改代码');
  }
  if (rc.requiresConfirmation.length) {
    constraints.push(`- 以下操作需用户确认：${rc.requiresConfirmation.join('、')}`);
  }

  if (constraints.length > 0) {
    parts.push('## 角色约束\n' + constraints.join('\n'));
  }

  return parts.join('\n\n');
}

function buildCollaborationRules(rc: RoleCard): string {
  return `## 协作规则

- 遇到超出职责范围的工作，使用 @mention 交接给对应角色（另起一行行首写 @agentId）
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在回复中另起一行写 @agentId + 请求内容`;
}

function buildProjectContext(projectName: string, projectPath: string): string {
  const parts: string[] = ['## 项目上下文'];
  if (projectName) {
    parts.push(`- 项目：${projectName}`);
  }
  if (projectPath) {
    parts.push(`- 工作目录：${projectPath}`);
  }
  parts.push('- 项目根目录有 CLAUDE.md / AGENTS.md 规范文件，请遵循');
  return parts.join('\n');
}

function buildIdentityConstant(agentId: string, agentName: string, rc: RoleCard): string {
  return `Identity: ${agentName} (@${agentId}, role=${rc.displayName})`;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections: string[] = [];

  // ① Role identity + constraints
  sections.push(buildRoleIdentity(ctx.roleCard));

  // ② Team roster
  const roster = buildTeamRoster(ctx.agentId, ctx.allRoleCards);
  if (roster) sections.push(roster);

  // ③ Collaboration rules
  sections.push(buildCollaborationRules(ctx.roleCard));

  // ④ Project context
  sections.push(buildProjectContext(ctx.projectName, ctx.projectPath));

  // ⑤ Identity constant (compression anchor)
  sections.push(buildIdentityConstant(ctx.agentId, ctx.agentName, ctx.roleCard));

  return sections.join('\n\n');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-context/buildSystemPrompt.ts
git commit -m "feat: add buildSystemPrompt for agent context injection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Wire into dispatchToAgent

**Files:**
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Add imports**

At the top of `src/store/taskHubStore.ts`, after the existing imports (around line 8), add:

```ts
import { buildSystemPrompt, type SystemPromptContext } from '@/lib/agent-context/buildSystemPrompt';
import { buildConversationHistory } from '@/lib/agent-context/buildConversationHistory';
```

- [ ] **Step 2: Replace the systemPrompt building block**

Find the block at lines 1375-1394 in `dispatchToAgent`:

```ts
        // Build system prompt from role card (only on first wake-up, session will carry context afterwards)
        let systemPrompt: string | undefined;
        let effectivePrompt = cleanedPrompt;
        if (agent?.roleCardId && !sessionId) {
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
```

Replace with:

```ts
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
```

- [ ] **Step 3: Inject conversation history into userPrompt**

Find the block at lines 1396-1407 (the task context injection block):

```ts
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
```

Replace with:

```ts
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
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: wire rich context injection into dispatchToAgent

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ① Role identity + structured constraints → Task 3 `buildRoleIdentity` ✓
- ② Team roster → Task 1 + Task 3 ✓
- ③ Collaboration rules → Task 3 `buildCollaborationRules` ✓
- ④ Project context + CLAUDE.md hint → Task 3 `buildProjectContext` ✓
- ⑤ Identity constant → Task 3 `buildIdentityConstant` ✓
- ⑥ Conversation history → Task 2 + Task 4 ✓
- ⑦ A2A handoff — not in this scope (deferred, requires agent→agent dispatch tracking)
- ⑧ Task context — preserved from existing code ✓
- ⑨ User message — preserved ✓
- ⑩ Trailing decision prompt → Task 4 ✓

**Placeholder scan:** No TBD/TODO. All code blocks contain actual content.

**Type consistency:**
- `buildSystemPrompt` takes `SystemPromptContext` which requires `agentId: string` (matches `agent.id` from `AGENT_ROSTER`)
- `buildConversationHistory` takes `ChatMessage[]` (matches `chatMessagesByConversation[conversationId]`) and `selfId: string` (matches `agentId`)
- `buildTeamRoster` takes `selfId: string` (matches `agentId`) and `RoleCard[]` (matches `get().roleCards`)
- `RoleCard.persona?.introduction` is optional — `buildRoleIdentity` handles both with and without persona
