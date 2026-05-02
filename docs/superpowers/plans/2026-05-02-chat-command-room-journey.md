# Chat Command Room Journey Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the center-column chat panel user journey across 4 directions: cold start, execution visibility, feedback & context, and message management.

**Architecture:** Extend the Zustand store with new ChatMessage fields and selectors, then build UI features on top. Store changes are testable with vitest; UI changes are visual and tested manually. Each direction produces independently deployable changes.

**Tech Stack:** React 19, Zustand 5, Next.js 16, Tailwind CSS v4, vitest 4, TypeScript, socket.io

**Design Spec:** `docs/superpowers/specs/2026-05-02-chat-command-room-journey-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/store/taskHubStore.ts` | State management, data model, selectors, actions | Modify |
| `src/components/task-hub/GlobalChatRoom.tsx` | Chat room container, input, message list | Modify |
| `src/components/task-hub/ChatMessageItem.tsx` | Individual message rendering | Modify |
| `src/components/task-hub/AgentBar.tsx` | Agent status bar | Modify |
| `src/components/project/ProjectChatPanel.tsx` | Chat panel header, layout | Modify |
| `src/components/task-hub/ChatFilterBar.tsx` | New: message filter/search toolbar | Create |
| `src/components/task-hub/MessageGroup.tsx` | New: grouped message rendering | Create |
| `src/components/task-hub/ProgressMessageCard.tsx` | New: progress bar + steps card | Create |
| `src/__tests__/store/chat-message-extensions.test.ts` | Tests for store extensions | Create |

---

## Task 1: Extend ChatMessage Type & Store Selectors

**Files:**
- Modify: `src/store/taskHubStore.ts:97-108` (ChatMessage interface)
- Modify: `src/store/taskHubStore.ts:476-480` (selectors)
- Create: `src/__tests__/store/chat-message-extensions.test.ts`

**Why:** All subsequent tasks depend on the extended ChatMessage type and new selectors. Do this first.

- [ ] **Step 1: Write failing tests for new selectors**

```typescript
// src/__tests__/store/chat-message-extensions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('ChatMessage extensions', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      conversations: [],
      tasks: [],
      chatMessagesByConversation: {},
      selectedConversationId: null,
      activeAgentIds: ['jean', 'keqing'],
    });
  });

  describe('selectAgentCurrentTask', () => {
    it('returns the in_progress task for a given agent', () => {
      const convId = 'conv-1';
      useTaskHubStore.setState({
        tasks: [
          { id: 'T-001', conversationId: convId, phaseId: 'p1', title: 'Init project', description: '', status: 'in_progress', agentId: 'keqing', dependencies: [], artifacts: [], createdAt: '2026-05-02T10:00:00Z', updatedAt: '2026-05-02T10:00:00Z' },
          { id: 'T-002', conversationId: convId, phaseId: 'p1', title: 'Build UI', description: '', status: 'pending', agentId: 'keqing', dependencies: [], artifacts: [], createdAt: '2026-05-02T10:00:00Z', updatedAt: '2026-05-02T10:00:00Z' },
        ],
      });

      const state = useTaskHubStore.getState();
      const task = state.getAgentCurrentTask('keqing');
      expect(task?.id).toBe('T-001');
      expect(task?.title).toBe('Init project');
    });

    it('returns undefined when agent has no in_progress task', () => {
      useTaskHubStore.setState({
        tasks: [
          { id: 'T-001', conversationId: 'conv-1', phaseId: 'p1', title: 'Init', description: '', status: 'done', agentId: 'keqing', dependencies: [], artifacts: [], createdAt: '', updatedAt: '' },
        ],
      });

      const state = useTaskHubStore.getState();
      expect(state.getAgentCurrentTask('keqing')).toBeUndefined();
    });
  });

  describe('addChatMessage auto-create conversation', () => {
    it('auto-creates conversation when no conversation selected and none exist', () => {
      useTaskHubStore.setState({
        conversations: [],
        selectedConversationId: null,
        chatMessagesByConversation: {},
      });

      useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: '帮我搭一个博客系统，支持 Markdown',
      });

      const state = useTaskHubStore.getState();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].title).toBe('帮我搭一个博客系统，支持 Markdown');
      expect(state.selectedConversationId).toBe(state.conversations[0].id);
    });

    it('does NOT auto-create when conversations already exist', () => {
      useTaskHubStore.setState({
        conversations: [{ id: 'conv-1', title: 'Existing', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '', updatedAt: '' }],
        selectedConversationId: null,
        chatMessagesByConversation: {},
      });

      useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: 'Another message',
      });

      expect(useTaskHubStore.getState().conversations).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/chat-message-extensions.test.ts`
Expected: FAIL — `getAgentCurrentTask` does not exist, auto-create logic not implemented

- [ ] **Step 3: Extend ChatMessage interface**

In `src/store/taskHubStore.ts`, replace the ChatMessage interface (lines 97-108):

```typescript
export interface ChatMessage {
  id: string;
  agentId: string | 'human' | 'system';
  content: string;
  timestamp: string;
  isApprovalRequest?: boolean;
  referencedTaskId?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  mentions?: string[];
  intent?: 'ideate' | 'execute' | 'review' | 'general' | 'progress';
  selectedProposals?: string[];
  // New fields for journey optimization
  progressData?: {
    taskId: string;
    type: 'start' | 'update' | 'complete';
    completedSteps: number;
    totalSteps: number;
    steps: { label: string; status: 'done' | 'in_progress' | 'pending' }[];
  };
  artifactPreview?: {
    files: { path: string; change: 'added' | 'modified' | 'deleted' }[];
  };
  rejectionReason?: string;
}
```

- [ ] **Step 4: Add `getAgentCurrentTask` selector to store**

In `src/store/taskHubStore.ts`, add to the `TaskHubState` interface (after line 480):

```typescript
getAgentCurrentTask: (agentId: string) => Task | undefined;
```

In the store creation (after the selectors section), add the implementation:

```typescript
getAgentCurrentTask: (agentId: string) => {
  return get().tasks.find(t => t.agentId === agentId && t.status === 'in_progress');
},
```

- [ ] **Step 5: Add auto-create conversation logic to `addChatMessage`**

In `src/store/taskHubStore.ts`, find the `addChatMessage` action (around line 1389). At the beginning of the function body, before the existing logic, add:

