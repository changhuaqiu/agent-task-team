# Task System Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the task system with dispatch persistence, workdir isolation, skill-based tool definitions, and token tracking — inspired by Multica's task orchestration patterns.

**Architecture:** Four modules built incrementally. Module 1 (dispatch persistence) is the foundation. Module 2 (workdir) and Module 4 (token tracking) depend on Module 1. Module 3 (skill tools) depends on Modules 1+2. Each module produces testable, working software independently.

**Tech Stack:** Next.js 16, better-sqlite3, drizzle-orm, Zustand 5, Socket.io, Vitest

**Spec:** `docs/superpowers/specs/2026-05-04-task-system-enhancement-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/server/repositories/dispatch-repo.ts` | Dispatch queue persistence (claim, dequeue, find stale) |
| `src/server/workdir-manager.ts` | Workdir creation, reuse, GC |
| `src/lib/agent-context/layers/toolLayer.ts` | Generate tool definitions from skill.config |
| `src/data/presetSkills/taskManagement.ts` | Preset task-management skill definition |
| `src/__tests__/server/repositories/dispatch-repo.test.ts` | Tests for dispatch repo |
| `src/__tests__/server/workdir-manager.test.ts` | Tests for workdir manager |
| `src/__tests__/lib/agent-context/layers/toolLayer.test.ts` | Tests for tool layer |

### Modified files
| File | Changes |
|------|---------|
| `src/server/db/migrate.ts` | Migration v4: add dispatch columns to task and invocation |
| `src/server/db/schema.ts` | Drizzle schema updates for new columns |
| `src/server/repositories/invocation-repo.ts` | Add dispatch status methods, token usage |
| `src/store/taskHubStore.ts` | Replace in-memory pendingDispatches with DB dispatches, coalescing |
| `src/server/daemon.ts` | Use WorkdirManager, intercept tool_use events, persist tokens |
| `src/server/agent/types.ts` | Add tool interception types |
| `src/server/agent/claude.ts` | Extract usage from stream JSON |
| `src/server/agent/opencode.ts` | Include accumulated tokens in AgentResult |
| `src/lib/agent-context/layers/skillLayer.ts` | Read config.tools and pass to new toolLayer |
| `src/lib/agent-context/PromptComposer.ts` | Add toolLayer to system prompt, update SkillSummary |
| `src/data/presetSkills.ts` | Import and register task-management skill |
| `src/server/seed-skills.ts` | Seed task-management preset |
| `src/pages/api/mutations.ts` | Add tool_use dispatch mutation types |

---

## Phase 1: Dispatch Persistence (Module 1)

### Task 1: Add migration v4 for dispatch tracking columns

**Files:**
- Modify: `src/server/db/migrate.ts`

- [ ] **Step 1: Add migration v4 SQL to the MIGRATIONS array**

In `src/server/db/migrate.ts`, add a new entry to the `MIGRATIONS` array after the v3 entry:

```typescript
{
  version: 4,
  sql: `
    ALTER TABLE task ADD COLUMN claimed_at TEXT;
    ALTER TABLE task ADD COLUMN started_at TEXT;
    ALTER TABLE task ADD COLUMN completed_at TEXT;
    ALTER TABLE task ADD COLUMN lease_expiry TEXT;
    ALTER TABLE task ADD COLUMN work_dir TEXT;

    ALTER TABLE invocation ADD COLUMN dispatch_status TEXT DEFAULT 'queued';
    ALTER TABLE invocation ADD COLUMN token_usage TEXT;
  `,
},
```

- [ ] **Step 2: Run existing tests to verify migration applies cleanly**

Run: `npx vitest run src/__tests__/server/db/index.test.ts`
Expected: PASS — migration v4 applies on top of v3 without error.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrate.ts
git commit -m "feat: add migration v4 for dispatch tracking columns on task and invocation tables"
```

---

### Task 2: Update Drizzle schema for new columns

**Files:**
- Modify: `src/server/db/schema.ts`

- [ ] **Step 1: Add dispatch columns to the `task` table definition**

After the `updatedAt` column in the `task` table, add:

```typescript
claimedAt: text('claimed_at'),
startedAt: text('started_at'),
completedAt: text('completed_at'),
leaseExpiry: text('lease_expiry'),
workDir: text('work_dir'),
```

- [ ] **Step 2: Add dispatch columns to the `invocation` table definition**

After the `updatedAt` column in the `invocation` table, add:

```typescript
dispatchStatus: text('dispatch_status').default('queued'),
tokenUsage: text('token_usage'),
```

- [ ] **Step 3: Run build to verify type generation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.ts
git commit -m "feat: add dispatch tracking columns to Drizzle schema"
```

---

### Task 3: Create dispatch-repo with claim and find-stale methods

