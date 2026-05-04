# TASKS.md ↔ Kanban Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kanban board display tasks and risks that agents write to `.ath/TASKS.md`, by fixing the file watcher to create DB records and adding Phase/Risk support to the file format.

**Architecture:** Extend `task-file-service.ts` with Phase column and Risk section parsing. Fix `task-file-watcher.ts` to create (not just update) DB records. Update `task.sync` store handler to add new tasks. Update `task_create` tool with full parameters. Update `protocolLayer.ts` to guide agents toward tool usage.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Zustand, Socket.IO, chokidar, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/server/task-file-service.ts` | Modify | New `ParsedTask` with `phase`, new `ParsedBlocker` type, updated parser/formatter for 8-col + Risk section |
| `src/server/task-file-watcher.ts` | Modify | `syncTasksToDb` creates tasks in DB (not just updates), syncs blockers to store |
| `src/data/presetSkills/taskManagement.ts` | Modify | `task_create` gains `dependencies`, `deliverable`, `role`, `phase` params |
| `src/server/skill-tool-executor.ts` | Modify | `executeTaskCreate` writes DB + file with full params |
| `src/pages/api/mutations.ts` | Modify | `tool.invoke` → `task_create` writes DB + file; `task_update_status` also writes file |
| `src/store/taskHubStore.ts` | Modify | `task.sync` handler creates new tasks in store (removes `continue` guard) |
| `src/lib/agent-context/layers/protocolLayer.ts` | Modify | Guide agents to use tools, document new TASKS.md format |
| `src/__tests__/server/task-file-service.test.ts` | Modify | Tests for new format parsing, round-trip, risk section |

---

### Task 1: Update TASKS.md format — ParsedTask, ParsedBlocker, parser, formatter

**Files:**
- Modify: `src/server/task-file-service.ts`
- Modify: `src/__tests__/server/task-file-service.test.ts`

- [ ] **Step 1: Write failing tests for new format**

Add to `src/__tests__/server/task-file-service.test.ts`:

```typescript
describe('parseTasksMd — new format with Phase', () => {
  it('parses 8-col format with Phase replacing Level', () => {
    const md = `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-001 | 拆分 Store | P1 | backend | luigi | doing | - | store slices |
| TASK-002 | 测试覆盖 | P1 | testing | - | todo | TASK-001 | - |
`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      id: 'TASK-001',
      title: '拆分 Store',
      phase: 'P1',
      role: 'backend',
      agent: 'luigi',
      status: 'in_progress',
      depends: [],
      deliverable: 'store slices',
    });
    expect(tasks[1].phase).toBe('P1');
    expect(tasks[1].depends).toEqual(['TASK-001']);
  });

  it('still parses old 9-col format (with Level) by mapping col 2 to phase', () => {
    const md = `| ID | Title | Role | Agent | Status | Depends | Deliverable | Level |\n|----|-------|------|-------|--------|---------|-------------|-------|\n| TASK-001 | Foo | backend | - | todo | - | - | L2 |`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(1);
    // Old format: no phase column, role is col 2
    expect(tasks[0].role).toBe('backend');
  });
});

describe('parseBlockersMd', () => {
  it('parses risk section below task table', () => {
    const md = `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-001 | Foo | P1 | backend | luigi | doing | - | - |

## 风险 / 阻塞

| ID | Task | Type | Summary | Status |
|----|------|------|---------|--------|
| R1 | TASK-001 | gate_fail | 类型定义不兼容 | open |
| R2 | TASK-001 | timeout | 等待上游依赖 | fixed |
`;
    const blockers = parseBlockersMd(md);
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toEqual({
      id: 'R1',
      taskId: 'TASK-001',
      type: 'gate_fail',
      summary: '类型定义不兼容',
      status: 'open',
    });
    expect(blockers[1].status).toBe('fixed');
  });

  it('returns empty array when no risk section', () => {
    expect(parseBlockersMd('# No risks')).toEqual([]);
  });
});

describe('formatTasksMd — new format', () => {
  it('round-trips parse → format with phase', () => {
    const original = [
      { id: 'TASK-001', title: 'Do thing', phase: 'P1', role: 'backend', agent: 'luigi', status: 'pending', depends: [], deliverable: 'store.ts' },
    ];
    const md = formatTasksMd(original);
    expect(md).toContain('| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |');
    const reparsed = parseTasksMd(md);
    expect(reparsed).toEqual(original);
  });
});

