# Project Sidebar Tree Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the left sidebar from a flat project card list into a two-layer workspace tree (root → projects), matching the UX spec in `docs/product/ux/2026-05-04-project-sidebar-ux-spec.md` and `docs/product/ux/2026-05-04-project-sidebar-item-detail-spec.md`.

**Architecture:** Add a `WorkspaceRootRow` as the top-level expandable container, and replace card-style project items with compact tree nodes (`ProjectTreeItem`). A pure function `getProjectStatus` computes health (empty/healthy/attention/blocked) from task stats. Status dots replace text-heavy status displays. Only the selected project shows full task/blocker counts.

**Tech Stack:** React 19, Zustand, Tailwind CSS 4, Lucide icons, Vitest for logic tests.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/components/project/getProjectStatus.ts` | Health classification from task stats |
| Create | `src/components/project/getProjectStatus.test.ts` | Tests for health logic |
| Create | `src/components/project/getWorkspaceName.ts` | Derive root display name from conversations |
| Create | `src/components/project/getWorkspaceName.test.ts` | Tests for workspace name logic |
| Create | `src/components/project/StatusDot.tsx` | Colored dot indicating project health |
| Create | `src/components/project/ProjectTreeItemActions.tsx` | Hover-only action buttons (delete) |
| Create | `src/components/project/WorkspaceRootRow.tsx` | Root node: expand/collapse, workspace name, + new |
| Create | `src/components/project/ProjectTreeItem.tsx` | Project tree node with status dot, title, goal |
| Modify | `src/components/project/ProjectSidebar.tsx` | Replace card list with tree layout |

---

### Task 1: Project Health Utility (TDD)

**Files:**
- Create: `src/components/project/getProjectStatus.ts`
- Create: `src/components/project/getProjectStatus.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/project/getProjectStatus.test.ts
import { describe, it, expect } from 'vitest';
import { getProjectStatus } from './getProjectStatus';
import type { ProjectStats } from './getProjectStatus';