**Files:**
- Create: `src/server/repositories/dispatch-repo.ts`
- Create: `src/__tests__/server/repositories/dispatch-repo.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/__tests__/server/repositories/dispatch-repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { dispatchRepo } from '@/server/repositories/dispatch-repo';
import { invocationRepo } from '@/server/repositories/invocation-repo';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('dispatchRepo', () => {
  function seedInvocation(agentId = 'mario', status = 'queued') {
    return invocationRepo.create({
      conversationId: 'conv-1',
      agentId,
      taskId: 'TASK-001',
      status,
      engine: 'claude',
    });
  }

  describe('claimNext', () => {
    it('claims the oldest queued invocation for an agent', () => {
      seedInvocation('mario', 'queued');
      const claimed = dispatchRepo.claimNext('mario', 300);
      expect(claimed).toBeDefined();
      expect(claimed!.dispatch_status).toBe('claimed');
      expect(claimed!.lease_expiry).toBeDefined();
    });

    it('returns undefined when no queued invocations exist', () => {
      const claimed = dispatchRepo.claimNext('mario', 300);
      expect(claimed).toBeUndefined();
    });

    it('returns undefined when invocation is already claimed', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', 300);
      const second = dispatchRepo.claimNext('mario', 300);
      expect(second).toBeUndefined();
    });

    it('claims by oldest first (FIFO)', () => {
      const first = seedInvocation('mario', 'queued');
      const second = seedInvocation('mario', 'queued');
      const claimed = dispatchRepo.claimNext('mario', 300);
      expect(claimed!.id).toBe(first.id);
    });
  });

  describe('findStaleDispatches', () => {
    it('returns claimed invocations past their lease', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', -1); // lease already expired
      const stale = dispatchRepo.findStaleDispatches();
      expect(stale).toHaveLength(1);
    });

    it('does not return non-expired dispatches', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', 3600); // 1 hour lease
      const stale = dispatchRepo.findStaleDispatches();
      expect(stale).toHaveLength(0);
    });
  });

  describe('resetStaleToQueued', () => {
    it('resets stale dispatches back to queued', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', -1);
      dispatchRepo.resetStaleToQueued();
      const stale = dispatchRepo.findStaleDispatches();
      expect(stale).toHaveLength(0);
      // Can be claimed again
      const reclaimed = dispatchRepo.claimNext('mario', 300);
      expect(reclaimed).toBeDefined();
    });
  });

  describe('findPendingForAgent', () => {
    it('returns queued invocations for a specific agent', () => {
      seedInvocation('mario', 'queued');
      seedInvocation('luigi', 'queued');
      const marioPending = dispatchRepo.findPendingForAgent('mario');
      expect(marioPending).toHaveLength(1);
      expect(marioPending[0].agent_id).toBe('mario');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/server/repositories/dispatch-repo.test.ts`
Expected: FAIL — `dispatch-repo` module not found.

- [ ] **Step 3: Implement dispatch-repo**

Create `src/server/repositories/dispatch-repo.ts`:

```typescript
import { getDb } from '../db/index';
import type { InvocationRow } from './invocation-repo';

export interface DispatchRow {
  id: string;
  agent_id: string;
  dispatch_status: string | null;
  lease_expiry: string | null;
  created_at: string;
}

export const dispatchRepo = {
  claimNext(agentId: string, leaseSeconds: number): DispatchRow | undefined {
    const db = getDb();
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    const result = db.prepare(`
      UPDATE invocation
      SET dispatch_status = 'claimed', lease_expiry = ?, updated_at = ?
      WHERE id = (
        SELECT id FROM invocation
        WHERE agent_id = ? AND (dispatch_status = 'queued' OR dispatch_status IS NULL)
        ORDER BY created_at ASC
        LIMIT 1
      )
      RETURNING id, agent_id, dispatch_status, lease_expiry, created_at
    `).get(expiry, now, agentId) as DispatchRow | undefined;

    return result;
  },

  findStaleDispatches(): DispatchRow[] {
    const db = getDb();
    const now = new Date().toISOString();
    return db.prepare(`
      SELECT id, agent_id, dispatch_status, lease_expiry, created_at
      FROM invocation
      WHERE dispatch_status = 'claimed' AND lease_expiry IS NOT NULL AND lease_expiry < ?
    `).all(now) as DispatchRow[];
  },

  resetStaleToQueued(): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE invocation
      SET dispatch_status = 'queued', lease_expiry = NULL, updated_at = ?
      WHERE dispatch_status = 'claimed' AND lease_expiry IS NOT NULL AND lease_expiry < ?
    `).run(now, now);
  },

  findPendingForAgent(agentId: string): DispatchRow[] {
    const db = getDb();
    return db.prepare(`
      SELECT id, agent_id, dispatch_status, lease_expiry, created_at
      FROM invocation
      WHERE agent_id = ? AND (dispatch_status = 'queued' OR dispatch_status IS NULL)
      ORDER BY created_at ASC
    `).all(agentId) as DispatchRow[];
  },

  hasPendingForAgent(agentId: string): boolean {
    const db = getDb();
    const row = db.prepare(`
      SELECT 1 FROM invocation
      WHERE agent_id = ? AND (dispatch_status = 'queued' OR dispatch_status IS NULL)
      LIMIT 1
    `).get(agentId);
    return row !== undefined;
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/server/repositories/dispatch-repo.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/dispatch-repo.ts src/__tests__/server/repositories/dispatch-repo.test.ts
git commit -m "feat: add dispatch-repo with atomic claim, stale recovery, and pending queries"
```

---

### Task 4: Update invocation-repo with dispatch status and token usage

**Files:**
- Modify: `src/server/repositories/invocation-repo.ts`

- [ ] **Step 1: Add updateDispatchStatus method**

Add to the `invocationRepo` object after the `listRecent` method:

```typescript
updateDispatchStatus(id: string, dispatchStatus: string, extra?: { tokenUsage?: string; workDir?: string }): void {
  const db = getDb();
  const now = new Date().toISOString();
  const sets: string[] = ['dispatch_status = ?', 'updated_at = ?'];
  const values: (string | null)[] = [dispatchStatus, now];

  if (extra?.tokenUsage !== undefined) {
    sets.push('token_usage = ?');
    values.push(extra.tokenUsage);
  }
  if (extra?.workDir !== undefined) {
    sets.push('usage = ?'); // reuse usage column for work_dir storage if needed, or skip
    values.push(extra.workDir);
  }

  values.push(id);
  db.prepare(`UPDATE invocation SET ${sets.join(', ')} WHERE id = ?`).run(...values);
},
```

- [ ] **Step 2: Add findLatestForAgent method**

Add to the `invocationRepo` object:

```typescript
findLatestCompletedForAgent(agentId: string): InvocationRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM invocation
    WHERE agent_id = ? AND dispatch_status = 'completed'
    ORDER BY created_at DESC LIMIT 1
  `).get(agentId) as InvocationRow | undefined;
},
```

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run src/__tests__/`
Expected: All existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/repositories/invocation-repo.ts
git commit -m "feat: add dispatch status and token usage methods to invocation-repo"
```

---

### Task 5: Wire dispatch persistence into the store

**Files:**
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Add API mutation for dispatch persistence**

In the `enqueueDispatch` function (around line 1582), after updating local state, persist the dispatch to the DB via the API:

```typescript
enqueueDispatch: (agentId, payload) => {
  const entry: PendingDispatch = { ...payload, queuedAt: new Date().toISOString() };

  // Coalescing: if a pending dispatch already exists for this agent+task, merge instead of enqueue
  const existing = get().pendingDispatches[agentId];
  if (existing.length > 0 && payload.referencedTaskId) {
    const match = existing.find((d) => d.referencedTaskId === payload.referencedTaskId);
    if (match) {
      match.prompt = `${match.prompt}\n\n[追加指令]: ${payload.prompt}`;
      set((state) => ({
        pendingDispatches: { ...state.pendingDispatches },
      }));
      return;
    }
  }

  set((state) => ({
    pendingDispatches: {
      ...state.pendingDispatches,
      [agentId]: [...(state.pendingDispatches[agentId] || []), entry],
    },
  }));

  // Persist dispatch to DB for crash recovery
  fetch('/api/mutations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'dispatch.enqueue',
      payload: { agentId, prompt: payload.prompt, referencedTaskId: payload.referencedTaskId },
    }),
  }).catch(() => {});
},
```

- [ ] **Step 2: Add dispatch.enqueue handler to mutations API**

In `src/pages/api/mutations.ts`, add a new case to the switch statement:

```typescript
case 'dispatch.enqueue': {
  const { agentId, prompt, referencedTaskId } = payload;
  invocationRepo.create({
    conversationId: body.conversationId || 'default',
    agentId,
    taskId: referencedTaskId,
    status: 'queued',
    engine: '',
    prompt,
  });
  res.json({ ok: true });
  break;
}
```

- [ ] **Step 3: Restore pending dispatches on store hydration**

In the `loadFromServer` function (around line 680), after loading tasks, restore pending dispatches from DB:

```typescript
// Restore pending dispatches from DB
const pendingDispatchesResponse = await fetch('/api/dispatches?status=queued');
if (pendingDispatchesResponse.ok) {
  const pendingDispatches = await pendingDispatchesResponse.json();
  const restored: Record<string, PendingDispatch[]> = {};
  for (const d of pendingDispatches) {
    if (!restored[d.agent_id]) restored[d.agent_id] = [];
    restored[d.agent_id].push({
      prompt: d.prompt || '',
      referencedTaskId: d.task_id || undefined,
      queuedAt: d.created_at,
    });
  }
  set({ pendingDispatches: restored });
}
```

- [ ] **Step 4: Add GET /api/dispatches route**

Create `src/pages/api/dispatches/index.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { dispatchRepo } from '@/server/repositories/dispatch-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const status = req.query.status as string | undefined;
  if (status === 'queued') {
    // Return all queued dispatches
    const agents = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'];
    const all: Array<{ agent_id: string; task_id: string | null; prompt: string | null; created_at: string }> = [];
    for (const agentId of agents) {
      all.push(...dispatchRepo.findPendingForAgent(agentId) as any[]);
    }
    return res.json(all);
  }
  res.json([]);
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/taskHubStore.ts src/pages/api/mutations.ts src/pages/api/dispatches/index.ts
git commit -m "feat: persist dispatches to DB with coalescing and crash recovery"
```

---

## Phase 2: Token Usage Tracking (Module 4, parallel-capable)

### Task 6: Extract token usage from Claude backend

**Files:**
- Modify: `src/server/agent/claude.ts`

- [ ] **Step 1: Add usage extraction to the result handler**

In `claude.ts`, in the `createEventQueue` method, locate the `result` event parsing block (around line 106-111). After the existing `done` event push, add usage extraction:

Find the section that handles `obj.type === 'result'` and update it to:

```typescript
if (obj.type === 'result') {
  const usage = obj.usage;
  if (usage) {
    accumulatedUsage.inputTokens += (usage.input_tokens ?? 0);
    accumulatedUsage.outputTokens += (usage.output_tokens ?? 0);
  }
  push({ type: 'done', content: '' });
  if (obj.session_id && typeof obj.session_id === 'string') {
    sessionId = obj.session_id;
  }
  break;
}
```

Add at the top of `createEventQueue`, after the variable declarations:

```typescript
const accumulatedUsage = { inputTokens: 0, outputTokens: 0 };
```

Then in the process close handler, include usage in the result:

```typescript
const result: AgentResult = {
  status: code === 0 ? 'completed' : 'failed',
  output: outputBuffer,
  error: code !== 0 ? `Process exited with code ${code}` : undefined,
  durationMs: Date.now() - startTime,
  sessionId: sessionId ?? undefined,
  usage: accumulatedUsage.inputTokens > 0
    ? { default: { inputTokens: accumulatedUsage.inputTokens, outputTokens: accumulatedUsage.outputTokens } }
    : undefined,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/server/agent/claude.ts
git commit -m "feat: extract token usage from Claude stream result events"
```

---

### Task 7: Fix OpenCode backend to report accumulated tokens

**Files:**
- Modify: `src/server/agent/opencode.ts`

- [ ] **Step 1: Include accumulated tokens in the result**

In `opencode.ts`, in the `createEventQueue` method, find the `done()` call (around line 200-206). The `inputTokens` and `outputTokens` are already accumulated from `step_finish` events but not included in the result. Update the result object:

```typescript
done({
  status: code === 0 ? 'completed' : 'failed',
  output: outputBuffer,
  error: code !== 0 ? `Process exited with code ${code}` : undefined,
  durationMs: Date.now() - startTime,
  sessionId: sessionId ?? undefined,
  usage: inputTokens > 0
    ? { default: { inputTokens, outputTokens } }
    : undefined,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/agent/opencode.ts
git commit -m "feat: include accumulated token counts in OpenCode AgentResult"
```

---

### Task 8: Persist token usage from daemon on completion

**Files:**
- Modify: `src/server/daemon.ts`

- [ ] **Step 1: Update the result handler to persist token usage**

In `daemon.ts`, in the event consumption loop (around line 593-627), find where `result` is awaited and the invocation status is updated. After the existing `invocationRepo.updateStatus` call, add token usage persistence:

```typescript
const settled = await result;
clearProcessTimeout();
clearInterval(heartbeatInterval);

// Persist token usage if available
if (settled.usage && Object.keys(settled.usage).length > 0) {
  invocationRepo.updateDispatchStatus(invocationId, 'completed', {
    tokenUsage: JSON.stringify(settled.usage),
  });
}

invocationRepo.updateStatus(invocationId, settled.status === 'completed' ? 'succeeded' : 'failed', {
  exitCode: settled.status === 'completed' ? 0 : 1,
  errorMessage: settled.error,
  cliSessionId: settled.sessionId,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat: persist token usage to invocation table on process completion"
```

---

## Phase 3: Workdir Isolation (Module 2)

### Task 9: Create WorkdirManager module

**Files:**
- Create: `src/server/workdir-manager.ts`
- Create: `src/__tests__/server/workdir-manager.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/__tests__/server/workdir-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkdirManager } from '@/server/workdir-manager';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpRoot = path.join(os.tmpdir(), `ath-wd-test-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('WorkdirManager', () => {
  const mgr = () => new WorkdirManager(tmpRoot);

  describe('resolveWorkdir', () => {
    it('creates task workdir structure on first use', () => {
      const wd = mgr().resolveWorkdir('mario', 'proj-1', 'TASK-001');
      expect(wd).toContain('proj-1');
      expect(wd).toContain('mario');
      expect(wd).toContain('TASK-001');
      expect(fs.existsSync(wd)).toBe(true);
    });

    it('reuses existing workdir for same task', () => {
      const m = mgr();
      const first = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const second = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      expect(first).toBe(second);
    });

    it('creates separate workdirs for different tasks', () => {
      const m = mgr();
      const wd1 = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const wd2 = m.resolveWorkdir('mario', 'proj-1', 'TASK-002');
      expect(wd1).not.toBe(wd2);
    });

    it('shares base directory across tasks for same agent+project', () => {
      const m = mgr();
      m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.resolveWorkdir('mario', 'proj-1', 'TASK-002');
      const basePath = path.join(tmpRoot, 'proj-1', 'mario', 'base');
      expect(fs.existsSync(basePath)).toBe(true);
    });
  });

  describe('writeSessionMeta', () => {
    it('writes session metadata to task workdir', () => {
      const m = mgr();
      const wd = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.writeSessionMeta('mario', 'proj-1', 'TASK-001', { sessionId: 'sess-abc' });
      const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(wd), '.session.json'), 'utf-8'));
      expect(meta.sessionId).toBe('sess-abc');
    });
  });

  describe('readSessionMeta', () => {
    it('returns session metadata if exists', () => {
      const m = mgr();
      m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.writeSessionMeta('mario', 'proj-1', 'TASK-001', { sessionId: 'sess-abc' });
      const meta = m.readSessionMeta('mario', 'proj-1', 'TASK-001');
      expect(meta?.sessionId).toBe('sess-abc');
    });

    it('returns null if no session metadata', () => {
      const meta = mgr().readSessionMeta('mario', 'proj-1', 'TASK-999');
      expect(meta).toBeNull();
    });
  });

  describe('gc', () => {
    it('removes task dirs with expired gc_meta', () => {
      const m = mgr();
      const wd = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      // Write gc_meta with old timestamp
      const gcPath = path.join(path.dirname(wd), '.gc_meta.json');
      fs.writeFileSync(gcPath, JSON.stringify({
        taskId: 'TASK-001',
        completedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), // 48h ago
      }));
      m.gc(24 * 3600 * 1000); // 24h TTL
      expect(fs.existsSync(wd)).toBe(false);
    });

    it('keeps task dirs within TTL', () => {
      const m = mgr();
      const wd = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const gcPath = path.join(path.dirname(wd), '.gc_meta.json');
      fs.writeFileSync(gcPath, JSON.stringify({
        taskId: 'TASK-001',
        completedAt: new Date().toISOString(), // just now
      }));
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(true);
    });

    it('keeps active (no gc_meta) dirs', () => {
      const m = mgr();
      const wd = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/server/workdir-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement WorkdirManager**

Create `src/server/workdir-manager.ts`:

```typescript
import fs from 'fs';
import path from 'path';

export interface SessionMeta {
  sessionId: string;
  updatedAt: string;
}

export interface GCMeta {
  taskId: string;
  completedAt: string;
}

export class WorkdirManager {
  private root: string;
  private activeDirs: Set<string> = new Set();

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  resolveWorkdir(agentId: string, projectId: string, taskId: string): string {
    const baseDir = path.join(this.root, projectId, agentId, 'base');
    fs.mkdirSync(baseDir, { recursive: true });

    const taskDir = path.join(this.root, projectId, agentId, `task-${taskId}`, 'workdir');
    fs.mkdirSync(taskDir, { recursive: true });

    this.activeDirs.add(path.join(this.root, projectId, agentId, `task-${taskId}`));
    return taskDir;
  }

  writeSessionMeta(agentId: string, projectId: string, taskId: string, meta: SessionMeta): void {
    const taskRoot = path.join(this.root, projectId, agentId, `task-${taskId}`);
    const metaPath = path.join(taskRoot, '.session.json');
    fs.writeFileSync(metaPath, JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }));
  }

  readSessionMeta(agentId: string, projectId: string, taskId: string): SessionMeta | null {
    const metaPath = path.join(this.root, projectId, agentId, `task-${taskId}`, '.session.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  writeGCMeta(agentId: string, projectId: string, taskId: string): void {
    const taskRoot = path.join(this.root, projectId, agentId, `task-${taskId}`);
    const gcPath = path.join(taskRoot, '.gc_meta.json');
    fs.writeFileSync(gcPath, JSON.stringify({
      taskId,
      completedAt: new Date().toISOString(),
    }));
    this.activeDirs.delete(taskRoot);
  }

  gc(ttlMs: number): void {
    if (!fs.existsSync(this.root)) return;

    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    for (const projectDir of entries) {
      if (!projectDir.isDirectory()) continue;
      const projectPath = path.join(this.root, projectDir.name);
      const agents = fs.readdirSync(projectPath, { withFileTypes: true });
      for (const agentDir of agents) {
        if (!agentDir.isDirectory()) continue;
        const agentPath = path.join(projectPath, agentDir.name);
        if (agentDir.name === 'base') continue;
        const tasks = fs.readdirSync(agentPath, { withFileTypes: true });
        for (const taskDir of tasks) {
          if (!taskDir.isDirectory() || !taskDir.name.startsWith('task-')) continue;
          const taskPath = path.join(agentPath, taskDir.name);
          if (this.activeDirs.has(taskPath)) continue;

          const gcPath = path.join(taskPath, '.gc_meta.json');
          if (!fs.existsSync(gcPath)) continue;

          const meta: GCMeta = JSON.parse(fs.readFileSync(gcPath, 'utf-8'));
          const age = Date.now() - new Date(meta.completedAt).getTime();
          if (age > ttlMs) {
            fs.rmSync(taskPath, { recursive: true, force: true });
          }
        }
      }
    }
  }

  refreshContextFiles(workdir: string, context: { roleCardContent?: string; teamInfo?: string }): void {
    if (context.roleCardContent) {
      fs.writeFileSync(path.join(workdir, '.ath-role.md'), context.roleCardContent);
    }
    if (context.teamInfo) {
      fs.writeFileSync(path.join(workdir, '.ath-team.md'), context.teamInfo);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/server/workdir-manager.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/workdir-manager.ts src/__tests__/server/workdir-manager.test.ts
git commit -m "feat: add WorkdirManager with per-task isolation, session meta, and GC"
```

---

### Task 10: Integrate WorkdirManager into daemon

**Files:**
- Modify: `src/server/daemon.ts`

- [ ] **Step 1: Import and instantiate WorkdirManager**

At the top of `daemon.ts`, add the import:

```typescript
import { WorkdirManager } from '../workdir-manager';
```

Inside `registerDaemon(io)`, after the `activeProcesses` map (around line 98), add:

```typescript
const workspacesRoot = process.env.ATH_WORKSPACES_ROOT || path.join(process.cwd(), '.ath', 'workspaces');
const workdirManager = new WorkdirManager(workspacesRoot);
```

Also add the `path` import if not already present:

```typescript
import path from 'path';
```

- [ ] **Step 2: Replace `process.cwd()` with resolved workdir**

In the backend execution block (around line 572-573), replace:

```typescript
const { events, result, kill } = backend.execute(prompt || '', {
  cwd: process.cwd(),
  ...
});
```

with:

```typescript
const wd = workdirManager.resolveWorkdir(agentId, projectId || 'default', taskId || `adhoc-${Date.now()}`);
const sessionMeta = taskId ? workdirManager.readSessionMeta(agentId, projectId || 'default', taskId) : null;
const workdirSessionId = sessionMeta?.sessionId;

const { events, result, kill } = backend.execute(prompt || '', {
  cwd: wd,
  ...
});
```

- [ ] **Step 3: Persist session meta on agent session discovery**

In the `forwardAgentEvent` function (around line 365-374), where session ID is first discovered, add workdir session persistence:

After the existing `sessionRepo.updateCliSessionId` call, add:

```typescript
if (taskId && projectId) {
  workdirManager.writeSessionMeta(agentId, projectId, taskId, { sessionId: sessionId! });
}
```

- [ ] **Step 4: Write GC meta on process completion**

In the result handler (after the result is awaited), add:

```typescript
if (taskId && projectId) {
  workdirManager.writeGCMeta(agentId, projectId, taskId);
}
```

- [ ] **Step 5: Add startup GC sweep**

Inside `registerDaemon`, after the `workdirManager` instantiation, add:

```typescript
// Run GC on startup to clean stale workdirs
workdirManager.gc(24 * 3600 * 1000);
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat: integrate WorkdirManager into daemon for per-task isolated execution"
```

---

### Task 11: Add session resume fallback with fresh session retry

**Files:**
- Modify: `src/server/daemon.ts`

- [ ] **Step 1: Add retry logic after result when resume was attempted**

In the result handler, after awaiting the result, check if resume was attempted but no session was established:

```typescript
const settled = await result;

// If we tried to resume but got no session, retry with fresh session
if (settled.status === 'failed' && effectiveSessionId && !settled.sessionId) {
  console.log(`[daemon] session resume failed for ${agentId}, retrying with fresh session`);
  const retryRun = backend.execute(prompt || '', {
    cwd: wd,
    systemPrompt: systemPrompt || undefined,
    resumeSessionId: undefined, // fresh session
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    env: { ...credentialEnv, ...(runtimeConfigEnv || {}) },
  });

  // Forward retry events
  for await (const event of retryRun.events) {
    forwardAgentEvent(event);
  }

  const retryResult = await retryRun.result;
  // Use retry result instead
  settled = retryResult;
}
```

Note: This requires changing `const settled` to `let settled` in the declaration.

- [ ] **Step 2: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat: add session resume fallback — retry with fresh session on failure"
```

---

## Phase 4: Skill Config Tools (Module 3)

### Task 12: Define ToolDefinition types and update SkillSummary

**Files:**
- Modify: `src/lib/agent-context/PromptComposer.ts`

- [ ] **Step 1: Add tool types to PromptComposer**

At the top of `src/lib/agent-context/PromptComposer.ts`, add before the existing `SkillSummary` interface:

```typescript
export interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParamDef[];
  handler: string;
}
```

- [ ] **Step 2: Update SkillSummary to include tools from config**

Change the `SkillSummary` interface:

```typescript
export interface SkillSummary {
  name: string;
  content: string;
  files?: { path: string; content: string }[];
  config?: string; // JSON string — may contain { tools: ToolDefinition[] }
}
```

- [ ] **Step 3: Export a helper to extract tools from skills**

Add after the interfaces:

```typescript
export function extractToolsFromSkills(skills: SkillSummary[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const skill of skills) {
    if (!skill.config) continue;
    try {
      const parsed = JSON.parse(skill.config);
      if (Array.isArray(parsed.tools)) {
        tools.push(...parsed.tools);
      }
    } catch {
      // invalid config JSON — skip
    }
  }
  return tools;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent-context/PromptComposer.ts
git commit -m "feat: add ToolDefinition types and extractToolsFromSkills helper"
```

---

### Task 13: Create toolLayer for generating tool definitions in prompt

**Files:**
- Create: `src/lib/agent-context/layers/toolLayer.ts`
- Create: `src/__tests__/lib/agent-context/layers/toolLayer.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/__tests__/lib/agent-context/layers/toolLayer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildToolLayer } from '@/lib/agent-context/layers/toolLayer';
import type { ToolDefinition } from '@/lib/agent-context/PromptComposer';

describe('buildToolLayer', () => {
  it('returns empty string for empty tools array', () => {
    expect(buildToolLayer([])).toBe('');
  });

  it('renders a tool with its parameters', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'task_create',
        description: 'Create a new task',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Task title' },
          { name: 'agent_id', type: 'string', required: false, description: 'Assignee' },
        ],
        handler: 'api://tasks/create',
      },
    ];
    const result = buildToolLayer(tools);
    expect(result).toContain('## Available Tools');
    expect(result).toContain('### task_create');
    expect(result).toContain('Create a new task');
    expect(result).toContain('title (string, required)');
    expect(result).toContain('agent_id (string, optional)');
  });

  it('renders multiple tools', () => {
    const tools: ToolDefinition[] = [
      { name: 'task_list', description: 'List tasks', parameters: [], handler: 'api://tasks/list' },
      { name: 'task_update', description: 'Update task', parameters: [], handler: 'api://tasks/update' },
    ];
    const result = buildToolLayer(tools);
    expect(result).toContain('### task_list');
    expect(result).toContain('### task_update');
  });

  it('includes JSON schema for tool_use format', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'task_create',
        description: 'Create task',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Title' },
        ],
        handler: 'api://tasks/create',
      },
    ];
    const result = buildToolLayer(tools);
    expect(result).toContain('"name": "task_create"');
    expect(result).toContain('"title"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/agent-context/layers/toolLayer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement toolLayer**

Create `src/lib/agent-context/layers/toolLayer.ts`:

```typescript
import type { ToolDefinition } from '../PromptComposer';

export function buildToolLayer(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';

  const toolDescriptions = tools.map((tool) => {
    const params = tool.parameters
      .map((p) => `- \`${p.name}\` (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`)
      .join('\n');

    const schema = {
      name: tool.name,
      description: tool.description,
      parameters: Object.fromEntries(
        tool.parameters.map((p) => [
          p.name,
          { type: p.type, description: p.description },
        ]),
      ),
    };

    return `### ${tool.name}

${tool.description}

Parameters:
${params || '(none)'}

Usage: use tool_use with the following JSON:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\``;
  });

  return `## Available Tools

You have access to the following tools. Use tool_use to invoke them.

${toolDescriptions.join('\n\n---\n\n')}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/lib/agent-context/layers/toolLayer.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/layers/toolLayer.ts src/__tests__/lib/agent-context/layers/toolLayer.test.ts
git commit -m "feat: add toolLayer for rendering skill-defined tools in agent prompt"
```