describe('formatBlockersMd', () => {
  it('formats blockers and round-trips', () => {
    const blockers = [
      { id: 'R1', taskId: 'TASK-001', type: 'gate_fail', summary: '类型不兼容', status: 'open' },
    ];
    const md = formatBlockersMd(blockers);
    expect(md).toContain('## 风险 / 阻塞');
    expect(md).toContain('| R1 | TASK-001 | gate_fail | 类型不兼容 | open |');
    const reparsed = parseBlockersMd(md);
    expect(reparsed).toEqual(blockers);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/server/task-file-service.test.ts`
Expected: FAIL — `phase` not in `ParsedTask`, `parseBlockersMd` / `formatBlockersMd` not exported

- [ ] **Step 3: Update `ParsedTask` type — add `phase`, remove `level`**

In `src/server/task-file-service.ts`, update the types and logic:

```typescript
export interface ParsedTask {
  id: string;
  title: string;
  phase: string;
  role: string;
  agent: string;
  status: string;
  depends: string[];
  deliverable: string;
}

export interface ParsedBlocker {
  id: string;
  taskId: string;
  type: string;
  summary: string;
  status: 'open' | 'fixed';
}
```

- [ ] **Step 4: Update `parseTasksMd` for 8-col format (Phase replaces Level)**

```typescript
export function parseTasksMd(content: string): ParsedTask[] {
  const lines = content.split('\n');
  const tasks: ParsedTask[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.startsWith('|-') || trimmed.startsWith('| ID') || trimmed.startsWith('|ID')) continue;

    const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);

    // Detect format by column count:
    // 8 cols: ID | Title | Phase | Role | Agent | Status | Depends | Deliverable (new)
    // 8 cols: ID | Title | Role | Agent | Status | Depends | Deliverable | Level (old — no phase)
    // We distinguish by checking if col[7] looks like L1/L2 (level) or a deliverable path
    if (cells.length < 8) continue;

    const id = cells[0];
    if (!id || id.includes('-') === false) continue;

    // Check if this is old format (Level col) or new format (Phase col)
    // Old format col order: ID Title Role Agent Status Depends Deliverable Level
    // New format col order: ID Title Phase Role Agent Status Depends Deliverable
    // Heuristic: if cells.length === 8 and last col matches L[0-9], it's old format
    const isOldFormat = cells.length === 8 && /^L\d+$/.test(cells[7]);

    if (isOldFormat) {
      tasks.push({
        id,
        title: cells[1],
        phase: '',
        role: cells[2],
        agent: cells[3] === '-' ? '' : cells[3],
        status: STATUS_MAP[cells[4]] ?? cells[4],
        depends: cells[5] === '-' ? [] : cells[5].split(',').map((s) => s.trim()),
        deliverable: cells[6] === '-' ? '' : cells[6],
      });
    } else {
      // New format: 8 cols with Phase
      tasks.push({
        id,
        title: cells[1],
        phase: cells[2] === '-' ? '' : cells[2],
        role: cells[3],
        agent: cells[4] === '-' ? '' : cells[4],
        status: STATUS_MAP[cells[5]] ?? cells[5],
        depends: cells[6] === '-' ? [] : cells[6].split(',').map((s) => s.trim()),
        deliverable: cells[7] === '-' ? '' : cells[7],
      });
    }
  }

  return tasks;
}
```

- [ ] **Step 5: Update `formatTasksMd` for new 8-col format**

```typescript
export function formatTasksMd(tasks: ParsedTask[]): string {
  const header = `| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|`;

  const rows = tasks.map((t) => {
    const status = STATUS_REVERSE[t.status] ?? t.status;
    const agent = t.agent || '-';
    const depends = t.depends.length > 0 ? t.depends.join(',') : '-';
    const deliverable = t.deliverable || '-';
    const phase = t.phase || '-';
    return `| ${t.id} | ${t.title} | ${phase} | ${t.role} | ${agent} | ${status} | ${depends} | ${deliverable} |`;
  });

  return `# 任务看板\n\n${header}\n${rows.join('\n')}\n`;
}
```

- [ ] **Step 6: Add `parseBlockersMd` and `formatBlockersMd`**

```typescript
export function parseBlockersMd(content: string): ParsedBlocker[] {
  const lines = content.split('\n');
  const blockers: ParsedBlocker[] = [];
  let inRiskSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## 风险') || trimmed.startsWith('## Risks')) {
      inRiskSection = true;
      continue;
    }
    if (inRiskSection && trimmed.startsWith('## ')) {
      break; // end of risk section
    }
    if (!inRiskSection) continue;
    if (!trimmed.startsWith('|') || trimmed.startsWith('|-') || trimmed.startsWith('| ID') || trimmed.startsWith('|ID')) continue;

    const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 5) continue;

    blockers.push({
      id: cells[0],
      taskId: cells[1],
      type: cells[2],
      summary: cells[3],
      status: cells[4] === 'fixed' ? 'fixed' : 'open',
    });
  }

  return blockers;
}

