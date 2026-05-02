# Project Task Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic AI task breakdown to project creation, with phase-grouped task proposals reviewed in-chat and a server-side folder picker for project binding.

**Architecture:** New Phase entity sits between Conversation and Task. The planner agent (Jean) receives a structured prompt after project creation, responds with PHASE/TASK lines parsed by `breakdownParser.ts`. The parsed result renders as phase-grouped proposal cards in ChatMessageItem. User confirms to persist phases + tasks. A new `GET /api/fs/list` endpoint provides server-side directory browsing for the FolderPicker component.

**Tech Stack:** React 19, Zustand 5, Next.js 16 API routes, vitest, TypeScript 5, Tailwind CSS 4

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/types/phase.ts` | Phase type definition |
| `src/lib/breakdownParser.ts` | Parse PHASE/TASK lines from agent messages |
| `src/lib/breakdownParser.test.ts` | Tests for breakdownParser |
| `src/pages/api/fs/list.ts` | Server-side directory listing API |
| `src/components/ui/FolderPicker.tsx` | Folder browser component |

### Modified Files
| File | Change |
|---|---|
| `src/store/taskHubStore.ts` | Phase state, breakdownStatus on Conversation, phaseId on Task, breakdown actions, createConversation extension |
| `src/components/project/ProjectCreateDialog.tsx` | Add FolderPicker + autoBreakdown toggle |
| `src/components/task-hub/ChatMessageItem.tsx` | Phase-grouped proposal rendering + confirm button |
| `src/components/project/ProjectChatPanel.tsx` | breakdownStatus indicator |
| `src/components/project/MiniKanban.tsx` | Phase tab bar |

---

### Task 1: Phase Type Definition

**Files:**
- Create: `src/types/phase.ts`

- [ ] **Step 1: Create phase.ts**

```typescript
// src/types/phase.ts
export type PhaseStatus = 'planned' | 'active' | 'done';