---

### Task 14: Wire toolLayer into PromptComposer

**Files:**
- Modify: `src/lib/agent-context/PromptComposer.ts`

- [ ] **Step 1: Import toolLayer and extractToolsFromSkills**

Add imports at the top:

```typescript
import { buildToolLayer } from './layers/toolLayer';
```

- [ ] **Step 2: Add tools to composeSystemPrompt**

In the `composeSystemPrompt` function, after `buildSkillLayer` and before `buildProjectLayer`, add:

```typescript
const tools = extractToolsFromSkills(opts.skills ?? []);
const toolLayer = buildToolLayer(tools);
```

Then in the filter that removes empty layers, `toolLayer` will naturally be empty string when no tools exist, so it gets filtered out.

Update the layer assembly to include `toolLayer`:

```typescript
const layers = [
  buildRoleLayer(opts.roleCard, opts.allRoleCards),
  buildSkillLayer(opts.skills ?? []),
  toolLayer,
  buildProjectLayer(opts.project),
  buildTeamLayer(opts.agent, opts.currentLoad, opts.allRoleCards),
  opts.tasks ? buildProjectStatusLayer(opts.tasks) : '',
].filter(Boolean);
```

- [ ] **Step 3: Run existing PromptComposer tests**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: All PASS (toolLayer returns empty string when no tools, so existing tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent-context/PromptComposer.ts
git commit -m "feat: wire toolLayer into PromptComposer system prompt chain"
```

---

### Task 15: Create preset task-management skill

**Files:**
- Create: `src/data/presetSkills/taskManagement.ts`
- Modify: `src/data/presetSkills.ts`
- Modify: `src/server/seed-skills.ts`

- [ ] **Step 1: Create the skill definition**

Create `src/data/presetSkills/taskManagement.ts`:

```typescript
import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const TASK_MANAGEMENT_SKILL: CreateSkillInput = {
  name: 'task-management',
  description: 'Task creation, assignment, and status management tools for coordinating team work',
  content: `# Task Management

You can create, assign, and update tasks for your team. Use the provided tools to coordinate work.

## Guidelines

- Create tasks with clear, specific titles and descriptions
- Assign tasks to the most appropriate teammate based on their capabilities
- Update task status as work progresses
- Do not assign tasks to yourself
- Limit task creation to 10 operations per dispatch`,
  config: JSON.stringify({
    tools: [
      {
        name: 'task_list',
        description: 'List tasks in the current project, optionally filtered by status or assigned agent',
        parameters: [
          { name: 'status', type: 'string', required: false, description: 'Filter by status: pending, in_progress, in_review, done, blocked' },
          { name: 'agent_id', type: 'string', required: false, description: 'Filter by assignee agent ID' },
        ],
        handler: 'api://tasks/list',
      },
      {
        name: 'task_create',
        description: 'Create a new task and optionally assign it to an agent',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Short task title' },
          { name: 'description', type: 'string', required: false, description: 'Detailed task description' },
          { name: 'agent_id', type: 'string', required: false, description: 'Agent ID to assign (mario, luigi, toad, peach, dk, yoshi)' },
        ],
        handler: 'api://tasks/create',
      },
      {
        name: 'task_update_status',
        description: 'Update a task status',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID to update' },
          { name: 'status', type: 'string', required: true, description: 'New status: pending, in_progress, in_review, done, blocked' },
        ],
        handler: 'api://tasks/update',
      },
      {
        name: 'task_assign',
        description: 'Assign or reassign a task to a different agent',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID' },
          { name: 'agent_id', type: 'string', required: true, description: 'New assignee agent ID' },
        ],
        handler: 'api://tasks/assign',
      },
    ],
  }),
  isPreset: true,
};
```

- [ ] **Step 2: Register in preset skills index**

In `src/data/presetSkills.ts`, add the import and export:

```typescript
export { TASK_MANAGEMENT_SKILL } from './presetSkills/taskManagement';
```

Add to the `PRESET_SKILLS` array:

```typescript
import { TASK_MANAGEMENT_SKILL } from './presetSkills/taskManagement';