export function formatBlockersMd(blockers: ParsedBlocker[]): string {
  if (blockers.length === 0) return '';
  const header = `## 风险 / 阻塞\n\n| ID | Task | Type | Summary | Status |\n|----|------|------|---------|--------|`;
  const rows = blockers.map((b) => `| ${b.id} | ${b.taskId} | ${b.type} | ${b.summary} | ${b.status} |`);
  return `${header}\n${rows.join('\n')}\n`;
}
```

- [ ] **Step 7: Update `writeTasksMd` to include blockers**

```typescript
export function writeTasksMd(projectPath: string, tasks: ParsedTask[], blockers?: ParsedBlocker[]): void {
  const dir = join(projectPath, '.ath');
  mkdirSync(dir, { recursive: true });
  let content = formatTasksMd(tasks);
  if (blockers && blockers.length > 0) {
    content += '\n' + formatBlockersMd(blockers);
  }
  writeFileSync(join(dir, 'TASKS.md'), content, 'utf-8');
}
```

- [ ] **Step 8: Update `readTasksMd` to also return blockers**

Change return type to `{ tasks: ParsedTask[]; blockers: ParsedBlocker[] }`:

```typescript
export function readTasksMd(projectPath: string): { tasks: ParsedTask[]; blockers: ParsedBlocker[] } {
  const filePath = join(projectPath, '.ath', 'TASKS.md');
  if (!existsSync(filePath)) return { tasks: [], blockers: [] };
  const content = readFileSync(filePath, 'utf-8');
  return {
    tasks: parseTasksMd(content),
    blockers: parseBlockersMd(content),
  };
}
```

- [ ] **Step 9: Update `updateTaskInMd` to use new readTasksMd return type**

```typescript
export function updateTaskInMd(projectPath: string, taskId: string, updates: Partial<Pick<ParsedTask, 'status' | 'agent' | 'deliverable' | 'phase'>>): void {
  const { tasks, blockers } = readTasksMd(projectPath);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  Object.assign(tasks[idx], updates);
  writeTasksMd(projectPath, tasks, blockers);
}
```

- [ ] **Step 10: Update existing tests to match new `ParsedTask` shape (no `level`, has `phase`)**

Update the existing round-trip test in `task-file-service.test.ts`:

```typescript
it('round-trips parse → format', () => {
  const original = [
    { id: 'TASK-001', title: 'Do thing', phase: 'P1', role: 'backend', agent: 'luigi', status: 'pending', depends: [], deliverable: '' },
  ];
  const md = formatTasksMd(original);
  const reparsed = parseTasksMd(md);
  expect(reparsed).toEqual(original);
});
```

And update the existing `parses a valid TASKS.md table` test to use new format.

- [ ] **Step 11: Run tests to verify all pass**

Run: `npx vitest run src/__tests__/server/task-file-service.test.ts`
Expected: ALL PASS

- [ ] **Step 12: Commit**

```bash
git add src/server/task-file-service.ts src/__tests__/server/task-file-service.test.ts
git commit -m "feat(task-file): new 8-col format with Phase + Blocker risk section"
```

---

### Task 2: Fix file watcher — create tasks in DB, sync blockers

**Files:**
- Modify: `src/server/task-file-watcher.ts`

- [ ] **Step 1: Update `syncTasksToDb` to create new tasks and sync blockers**

```typescript
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { readTasksMd } from './task-file-service';
import { taskRepo } from './repositories/task-repo';
import type { Server as IOServer } from 'socket.io';

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function conversationIdFromPath(projectPath: string): string {
  // projectPath is like .ath/workspaces/conv-xxx → extract conv-xxx
  const parts = projectPath.split('/');
  return parts[parts.length - 1] || 'default';
}