export interface Phase {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  order: number;
  status: PhaseStatus;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/phase.ts
git commit -m "feat: add Phase type definition"
```

---

### Task 2: Breakdown Parser (TDD)

**Files:**
- Create: `src/lib/breakdownParser.ts`
- Create: `src/lib/breakdownParser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/breakdownParser.test.ts
import { describe, it, expect } from 'vitest';
import { parsePhaseBreakdown } from './breakdownParser';

describe('parsePhaseBreakdown', () => {
  it('parses a single phase with tasks', () => {
    const input = [
      'PHASE: 基础搭建 | 数据库和路由先行',
      'TASK: 数据库 Schema 设计 | 设计 users/orders 表 @zhongli',
      'TASK: 前端项目初始化 | 搭建 React 项目骨架 @keqing',
    ].join('\n');

    const result = parsePhaseBreakdown(input);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('基础搭建');
    expect(result[0].description).toBe('数据库和路由先行');
    expect(result[0].tasks).toHaveLength(2);
    expect(result[0].tasks[0]).toEqual({
      title: '数据库 Schema 设计',
      description: '设计 users/orders 表',
      agentId: 'zhongli',
    });
    expect(result[0].tasks[1].agentId).toBe('keqing');
  });

  it('parses multiple phases', () => {
    const input = [
      'PHASE: 阶段一 | 描述一',
      'TASK: 任务 A | 描述A @jean',
      'PHASE: 阶段二 | 描述二',
      'TASK: 任务 B | 描述B @keqing',
      'TASK: 任务 C | 描述C',
    ].join('\n');

    const result = parsePhaseBreakdown(input);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('阶段一');
    expect(result[0].tasks).toHaveLength(1);
    expect(result[1].title).toBe('阶段二');
    expect(result[1].tasks).toHaveLength(2);
    expect(result[1].tasks[1].agentId).toBeUndefined();
  });

  it('returns empty array when no PHASE lines found', () => {
    expect(parsePhaseBreakdown('some random text')).toEqual([]);
    expect(parsePhaseBreakdown('')).toEqual([]);
  });

  it('handles TASK without description or agentId', () => {
    const input = 'PHASE: 阶段 | 描述\nTASK: 仅标题';
    const result = parsePhaseBreakdown(input);
    expect(result[0].tasks[0]).toEqual({
      title: '仅标题',
      description: '',
      agentId: undefined,
    });
  });

  it('ignores lines before the first PHASE', () => {
    const input = [
      '这是开头的一些说明文字',
      'PHASE: 阶段 | 描述',
      'TASK: 任务 | 描述',
    ].join('\n');
    const result = parsePhaseBreakdown(input);
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/breakdownParser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement breakdownParser**

```typescript
// src/lib/breakdownParser.ts
export interface TaskProposal {
  title: string;
  description: string;
  agentId?: string;
}

export interface PhaseProposal {
  title: string;
  description: string;
  tasks: TaskProposal[];
}

export function parsePhaseBreakdown(content: string): PhaseProposal[] {
  const lines = content.split('\n');
  const phases: PhaseProposal[] = [];
  let currentPhase: PhaseProposal | null = null;

  for (const raw of lines) {
    const phaseMatch = /^\s*PHASE\s*:\s*(.+)\s*$/i.exec(raw);
    if (phaseMatch) {
      const rest = phaseMatch[1] || '';
      const [titlePart, ...descParts] = rest.split('|');
      currentPhase = {
        title: titlePart.trim(),
        description: descParts.join('|').trim(),
        tasks: [],
      };
      phases.push(currentPhase);
      continue;
    }

    const taskMatch = /^\s*(?:-|\*)?\s*TASK\s*:\s*(.+)\s*$/i.exec(raw);
    if (taskMatch && currentPhase) {
      const rest = taskMatch[1] || '';
      const agentMatch = /@(\w+)/.exec(rest);
      const agentId = agentMatch ? agentMatch[1] : undefined;
      const cleaned = rest.replace(/@(\w+)/g, '').trim();
      const [titlePart, ...descParts] = cleaned.split('|');
      const title = (titlePart || '').trim();
      const description = descParts.join('|').trim();
      if (title) {
        currentPhase.tasks.push({ title, description, agentId });
      }
    }
  }

  return phases;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/breakdownParser.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/breakdownParser.ts src/lib/breakdownParser.test.ts
git commit -m "feat: add breakdown parser for PHASE/TASK message format"
```

---

### Task 3: Server Directory Listing API

**Files:**
- Create: `src/pages/api/fs/list.ts`

- [ ] **Step 1: Create the API route**

```typescript
// src/pages/api/fs/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();

function safeResolve(input: string): string | null {
  const resolved = path.resolve(input);
  if (!resolved.startsWith(HOME)) return null;
  if (resolved.includes('..')) return null;
  return resolved;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawPath = (req.query.path as string) || HOME;
  const resolved = safeResolve(rawPath);
  if (!resolved) return res.status(403).json({ error: 'Path not allowed' });

  try {
    if (!fs.existsSync(resolved)) {
      return res.status(200).json({ path: resolved, children: [] });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const children = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        const childPath = path.join(resolved, e.name);
        let hasChildren = false;
        try {
          hasChildren = fs.readdirSync(childPath).some((name) => {
            try {
              return fs.statSync(path.join(childPath, name)).isDirectory();
            } catch { return false; }
          });
        } catch { /* ignore */ }
        return { name: e.name, path: childPath, hasChildren };
      });

    res.status(200).json({ path: resolved, children });
  } catch (error) {
    console.error('[api/fs/list] Error:', error);
    res.status(500).json({ error: 'Failed to list directory' });
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/fs/list.ts
git commit -m "feat: add server-side directory listing API"
```

---

### Task 4: FolderPicker Component

**Files:**
- Create: `src/components/ui/FolderPicker.tsx`

- [ ] **Step 1: Create FolderPicker**

```tsx
// src/components/ui/FolderPicker.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Folder, FolderOpen, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DirEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState(value || '');
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      setChildren(data.children || []);
      setCurrentPath(data.path || dirPath);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDir(value || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = (dirPath: string) => {
    fetchDir(dirPath);
  };

  const selectPath = (dirPath: string) => {
    onChange(dirPath);
  };

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
        项目目录
      </label>

      {/* Selected path display */}
      {value && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[hsl(var(--accent-soft))] border border-[hsl(var(--accent))] text-[12px] font-medium text-[hsl(var(--accent))]">
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{value}</span>
          <button
            type="button"
            onClick={() => onChange('')}
            className="ml-auto text-[10px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]"
          >
            清除
          </button>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 flex-wrap text-[10px] text-[hsl(var(--text-tertiary))]">
        <button
          type="button"
          onClick={() => navigateTo('')}
          className="hover:text-[hsl(var(--text-primary))] transition-colors"
        >
          <Home className="w-3 h-3 inline" />
        </button>
        {breadcrumbs.map((seg, i) => {
          const partial = '/' + breadcrumbs.slice(0, i + 1).join('/');
          return (
            <span key={partial} className="flex items-center gap-0.5">
              <span>/</span>
              <button
                type="button"
                onClick={() => navigateTo(partial)}
                className="hover:text-[hsl(var(--text-primary))] transition-colors truncate max-w-[80px]"
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>

      {/* Directory list */}
      <div className="max-h-[180px] overflow-y-auto rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] scrollbar-thin">
        {loading ? (
          <div className="px-3 py-2 text-[11px] text-[hsl(var(--text-tertiary))]">加载中…</div>
        ) : children.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-[hsl(var(--text-tertiary))]">空目录</div>
        ) : (
          children.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-[hsl(var(--bg-card-hover))] transition-colors cursor-pointer border-b border-[hsl(var(--border-subtle))] last:border-b-0"
            >
              <Folder className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))] shrink-0" />
              <span
                className="text-[12px] text-[hsl(var(--text-primary))] truncate flex-1"
                onClick={() => selectPath(entry.path)}
              >
                {entry.name}
              </span>
              {entry.hasChildren && (
                <button
                  type="button"
                  onClick={() => navigateTo(entry.path)}
                  className="p-0.5 text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/FolderPicker.tsx
git commit -m "feat: add FolderPicker component with server-side directory browsing"
```

---

### Task 5: Store Changes — Phase State + Model Updates

**Files:**
- Modify: `src/store/taskHubStore.ts`

This is the largest task. It touches the Task interface, Conversation interface, ChatMessage interface, and adds Phase state + breakdown actions.

- [ ] **Step 1: Add imports**

At the top of `src/store/taskHubStore.ts`, add the Phase type import alongside existing imports. Find the existing import of `RoleCard` and add after it:

```typescript
import type { Phase, PhaseStatus } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
```

- [ ] **Step 2: Add phaseId to Task interface**

Find the Task interface (around line 114). After the `conversationId` field, add:

```typescript
  phaseId: string;
```

The Task interface becomes:

```typescript
export interface Task {
  id: string;
  conversationId: string;
  phaseId: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  dependencies: string[];
  artifacts: TaskArtifact[];
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Add breakdownStatus to Conversation interface**

Find the Conversation interface (around line 139). After the `priority` field, add:

```typescript
  projectPath: string;
  breakdownStatus: 'none' | 'in_progress' | 'reviewed' | 'confirmed';
```

The Conversation interface becomes:

```typescript
export interface Conversation {
  id: string;
  title: string;
  goal: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  projectPath: string;
  breakdownStatus: 'none' | 'in_progress' | 'reviewed' | 'confirmed';
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Add selectedProposals to ChatMessage interface**

Find the ChatMessage interface (around line 94). After the `intent` field, add:

```typescript
  selectedProposals?: string[];
```

- [ ] **Step 5: Add Phase state and breakdown actions to TaskHubState interface**

Find the section where role card state is declared (search for `roleCards: RoleCard[]`). Add after that block:

```typescript
  // Phase state
  phases: Phase[];
  upsertPhase: (phase: Omit<Phase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => string;
  removePhase: (phaseId: string) => void;

  // Breakdown actions
  setBreakdownStatus: (conversationId: string, status: Conversation['breakdownStatus']) => void;
  triggerBreakdown: (conversationId: string) => void;
  confirmBreakdown: (conversationId: string, proposals: PhaseProposal[]) => void;
```

Also update the `createConversation` signature. Find the existing declaration and change it to:

```typescript
  createConversation: (input: { title: string; goal: string; projectPath?: string; priority?: Conversation['priority']; autoBreakdown?: boolean }) => void;
```

- [ ] **Step 6: Add initial state values**

Find the initial state object (search for `activeAgentIds: ['jean', 'keqing']`). Add:

```typescript
  phases: [],
```

- [ ] **Step 7: Add phaseId to addTask default**

Find the `addTask` action implementation. In the `set` call where the new task is constructed (around line 1201), add `phaseId: taskData.phaseId || '',` before `title`:

```typescript
    { ...taskData, id, phaseId: taskData.phaseId || '', createdAt: stamp, updatedAt: stamp, conversationId },
```

Also update the `Omit` type in the `addTask` signature to not include `phaseId` (so it's optional). Find the addTask declaration in the interface and change the parameter type to:

```typescript
  addTask: (taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'conversationId'> & { phaseId?: string }) => void;
```

- [ ] **Step 8: Add phaseId to createConversation implementation**

Find the `createConversation` implementation (around line 765). Update the conversation object creation to include the new fields:

```typescript
  createConversation: ({ title, goal, projectPath, priority, autoBreakdown }) => {
    const id = makeId('conv');
    const stamp = new Date().toISOString();
    const conversation: Conversation = {
      id,
      title,
      goal,
      status: 'active',
      priority: priority ?? 'p1',
      projectPath: projectPath ?? '',
      breakdownStatus: 'none',
      createdAt: stamp,
      updatedAt: stamp,
    };
```

Also update the fetch payload to include `project_path`:

```typescript
    body: JSON.stringify({ type: 'conversation.create', payload: { id, title, goal, priority: priority ?? 'p1', project_path: projectPath } }),
```

At the end of createConversation, add auto-breakdown trigger before the closing `},`:

```typescript
    if (autoBreakdown !== false) {
      setTimeout(() => get().triggerBreakdown(id), 500);
    }
  },
```

- [ ] **Step 9: Implement Phase store actions**

After the role card actions section (search for `setAgentRoleCardId`), add:

```typescript
      // Phase actions
      upsertPhase: (phaseData) => {
        const stamp = new Date().toISOString();
        const existing = get().phases.find((p) => p.id === phaseData.id);
        if (existing) {
          set((state) => ({
            phases: state.phases.map((p) =>
              p.id === phaseData.id ? { ...p, ...phaseData, updatedAt: stamp } : p
            ),
          }));
          return phaseData.id!;
        }
        const id = phaseData.id || `${get().selectedConversationId}-PHASE-${String(state_phases_seq++).padStart(3, '0')}`;
        set((state) => ({
          phases: [...state.phases, {
            id,
            conversationId: phaseData.conversationId,
            title: phaseData.title,
            description: phaseData.description,
            order: phaseData.order,
            status: phaseData.status,
            createdAt: stamp,
            updatedAt: stamp,
          }],
        }));
        return id;
      },

      removePhase: (phaseId) => {
        set((state) => ({ phases: state.phases.filter((p) => p.id !== phaseId) }));
      },

      setBreakdownStatus: (conversationId, status) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, breakdownStatus: status } : c
          ),
        }));
      },

      triggerBreakdown: (conversationId) => {
        const conv = get().conversations.find((c) => c.id === conversationId);
        if (!conv) return;
        get().setBreakdownStatus(conversationId, 'in_progress');
        const prompt = `你是项目统筹 Jean。请将以下项目目标拆解为 2-4 个阶段。

项目：${conv.title}
目标：${conv.goal}${conv.projectPath ? `\n项目路径：${conv.projectPath}` : ''}

请严格按以下格式输出，不要输出其他内容：

PHASE: {阶段名} | {阶段简述}
TASK: {任务标题} | {任务描述} @{推荐agentId}
TASK: {任务标题} | {任务描述} @{推荐agentId}
PHASE: {下一个阶段名} | {阶段简述}
TASK: {任务标题} | {任务描述} @{推荐agentId}`;
        get().dispatchToAgent({
          agentId: 'jean',
          prompt,
        });
      },

      confirmBreakdown: (conversationId, proposals) => {
        let taskSeq = get().tasks.length;
        for (let pi = 0; pi < proposals.length; pi++) {
          const prop = proposals[pi];
          const phaseId = get().upsertPhase({
            conversationId,
            title: prop.title,
            description: prop.description,
            order: pi,
            status: 'planned',
          });
          for (const taskProp of prop.tasks) {
            taskSeq++;
            const taskId = `TASK-${String(taskSeq).padStart(3, '0')}`;
            const stamp = new Date().toISOString();
            set((state) => ({
              tasks: [...state.tasks, {
                id: taskId,
                conversationId,
                phaseId,
                title: taskProp.title,
                description: taskProp.description,
                status: 'pending' as TaskStatus,
                agentId: taskProp.agentId || 'jean',
                dependencies: [],
                artifacts: [],
                createdAt: stamp,
                updatedAt: stamp,
              }],
            }));
          }
        }
        get().setBreakdownStatus(conversationId, 'confirmed');
      },
```

Add a module-level counter before the store definition (near `taskCounter`):

```typescript
let state_phases_seq = 1;
```

Use `'jean'` directly as the fallback agentId — the planner always suggests valid agent IDs in the breakdown, and Jean is the safest default.

- [ ] **Step 10: Add phases to partialize**

Find the `partialize` configuration. Add `phases` to the persisted fields alongside `roleCards`:

```typescript
phases: state.phases,
```

- [ ] **Step 11: Add migration for existing data**

In the `onRehydrateStorage` migration section, add logic to backfill missing fields on existing conversations:

```typescript
// Backfill breakdownStatus and projectPath on existing conversations
let needsConvUpdate = false;
const updatedConversations = state.conversations.map((c: any) => {
  let updated = false;
  const patches: Record<string, any> = {};
  if (c.breakdownStatus === undefined) { patches.breakdownStatus = 'none'; updated = true; }
  if (c.projectPath === undefined) { patches.projectPath = ''; updated = true; }
  if (updated) { needsConvUpdate = true; return { ...c, ...patches }; }
  return c;
});
if (needsConvUpdate) {
  state.conversations = updatedConversations;
}
```

Also backfill `phaseId` on existing tasks:

```typescript
// Backfill phaseId on existing tasks
let needsTaskUpdate = false;
const updatedTasks = state.tasks.map((t: any) => {
  if (t.phaseId === undefined) { needsTaskUpdate = true; return { ...t, phaseId: '' }; }
  return t;
});
if (needsTaskUpdate) {
  state.tasks = updatedTasks;
}
```

- [ ] **Step 12: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 13: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: add Phase state, breakdown actions, and model updates to store"
```

---

### Task 6: Update ProjectCreateDialog

**Files:**
- Modify: `src/components/project/ProjectCreateDialog.tsx`

- [ ] **Step 1: Add FolderPicker and autoBreakdown toggle**

Import FolderPicker at the top:

```typescript
import { FolderPicker } from '@/components/ui/FolderPicker';
```

Add state variables after the existing `useState` declarations (around line 17):

```typescript
  const [projectPath, setProjectPath] = useState('');
  const [autoBreakdown, setAutoBreakdown] = useState(true);
```

Add the FolderPicker section after the title input and before the goal textarea (between the two `<div className="space-y-1.5">` blocks):

```tsx
            <div className="space-y-1.5">
              <FolderPicker value={projectPath} onChange={setProjectPath} />
            </div>
```

Add the autoBreakdown toggle after the goal textarea section:

```tsx
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={autoBreakdown}
                onClick={() => setAutoBreakdown(!autoBreakdown)}
                className={cn(
                  'w-4 h-4 rounded-[2px] border-2 flex items-center justify-center transition-all',
                  autoBreakdown
                    ? 'bg-[hsl(var(--accent))] border-[hsl(var(--accent))] text-white'
                    : 'bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))]'
                )}
              >
                {autoBreakdown && <span className="text-[10px]">✓</span>}
              </button>
              <span className="text-[11px] text-[hsl(var(--text-secondary))]">
                自动拆解任务（由 ⚔️ Jean 分析）
              </span>
            </div>
```

Update the `handleCreate` to pass new fields:

```typescript
  const handleCreate = () => {
    const trimmedTitle = title.trim();
    const trimmedGoal = goal.trim();
    if (!trimmedTitle || !trimmedGoal) return;
    createConversation({ title: trimmedTitle, goal: trimmedGoal, projectPath: projectPath || undefined, autoBreakdown });
    setTitle('');
    setGoal('');
    setProjectPath('');
    setAutoBreakdown(true);
    onClose();
  };
```

Update the submit button label:

Change `创建项目` to:

```tsx
{autoBreakdown ? '创建并拆解' : '创建项目'}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/project/ProjectCreateDialog.tsx
git commit -m "feat: add FolderPicker and autoBreakdown toggle to project creation"
```

---

### Task 7: ChatMessageItem Phase Rendering

**Files:**
- Modify: `src/components/task-hub/ChatMessageItem.tsx`

- [ ] **Step 1: Add breakdown parser import**

At the top, add:

```typescript
import { parsePhaseBreakdown, type PhaseProposal } from '@/lib/breakdownParser';
```

- [ ] **Step 2: Replace proposal parsing logic**

Find the `parseTaskProposals` call (around line 91). Replace it with:

```typescript
  const proposals = useMemo(() => parsePhaseBreakdown(message.content), [message.content]);
  const hasPhaseStructure = proposals.length > 0;
```

Remove the old `parseTaskProposals` function definition (lines 58-75) and the `TaskProposal` type (lines 52-56) — they are replaced by `parsePhaseBreakdown` from the lib.

- [ ] **Step 3: Add local checkbox state for task selection**

Add a `useState` for tracking which tasks are checked. Each task is keyed by `"${pi}-${ti}"` (phase index + task index):

```typescript
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => {
    if (!hasPhaseStructure) return new Set();
    // Default: all tasks checked
    const keys = new Set<string>();
    proposals.forEach((phase, pi) => {
      phase.tasks.forEach((_, ti) => keys.add(`${pi}-${ti}`));
    });
    return keys;
  });

  const toggleCheck = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Build filtered proposals from checked tasks
  const filteredProposals = useMemo(() => {
    return proposals.map((phase, pi) => ({
      ...phase,
      tasks: phase.tasks.filter((_, ti) => checkedKeys.has(`${pi}-${ti}`)),
    })).filter((p) => p.tasks.length > 0);
  }, [proposals, checkedKeys]);

  const totalChecked = filteredProposals.reduce((sum, p) => sum + p.tasks.length, 0);
```

- [ ] **Step 4: Add phase proposal rendering with checkboxes**

Find the existing `{proposals.length > 0 && (` block (around line 151). Replace the entire block with phase-grouped rendering:

```tsx
          {hasPhaseStructure && (
            <div className="mt-3 pt-2 border-t border-dashed border-[hsl(var(--border-subtle))] flex flex-col gap-2">
              {proposals.map((phase, pi) => (
                <div key={pi} className="rounded-[4px] border-2 border-[hsl(var(--border))] overflow-hidden">
                  <div className="px-3 py-1.5 bg-[hsl(var(--bg-muted))] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold bg-[hsl(var(--accent))] text-white px-1.5 py-0.5 rounded-[2px]">
                        阶段 {pi + 1}
                      </span>
                      <span className="text-[11px] font-bold text-[hsl(var(--text-primary))]">{phase.title}</span>
                    </div>
                    <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{phase.tasks.length} 任务</span>
                  </div>
                  <div className="px-2 py-1.5 flex flex-col gap-1">
                    {phase.tasks.map((task, ti) => {
                      const key = `${pi}-${ti}`;
                      const isChecked = checkedKeys.has(key);
                      const suggestedAgent = task.agentId ? allAgents.find((a) => a.id === task.agentId) : undefined;
                      return (
                        <div
                          key={key}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1 rounded-[2px] border transition-colors",
                            isChecked
                              ? "bg-[hsl(var(--bg-app))] border-[hsl(var(--border-subtle))]"
                              : "bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))] opacity-50"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCheck(key)}
                            className={cn(
                              "w-4 h-4 rounded-[2px] border-2 flex items-center justify-center shrink-0 transition-all",
                              isChecked
                                ? "bg-[hsl(var(--accent))] border-[hsl(var(--accent))] text-white"
                                : "bg-[hsl(var(--bg-muted))] border-[hsl(var(--border))]"
                            )}
                          >
                            {isChecked && <span className="text-[8px]">✓</span>}
                          </button>
                          <span className="text-[10px] text-[hsl(var(--text-primary))] flex-1 truncate">{task.title}</span>
                          {suggestedAgent && (
                            <span className="text-[9px] text-[hsl(var(--text-tertiary))] shrink-0">
                              {suggestedAgent.emoji} {suggestedAgent.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  disabled={totalChecked === 0}
                  onClick={() => {
                    const convId = useTaskHubStore.getState().selectedConversationId;
                    if (!convId) return;
                    useTaskHubStore.getState().confirmBreakdown(convId, filteredProposals);
                  }}
                  className="flex-1 py-1.5 text-[10px] font-bold bg-[hsl(var(--accent))] text-white border-2 border-[hsl(var(--accent))] rounded-[2px] shadow-[2px_2px_0px_hsl(var(--accent)/0.4)] hover:shadow-[1px_1px_0px_hsl(var(--accent)/0.4)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ✓ 确认选中 ({totalChecked} 个任务)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const convId = useTaskHubStore.getState().selectedConversationId;
                    if (!convId) return;
                    useTaskHubStore.getState().triggerBreakdown(convId);
                  }}
                  className="py-1.5 px-3 text-[10px] font-bold text-[hsl(var(--text-tertiary))] bg-[hsl(var(--bg-muted))] border border-[hsl(var(--border))] rounded-[2px] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  重新拆解
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors (may need to fix `allAgents` reference — it already exists in the component scope)

- [ ] **Step 5: Commit**

```bash
git add src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: render phase-grouped task proposals with confirm button"
```

---

### Task 8: ProjectChatPanel Breakdown Status

**Files:**
- Modify: `src/components/project/ProjectChatPanel.tsx`

- [ ] **Step 1: Add breakdown status indicator**

In the header section, after the goal text and before `<AgentBar />`, add:

```tsx
        {selectedConversation?.breakdownStatus === 'in_progress' && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-bold text-amber-500">⚔️ Jean 正在拆解任务…</span>
          </div>
        )}
        {selectedConversation?.breakdownStatus === 'reviewed' && (() => {
          const phaseCount = phases.filter((p) => p.conversationId === selectedConversationId).length;
          const taskCount = scoped.length;
          return (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-[10px] font-bold text-amber-500">{phaseCount} 阶段 · {taskCount} 任务 · 待确认</span>
            </div>
          );
        })()}
```

Add the `phases` selector at the top of the component:

```typescript
  const phases = useTaskHubStore((s) => s.phases);
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/project/ProjectChatPanel.tsx
git commit -m "feat: add breakdown status indicator to command center header"
```

---

### Task 9: MiniKanban Phase Tabs

**Files:**
- Modify: `src/components/project/MiniKanban.tsx`

- [ ] **Step 1: Add phase filtering**

Add state and phase data selectors at the top of the component:

```typescript
import { useState } from 'react';
```

Inside the component, add:

```typescript
  const phases = useTaskHubStore((s) => s.phases);
  const [activePhase, setActivePhase] = useState<string | null>(null);

  const scopedPhases = useMemo(() => {
    if (!selectedConversationId) return [];
    return phases
      .filter((p) => p.conversationId === selectedConversationId)
      .sort((a, b) => a.order - b.order);
  }, [selectedConversationId, phases]);

  const phaseFiltered = useMemo(() => {
    if (!activePhase) return scoped;
    return scoped.filter((t) => t.phaseId === activePhase);
  }, [scoped, activePhase]);
```

- [ ] **Step 2: Add phase tab bar**

Add the phase tab bar before the kanban columns, after the header section:

```tsx
      {scopedPhases.length > 0 && (
        <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setActivePhase(null)}
            className={cn(
              'px-2 py-1 text-[10px] font-bold rounded-[2px] border-2 transition-all',
              activePhase === null
                ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))] shadow-[1px_1px_0px_hsl(var(--accent)/0.4)]'
                : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))] hover:border-[hsl(var(--text-primary))]'
            )}
          >
            全部 ({scoped.length})
          </button>
          {scopedPhases.map((phase) => {
            const count = scoped.filter((t) => t.phaseId === phase.id).length;
            return (
              <button
                key={phase.id}
                type="button"
                onClick={() => setActivePhase(phase.id)}
                className={cn(
                  'px-2 py-1 text-[10px] font-bold rounded-[2px] border-2 transition-all',
                  activePhase === phase.id
                    ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))] shadow-[1px_1px_0px_hsl(var(--accent)/0.4)]'
                    : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))] hover:border-[hsl(var(--text-primary))]'
                )}
              >
                {phase.title} ({count})
              </button>
            );
          })}
        </div>
      )}
```

Replace `scoped` with `phaseFiltered` in the `groupByStatus` call:

```typescript
  const grouped = useMemo(() => groupByStatus(phaseFiltered), [phaseFiltered]);
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/project/MiniKanban.tsx
git commit -m "feat: add phase tab filtering to MiniKanban"
```

---

### Task 10: Integration Verification

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Start dev server and manually test**

Run: `npx next dev`

Test the flow:
1. Open the app, click "+" to create project
2. Fill in title + goal, browse and select a folder, ensure "auto-breakdown" is checked
3. Click "创建并拆解"
4. Verify the header shows "⚔️ Jean 正在拆解任务…"
5. Wait for Jean's response with PHASE/TASK lines
6. Verify the response renders as phase-grouped cards
7. Click "确认全部" — verify tasks appear in MiniKanban
8. Verify phase tabs appear in MiniKanban and filtering works
9. Verify the header shows status counts after confirmation

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: project task breakdown — integration complete"
```