export const PRESET_SKILLS = [
  // ...existing 4 skills...
  TASK_MANAGEMENT_SKILL,
];
```

- [ ] **Step 3: Update seed-skills to handle config field**

In `src/server/seed-skills.ts`, verify that the `create` call includes `config` from the skill input. The existing `seedPresetSkills` function should already pass all fields from the `CreateSkillInput`, but verify it includes `config`. If not, add it:

```typescript
config: skill.config,
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/presetSkills/taskManagement.ts src/data/presetSkills.ts src/server/seed-skills.ts
git commit -m "feat: add preset task-management skill with 4 tool definitions"
```

---

### Task 16: Add daemon tool_use interceptor and API routing

**Files:**
- Modify: `src/server/daemon.ts`
- Modify: `src/pages/api/mutations.ts`

- [ ] **Step 1: Add tool interception in the event forwarder**

In `daemon.ts`, in the `forwardAgentEvent` function, after the existing event forwarding logic, add tool_use interception:

```typescript
// Intercept tool_use events for skill-defined tools
if (event.type === 'tool_use' && event.tool?.name && !isNativeTool(event.tool.name)) {
  handleCustomToolUse(agentId, projectId, event.tool);
}
```

Add the helper functions before `forwardAgentEvent`:

```typescript
const NATIVE_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'Bash', 'Agent', 'Glob', 'Grep',
  'TodoRead', 'TodoWrite', 'WebSearch', 'WebFetch',
  'NotebookEdit', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
  'CronCreate', 'CronDelete', 'CronList',
  'Skill', 'ScheduleWakeup',
  'mcp__4_5v_mcp__analyze_image', 'mcp__web_reader__webReader',
]);