```typescript
addChatMessage: (msg) => {
  // Auto-create conversation if none selected and none exist
  if (!get().selectedConversationId && get().conversations.length === 0 && msg.agentId === 'human') {
    const title = msg.content.length > 20
      ? msg.content.slice(0, msg.content.indexOf('，') > 0 ? msg.content.indexOf('，') : 20)
      : msg.content;
    get().createConversation({ title, goal: msg.content });
  }

  const convId = msg.conversationId || get().selectedConversationId;
  if (!convId) return;

  // ... rest of existing addChatMessage logic, replacing:
  //   const convId = msg.conversationId ?? get().selectedConversationId;
  //   with the above const convId line
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/store/chat-message-extensions.test.ts`
Expected: PASS

- [ ] **Step 7: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 8: Commit**

```bash
git add src/store/taskHubStore.ts src/__tests__/store/chat-message-extensions.test.ts
git commit -m "feat: extend ChatMessage type and add auto-create conversation selector"
```

---

## Task 2: Unlock Input & Welcome State (Cold Start)

**Files:**
- Modify: `src/components/task-hub/GlobalChatRoom.tsx:74-128` (empty state, input area)
- Modify: `src/components/project/ProjectChatPanel.tsx:41` (header title)

**Why:** Remove the biggest friction point — users can't do anything until they create a project elsewhere.

- [ ] **Step 1: Remove input disabled logic in GlobalChatRoom**

In `src/components/task-hub/GlobalChatRoom.tsx`, remove `disabled={!selectedConversationId}` from the textarea (line 96). The input should always be enabled.

- [ ] **Step 2: Update empty state content**

In `src/components/task-hub/GlobalChatRoom.tsx`, replace the empty state block (lines 74-78) with the welcome state. Find and replace the entire `{!selectedConversationId && (...)}` block:

```tsx
{!selectedConversationId && chatMessages.length === 0 && (
  <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12 px-4">
    <div className="text-3xl">⚔️</div>
    <div className="text-center">
      <h3 className="text-[14px] font-bold text-[hsl(var(--text-primary))]">
        作战指挥室
      </h3>
      <p className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1 max-w-[280px] leading-relaxed">
        描述你想构建的东西，或 @Agent 下达具体指令。
        <br />首次发送将自动创建项目。
      </p>
    </div>
    <div className="flex flex-wrap gap-2 justify-center mt-2">
      {[
        '@Jean 帮我规划一下…',
        '@Keqing 写一个…',
        '@Zhongli 审查…',
      ].map((hint) => (
        <button
          key={hint}
          type="button"
          onClick={() => setInputValue(hint)}
          className="text-[10px] px-3 py-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))] hover:text-[hsl(var(--text-primary))] transition-colors"
        >
          {hint}
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Update hint text below input**

In `src/components/task-hub/GlobalChatRoom.tsx`, replace the hint paragraph (lines 123-125):

```tsx
<p className="text-[9px] font-medium text-[hsl(var(--text-tertiary))] mt-2 ml-1">
  使用 #TASK-000 引用任务 · @Agent 提及智能体
</p>
```

- [ ] **Step 4: Update ProjectChatPanel header text**

In `src/components/project/ProjectChatPanel.tsx`, line 41, replace:

```tsx
{selectedConversation?.title || '请选择一个项目'}
```

with:

```tsx
{selectedConversation?.title || '⚔️ 作战指挥室'}
```

- [ ] **Step 5: Add context-aware empty state for selected project with no messages**

In `src/components/task-hub/GlobalChatRoom.tsx`, add after the welcome state block, a new block for when a conversation is selected but has no messages. Insert before the `{chatMessages.map(...)}` block:

```tsx
{selectedConversationId && chatMessages.length === 0 && (() => {
  const conv = useTaskHubStore.getState().getSelectedConversation();
  const convTasks = useTaskHubStore.getState().tasks.filter(t => t.conversationId === selectedConversationId);
  const hasGoal = conv?.goal && conv.goal.length > 0;
  const hasTasks = convTasks.length > 0;
  const agents = useTaskHubStore.getState().activeAgentIds;
  const accounts = useTaskHubStore.getState().accounts;
  const hasBoundAccount = agents.some(aid => {
    const agent = AGENT_ROSTER.find(a => a.id === aid);
    if (!agent) return false;
    const rc = useTaskHubStore.getState().roleCards.find(c => c.id === agent.roleCardId);
    return rc?.accountIds.some(accId => accounts.find(a => a.id === accId)?.status === 'valid');
  });

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-8 px-4">
      {!hasBoundAccount && (
        <>
          <div className="text-2xl">⚠️</div>
          <p className="text-[11px] text-[hsl(var(--text-tertiary))] text-center max-w-[260px]">
            Agent 需要绑定账号才能出战
          </p>
          <button
            type="button"
            onClick={() => useTaskHubStore.getState().setRosterModalOpen(true)}
            className="text-[10px] font-bold px-3 py-1.5 bg-[hsl(var(--accent))] text-white rounded-[2px] shadow-[2px_2px_0px_hsl(var(--text-primary))] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
          >
            配置 Agent
          </button>
        </>
      )}
      {hasBoundAccount && !hasTasks && (
        <>
          <div className="text-2xl">🔑</div>
          <p className="text-[11px] text-[hsl(var(--text-tertiary))] text-center max-w-[260px]">
            {hasGoal ? `目标：${conv.goal.slice(0, 50)}…` : '@Jean 可以帮你拆解任务'}
          </p>
        </>
      )}
      {hasBoundAccount && hasTasks && (
        <>
          <div className="text-2xl">📋</div>
          <p className="text-[11px] text-[hsl(var(--text-tertiary))] text-center">
            {convTasks.filter(t => t.status === 'pending').length} 个待执行任务
          </p>
        </>
      )}
    </div>
  );
})()}
```

Also add the `AGENT_ROSTER` import if not present:

```tsx
import { useTaskHubStore, AGENT_ROSTER, type ChatMessage } from '@/store/taskHubStore';
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev`
- Open the app without any project → should see welcome state with "作战指挥室" + 3 suggestion buttons
- Input should be enabled
- Click a suggestion → should fill input without sending
- Type a message and send → should auto-create a project

- [ ] **Step 7: Commit**

```bash
git add src/components/task-hub/GlobalChatRoom.tsx src/components/project/ProjectChatPanel.tsx
git commit -m "feat: unlock chat input on cold start with welcome state and quick suggestions"
```

---

## Task 3: AgentBar Working Status (Execution Visibility)

**Files:**
- Modify: `src/components/task-hub/AgentBar.tsx:10-13` (add store selectors)
- Modify: `src/components/task-hub/AgentBar.tsx:37-107` (agent card rendering)

**Why:** Users can't see which Agent is actively working on which task.

- [ ] **Step 1: Add task selector to AgentBar**

In `src/components/task-hub/AgentBar.tsx`, add `tasks` to the store selectors (after line 13):

```tsx
const tasks = useTaskHubStore((s) => s.tasks);
```

- [ ] **Step 2: Update agent card rendering to show working state**

In `src/components/task-hub/AgentBar.tsx`, find the agent card `<button>` (around line 39-63). Replace the entire button className to add working-state styling. Find:

```tsx
className={cn(
  'flex items-center gap-1.5 px-2 py-1 rounded-[4px] border-2 transition-all',
  isExpanded
    ? 'border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] shadow-[2px_2px_0px_hsl(var(--text-primary))]'
    : cfg
      ? `border-[hsl(var(${cfg.themeVar})/0.4)] bg-[hsl(var(${cfg.themeVar}-soft)/0.5)] hover:border-[hsl(var(${cfg.themeVar}))]`
      : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] hover:border-[hsl(var(--text-primary))]',
)}
```

Replace with:

```tsx
className={cn(
  'flex items-center gap-1.5 px-2 py-1 rounded-[4px] border-2 transition-all',
  isExpanded
    ? 'border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] shadow-[2px_2px_0px_hsl(var(--text-primary))]'
    : currentTask
      ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_8px_rgba(59,130,246,0.2)] hover:border-blue-400'
      : cfg
        ? `border-[hsl(var(${cfg.themeVar})/0.4)] bg-[hsl(var(${cfg.themeVar}-soft)/0.5)] hover:border-[hsl(var(${cfg.themeVar}))]`
        : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] hover:border-[hsl(var(--text-primary))]',
)}
```

- [ ] **Step 3: Add current task lookup and display**

Before the return of the agent `.map()`, add the current task lookup:

```tsx
const currentTask = tasks.find(t => t.agentId === agent.id && t.status === 'in_progress');
```

After the agent name/role display (after line 75), add the current task title when agent is working:

```tsx
{currentTask && (
  <span className="text-[8px] text-blue-400 max-w-[60px] truncate animate-pulse">
    {currentTask.title}
  </span>
)}
```

Replace the existing account status dot (lines 77-84) with a combined status indicator:

```tsx
<span
  className={cn(
    'w-1.5 h-1.5 rounded-full shrink-0',
    currentTask ? 'bg-blue-400 animate-pulse' : hasValidAccount ? 'bg-emerald-400' : boundCount > 0 ? 'bg-amber-400' : 'bg-zinc-400',
  )}
  title={currentTask ? `执行中: ${currentTask.title}` : hasValidAccount ? '账号已验证' : boundCount > 0 ? '账号待验证' : '未绑定账号'}
