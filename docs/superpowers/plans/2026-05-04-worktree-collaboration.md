# Worktree-Based Project Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Git Worktree-based project isolation so each project has its own workspace and agents collaborate within that workspace.

**Architecture:** Extend the existing `WorkdirManager` to support Git Worktrees. Each project gets a dedicated worktree directory under `.worktrees/`. The daemon routes agents to the correct worktree based on project context.

**Tech Stack:** TypeScript, Git Worktree, Node.js fs, Zustand store

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/server/worktree-manager.ts` | Git worktree CRUD operations (create, list, remove) |
| `src/server/worktree-manager.test.ts` | Tests for worktree manager |
| `src/app/api/worktrees/route.ts` | API endpoints for worktree operations |
| `src/components/project/WorktreeIndicator.tsx` | UI indicator showing current worktree |

### Modified Files

| File | Changes |
|------|---------|
| `src/server/workdir-manager.ts` | Integrate with worktree manager for project-level resolution |
| `src/server/daemon.ts` | Route agents to worktree directories |
| `src/store/taskHubStore.ts` | Add worktree state and actions |
| `src/components/project/ProjectSidebar.tsx` | Show worktree status for each project |
| `src/components/project/ProjectCreateDialog.tsx` | Add option to create worktree on project creation |

---

## Task 1: Create WorktreeManager Module

**Files:**
- Create: `src/server/worktree-manager.ts`
- Create: `src/server/worktree-manager.test.ts`

- [ ] **Step 1: Define WorktreeManager interface**

```typescript
// src/server/worktree-manager.ts
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export class WorktreeManager {
  private repoRoot: string;
  private worktreeBase: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.worktreeBase = path.join(repoRoot, '.worktrees');
    fs.mkdirSync(this.worktreeBase, { recursive: true });
  }
}
```

- [ ] **Step 2: Implement createWorktree method**

```typescript
// Add to WorktreeManager class

async createWorktree(projectSlug: string): Promise<WorktreeInfo> {
  const branchName = `feature/${projectSlug}`;
  const worktreePath = path.join(this.worktreeBase, branchName);

  // Create worktree with new branch
  await execAsync(
    `git worktree add -b ${branchName} ${worktreePath}`,
    { cwd: this.repoRoot }
  );

  return {
    path: worktreePath,
    branch: branchName,
    head: await this.getHead(worktreePath),
  };
}

private async getHead(worktreePath: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: worktreePath });
  return stdout.trim();
}
```

- [ ] **Step 3: Implement listWorktrees method**

```typescript
// Add to WorktreeManager class

async listWorktrees(): Promise<WorktreeInfo[]> {
  const { stdout } = await execAsync('git worktree list --porcelain', { cwd: this.repoRoot });
  
  const worktrees: WorktreeInfo[] = [];
  const lines = stdout.split('\n');
  
  let current: Partial<WorktreeInfo> = {};
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = { path: line.slice(9) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    }
  }
  
  if (current.path) {
    worktrees.push(current as WorktreeInfo);
  }
  
  return worktrees.filter(w => w.path.startsWith(this.worktreeBase));
}
```

- [ ] **Step 4: Implement removeWorktree method**

```typescript
// Add to WorktreeManager class

async removeWorktree(projectSlug: string): Promise<void> {
  const branchName = `feature/${projectSlug}`;
  const worktreePath = path.join(this.worktreeBase, branchName);

  // Remove worktree
  await execAsync(`git worktree remove ${worktreePath}`, { cwd: this.repoRoot });
  
  // Delete branch
  try {
    await execAsync(`git branch -d ${branchName}`, { cwd: this.repoRoot });
  } catch {
    // Branch might not be merged yet, that's okay
  }
}
```

- [ ] **Step 5: Implement exists method**

```typescript
// Add to WorktreeManager class

async exists(projectSlug: string): Promise<boolean> {
  const branchName = `feature/${projectSlug}`;
  const worktreePath = path.join(this.worktreeBase, branchName);
  return fs.existsSync(worktreePath);
}

getWorktreePath(projectSlug: string): string {
  return path.join(this.worktreeBase, `feature/${projectSlug}`);
}
```

- [ ] **Step 6: Write unit tests**

```typescript
// src/server/worktree-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeManager } from './worktree-manager';

const execAsync = promisify(exec);