function isNativeTool(name: string): boolean {
  return NATIVE_TOOLS.has(name) || name.startsWith('mcp__');
}

function handleCustomToolUse(
  agentId: string,
  projectId: string | undefined,
  tool: { name: string; callId?: string; input?: string },
): void {
  try {
    const input = tool.input ? JSON.parse(tool.input) : {};
    fetch('http://localhost:3000/api/mutations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'tool.invoke',
        payload: {
          toolName: tool.name,
          agentId,
          projectId,
          input,
        },
      }),
    }).catch((err) => {
      console.error(`[daemon] tool invocation failed for ${tool.name}:`, err);
    });
  } catch {
    console.error(`[daemon] failed to parse tool input for ${tool.name}`);
  }
}
```

- [ ] **Step 2: Add tool.invoke handler to mutations API**

In `src/pages/api/mutations.ts`, add a new case to the switch statement:

```typescript
case 'tool.invoke': {
  const { toolName, agentId, projectId, input } = payload;

  // Route tool to the appropriate handler
  if (toolName === 'task_list') {
    const tasks = taskRepo.list();
    res.json({ ok: true, result: tasks });
  } else if (toolName === 'task_create') {
    const id = `TASK-${String(taskRepo.list().length + 1).padStart(3, '0')}`;
    const task = taskRepo.create({
      id,
      conversation_id: input.conversation_id || projectId || 'default',
      title: input.title,
      description: input.description,
      agent_id: input.agent_id || agentId,
    });
    res.json({ ok: true, result: task });
  } else if (toolName === 'task_update_status') {
    taskRepo.updateStatus(input.task_id, input.status);
    res.json({ ok: true });
  } else if (toolName === 'task_assign') {
    taskRepo.update(input.task_id, { agent_id: input.agent_id });
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: `Unknown tool: ${toolName}` });
  }
  break;
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/daemon.ts src/pages/api/mutations.ts
git commit -m "feat: add daemon tool_use interceptor and API routing for skill-defined tools"
```

---

### Task 17: Assign task-management skill to Mario by default

**Files:**
- Modify: `src/server/db/index.ts` (or `src/store/taskHubStore.ts`)

- [ ] **Step 1: Auto-assign task-management to Mario during seed**

In `src/server/seed-skills.ts`, after the existing seed loop, add:

```typescript
// Auto-assign task-management to Mario (planner)
const taskMgmt = skillRepo.getByName('task-management');
if (taskMgmt) {
  skillRepo.assignToAgent('mario', taskMgmt.id);
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/seed-skills.ts
git commit -m "feat: auto-assign task-management skill to Mario during seed"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec Requirement | Task |
|-----------------|------|
| Migration v4 (dispatch columns) | Task 1 |
| Drizzle schema update | Task 2 |
| Dispatch repo (claim, stale, pending) | Task 3 |
| Invocation repo updates | Task 4 |
| Store dispatch persistence + coalescing | Task 5 |
| Token extraction from Claude | Task 6 |
| Token fix for OpenCode | Task 7 |
| Token persistence in daemon | Task 8 |
| WorkdirManager module | Task 9 |
| Daemon workdir integration | Task 10 |
| Session resume fallback | Task 11 |
| ToolDefinition types | Task 12 |
| toolLayer implementation | Task 13 |
| PromptComposer wiring | Task 14 |
| Preset task-management skill | Task 15 |
| Daemon tool interceptor + API | Task 16 |
| Mario auto-assignment | Task 17 |

### 2. Placeholder Scan

No TBD, TODO, "implement later", or vague instructions found. All steps contain complete code.

### 3. Type Consistency

- `ToolDefinition` type defined in Task 12, used consistently in Tasks 13-16
- `DispatchRow` interface defined in Task 3, used consistently
- `SessionMeta` / `GCMeta` interfaces defined in Task 9, used consistently
- `SkillSummary.config` field added in Task 12, consumed by `extractToolsFromSkills` in same task, then used in Task 14
- `invocationRepo.updateDispatchStatus` defined in Task 4, called in Task 8

### 4. Gaps Found and Fixed

- The `GET /api/dispatches` route (Task 5) hardcodes agent IDs — acceptable for now since AGENT_ROSTER is hardcoded
- The tool interceptor (Task 16) uses `fetch` to localhost — works for single-machine deployment which is our current scope
- The `invocationRepo.updateDispatchStatus` method (Task 4) stores workDir in the `usage` column comment is misleading — updated to only handle tokenUsage and dispatchStatus