describe('getProjectStatus', () => {
  const base: ProjectStats = { total: 0, blocked: 0, inProgress: 0, done: 0 };

  it('returns "empty" when there are no tasks', () => {
    expect(getProjectStatus(base)).toBe('empty');
  });

  it('returns "blocked" when any task is blocked', () => {
    expect(getProjectStatus({ total: 5, blocked: 1, inProgress: 2, done: 2 })).toBe('blocked');
  });

  it('returns "blocked" even if some tasks are in progress', () => {
    expect(getProjectStatus({ total: 3, blocked: 2, inProgress: 1, done: 0 })).toBe('blocked');
  });

  it('returns "attention" when tasks exist but none started', () => {
    expect(getProjectStatus({ total: 4, blocked: 0, inProgress: 0, done: 0 })).toBe('attention');
  });

  it('returns "healthy" when tasks are in progress', () => {
    expect(getProjectStatus({ total: 3, blocked: 0, inProgress: 2, done: 0 })).toBe('healthy');
  });

  it('returns "healthy" when tasks are done', () => {
    expect(getProjectStatus({ total: 5, blocked: 0, inProgress: 0, done: 5 })).toBe('healthy');
  });

  it('returns "healthy" when mix of in-progress and done', () => {
    expect(getProjectStatus({ total: 6, blocked: 0, inProgress: 2, done: 4 })).toBe('healthy');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/project/getProjectStatus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/components/project/getProjectStatus.ts
export type ProjectHealth = 'empty' | 'healthy' | 'attention' | 'blocked';

export interface ProjectStats {
  total: number;
  blocked: number;
  inProgress: number;
  done: number;
}

export function getProjectStatus(stats: ProjectStats): ProjectHealth {
  if (stats.total === 0) return 'empty';
  if (stats.blocked > 0) return 'blocked';
  if (stats.inProgress === 0 && stats.done === 0) return 'attention';
  return 'healthy';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/project/getProjectStatus.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/project/getProjectStatus.ts src/components/project/getProjectStatus.test.ts
git commit -m "feat(sidebar): add project health classification utility"
```

---

### Task 2: Workspace Name Utility (TDD)

**Files:**
- Create: `src/components/project/getWorkspaceName.ts`
- Create: `src/components/project/getWorkspaceName.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/project/getWorkspaceName.test.ts
import { describe, it, expect } from 'vitest';
import { getWorkspaceName, getWorkspaceFullPath } from './getWorkspaceName';

const makeConversation = (projectPath?: string) => ({
  id: 'test',
  title: 'Test',
  goal: 'Test goal',
  status: 'active' as const,
  priority: 'p1' as const,
  projectPath: projectPath ?? '',
  breakdownStatus: 'none' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

describe('getWorkspaceName', () => {
  it('returns fallback when no conversations', () => {
    expect(getWorkspaceName([])).toBe('工作区');
  });

  it('returns fallback when no conversation has projectPath', () => {
    expect(getWorkspaceName([makeConversation('')])).toBe('工作区');
  });

  it('returns last directory segment from projectPath', () => {
    expect(getWorkspaceName([makeConversation('/Users/dev/my-project')])).toBe('my-project');
  });

  it('handles trailing slash', () => {
    expect(getWorkspaceName([makeConversation('/Users/dev/my-project/')])).toBe('my-project');
  });

  it('uses first conversation with a path', () => {
    const convs = [makeConversation(''), makeConversation('/home/app/real-project')];
    expect(getWorkspaceName(convs)).toBe('real-project');
  });

  it('returns bare segment when path has no slashes', () => {
    expect(getWorkspaceName([makeConversation('my-app')])).toBe('my-app');
  });
});

describe('getWorkspaceFullPath', () => {
  it('returns null when no conversations', () => {
    expect(getWorkspaceFullPath([])).toBeNull();
  });

  it('returns the path from first conversation that has one', () => {
    expect(getWorkspaceFullPath([makeConversation('/Users/dev/project')])).toBe('/Users/dev/project');
  });

  it('returns null when no conversation has a path', () => {
    expect(getWorkspaceFullPath([makeConversation('')])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/project/getWorkspaceName.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/components/project/getWorkspaceName.ts
import type { Conversation } from '@/store/taskHubStore';

export function getWorkspaceName(conversations: Conversation[]): string {
  const path = conversations.find((c) => c.projectPath)?.projectPath;
  if (!path) return '工作区';
  const segments = path.replace(/\/$/, '').split('/');
  return segments[segments.length - 1] || '工作区';
}

export function getWorkspaceFullPath(conversations: Conversation[]): string | null {
  return conversations.find((c) => c.projectPath)?.projectPath ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/project/getWorkspaceName.test.ts`
Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/project/getWorkspaceName.ts src/components/project/getWorkspaceName.test.ts
git commit -m "feat(sidebar): add workspace name derivation utility"
```

---

### Task 3: StatusDot Component

**Files:**
- Create: `src/components/project/StatusDot.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/project/StatusDot.tsx
import { cn } from '@/lib/utils';
import type { ProjectHealth } from './getProjectStatus';

const healthColors: Record<ProjectHealth, string> = {
  empty: 'bg-[hsl(var(--text-tertiary)/0.4)]',
  healthy: 'bg-[hsl(var(--status-done))]',
  attention: 'bg-[hsl(var(--status-pending))]',
  blocked: 'bg-[hsl(var(--status-blocked))]',
};

export function StatusDot({ health }: { health: ProjectHealth }) {
  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', healthColors[health])}
      aria-hidden
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project/StatusDot.tsx
git commit -m "feat(sidebar): add StatusDot component"
```

---

### Task 4: ProjectTreeItemActions Component

**Files:**
- Create: `src/components/project/ProjectTreeItemActions.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/project/ProjectTreeItemActions.tsx
import { Trash2 } from 'lucide-react';

export function ProjectTreeItemActions({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="absolute top-1/2 -translate-y-1/2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-fast)]">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="p-1 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-blocked))] hover:bg-[hsl(var(--bg-card-hover))]"
        title="删除项目"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project/ProjectTreeItemActions.tsx
git commit -m "feat(sidebar): add ProjectTreeItemActions hover menu"
```

---

### Task 5: WorkspaceRootRow Component

**Files:**
- Create: `src/components/project/WorkspaceRootRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/project/WorkspaceRootRow.tsx
'use client';

import { ChevronRight, FolderOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/store/taskHubStore';
import { getWorkspaceName, getWorkspaceFullPath } from './getWorkspaceName';

export function WorkspaceRootRow({
  conversations,
  expanded,
  onToggle,
  onCreateProject,
}: {
  conversations: Conversation[];
  expanded: boolean;
  onToggle: () => void;
  onCreateProject: () => void;
}) {
  const name = getWorkspaceName(conversations);
  const fullPath = getWorkspaceFullPath(conversations);
  const count = conversations.length;

  return (
    <div className="px-3 py-3 border-b border-[hsl(var(--border-subtle))]">
      <div
        className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 cursor-pointer select-none hover:bg-[hsl(var(--bg-card-hover))] transition-colors duration-[var(--duration-fast)]"
        onClick={onToggle}
        title={fullPath ?? undefined}
      >
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-[hsl(var(--text-tertiary))] transition-transform duration-[var(--duration-fast)]',
            expanded && 'rotate-90'
          )}
        />
        <FolderOpen className="w-4 h-4 shrink-0 text-[hsl(var(--text-tertiary))]" />
        <span className="text-[var(--text-sm)] font-medium text-[hsl(var(--text-primary))] truncate min-w-0">
          {name}
        </span>
        {count > 0 && (
          <span className="text-[var(--text-xs)] text-[hsl(var(--text-tertiary))] ml-auto shrink-0 tabular-nums">
            {count}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateProject();
          }}
          className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors duration-[var(--duration-fast)]"
          title="新建项目"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project/WorkspaceRootRow.tsx
git commit -m "feat(sidebar): add WorkspaceRootRow component"
```

---

### Task 6: ProjectTreeItem Component

**Files:**
- Create: `src/components/project/ProjectTreeItem.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/project/ProjectTreeItem.tsx
'use client';

import { cn } from '@/lib/utils';
import { StatusDot } from './StatusDot';
import { ProjectTreeItemActions } from './ProjectTreeItemActions';
import type { ProjectHealth } from './getProjectStatus';

export function ProjectTreeItem({
  title,
  goal,
  health,
  isSelected,
  taskCount,
  blockerCount,
  onSelect,
  onDelete,
}: {
  title: string;
  goal: string;
  health: ProjectHealth;
  isSelected: boolean;
  taskCount: number;
  blockerCount: number;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative pl-4">
      {isSelected && (
        <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-[hsl(var(--accent))]" />
      )}
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full text-left rounded-[var(--radius-md)] px-3 py-2 transition-colors duration-[var(--duration-fast)]',
          isSelected
            ? 'bg-[hsl(var(--accent-soft))]'
            : 'hover:bg-[hsl(var(--bg-card-hover))]'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot health={health} />
          <span
            className={cn(
              'text-[var(--text-sm)] text-[hsl(var(--text-primary))] truncate min-w-0',
              isSelected && 'font-medium'
            )}
          >
            {title}
          </span>
        </div>
        <div className="mt-0.5 pl-[14px] text-[var(--text-xs)] text-[hsl(var(--text-tertiary))] truncate">
          {goal}
        </div>
        {isSelected && taskCount > 0 && (
          <div className="mt-1 pl-[14px] flex items-center gap-2 text-[var(--text-xs)] tabular-nums text-[hsl(var(--text-tertiary))]">
            <span>{taskCount} 任务</span>
            {blockerCount > 0 && (
              <span className="text-[hsl(var(--status-blocked))]">{blockerCount} 阻塞</span>
            )}
          </div>
        )}
      </button>
      <ProjectTreeItemActions onDelete={onDelete} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project/ProjectTreeItem.tsx
git commit -m "feat(sidebar): add ProjectTreeItem tree node component"
```

---

### Task 7: Rewrite ProjectSidebar

**Files:**
- Modify: `src/components/project/ProjectSidebar.tsx` (full rewrite)

- [ ] **Step 1: Replace the entire file**

Read the current `src/components/project/ProjectSidebar.tsx`, then replace its contents with:

```tsx
// src/components/project/ProjectSidebar.tsx
'use client';

import { useMemo, useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { ProjectCreateDialog } from './ProjectCreateDialog';
import { WorkspaceRootRow } from './WorkspaceRootRow';
import { ProjectTreeItem } from './ProjectTreeItem';
import { getProjectStatus } from './getProjectStatus';

export function ProjectSidebar() {
  const conversations = useTaskHubStore((s) => s.conversations);
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const setSelectedConversationId = useTaskHubStore((s) => s.setSelectedConversationId);
  const deleteConversation = useTaskHubStore((s) => s.deleteConversation);
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.blockersByConversation);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const statsByConversation = useMemo(() => {
    const taskStats = new Map<
      string,
      { total: number; blocked: number; inProgress: number; done: number }
    >();
    for (const t of tasks) {
      const prev = taskStats.get(t.conversationId) ?? { total: 0, blocked: 0, inProgress: 0, done: 0 };
      prev.total += 1;
      if (t.status === 'blocked') prev.blocked += 1;
      if (t.status === 'in-progress') prev.inProgress += 1;
      if (t.status === 'done') prev.done += 1;
      taskStats.set(t.conversationId, prev);
    }

    const openBlockers = new Map<string, number>();
    for (const [cid, list] of Object.entries(blockers)) {
      openBlockers.set(cid, (list || []).filter((b) => b.status === 'open').length);
    }

    return { taskStats, openBlockers };
  }, [tasks, blockers]);

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [conversations]
  );

  return (
    <>
      <aside className="w-[248px] shrink-0 h-full border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex flex-col">
        <WorkspaceRootRow
          conversations={conversations}
          expanded={isExpanded}
          onToggle={() => setIsExpanded((prev) => !prev)}
          onCreateProject={() => setIsCreateOpen(true)}
        />

        <div className="flex-1 overflow-y-auto py-1 flex flex-col gap-px scrollbar-thin">
          {isExpanded &&
            sorted.map((c) => {
              const stats = statsByConversation.taskStats.get(c.id) ?? {
                total: 0,
                blocked: 0,
                inProgress: 0,
                done: 0,
              };
              const openBlockerCount = statsByConversation.openBlockers.get(c.id) ?? 0;
              const health = getProjectStatus(stats);
              const isSelected = c.id === selectedConversationId;

              return (
                <ProjectTreeItem
                  key={c.id}
                  title={c.title}
                  goal={c.goal}
                  health={health}
                  isSelected={isSelected}
                  taskCount={stats.total}
                  blockerCount={openBlockerCount}
                  onSelect={() => setSelectedConversationId(c.id)}
                  onDelete={() => {
                    if (confirm(`删除项目「${c.title}」及其所有任务？`)) {
                      deleteConversation(c.id);
                    }
                  }}
                />
              );
            })}

          {isExpanded && sorted.length === 0 && (
            <div className="px-6 py-4 text-[var(--text-xs)] text-[hsl(var(--text-tertiary))]">
              还没有项目
            </div>
          )}
        </div>
      </aside>

      <ProjectCreateDialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx next build 2>&1 | tail -20` or `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run all existing tests to ensure nothing broke**

Run: `npx vitest run`
Expected: All tests pass (including the new ones from Tasks 1-2)

- [ ] **Step 4: Commit**

```bash
git add src/components/project/ProjectSidebar.tsx
git commit -m "feat(sidebar): rewrite sidebar as workspace tree layout"
```

---

### Task 8: Visual Verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the following states in the browser**

Check each of these visual requirements against the spec:

1. **Root row** shows workspace name (derived from projectPath), expand/collapse chevron, project count, and + button
2. **Root row** click toggles project list expand/collapse
3. **Project items** look like tree nodes — no border, no card shadow, compact vertical spacing
4. **Status dots** appear next to each project name (green/yellow/red/gray)
5. **Selected project** has: accent-soft background, left accent bar, task/blocker counts
6. **Non-selected projects** show only: name + one-line goal + status dot (no task counts)
7. **Hover on non-selected**: light background change, delete button appears
8. **Hover on selected**: selected state stays dominant (accent background persists)
9. **Delete button** only appears on hover, not permanently visible
10. **Empty state**: "还没有项目" text when no conversations exist
11. **Clicking +** opens the ProjectCreateDialog
12. **New project** appears in the tree after creation

- [ ] **Step 3: Fix any visual issues found during verification**

Address spacing, alignment, color, or interaction issues. Commit fixes.

---

### Task 9: Run Full Test Suite and Final Commit

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "fix(sidebar): visual polish from verification pass"
```