/>
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev`
- Create a project, confirm breakdown so tasks are created
- Manually set a task to `in_progress` with an agent
- Agent card should show blue border + pulsing dot + truncated task title

- [ ] **Step 5: Commit**

```bash
git add src/components/task-hub/AgentBar.tsx
git commit -m "feat: show agent working status with current task in AgentBar"
```

---

## Task 4: Progress Messages in Store (Execution Visibility)

**Files:**
- Modify: `src/store/taskHubStore.ts` (socket event handlers, around line 1509-1615)
- Create: test additions in `src/__tests__/store/chat-message-extensions.test.ts`

**Why:** Agent execution progress needs to surface as chat messages driven by daemon events.

- [ ] **Step 1: Write failing test for progress message creation**

Add to `src/__tests__/store/chat-message-extensions.test.ts`:

```typescript
describe('progress message creation', () => {
  it('createProgressMessage builds correct message for start type', () => {
    const msg = useTaskHubStore.getState().createProgressMessage({
      taskId: 'T-001',
      taskTitle: 'Init project',
      type: 'start',
    }, 'conv-1');
    expect(msg.agentId).toBe('system');
    expect(msg.intent).toBe('progress');
    expect(msg.progressData?.type).toBe('start');
    expect(msg.progressData?.taskId).toBe('T-001');
    expect(msg.content).toContain('T-001');
    expect(msg.content).toContain('开始执行');
  });

  it('createProgressMessage builds correct message for complete type', () => {
    const msg = useTaskHubStore.getState().createProgressMessage({
      taskId: 'T-001',
      taskTitle: 'Init project',
      type: 'complete',
    }, 'conv-1');
    expect(msg.progressData?.type).toBe('complete');
    expect(msg.content).toContain('执行完成');
  });

  it('createProgressMessage builds correct message for update type with steps', () => {
    const msg = useTaskHubStore.getState().createProgressMessage({
      taskId: 'T-001',
      taskTitle: 'Init project',
      type: 'update',
      completedSteps: 2,
      totalSteps: 4,
      steps: [
        { label: 'Install deps', status: 'done' },
        { label: 'Config Tailwind', status: 'done' },
        { label: 'Setup ESLint', status: 'in_progress' },
        { label: 'Create layout', status: 'pending' },
      ],
    }, 'conv-1');
    expect(msg.progressData?.completedSteps).toBe(2);
    expect(msg.progressData?.totalSteps).toBe(4);
    expect(msg.progressData?.steps).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/chat-message-extensions.test.ts`
Expected: FAIL — `createProgressMessage` does not exist

- [ ] **Step 3: Add `createProgressMessage` action to store**

In `src/store/taskHubStore.ts`, add to the `TaskHubState` interface:

```typescript
createProgressMessage: (params: {
  taskId: string;
  taskTitle: string;
  type: 'start' | 'update' | 'complete';
  completedSteps?: number;
  totalSteps?: number;
  steps?: { label: string; status: 'done' | 'in_progress' | 'pending' }[];
}, conversationId: string) => ChatMessage;
```

Add the implementation in the store:

```typescript
createProgressMessage: (params, conversationId) => {
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const contentTemplates = {
    start: `▶ #${params.taskId} 开始执行 — ${params.taskTitle}`,
    update: `⟳ #${params.taskId} 进度更新 — ${params.completedSteps}/${params.totalSteps}`,
    complete: `✓ #${params.taskId} 执行完成 — ${params.taskTitle}`,
  };

  return {
    id,
    agentId: 'system',
    content: contentTemplates[params.type],
    timestamp: new Date().toISOString(),
    intent: 'progress',
    referencedTaskId: params.taskId,
    conversationId,
    progressData: {
      taskId: params.taskId,
      type: params.type,
      completedSteps: params.completedSteps ?? 0,
      totalSteps: params.totalSteps ?? 0,
      steps: params.steps ?? [],
    },
  };
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/store/chat-message-extensions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/taskHubStore.ts src/__tests__/store/chat-message-extensions.test.ts
git commit -m "feat: add createProgressMessage store action for execution visibility"
```

---

## Task 5: Progress Message Card UI (Execution Visibility)

**Files:**
- Create: `src/components/task-hub/ProgressMessageCard.tsx`
- Modify: `src/components/task-hub/ChatMessageItem.tsx:15-26` (IntentIcon) and lines 152-234 (bubble content)

**Why:** Render progress messages with a visual progress bar and step list.

- [ ] **Step 1: Create ProgressMessageCard component**

Create `src/components/task-hub/ProgressMessageCard.tsx`:

```tsx
'use client';

import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/store/taskHubStore';

interface ProgressMessageCardProps {
  message: ChatMessage;
  onTaskClick?: (taskId: string) => void;
}

const TYPE_STYLES = {
  start: { border: 'border-blue-500/40', bg: 'bg-blue-500/5', icon: '▶', color: 'text-blue-400' },
  update: { border: 'border-yellow-500/40', bg: 'bg-yellow-500/5', icon: '⟳', color: 'text-yellow-400' },
  complete: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/5', icon: '✓', color: 'text-emerald-400' },
};

export function ProgressMessageCard({ message, onTaskClick }: ProgressMessageCardProps) {
  const data = message.progressData;
  if (!data) return null;

  const style = TYPE_STYLES[data.type];

  return (
    <div className={cn('rounded-[4px] border-2 p-2.5', style.border, style.bg)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <span className={cn('text-[11px] font-bold', style.color)}>
          {style.icon} {message.content}
        </span>
      </div>

      {/* Progress bar (for update and complete types) */}
      {data.totalSteps > 0 && (
        <div className="mb-2">
          <div className="h-[3px] bg-[hsl(var(--bg-muted))] rounded-[2px] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[hsl(var(--accent))] to-blue-400 rounded-[2px] transition-all duration-300"
              style={{ width: `${data.totalSteps > 0 ? (data.completedSteps / data.totalSteps) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{data.completedSteps}/{data.totalSteps} 步骤</span>
          </div>
        </div>
      )}

      {/* Step list */}
      {data.steps.length > 0 && (
        <div className="space-y-0.5 font-mono text-[10px] leading-relaxed">
          {data.steps.map((step, i) => (
            <div key={i} className={cn(
              step.status === 'done' && 'text-emerald-400',
              step.status === 'in_progress' && 'text-yellow-400',
              step.status === 'pending' && 'text-[hsl(var(--text-tertiary))]',
            )}>
              {step.status === 'done' && '✓ '}
              {step.status === 'in_progress' && '⟳ '}
              {step.status === 'pending' && '○ '}
              {step.label}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons for complete type */}
      {data.type === 'complete' && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => onTaskClick?.(data.taskId)}
            className="text-[9px] font-bold px-2 py-1 rounded-[2px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            📋 查看产出
          </button>
          <button
            type="button"
            onClick={() => onTaskClick?.(data.taskId)}
            className="text-[9px] font-bold px-2 py-1 rounded-[2px] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            🔍 查看终端
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add 'progress' to IntentIcon and INTENT_LABELS in ChatMessageItem**

In `src/components/task-hub/ChatMessageItem.tsx`, update IntentIcon (lines 15-26):

```tsx
const IntentIcon = ({ intent }: { intent?: string }) => {
  switch (intent) {
    case 'ideate':
      return <Lightbulb className="w-3 h-3 text-yellow-500" />;
    case 'execute':
      return <Play className="w-3 h-3 text-blue-500" />;
    case 'review':
      return <Eye className="w-3 h-3 text-green-500" />;
    case 'progress':
      return <Play className="w-3 h-3 text-blue-400" />;
    default:
      return null;
  }
};
```

Update INTENT_LABELS (lines 28-32):

```tsx
const INTENT_LABELS: Record<string, string> = {
  ideate: '构思',
  execute: '执行',
  review: '评审',
  progress: '进度',
};
```

- [ ] **Step 3: Render ProgressMessageCard in ChatMessageItem**

In `src/components/task-hub/ChatMessageItem.tsx`, add the import:

```tsx
import { ProgressMessageCard } from './ProgressMessageCard';
```

Inside the message bubble `<div>`, after `{formatContentWithMentions(message.content)}` (line 153), add:

```tsx
{message.progressData && (
  <div className="mt-2">
    <ProgressMessageCard
      message={message}
      onTaskClick={(taskId) => setSelectedTaskId(taskId)}
    />
  </div>
)}
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev`
- Manually add a progress message to the store via browser console or test
- Should render progress bar with steps and colored indicators

- [ ] **Step 5: Commit**

```bash
git add src/components/task-hub/ProgressMessageCard.tsx src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: add ProgressMessageCard component for execution visibility"
```

---

## Task 6: Message Grouping (Execution Visibility)

**Files:**
- Create: `src/components/task-hub/MessageGroup.tsx`
- Modify: `src/components/task-hub/GlobalChatRoom.tsx:79-80` (message list rendering)

**Why:** Multiple agents working in parallel creates a noisy chat; grouping by agent reduces cognitive load.

- [ ] **Step 1: Create MessageGroup component**

Create `src/components/task-hub/MessageGroup.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/store/taskHubStore';
import { ChatMessageItem } from './ChatMessageItem';

interface MessageGroupProps {
  messages: ChatMessage[];
  themeColor: string;
  agentEmoji: string;
  agentName: string;
  defaultExpanded: boolean;
}

export function MessageGroup({ messages, themeColor, agentEmoji, agentName, defaultExpanded }: MessageGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (messages.length === 0) return null;

  // Single message — no grouping needed
  if (messages.length === 1) {
    return <ChatMessageItem message={messages[0]} />;
  }

  const firstTime = messages[0].timestamp.slice(11, 16);
  const lastTime = messages[messages.length - 1].timestamp.slice(11, 16);

  return (
    <div className={cn('border-l-2 pl-2.5', themeColor)}>
      {/* Group header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left mb-1 group"
      >
        <span className="text-[11px]">{agentEmoji}</span>
        <span className="text-[10px] font-bold text-[hsl(var(--text-secondary))]">{agentName}</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{messages.length} 条</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">· {firstTime}-{lastTime}</span>
        <span className="text-[9px] text-[hsl(var(--text-tertiary))] ml-auto group-hover:text-[hsl(var(--text-primary))] transition-colors">
          {expanded ? '▼ 收起' : '▶ 展开'}
        </span>
      </button>

      {/* Messages */}
      {expanded && (
        <div className="flex flex-col gap-4">
          {messages.map((msg) => (
            <ChatMessageItem key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrate grouping into GlobalChatRoom**

In `src/components/task-hub/GlobalChatRoom.tsx`, add import:

```tsx
import { MessageGroup } from './MessageGroup';
```

Replace the message rendering block (lines 79-81):

```tsx
{chatMessages.map((msg) => (
  <ChatMessageItem key={msg.id} message={msg} />
))}
```

with grouped rendering:

```tsx
{(() => {
  // Group consecutive messages from the same agent
  const groups: { agentId: string; messages: ChatMessage[] }[] = [];
  for (const msg of chatMessages) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.agentId === msg.agentId) {
      lastGroup.messages.push(msg);
    } else {
      groups.push({ agentId: msg.agentId, messages: [msg] });
    }
  }

  const AGENT_META: Record<string, { emoji: string; name: string; color: string }> = {
    jean: { emoji: '🔑', name: 'Jean', color: 'border-amber-500/40' },
    keqing: { emoji: '⚡', name: 'Keqing', color: 'border-blue-500/40' },
    zhongli: { emoji: '🛡️', name: 'Zhongli', color: 'border-amber-600/40' },
    nahida: { emoji: '🌿', name: 'Nahida', color: 'border-emerald-500/40' },
    albedo: { emoji: '⚗️', name: 'Albedo', color: 'border-purple-500/40' },
    venti: { emoji: '🎵', name: 'Venti', color: 'border-cyan-500/40' },
    system: { emoji: '⚙️', name: '系统', color: 'border-violet-500/40' },
    human: { emoji: '👤', name: '用户', color: 'border-[hsl(var(--agent-owner))]/40' },
  };

  return groups.map((group, gi) => {
    const meta = AGENT_META[group.agentId] || { emoji: '?', name: group.agentId, color: 'border-zinc-500/40' };
    const isLatestGroup = gi === groups.length - 1;
    const isHuman = group.agentId === 'human';

    // Human messages are never grouped — render individually
    if (isHuman) {
      return group.messages.map((msg) => (
        <ChatMessageItem key={msg.id} message={msg} />
      ));
    }

    return (
      <MessageGroup
        key={group.messages[0].id}
        messages={group.messages}
        themeColor={meta.color}
        agentEmoji={meta.emoji}
        agentName={meta.name}
        defaultExpanded={isLatestGroup}
      />
    );
  });
})()}
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`
- Have a conversation with multiple agent messages
- Non-latest agent groups should be collapsed with a "展开" toggle
- Human messages render individually
- Latest group is expanded by default

- [ ] **Step 4: Commit**

```bash
git add src/components/task-hub/MessageGroup.tsx src/components/task-hub/GlobalChatRoom.tsx
git commit -m "feat: group consecutive agent messages with expand/collapse"
```

---

## Task 7: Batch Operations on Breakdown Cards (Feedback & Context)

**Files:**
- Modify: `src/components/task-hub/ChatMessageItem.tsx:155-234` (breakdown section)

**Why:** Users need "select all/deselect all" per phase and the ability to confirm individual phases.

- [ ] **Step 1: Add phase-level select all/deselect buttons**

In `src/components/task-hub/ChatMessageItem.tsx`, find the phase header `<div>` (around line 159-166). After the existing header content (the `<span>` showing task count), add toggle buttons:

Replace the header div content. Find the full phase header block:

```tsx
<div className="px-3 py-1.5 bg-[hsl(var(--bg-muted))] flex items-center justify-between gap-2">
  <div className="flex items-center gap-1.5">
    <span className="text-[9px] font-bold bg-[hsl(var(--accent))] text-white px-1.5 py-0.5 rounded-[2px]">
      阶段 {pi + 1}
    </span>
    <span className="text-[11px] font-bold text-[hsl(var(--text-primary))]">{phase.title}</span>
  </div>
  <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{phase.tasks.length} 任务</span>
</div>
```

Replace with:

```tsx
<div className="px-3 py-1.5 bg-[hsl(var(--bg-muted))] flex items-center justify-between gap-2">
  <div className="flex items-center gap-1.5">
    <span className="text-[9px] font-bold bg-[hsl(var(--accent))] text-white px-1.5 py-0.5 rounded-[2px]">
      阶段 {pi + 1}
    </span>
    <span className="text-[11px] font-bold text-[hsl(var(--text-primary))]">{phase.title}</span>
  </div>
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => {
        const keys = new Set(checkedKeys);
        phase.tasks.forEach((_, ti) => keys.add(`${pi}-${ti}`));
        setCheckedKeys(keys);
      }}
      className="text-[9px] text-[hsl(var(--accent))] hover:underline"
    >
      全选
    </button>
    <button
      type="button"
      onClick={() => {
        const keys = new Set(checkedKeys);
        phase.tasks.forEach((_, ti) => keys.delete(`${pi}-${ti}`));
        setCheckedKeys(keys);
      }}
      className="text-[9px] text-[hsl(var(--text-tertiary))] hover:underline"
    >
      全不选
    </button>
  </div>
</div>
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`
- Trigger Jean breakdown with multiple phases
- Each phase header should show "全选" and "全不选" buttons
- Clicking should toggle all tasks in that phase

- [ ] **Step 3: Commit**

```bash
git add src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: add select all/deselect all per phase in breakdown cards"
```

---

## Task 8: System Feedback Message After Confirmation (Feedback & Context)

**Files:**
- Modify: `src/store/taskHubStore.ts` (confirmBreakdown action, around line 1074)

**Why:** After confirming breakdown, users don't know if agents started or what happens next.

- [ ] **Step 1: Write failing test**

Add to `src/__tests__/store/chat-message-extensions.test.ts`:

```typescript
describe('confirmBreakdown system feedback', () => {
  it('sends a system message after confirming breakdown', () => {
    const convId = 'conv-1';
    useTaskHubStore.setState({
      conversations: [{ id: convId, title: 'Test', goal: 'Build X', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'reviewed', createdAt: '', updatedAt: '' }],
      selectedConversationId: convId,
      tasks: [],
      chatMessagesByConversation: {},
      phases: [],
      activeAgentIds: ['jean', 'keqing'],
    });

    useTaskHubStore.getState().confirmBreakdown(convId, [
      { title: 'Phase 1', description: '', tasks: [
        { title: 'Task A', description: '', agentId: 'keqing' },
        { title: 'Task B', description: '', agentId: 'keqing' },
      ]},
    ]);

    const messages = useTaskHubStore.getState().chatMessagesByConversation[convId];
    const systemMsg = messages?.find(m => m.agentId === 'system' && m.intent !== 'progress');
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content).toContain('2 个任务');
    expect(systemMsg?.content).toContain('1 个阶段');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/chat-message-extensions.test.ts`
Expected: FAIL — no system message is created after confirmBreakdown

- [ ] **Step 3: Add system message creation in confirmBreakdown**

In `src/store/taskHubStore.ts`, find the `confirmBreakdown` action (around line 1074). At the end of the function, after tasks and phases are created, add:

```typescript
// Send system feedback message
const totalTasks = proposals.reduce((sum, p) => sum + p.tasks.length, 0);
const totalPhases = proposals.length;
const phaseSummary = proposals.map((p, i) =>
  `阶段 ${i + 1}: ${p.tasks.length} 任务 ${i === 0 ? '✓ 已派发' : '⏳ 等待前置阶段'}`
).join('\n');

const systemMsg: ChatMessage = {
  id: `msg-${Date.now()}-sys`,
  agentId: 'system',
  content: `已创建 **${totalTasks} 个任务**，分 **${totalPhases} 个阶段**执行：\n\n${phaseSummary}\n\n你可以随时 @Agent 追加指令或调整计划。`,
  timestamp: new Date().toISOString(),
  intent: 'general',
  conversationId: convId,
};

set((state) => ({
  chatMessagesByConversation: {
    ...state.chatMessagesByConversation,
    [convId]: [...(state.chatMessagesByConversation[convId] || []), systemMsg],
  },
}));
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/store/chat-message-extensions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/taskHubStore.ts src/__tests__/store/chat-message-extensions.test.ts
git commit -m "feat: send system feedback message after breakdown confirmation"
```

---

## Task 9: Artifact Preview & Rejection Reason in Approval (Feedback & Context)

**Files:**
- Modify: `src/components/task-hub/ChatMessageItem.tsx:247-277` (approval actions section)

**Why:** Approval messages lack context about what's being approved; rejection provides no feedback to the agent.

- [ ] **Step 1: Add artifact preview above approval buttons**

In `src/components/task-hub/ChatMessageItem.tsx`, find the approval actions block (line 248). Before the approval buttons `<div>`, add the artifact preview:

```tsx
{/* Artifact preview */}
{message.artifactPreview && message.artifactPreview.files.length > 0 && (
  <div className="mb-2 p-2 bg-[hsl(var(--bg-app))] rounded-[4px] border border-[hsl(var(--border-subtle))]">
    <div className="text-[9px] text-[hsl(var(--text-tertiary))] mb-1">产出物预览：</div>
    <div className="font-mono text-[10px] space-y-0.5">
      {message.artifactPreview.files.map((file, fi) => (
        <div key={fi} className={cn(
          file.change === 'added' && 'text-emerald-400',
          file.change === 'modified' && 'text-blue-400',
          file.change === 'deleted' && 'text-red-400',
        )}>
          {file.change === 'added' && '+ '}
          {file.change === 'modified' && '~ '}
          {file.change === 'deleted' && '- '}
          <span className="text-[hsl(var(--accent))]">{file.path}</span>
          <span className="text-[hsl(var(--text-tertiary))]"> ({file.change === 'added' ? '新增' : file.change === 'modified' ? '修改' : '删除'})</span>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 2: Add rejection reason input state and UI**

In `src/components/task-hub/ChatMessageItem.tsx`, add state for rejection flow. After the existing `useState` hooks (around line 70), add:

```tsx
const [showRejectInput, setShowRejectInput] = useState(false);
const [rejectReason, setRejectReason] = useState('');
```

Replace the approval pending buttons (lines 252-264) with:

```tsx
{message.approvalStatus === 'pending' ? (
  <>
    <div className="flex gap-2">
      <button
        onClick={() => {
          updateChatMessageStatus(message.id, 'approved');
          setShowRejectInput(false);
        }}
        className="flex-1 flex items-center justify-center gap-1 bg-[hsl(var(--status-done))] hover:brightness-110 text-[hsl(var(--bg-app))] text-[10px] font-bold py-1.5 px-2 rounded-[2px] shadow-[2px_2px_0px_hsl(var(--text-primary))] transition-transform active:translate-y-[2px] active:shadow-[0px_0px_0px_hsl(var(--text-primary))]"
      >
        <Check className="w-3 h-3" /> 同意
      </button>
      <button
        onClick={() => setShowRejectInput(true)}
        className="flex-1 flex items-center justify-center gap-1 bg-[hsl(var(--status-rejected))] hover:brightness-110 text-[hsl(var(--bg-app))] text-[10px] font-bold py-1.5 px-2 rounded-[2px] shadow-[2px_2px_0px_hsl(var(--text-primary))] transition-transform active:translate-y-[2px] active:shadow-[0px_0px_0px_hsl(var(--text-primary))]"
      >
        <X className="w-3 h-3" /> 拒绝
      </button>
    </div>
    {showRejectInput && (
      <div className="mt-2 p-2 bg-[hsl(var(--bg-app))] border border-[hsl(var(--status-rejected-border))] rounded-[4px]">
        <div className="text-[9px] font-bold text-[hsl(var(--status-rejected))] mb-1">拒绝原因：</div>
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="描述问题或建议修改…"
          rows={2}
          className="w-full bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-primary))] text-[11px] rounded-[2px] border border-[hsl(var(--border))] px-2 py-1.5 focus:outline-none focus:border-[hsl(var(--status-rejected))] resize-none"
        />
        <div className="flex justify-end mt-1">
          <button
            onClick={() => {
              if (!rejectReason.trim()) return;
              updateChatMessageStatus(message.id, 'rejected');
              // Write rejection reason to message
              const convId = useTaskHubStore.getState().selectedConversationId;
              if (convId) {
                set((state) => ({
                  chatMessagesByConversation: {
                    ...state.chatMessagesByConversation,
                    [convId]: (state.chatMessagesByConversation[convId] || []).map(m =>
                      m.id === message.id ? { ...m, rejectionReason: rejectReason.trim() } : m
                    ),
                  },
                }));
              }
              setShowRejectInput(false);
              setRejectReason('');
            }}
            disabled={!rejectReason.trim()}
            className="text-[9px] font-bold px-3 py-1 bg-[hsl(var(--status-rejected))] text-[hsl(var(--bg-app))] rounded-[2px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            提交反馈
          </button>
        </div>
      </div>
    )}
  </>
) : (
  <div
    className={cn(
      'w-full text-center text-[10px] font-bold py-1 rounded-[2px] border',
      message.approvalStatus === 'approved'
        ? 'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))] border-[hsl(var(--status-done-border))]'
        : 'bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))] border-[hsl(var(--status-rejected-border))]'
    )}
  >
    {message.approvalStatus === 'approved' ? '已同意' : `已拒绝${message.rejectionReason ? '：' + message.rejectionReason.slice(0, 30) : ''}`}
  </div>
)}
```

Note: The rejection reason update uses `useTaskHubStore.getState().selectedConversationId` and direct `set()` instead of a new action, keeping it minimal. If `set` is not in scope, use the store's `set` function pattern already established in the component.

- [ ] **Step 3: Verify manually**

Run: `npm run dev`
- Create an approval request message with artifactPreview data
- Should show file list with colored change indicators
- Click "拒绝" → should show reason textarea
- Submit with reason → should show "已拒绝：{reason}"

- [ ] **Step 4: Commit**

```bash
git add src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: add artifact preview and rejection reason to approval messages"
```

---

## Task 10: Message Filter/Search Toolbar (Message Management)

**Files:**
- Create: `src/components/task-hub/ChatFilterBar.tsx`
- Modify: `src/components/task-hub/GlobalChatRoom.tsx` (integrate filter bar)

**Why:** Long conversations become unmanageable without search and filtering.

- [ ] **Step 1: Create ChatFilterBar component**

Create `src/components/task-hub/ChatFilterBar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface ChatFilter {
  intent: string | null;    // null = all
  agentId: string | null;   // null = all
  userOnly: boolean;
  search: string;
}

interface ChatFilterBarProps {
  onFilterChange: (filter: ChatFilter) => void;
  messageCount: number;
}

const INTENT_OPTIONS = [
  { value: null, label: '全部' },
  { value: 'ideate', label: '💡 构思' },
  { value: 'execute', label: '⚡ 执行' },
  { value: 'review', label: '🔍 评审' },
  { value: 'progress', label: '📊 进度' },
  { value: 'general', label: '💬 通用' },
];

export function ChatFilterBar({ onFilterChange, messageCount }: ChatFilterBarProps) {
  const [search, setSearch] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const [userOnly, setUserOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(messageCount < 20);

  const updateFilter = (partial: Partial<ChatFilter>) => {
    const next = { search, intent, userOnly, ...partial };
    setSearch(next.search);
    setIntent(next.intent);
    setUserOnly(next.userOnly);
    onFilterChange(next as ChatFilter);
  };

  if (collapsed) {
    return (
      <div className="px-4 py-1 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{messageCount} 条消息</span>
        {messageCount >= 20 && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-[9px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            筛选 ▼
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="flex items-center gap-1 px-2 py-0.5 bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))] rounded-[4px] min-w-[100px]">
        <span className="text-[10px] text-[hsl(var(--text-tertiary))]">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => updateFilter({ search: e.target.value })}
          placeholder="搜索…"
          className="bg-transparent text-[11px] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] outline-none w-full"
        />
      </div>

      {/* Intent chips */}
      <div className="flex gap-1 items-center">
        <span className="text-[9px] text-[hsl(var(--text-tertiary))]">意图:</span>
        {INTENT_OPTIONS.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => updateFilter({ intent: opt.value })}
            className={cn(
              'text-[9px] px-2 py-0.5 rounded-full border transition-colors',
              intent === opt.value
                ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                : 'border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* User only toggle */}
      <button
        type="button"
        onClick={() => updateFilter({ userOnly: !userOnly })}
        className={cn(
          'text-[9px] px-2 py-0.5 rounded-full border transition-colors',
          userOnly
            ? 'border-[hsl(var(--agent-owner))] bg-[hsl(var(--agent-owner))]/10 text-[hsl(var(--agent-owner))]'
            : 'border-[hsl(var(--border))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))]',
        )}
      >
        👤 仅用户
      </button>

      {/* Collapse */}
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="text-[9px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] ml-auto transition-colors"
      >
        收起 ▲
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Integrate filter bar into GlobalChatRoom**

In `src/components/task-hub/GlobalChatRoom.tsx`, add imports:

```tsx
import { ChatFilterBar, type ChatFilter } from './ChatFilterBar';
```

Add filter state after the existing `useState` hooks:

```tsx
const [filter, setFilter] = useState<ChatFilter>({ intent: null, agentId: null, userOnly: false, search: '' });
```

Add filtering logic before the message rendering:

```tsx
const filteredMessages = useMemo(() => {
  let msgs = chatMessages;
  if (filter.intent) msgs = msgs.filter(m => m.intent === filter.intent);
  if (filter.agentId) msgs = msgs.filter(m => m.agentId === filter.agentId);
  if (filter.userOnly) msgs = msgs.filter(m => m.agentId === 'human');
  if (filter.search) {
    const q = filter.search.toLowerCase();
    msgs = msgs.filter(m => m.content.toLowerCase().includes(q));
  }
  return msgs;
}, [chatMessages, filter]);
```

Add `useMemo` to imports if not present.

Insert the filter bar before the message list scroll container:

```tsx
<ChatFilterBar
  onFilterChange={setFilter}
  messageCount={chatMessages.length}
/>
```

Replace `chatMessages.map(...)` with `filteredMessages.map(...)` in the rendering.

- [ ] **Step 3: Verify manually**

Run: `npm run dev`
- Send multiple messages with different intents
- Filter bar should appear (collapsed if < 20 messages, with expand toggle)
- Expand, filter by intent, search by keyword
- Messages should filter in real-time

- [ ] **Step 4: Commit**

```bash
git add src/components/task-hub/ChatFilterBar.tsx src/components/task-hub/GlobalChatRoom.tsx
git commit -m "feat: add message filter/search toolbar with intent and agent filtering"
```

---

## Task 11: Date Separators & Hover Actions (Message Management)

**Files:**
- Modify: `src/components/task-hub/GlobalChatRoom.tsx` (date separators)
- Modify: `src/components/task-hub/ChatMessageItem.tsx` (hover actions)

**Why:** Date separators help navigate long conversations; hover actions provide quick message interactions.

- [ ] **Step 1: Add date separator helper function**

In `src/components/task-hub/GlobalChatRoom.tsx`, add a helper function before the component:

```tsx
function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
```

- [ ] **Step 2: Insert date separators in message rendering**

In the message rendering section of `GlobalChatRoom.tsx`, wrap the grouped messages with date separators. Before the group rendering logic, add:

```tsx
{(() => {
  // ... existing grouping logic ...

  let lastDate = '';
  return groups.map((group, gi) => {
    const groupDate = new Date(group.messages[0].timestamp).toDateString();
    const showDateSep = groupDate !== lastDate;
    lastDate = groupDate;

    return (
      <div key={group.messages[0].id}>
        {showDateSep && (
          <div className="text-center my-3">
            <span className="text-[9px] text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-card))] px-3 py-0.5 rounded-full border border-[hsl(var(--border-subtle))]">
              ── {formatDateSeparator(group.messages[0].timestamp)} ──
            </span>
          </div>
        )}
        {/* ... existing group rendering ... */}
      </div>
    );
  });
})()}
```

- [ ] **Step 3: Add hover action bar to ChatMessageItem**

In `src/components/task-hub/ChatMessageItem.tsx`, add a hover state:

```tsx
const [isHovered, setIsHovered] = useState(false);
```

Wrap the message bubble `<div>` with a hover handler:

```tsx
<div
  onMouseEnter={() => setIsHovered(true)}
  onMouseLeave={() => setIsHovered(false)}
  className={cn('relative', isHuman && 'flex flex-col items-end')}
>
```

Inside the bubble div, after the content, add the hover action bar:

```tsx
{isHovered && (
  <div className="absolute -top-2 right-2 flex gap-0.5 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-[4px] p-0.5 shadow-sm z-10">
    <button
      type="button"
      onClick={() => {
        // Quote message into input - dispatch custom event
        window.dispatchEvent(new CustomEvent('chat:quote', { detail: message.content }));
      }}
      className="text-[9px] px-1.5 py-0.5 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
      title="引用此消息"
    >
      📎
    </button>
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(message.content)}
      className="text-[9px] px-1.5 py-0.5 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
      title="复制内容"
    >
      📋
    </button>
    {message.referencedTaskId && (
      <button
        type="button"
        onClick={() => setSelectedTaskId(message.referencedTaskId!)}
        className="text-[9px] px-1.5 py-0.5 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] rounded-[2px] hover:bg-[hsl(var(--bg-muted))] transition-colors"
        title="跳转到任务"
      >
        🔗
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4: Add quote event listener in GlobalChatRoom**

In `src/components/task-hub/GlobalChatRoom.tsx`, add an effect to listen for the quote event:

```tsx
useEffect(() => {
  const handler = (e: CustomEvent) => {
    setInputValue(`> ${e.detail}\n\n`);
  };
  window.addEventListener('chat:quote', handler as EventListener);
  return () => window.removeEventListener('chat:quote', handler as EventListener);
}, []);
```

- [ ] **Step 5: Verify manually**

Run: `npm run dev`
- Messages from different days should show date separators
- Hover over any message → should show action bar with 📎📋 buttons
- Click 📋 → should copy message to clipboard
- Click 📎 → should quote message into input

- [ ] **Step 6: Commit**

```bash
git add src/components/task-hub/GlobalChatRoom.tsx src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: add date separators and hover action bar to chat messages"
```

---

## Task 12: Jean Auto-Trigger Mechanism

**Files:**
- Modify: `src/store/taskHubStore.ts` (addChatMessage action)

**Why:** When a project has no breakdown yet, Jean should auto-trigger to decompose tasks.

- [ ] **Step 1: Add auto-trigger logic in addChatMessage**

In `src/store/taskHubStore.ts`, find the `addChatMessage` action. After the existing mention parsing and intent detection logic, before the message is pushed to the array, add the auto-trigger check:

```typescript
// Auto-trigger Jean breakdown for new projects
const conv = get().conversations.find(c => c.id === convId);
if (conv && conv.breakdownStatus === 'none' && !msg.mentions?.length) {
  // Use setTimeout to avoid blocking the message save
  setTimeout(() => {
    const state = useTaskHubStore.getState();
    if (state.conversations.find(c => c.id === convId)?.breakdownStatus === 'none') {
      state.triggerBreakdown(convId);
    }
  }, 500);
}
```

This only triggers when:
- The conversation's `breakdownStatus` is `'none'` (never broken down)
- The message doesn't explicitly @mention another agent (those take priority)
- Uses setTimeout to not block the message save

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Verify manually**

Run: `npm run dev`
- Create a new project
- Send a message without @mentioning anyone
- Jean should auto-start breakdown after 500ms
- Send a message with @Keqing → Jean should NOT auto-trigger

- [ ] **Step 4: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: auto-trigger Jean breakdown for new projects without explicit @mention"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Each of the 18 changes from the spec maps to a task:
  - 1.1 (unlock input) → Task 2
  - 1.2 (auto-create conv) → Task 1
  - 1.3 (context-aware empty) → Task 2
  - 1.4 (quick suggestions) → Task 2
  - 2.1 (AgentBar status) → Task 3
  - 2.2 (progress messages) → Tasks 4, 5
  - 2.3 (message grouping) → Task 6
  - 3.1 (batch operations) → Task 7
  - 3.2 (system feedback) → Task 8
  - 3.3 (artifact preview) → Task 9
  - 3.4 (rejection reason) → Task 9
  - 4.1 (filter/search) → Task 10
  - 4.2 (date separators) → Task 11
  - 4.3 (hover actions) → Task 11
  - P4 (Jean auto-trigger) → Task 12
- [x] **Placeholder scan:** No TBD, TODO, or "implement later" found
- [x] **Type consistency:** ChatMessage type extended consistently across all tasks; `getAgentCurrentTask` selector matches usage in AgentBar; `createProgressMessage` matches ProgressMessageCard props