export function startTaskWatcher(projectPath: string, io: IOServer): void {
  if (watchers.has(projectPath)) return;

  const tasksFile = `${projectPath}/.ath/TASKS.md`;
  const watcher = watch(tasksFile, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('change', () => {
    if (debounceTimers.has(projectPath)) clearTimeout(debounceTimers.get(projectPath)!);
    debounceTimers.set(projectPath, setTimeout(() => {
      debounceTimers.delete(projectPath);
      syncTasksToDb(projectPath, io);
    }, 500));
  });

  watchers.set(projectPath, watcher);
}

export function stopTaskWatcher(projectPath: string): void {
  const watcher = watchers.get(projectPath);
  if (watcher) {
    watcher.close();
    watchers.delete(projectPath);
  }
  const timer = debounceTimers.get(projectPath);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(projectPath);
  }
}

export function syncTasksToDb(projectPath: string, io: IOServer): void {
  const { tasks: parsed, blockers } = readTasksMd(projectPath);
  if (parsed.length === 0 && blockers.length === 0) return;

  const conversationId = conversationIdFromPath(projectPath);
  const newlyDone: string[] = [];

  for (const t of parsed) {
    const existing = taskRepo.getById(t.id);

    if (!existing) {
      // CREATE new task in DB — this is the key fix
      try {
        taskRepo.create({
          id: t.id,
          conversation_id: conversationId,
          title: t.title,
          description: t.deliverable || '',
          agent_id: t.agent || '',
          dependencies: t.depends,
        });
      } catch (e) {
        console.error(`[watcher] failed to create task ${t.id}:`, e);
      }
      continue;
    }

    if (existing.status !== t.status) {
      taskRepo.updateStatus(t.id, t.status);
      if (t.status === 'done') newlyDone.push(t.id);
    }
    if (t.agent && existing.agent_id !== t.agent) {
      taskRepo.update(t.id, { agent_id: t.agent });
    }
  }

  // Dependency resolution: check if any todo tasks are now unblocked
  for (const doneId of newlyDone) {
    for (const t of parsed) {
      if (t.depends.includes(doneId) && t.status === 'pending' && t.agent) {
        const allDone = t.depends.every((depId) => {
          const dep = parsed.find((p) => p.id === depId);
          return dep?.status === 'done';
        });
        if (allDone) {
          io.emit('task.ready', { taskId: t.id, agentId: t.agent, projectPath });
        }
      }
    }
  }

  io.emit('task.sync', { projectPath, conversationId, tasks: parsed, blockers });
}
```

- [ ] **Step 2: Verify the watcher compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors in `task-file-watcher.ts`

- [ ] **Step 3: Commit**

```bash
git add src/server/task-file-watcher.ts
git commit -m "fix(watcher): create tasks in DB when new tasks found in TASKS.md"
```

---

### Task 3: Update `task.sync` store handler — accept new tasks and blockers

**Files:**
- Modify: `src/store/taskHubStore.ts` (lines 1403-1417)

- [ ] **Step 1: Update `task.sync` handler to create new tasks and process blockers**

Find the `socket.on('task.sync', ...)` block (around line 1403) and replace:

```typescript
socket.on('task.sync', ({ projectPath, conversationId, tasks: syncedTasks, blockers: syncedBlockers }: { projectPath: string; conversationId: string; tasks: any[]; blockers?: any[] }) => {
  const store = useTaskHubStore.getState();

  for (const synced of syncedTasks) {
    const existing = store.getTaskById(synced.id);
    if (!existing) {
      // New task from file — add to store
      useTaskHubStore.setState((state) => ({
        tasks: [...state.tasks, {
          id: synced.id,
          conversationId: conversationId || state.selectedConversationId || '',
          phaseId: synced.phase || '',
          title: synced.title,
          description: synced.deliverable || '',
          status: synced.status,
          agentId: synced.agent || '',
          dependencies: synced.depends || [],
          artifacts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      }));
      continue;
    }

    if (existing.status !== synced.status || existing.agentId !== synced.agent) {
      useTaskHubStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === synced.id
            ? { ...t, status: synced.status, agentId: synced.agent || t.agentId, updatedAt: new Date().toISOString() }
            : t
        ),
      }));
    }
  }

  // Sync blockers from file
  if (syncedBlockers && syncedBlockers.length > 0) {
    for (const b of syncedBlockers) {
      if (b.status === 'open') {
        const existing = (store.blockersByConversation[conversationId] || []).find((eb: any) => eb.id === b.id);
        if (!existing) {
          store.openBlocker({
            id: b.id,
            conversationId,
            taskId: b.taskId,
            type: b.type,
            reasonSummary: b.summary,
            status: 'open',
          });
        }
      }
    }
  }
});
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i 'taskHubStore' | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "fix(store): task.sync handler creates new tasks from file and syncs blockers"
```

---

### Task 4: Update `task_create` tool — add full parameters

**Files:**
- Modify: `src/data/presetSkills/taskManagement.ts`
- Modify: `src/server/skill-tool-executor.ts`
- Modify: `src/pages/api/mutations.ts`

- [ ] **Step 1: Update `taskManagement.ts` tool definition**

Replace the `task_create` entry in the tools array:

```typescript
{
  name: 'task_create',
  description: 'Create a new task with full details and optionally assign it to an agent',
  parameters: [
    { name: 'title', type: 'string', required: true, description: 'Short task title' },
    { name: 'description', type: 'string', required: false, description: 'Detailed task description' },
    { name: 'agent_id', type: 'string', required: false, description: 'Agent ID to assign (mario, luigi, toad, peach, dk, yoshi)' },
    { name: 'role', type: 'string', required: false, description: 'Task role: planner, backend, frontend, testing, security, devops' },
    { name: 'phase', type: 'string', required: false, description: 'Phase ID (e.g. P1, P2)' },
    { name: 'dependencies', type: 'string', required: false, description: 'Comma-separated task IDs this task depends on' },
    { name: 'deliverable', type: 'string', required: false, description: 'Expected output file or artifact' },
  ],
  handler: 'api://tasks/create',
},
```

- [ ] **Step 2: Update `executeTaskCreate` in `skill-tool-executor.ts`**

Replace the `executeTaskCreate` function:

```typescript
function executeTaskCreate(invocation: ToolInvocation): ToolResult {
  const title = invocation.input.title as string;
  if (!title) {
    return { success: false, error: 'title is required' };
  }

  const taskCount = taskRepo.list().length;
  const id = `TASK-${String(taskCount + 1).padStart(3, '0')}`;
  const agentId = (invocation.input.agent_id as string) || invocation.agentId;
  const dependencies = typeof invocation.input.dependencies === 'string'
    ? (invocation.input.dependencies as string).split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const task = taskRepo.create({
    id,
    conversation_id: invocation.conversationId,
    title,
    description: (invocation.input.description as string) || '',
    agent_id: agentId,
    dependencies,
  });

  // Also write to TASKS.md
  try {
    const { updateTaskInMd } = require('./task-file-service');
    const { join } = require('path');
    const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
    const projectDir = join(wsRoot, invocation.conversationId || 'default');
    const role = (invocation.input.role as string) || 'worker';
    const phase = (invocation.input.phase as string) || '';
    const deliverable = (invocation.input.deliverable as string) || '';

    // Read existing tasks, append new one, write back
    const { readTasksMd, writeTasksMd } = require('./task-file-service');
    const { tasks: existingTasks, blockers } = readTasksMd(projectDir);
    existingTasks.push({
      id, title, phase, role, agent: agentId, status: 'pending', depends: dependencies, deliverable,
    });
    writeTasksMd(projectDir, existingTasks, blockers);
  } catch (e) {
    console.error('[task_create] failed to update TASKS.md:', e);
  }

  return { success: true, data: task };
}
```

- [ ] **Step 3: Update `executeTaskUpdateStatus` to also write to file**

Replace `executeTaskUpdateStatus`:

```typescript
function executeTaskUpdateStatus(invocation: ToolInvocation): ToolResult {
  const taskId = invocation.input.task_id as string;
  const status = invocation.input.status as string;

  if (!taskId || !status) {
    return { success: false, error: 'task_id and status are required' };
  }

  const allowedStatuses = ['pending', 'in_progress', 'in_review', 'done', 'blocked', 'rejected'];
  if (!allowedStatuses.includes(status)) {
    return { success: false, error: `Invalid status: ${status}. Allowed: ${allowedStatuses.join(', ')}` };
  }

  const existing = taskRepo.getById(taskId);
  if (!existing) {
    return { success: false, error: `Task not found: ${taskId}` };
  }

  taskRepo.updateStatus(taskId, status);

  // Also update TASKS.md
  try {
    const { updateTaskInMd } = require('./task-file-service');
    const { join } = require('path');
    const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
    const projectDir = join(wsRoot, existing.conversation_id || 'default');
    const STATUS_REVERSE: Record<string, string> = {
      pending: 'todo', in_progress: 'doing', in_review: 'review', done: 'done', blocked: 'blocked', rejected: 'rejected',
    };
    updateTaskInMd(projectDir, taskId, { status: STATUS_REVERSE[status] || status });
  } catch (e) {
    console.error('[task_update_status] failed to update TASKS.md:', e);
  }

  return { success: true, data: { id: taskId, status } };
}
```

- [ ] **Step 4: Update `mutations.ts` `task_create` handler to match**

In the `tool.invoke` → `task_create` branch (line 176), update to also write file:

```typescript
} else if (toolName === 'task_create') {
  const taskCount = taskRepo.list().length;
  const id = `TASK-${String(taskCount + 1).padStart(3, '0')}`;
  const deps = typeof input.dependencies === 'string'
    ? input.dependencies.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  const task = taskRepo.create({
    id,
    conversation_id: conversationId,
    title: input.title,
    description: input.description || '',
    agent_id: input.agent_id || toolAgentId,
    dependencies: deps,
  });

  // Also write to TASKS.md
  try {
    const { readTasksMd, writeTasksMd } = await import('@/server/task-file-service');
    const { join } = await import('path');
    const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
    const projectDir = join(wsRoot, conversationId || 'default');
    const { tasks: existingTasks, blockers } = readTasksMd(projectDir);
    existingTasks.push({
      id,
      title: input.title,
      phase: input.phase || '',
      role: input.role || 'worker',
      agent: input.agent_id || toolAgentId || '',
      status: 'pending',
      depends: deps,
      deliverable: input.deliverable || '',
    });
    writeTasksMd(projectDir, existingTasks, blockers);
  } catch (e) {
    console.error('[task_create] failed to update TASKS.md:', e);
  }

  res.json({ ok: true, result: task });
}
```

Also update `task_update_status` branch to write file:

```typescript
} else if (toolName === 'task_update_status') {
  taskRepo.updateStatus(input.task_id, input.status);

  // Also update TASKS.md
  try {
    const { updateTaskInMd } = await import('@/server/task-file-service');
    const { join } = await import('path');
    const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
    const existing = taskRepo.getById(input.task_id);
    const convId = existing?.conversation_id || conversationId || 'default';
    const projectDir = join(wsRoot, convId);
    const STATUS_REVERSE: Record<string, string> = {
      pending: 'todo', in_progress: 'doing', in_review: 'review', done: 'done', blocked: 'blocked', rejected: 'rejected',
    };
    updateTaskInMd(projectDir, input.task_id, { status: STATUS_REVERSE[input.status] || input.status });
  } catch (e) {
    console.error('[task_update_status] failed to update TASKS.md:', e);
  }

  res.json({ ok: true });
}
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/data/presetSkills/taskManagement.ts src/server/skill-tool-executor.ts src/pages/api/mutations.ts
git commit -m "feat(tools): task_create with full params + task_update_status write to TASKS.md"
```

---

### Task 5: Update `protocolLayer.ts` — guide agents to use tools

**Files:**
- Modify: `src/lib/agent-context/layers/protocolLayer.ts`

- [ ] **Step 1: Rewrite protocol layer to guide tool usage and document new format**

```typescript
import type { RoleCard } from '@/types/roleCard';