describe('WorktreeManager', () => {
  const testRepo = '/tmp/test-worktree-repo';
  let manager: WorktreeManager;

  beforeEach(async () => {
    // Create a test git repo
    fs.mkdirSync(testRepo, { recursive: true });
    await execAsync('git init', { cwd: testRepo });
    await execAsync('git commit --allow-empty -m "init"', { cwd: testRepo });
    manager = new WorktreeManager(testRepo);
  });

  afterEach(() => {
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  it('should create a worktree', async () => {
    const info = await manager.createWorktree('test-feature');
    expect(info.branch).toBe('feature/test-feature');
    expect(fs.existsSync(info.path)).toBe(true);
  });

  it('should list worktrees', async () => {
    await manager.createWorktree('feature-1');
    await manager.createWorktree('feature-2');
    const worktrees = await manager.listWorktrees();
    expect(worktrees.length).toBe(2);
  });

  it('should remove a worktree', async () => {
    await manager.createWorktree('to-remove');
    await manager.removeWorktree('to-remove');
    expect(await manager.exists('to-remove')).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests to verify**

Run: `pnpm vitest run src/server/worktree-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/server/worktree-manager.ts src/server/worktree-manager.test.ts
git commit -m "feat: add WorktreeManager for git worktree CRUD operations"
```

---

## Task 2: Integrate WorktreeManager with WorkdirManager

**Files:**
- Modify: `src/server/workdir-manager.ts`

- [ ] **Step 1: Add WorktreeManager dependency**

```typescript
// src/server/workdir-manager.ts
import { WorktreeManager } from './worktree-manager';

export class WorkdirManager {
  private root: string;
  private worktreeManager: WorktreeManager;
  private activeDirs: Set<string> = new Set();

  constructor(root: string, repoRoot?: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.worktreeManager = new WorktreeManager(repoRoot || root);
  }
}
```

- [ ] **Step 2: Add worktree-aware resolution method**

```typescript
// Add to WorkdirManager class

async resolveProjectWorkdir(projectSlug: string): Promise<string> {
  const worktreePath = this.worktreeManager.getWorktreePath(projectSlug);
  
  if (!await this.worktreeManager.exists(projectSlug)) {
    await this.worktreeManager.createWorktree(projectSlug);
  }
  
  return worktreePath;
}

getWorktreeManager(): WorktreeManager {
  return this.worktreeManager;
}
```

- [ ] **Step 3: Update resolveWorkdir to support worktrees**

```typescript
// Modify existing resolveWorkdir method

async resolveWorkdir(
  agentId: string, 
  projectId: string, 
  taskId: string,
  options?: { useWorktree?: boolean; projectSlug?: string }
): Promise<string> {
  let baseDir: string;
  
  if (options?.useWorktree && options?.projectSlug) {
    // Use worktree for project-level isolation
    const worktreePath = await this.resolveProjectWorkdir(options.projectSlug);
    baseDir = path.join(worktreePath, '.agent-workspaces', agentId, 'base');
  } else {
    // Legacy behavior
    baseDir = path.join(this.root, projectId, agentId, 'base');
  }
  
  fs.mkdirSync(baseDir, { recursive: true });

  const taskDir = path.join(path.dirname(baseDir), `task-${taskId}`, 'workdir');
  fs.mkdirSync(taskDir, { recursive: true });

  this.activeDirs.add(path.dirname(taskDir));
  return taskDir;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/server/workdir-manager.ts
git commit -m "feat: integrate WorktreeManager with WorkdirManager"
```

---

## Task 3: Add API Endpoints for Worktree Operations

**Files:**
- Create: `src/app/api/worktrees/route.ts`

- [ ] **Step 1: Create GET endpoint to list worktrees**

```typescript
// src/app/api/worktrees/route.ts
import { NextResponse } from 'next/server';
import { WorktreeManager } from '@/server/worktree-manager';

const manager = new WorktreeManager(process.cwd());

export async function GET() {
  try {
    const worktrees = await manager.listWorktrees();
    return NextResponse.json({ worktrees });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list worktrees' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create POST endpoint to create worktree**

```typescript
// Add to src/app/api/worktrees/route.ts

export async function POST(request: Request) {
  try {
    const { projectSlug } = await request.json();
    
    if (!projectSlug) {
      return NextResponse.json(
        { error: 'projectSlug is required' },
        { status: 400 }
      );
    }

    if (await manager.exists(projectSlug)) {
      return NextResponse.json(
        { error: 'Worktree already exists' },
        { status: 409 }
      );
    }

    const worktree = await manager.createWorktree(projectSlug);
    return NextResponse.json({ worktree }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create worktree' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create DELETE endpoint to remove worktree**

```typescript
// Add to src/app/api/worktrees/route.ts

export async function DELETE(request: Request) {
  try {
    const { projectSlug } = await request.json();
    
    if (!projectSlug) {
      return NextResponse.json(
        { error: 'projectSlug is required' },
        { status: 400 }
      );
    }

    if (!await manager.exists(projectSlug)) {
      return NextResponse.json(
        { error: 'Worktree not found' },
        { status: 404 }
      );
    }

    await manager.removeWorktree(projectSlug);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to remove worktree' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/worktrees/route.ts
git commit -m "feat: add API endpoints for worktree operations"
```

---

## Task 4: Update Daemon to Route Agents to Worktrees

**Files:**
- Modify: `src/server/daemon.ts`

- [ ] **Step 1: Add WorktreeManager to daemon**

```typescript
// src/server/daemon.ts
import { WorktreeManager } from './worktree-manager';

export default function registerDaemon(io: IOServer) {
  const activeProcesses = new Map<string, { kill: () => void }>();
  const worktreeManager = new WorktreeManager(process.cwd());
  // ... existing code
}
```

- [ ] **Step 2: Modify terminal start handler to use worktree**

Find the terminal start handler and update it:

```typescript
// In the terminal:start handler, update the workdir resolution

socket.on('terminal:start', async (payload: TerminalStartPayload) => {
  const { projectId, taskId, agentId, projectSlug } = payload;
  
  let workdir: string;
  
  if (projectSlug) {
    // Use worktree-based workdir
    workdir = await workdirManager.resolveWorkdir(agentId, projectId || 'default', taskId || 'default', {
      useWorktree: true,
      projectSlug,
    });
  } else {
    // Legacy behavior
    workdir = workdirManager.resolveWorkdir(agentId, projectId || 'default', taskId || 'default');
  }
  
  // ... rest of existing code
});
```

- [ ] **Step 3: Add worktree listing event**

```typescript
// Add new event handler

socket.on('worktree:list', async (callback) => {
  try {
    const worktrees = await worktreeManager.listWorktrees();
    callback({ worktrees });
  } catch (error) {
    callback({ error: 'Failed to list worktrees' });
  }
});

socket.on('worktree:create', async ({ projectSlug }, callback) => {
  try {
    const worktree = await worktreeManager.createWorktree(projectSlug);
    callback({ worktree });
  } catch (error) {
    callback({ error: 'Failed to create worktree' });
  }
});

socket.on('worktree:remove', async ({ projectSlug }, callback) => {
  try {
    await worktreeManager.removeWorktree(projectSlug);
    callback({ success: true });
  } catch (error) {
    callback({ error: 'Failed to remove worktree' });
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat: add worktree routing to daemon"
```

---

## Task 5: Update Zustand Store with Worktree State

**Files:**
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Add worktree types and state**

```typescript
// Add to taskHubStore.ts

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

// Add to the store state interface
interface TaskHubState {
  // ... existing state
  worktrees: WorktreeInfo[];
  worktreesLoading: boolean;
}
```

- [ ] **Step 2: Add worktree actions**

```typescript
// Add to the store actions

interface TaskHubActions {
  // ... existing actions
  fetchWorktrees: () => Promise<void>;
  createWorktree: (projectSlug: string) => Promise<void>;
  removeWorktree: (projectSlug: string) => Promise<void>;
}
```

- [ ] **Step 3: Implement worktree actions**

```typescript
// Add to the store implementation

fetchWorktrees: async () => {
  set({ worktreesLoading: true });
  try {
    const response = await fetch('/api/worktrees');
    const data = await response.json();
    set({ worktrees: data.worktrees, worktreesLoading: false });
  } catch (error) {
    console.error('Failed to fetch worktrees:', error);
    set({ worktreesLoading: false });
  }
},

createWorktree: async (projectSlug: string) => {
  try {
    const response = await fetch('/api/worktrees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug }),
    });
    if (response.ok) {
      await get().fetchWorktrees();
    }
  } catch (error) {
    console.error('Failed to create worktree:', error);
  }
},

removeWorktree: async (projectSlug: string) => {
  try {
    const response = await fetch('/api/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug }),
    });
    if (response.ok) {
      await get().fetchWorktrees();
    }
  } catch (error) {
    console.error('Failed to remove worktree:', error);
  }
},
```

- [ ] **Step 4: Initialize worktrees in store**

```typescript
// Add to store initialization

// In the store creation, add initial state
worktrees: [],
worktreesLoading: false,

// Optionally fetch worktrees on store creation
// (or call fetchWorktrees() from a component on mount)
```

- [ ] **Step 5: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: add worktree state and actions to store"
```

---

## Task 6: Add WorktreeIndicator Component

**Files:**
- Create: `src/components/project/WorktreeIndicator.tsx`

- [ ] **Step 1: Create WorktreeIndicator component**

```typescript
// src/components/project/WorktreeIndicator.tsx
'use client';

import { GitBranch, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorktreeIndicatorProps {
  branch?: string;
  className?: string;
}

export function WorktreeIndicator({ branch, className }: WorktreeIndicatorProps) {
  if (!branch) return null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
        'bg-[hsl(var(--accent-subtle))] text-[hsl(var(--accent))]',
        'text-[10px] font-medium',
        className
      )}
      title={`Worktree: ${branch}`}
    >
      <GitBranch className="w-3 h-3" />
      <span className="truncate max-w-[120px]">{branch}</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project/WorktreeIndicator.tsx
git commit -m "feat: add WorktreeIndicator component"
```

---

## Task 7: Update ProjectSidebar to Show Worktree Status

**Files:**
- Modify: `src/components/project/ProjectSidebar.tsx`

- [ ] **Step 1: Import WorktreeIndicator**

```typescript
// Add import
import { WorktreeIndicator } from './WorktreeIndicator';
import { useTaskHubStore } from '@/store/taskHubStore';
```

- [ ] **Step 2: Add worktree state to component**

```typescript
// In ProjectSidebar component

const worktrees = useTaskHubStore((s) => s.worktrees);
const fetchWorktrees = useTaskHubStore((s) => s.fetchWorktrees);

useEffect(() => {
  fetchWorktrees();
}, [fetchWorktrees]);
```

- [ ] **Step 3: Show worktree indicator for each project**

```typescript
// In the project list rendering, add worktree indicator

{sorted.map((c) => {
  const counts = statsByConversation.taskCounts.get(c.id) ?? { total: 0, blocked: 0 };
  const openBlockerCount = statsByConversation.openBlockers.get(c.id) ?? 0;
  const worktree = worktrees.find(w => w.branch.includes(c.title.toLowerCase().replace(/\s+/g, '-')));
  
  return (
    <div key={c.id} className="group relative">
      {/* Existing project button */}
      <button ...>
        {/* Existing content */}
        {worktree && (
          <WorktreeIndicator branch={worktree.branch} className="mt-1" />
        )}
      </button>
    </div>
  );
})}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/project/ProjectSidebar.tsx
git commit -m "feat: show worktree status in ProjectSidebar"
```

---

## Task 8: Update ProjectCreateDialog with Worktree Option

**Files:**
- Modify: `src/components/project/ProjectCreateDialog.tsx`

- [ ] **Step 1: Add worktree toggle state**

```typescript
// In ProjectCreateDialog component

const [createWorktree, setCreateWorktree] = useState(false);
const worktreeManager = useTaskHubStore((s) => s.createWorktree);
```

- [ ] **Step 2: Add worktree checkbox to form**

```typescript
// Add after the goal textarea

<div className="flex items-center gap-2">
  <input
    type="checkbox"
    id="create-worktree"
    checked={createWorktree}
    onChange={(e) => setCreateWorktree(e.target.checked)}
    className="w-4 h-4 rounded border-[hsl(var(--border))]"
  />
  <label
    htmlFor="create-worktree"
    className="text-[12px] font-medium text-[hsl(var(--text-secondary))]"
  >
    创建独立工作空间 (Git Worktree)
  </label>
</div>
```

- [ ] **Step 3: Update handleCreate to create worktree**

```typescript
// Update handleCreate function

const handleCreate = async () => {
  const trimmedTitle = title.trim();
  const trimmedGoal = goal.trim();
  if (!trimmedTitle || !trimmedGoal) return;
  
  createConversation({ title: trimmedTitle, goal: trimmedGoal, projectPath: projectPath || undefined });
  
  if (createWorktree) {
    const projectSlug = trimmedTitle.toLowerCase().replace(/\s+/g, '-');
    await worktreeManager(projectSlug);
  }
  
  setTitle('');
  setGoal('');
  setProjectPath('');
  setCreateWorktree(false);
  onClose();
};
```

- [ ] **Step 4: Commit**

```bash
git add src/components/project/ProjectCreateDialog.tsx
git commit -m "feat: add worktree option to ProjectCreateDialog"
```

---

## Task 9: Integration Testing

**Files:**
- Create: `src/__tests__/worktree-integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/__tests__/worktree-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeManager } from '@/server/worktree-manager';
import { WorkdirManager } from '@/server/workdir-manager';

const execAsync = promisify(exec);

describe('Worktree Integration', () => {
  const testRepo = '/tmp/test-integration-repo';
  let worktreeManager: WorktreeManager;
  let workdirManager: WorkdirManager;

  beforeAll(async () => {
    fs.mkdirSync(testRepo, { recursive: true });
    await execAsync('git init', { cwd: testRepo });
    await execAsync('git commit --allow-empty -m "init"', { cwd: testRepo });
    worktreeManager = new WorktreeManager(testRepo);
    workdirManager = new WorkdirManager(path.join(testRepo, '.workspaces'), testRepo);
  });

  afterAll(() => {
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  it('should create worktree and resolve workdir within it', async () => {
    // Create worktree
    const worktree = await worktreeManager.createWorktree('test-project');
    expect(fs.existsSync(worktree.path)).toBe(true);

    // Resolve workdir within worktree
    const workdir = await workdirManager.resolveWorkdir('agent-1', 'project-1', 'task-1', {
      useWorktree: true,
      projectSlug: 'test-project',
    });

    expect(workdir).toContain(worktree.path);
    expect(fs.existsSync(workdir)).toBe(true);
  });

  it('should isolate different projects', async () => {
    await worktreeManager.createWorktree('project-a');
    await worktreeManager.createWorktree('project-b');

    const workdirA = await workdirManager.resolveWorkdir('agent-1', 'p1', 't1', {
      useWorktree: true,
      projectSlug: 'project-a',
    });

    const workdirB = await workdirManager.resolveWorkdir('agent-1', 'p1', 't1', {
      useWorktree: true,
      projectSlug: 'project-b',
    });

    expect(workdirA).not.toBe(workdirB);
    expect(workdirA).toContain('project-a');
    expect(workdirB).toContain('project-b');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `pnpm vitest run src/__tests__/worktree-integration.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/worktree-integration.test.ts
git commit -m "test: add worktree integration tests"
```

---

## Task 10: Update Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-05-04-worktree-collaboration-design.md`
- Modify: `SOP.md`

- [ ] **Step 1: Update design spec status**

```markdown
---
title: Worktree-Based Project Collaboration Model
created: 2026-05-04
status: implemented
---
```

- [ ] **Step 2: Add implementation notes to spec**

```markdown
## Implementation Notes

### Key Components

1. **WorktreeManager** (`src/server/worktree-manager.ts`)
   - Handles Git worktree CRUD operations
   - Manages `.worktrees/` directory

2. **WorkdirManager Integration** (`src/server/workdir-manager.ts`)
   - Extended to support worktree-based resolution
   - New `resolveProjectWorkdir()` method

3. **API Endpoints** (`src/app/api/worktrees/route.ts`)
   - GET: List all worktrees
   - POST: Create new worktree
   - DELETE: Remove worktree

4. **Daemon Integration** (`src/server/daemon.ts`)
   - Routes agents to worktree directories
   - New socket events for worktree operations

5. **Frontend Components**
   - `WorktreeIndicator`: Shows branch status
   - `ProjectSidebar`: Displays worktree info
   - `ProjectCreateDialog`: Option to create worktree
```

- [ ] **Step 3: Update SOP with worktree guidelines**

```markdown
## Worktree Guidelines

When working on features:

1. **Create a worktree** for each major feature
   ```bash
   # Via API
   curl -X POST /api/worktrees -d '{"projectSlug": "feature-name"}'
   
   # Via CLI
   git worktree add -b feature/feature-name .worktrees/feature/feature-name
   ```

2. **Work within the worktree** for all related changes

3. **Merge back to main** when feature is complete
   ```bash
   git checkout main
   git merge feature/feature-name
   git worktree remove .worktrees/feature/feature-name
   git branch -d feature/feature-name
   ```

4. **Clean up old worktrees** periodically
   ```bash
   git worktree list
   git worktree remove <path>
   ```
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-04-worktree-collaboration-design.md SOP.md
git commit -m "docs: update design spec and SOP with worktree implementation details"
```

---

## Final Verification

- [ ] **Run all tests**
  ```bash
  pnpm test
  ```

- [ ] **Check TypeScript compilation**
  ```bash
  pnpm build
  ```

- [ ] **Verify worktree creation works end-to-end**
  1. Start the dev server: `pnpm dev`
  2. Create a new project with "Create worktree" checked
  3. Verify `.worktrees/feature-xxx` directory exists
  4. Verify agents can work within the worktree

- [ ] **Update ROADMAP.md if needed**

---

## Notes

- **Dependency Sharing**: Each worktree has its own `node_modules`. For large projects, consider using `pnpm` workspaces to share dependencies.
- **Port Conflicts**: When running multiple projects simultaneously, assign different ports to each.
- **Cleanup**: Implement periodic cleanup of old worktrees (e.g., older than 30 days).