export function deriveRoleFromCard(roleCard?: RoleCard): string {
  if (!roleCard?.capabilities?.domains?.length) return 'worker';
  return roleCard.capabilities.domains[0];
}

interface ProtocolLayerOpts {
  agentId: string;
  agentRole: string;
  projectPath: string;
  hasTaskAssignment: boolean;
  isPlanner: boolean;
}

export function buildProtocolLayer(opts: ProtocolLayerOpts): string {
  const constraints = `## 任务协作协议

### 你的身份
- agentId: ${opts.agentId} | Role: ${opts.agentRole}

### 任务管理方式
使用以下工具管理任务（不要手动编辑 .ath/TASKS.md）：
- task_create：创建任务（含 phase、role、dependencies、deliverable）
- task_update_status：更新任务状态
- task_assign：分配任务给其他 Agent
- task_list：查询任务列表

### TASKS.md 格式（只读参考，由系统自动维护）
\`\`\`
| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
| TASK-001 | 示例 | P1 | backend | luigi | doing | - | types.ts |

## 风险 / 阻塞
| ID | Task | Type | Summary | Status |
| R1 | TASK-001 | gate_fail | 描述 | open |
\`\`\`

### 状态流转
todo → doing → review → done / blocked

### 规则
1. 先用 task_list 查看全部任务
2. 有分配给你的 → 认领 → task_update_status 改为 doing → 执行
3. 完成后 → task_update_status 改为 review + 填 deliverable
4. 阻塞 → task_update_status 改为 blocked，在聊天中说明原因
5. 遇到风险 → 在聊天中上报，由 planner 记录到 TASKS.md

### 禁止
- 不直接编辑 .ath/TASKS.md（由系统工具维护）
- 不改其他 Agent 的任务行
- 不跳过 review 直接标 done

### 资源位置
- 任务看板: .ath/TASKS.md（只读）
- 完成标准: .ath/PROTOCOLS.md
- 角色映射: .ath/ROLES.md
- 项目上下文: .ath/PROJECT.md`;

  let guidance = '';

  if (opts.isPlanner) {
    guidance = '\n\n调度职责：用 task_list 读取看板，按优先级用 task_assign 分配任务。遇到风险用 task_create 参数记录。';
  } else if (opts.hasTaskAssignment) {
    guidance = '\n\n你被分配了任务。用 task_list 确认，用 task_update_status 更新进度。';
  } else {
    guidance = '\n\n用 task_list 检查是否有 Role 匹配的 todo 任务。没有则按用户指令执行。';
  }

  return constraints + guidance;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i 'protocolLayer' | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-context/layers/protocolLayer.ts
git commit -m "feat(protocol): guide agents to use tools, document new TASKS.md format"
```

---

### Task 6: Update `confirmBreakdown` to use new `ParsedTask` shape

**Files:**
- Modify: `src/store/taskStore.ts` (lines 394-405)

- [ ] **Step 1: Update `confirmBreakdown` mapping to include `phase` instead of `level`**

Find the `mdTasks` mapping (around line 396) and update:

```typescript
const mdTasks = allNewTasks.map((t: any) => ({
  id: t.id,
  title: t.title,
  phase: t.phaseId || '',
  role: roleMap[t.agentId] || 'backend',
  agent: t.agentId || '',
  status: t.status,
  depends: t.dependencies || [],
  deliverable: '',
}));
```

Note: `level` field removed, `phase` added from `t.phaseId`.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i 'taskStore' | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/store/taskStore.ts
git commit -m "fix(store): confirmBreakdown uses new ParsedTask shape with phase"
```

---

### Task 7: Integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Manual smoke test — create a TASKS.md and verify kanban shows it**

1. Create a test TASKS.md at `.ath/workspaces/<conversationId>/.ath/TASKS.md` with the new format
2. Verify the file watcher detects it and populates the DB
3. Verify the kanban board shows the tasks and risks
4. Verify phase filter works

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: integration fixes for TASKS.md ↔ kanban sync"
```
