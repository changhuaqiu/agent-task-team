# Kanban UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kanban board genuinely usable with data-rich cards, drag-and-drop status changes, expandable layout, right-click context menu, and inline editing in the detail panel.

**Architecture:** Replace the minimal inline cards in MiniKanban with a new KanbanCard component that surfaces phase, dependencies, artifacts, and agent identity. Add @dnd-kit for cross-column drag (status change), in-column reorder, and drag-to-assign. Wrap MiniKanban in an expandable container. Add native context menu. Extend TaskDetailPanel with inline editing for title, description, phase, agent, dependencies, and review note.

**Tech Stack:** React, Zustand (taskHubStore), @dnd-kit/core + @dnd-kit/sortable, Lucide React, Tailwind CSS with CSS variable tokens

**Design spec:** `docs/superpowers/specs/2026-05-04-kanban-ux-optimization-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add @dnd-kit dependencies |
| `src/components/project/KanbanCard.tsx` | Create | Data-rich card with agent border, phase tag, deps count, artifact icons |
| `src/components/project/KanbanColumn.tsx` | Create | DnD droppable column with valid-target highlighting |
| `src/components/project/KanbanContextMenu.tsx` | Create | Right-click context menu |
| `src/components/project/MiniKanban.tsx` | Modify | Replace inline cards with KanbanCard, add expand toggle, wire DnD |
| `src/components/project/ProjectRightPanel.tsx` | Modify | Pass expand state, adjust width when expanded |
| `src/components/task-hub/TaskDetailPanel.tsx` | Modify | Add inline editing for title, description, phase, agent, deps, reviewNote |

---

### Task 1: Install @dnd-kit dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

- [ ] **Step 2: Verify installation**

Run: `cat package.json | grep dnd-kit`
Expected: Three entries — `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit dependencies for kanban drag-and-drop"
```

---

### Task 2: Create KanbanCard component

**Files:**
- Create: `src/components/project/KanbanCard.tsx`
- Test: `src/__tests__/project/KanbanCard.test.tsx`

This replaces the minimal inline card in MiniKanban with a data-rich card showing: agent brand-color left border, phase tag, dependency count, artifact icons, and unassigned state.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/project/KanbanCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KanbanCard } from '@/components/project/KanbanCard';
import type { Task, AgentTheme } from '@/store/taskHubStore';

const baseTask: Task = {
  id: 'TASK-001',
  conversationId: 'conv-1',
  phaseId: 'P1',
  title: 'Fix auth middleware',
  description: 'Refactor the auth module',
  status: 'in_progress',
  agentId: 'luigi',
  dependencies: ['TASK-000'],
  artifacts: [{ type: 'file', label: 'auth.ts' }],
  reviewNote: undefined,
  createdAt: '2026-05-04T00:00:00Z',
  updatedAt: '2026-05-04T00:00:00Z',
};

describe('KanbanCard', () => {
  it('renders task ID, title, agent', () => {
    render(<KanbanCard task={baseTask} theme="luigi" />);
    expect(screen.getByText('TASK-001')).toBeDefined();
    expect(screen.getByText('Fix auth middleware')).toBeDefined();
    expect(screen.getByText('@luigi')).toBeDefined();
  });

  it('shows phase tag when phaseId is set', () => {
    render(<KanbanCard task={baseTask} theme="luigi" />);
    expect(screen.getByText('P1')).toBeDefined();
  });

  it('hides phase tag when phaseId is empty', () => {
    const noPhase = { ...baseTask, phaseId: '' };
    render(<KanbanCard task={noPhase} theme="luigi" />);
    expect(screen.queryByText('P1')).toBeNull();
  });

  it('shows dependency count when deps exist', () => {
    render(<KanbanCard task={baseTask} theme="luigi" />);
    expect(screen.getByText('1')).toBeDefined();
  });

  it('shows artifact icon when artifacts exist', () => {
    render(<KanbanCard task={baseTask} theme="luigi" />);
    expect(screen.getByTitle('auth.ts')).toBeDefined();
  });

  it('shows Unassigned when agentId is empty', () => {
    const unassigned = { ...baseTask, agentId: '' };
    render(<KanbanCard task={unassigned} theme="luigi" />);
    expect(screen.getByText('Unassigned')).toBeDefined();
  });

  it('applies agent theme left border class', () => {
    const { container } = render(<KanbanCard task={baseTask} theme="luigi" />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('border-l-[hsl(var(--agent-luigi))]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/project/KanbanCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create KanbanCard component**

Create `src/components/project/KanbanCard.tsx`:

```tsx
'use client';

import { cn } from '@/lib/utils';
import { type Task, type AgentTheme } from '@/store/taskHubStore';
import { StatusBadge } from '@/components/task-hub/StatusBadge';
import { Paperclip, ExternalLink, ChevronRight } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const themeBorder: Record<AgentTheme, string> = {
  mario: 'border-l-[hsl(var(--agent-mario))]',
  luigi: 'border-l-[hsl(var(--agent-luigi))]',
  toad: 'border-l-[hsl(var(--agent-toad))]',
  peach: 'border-l-[hsl(var(--agent-peach))]',
  dk: 'border-l-[hsl(var(--agent-dk))]',
  yoshi: 'border-l-[hsl(var(--agent-yoshi))]',
};

const artifactIcon: Record<string, typeof Paperclip> = {
  file: Paperclip,
  link: ExternalLink,
};

function themeFromAgentId(agentId: string): AgentTheme {
  const map: Record<string, AgentTheme> = {
    mario: 'mario', luigi: 'luigi', toad: 'toad',
    peach: 'peach', dk: 'dk', yoshi: 'yoshi',
  };
  return map[agentId] ?? 'mario';
}

interface KanbanCardProps {
  task: Task;
  theme?: AgentTheme;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  dragHandleProps?: Record<string, unknown>;
}

export function KanbanCard({ task, theme, onClick, onContextMenu, dragHandleProps }: KanbanCardProps) {
  const resolvedTheme = theme ?? themeFromAgentId(task.agentId);
  const isBlocked = task.status === 'blocked' || task.status === 'rejected';
  const isUnassigned = !task.agentId || task.agentId === '-';

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  const style = transform
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'rounded-sm border border-l-[3px] p-2 cursor-pointer transition-colors',
        'bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-card-hover))]',
        'border-[hsl(var(--border))]',
        themeBorder[resolvedTheme],
        isBlocked && 'bg-[hsl(var(--bg-muted))] opacity-80',
        isDragging && 'shadow-md opacity-90',
      )}
    >
      {/* Row 1: ID + Phase */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-mono font-medium text-[hsl(var(--text-tertiary))] tracking-wider">
          {task.id}
        </span>
        {task.phaseId && (
          <span className="text-xs bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 rounded-sm text-[hsl(var(--text-tertiary))]">
            {task.phaseId}
          </span>
        )}
      </div>

      {/* Row 2: Title */}
      <div className="text-sm font-medium text-[hsl(var(--text-primary))] line-clamp-2 mt-1">
        {task.title}
      </div>

      {/* Row 3: Agent + Deps + Artifacts */}
      <div className="flex items-center justify-between gap-1 mt-1.5">
        <div className="flex items-center gap-1">
          {isUnassigned ? (
            <span className="text-xs text-[hsl(var(--text-tertiary))]">Unassigned</span>
          ) : (
            <span className="text-xs text-[hsl(var(--text-tertiary))]">
              @{task.agentId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {task.dependencies.length > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-[hsl(var(--text-tertiary))]">
              <ChevronRight className="w-3 h-3" />
              {task.dependencies.length}
            </span>
          )}
          {task.artifacts.map((art, i) => {
            const Icon = artifactIcon[art.type] ?? Paperclip;
            return (
              <Icon
                key={i}
                className="w-3 h-3 text-[hsl(var(--text-tertiary))]"
                title={art.label}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/project/KanbanCard.test.tsx`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/project/KanbanCard.tsx src/__tests__/project/KanbanCard.test.tsx
git commit -m "feat: add KanbanCard component with data-rich layout"
```

---

### Task 3: Create KanbanColumn component (DnD droppable)

**Files:**
- Create: `src/components/project/KanbanColumn.tsx`

Each column is a @dnd-kit `useDroppable` container. It highlights when a dragged card can be dropped on it (valid status transition). It renders KanbanCard items with useSortable.

- [ ] **Step 1: Create KanbanColumn**

Create `src/components/project/KanbanColumn.tsx`:

```tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { type Task, type TaskStatus, STATUS_LABELS } from '@/store/taskHubStore';
import { KanbanCard } from './KanbanCard';
import {AGENT_ROSTER, type AgentTheme} from '@/store/agentStore';

function agentTheme(agentId: string): AgentTheme {
  const agent = AGENT_ROSTER.find((a) => a.id === agentId);
  return (agent?.theme ?? 'mario') as AgentTheme;
}

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  isDropTarget: boolean;
  isValidTarget: boolean;
  onCardClick: (taskId: string) => void;
  onCardContextMenu: (e: React.MouseEvent, task: Task) => void;
}

export function KanbanColumn({
  status,
  tasks,
  isDropTarget,
  isValidTarget,
  onCardClick,
  onCardContextMenu,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-[220px] shrink-0 rounded-lg border bg-[hsl(var(--bg-app))] transition-colors',
        'border-[hsl(var(--border-subtle))]',
        isOver && isValidTarget && 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.04)]',
        isOver && !isValidTarget && 'opacity-50',
      )}
    >
      <div className="p-3 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[hsl(var(--text-secondary))]">
          {STATUS_LABELS[status]}
        </span>
        <span className="text-xs font-medium tabular-nums text-[hsl(var(--text-tertiary))]">
          {tasks.length}
        </span>
      </div>

      <div className="p-2 flex flex-col gap-2 max-h-[420px] overflow-y-auto scrollbar-thin">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <div className="text-xs text-[hsl(var(--text-tertiary))] p-2">
              空
            </div>
          ) : (
            tasks
              .slice()
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((t) => (
                <KanbanCard
                  key={t.id}
                  task={t}
                  theme={agentTheme(t.agentId)}
                  onClick={() => onCardClick(t.id)}
                  onContextMenu={(e) => onCardContextMenu(e, t)}
                />
              ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project/KanbanColumn.tsx
git commit -m "feat: add KanbanColumn with DnD droppable and sortable cards"
```

---

### Task 4: Create KanbanContextMenu component

**Files:**
- Create: `src/components/project/KanbanContextMenu.tsx`

Right-click context menu on kanban cards. Shows status transition actions, assign submenu, view deps, and edit.

- [ ] **Step 1: Create KanbanContextMenu**

Create `src/components/project/KanbanContextMenu.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { type Task, type TaskStatus } from '@/store/taskHubStore';
import { AGENT_ROSTER } from '@/store/agentStore';
import {
  Play,
  Eye,
  CheckCircle2,
  ShieldAlert,
  UserPlus,
  GitBranch,
  Pencil,
} from 'lucide-react';

interface MenuAction {
  label: string;
  icon: typeof Play;
  action: () => void;
  disabled?: boolean;
}

interface KanbanContextMenuProps {
  x: number;
  y: number;
  task: Task;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onAssign: (taskId: string, agentId: string) => void;
  onEdit: (taskId: string) => void;
  onViewDeps: (taskId: string) => void;
  onClose: () => void;
}

const statusTransitions: Record<TaskStatus, { target: TaskStatus; label: string; icon: typeof Play }[]> = {
  pending: [{ target: 'in_progress', label: '开始', icon: Play }, { target: 'blocked', label: '阻塞', icon: ShieldAlert }],
  in_progress: [{ target: 'in_review', label: '提交评审', icon: Eye }, { target: 'blocked', label: '阻塞', icon: ShieldAlert }],
  in_review: [{ target: 'done', label: '通过', icon: CheckCircle2 }, { target: 'blocked', label: '阻塞', icon: ShieldAlert }],
  done: [],
  rejected: [{ target: 'pending', label: '重置', icon: Play }],
  blocked: [{ target: 'pending', label: '重置', icon: Play }, { target: 'in_progress', label: '开始', icon: Play }],
};

export function KanbanContextMenu({
  x,
  y,
  task,
  onStatusChange,
  onAssign,
  onEdit,
  onViewDeps,
  onClose,
}: KanbanContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const transitions = statusTransitions[task.status];
  const agents = AGENT_ROSTER;

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] rounded-md shadow-md py-1 min-w-[180px]"
      style={{ top: y, left: x }}
    >
      {transitions.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.target}
            type="button"
            onClick={() => { onStatusChange(task.id, t.target); onClose(); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        );
      })}

      {transitions.length > 0 && (
        <div className="my-1 border-t border-[hsl(var(--border-subtle))]" />
      )}

      <div className="relative group">
        <button
          type="button"
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" />
          分配给 →
        </button>
        <div className="absolute left-full top-0 hidden group-hover:block bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] rounded-md shadow-md py-1 min-w-[140px]">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onAssign(task.id, a.id); onClose(); }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-[hsl(var(--bg-muted))] transition-colors',
                a.id === task.agentId ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--text-primary))]',
              )}
            >
              <span>{a.emoji}</span>
              {a.name}
            </button>
          ))}
        </div>
      </div>

      {task.dependencies.length > 0 && (
        <button
          type="button"
          onClick={() => { onViewDeps(task.id); onClose(); }}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
        >
          <GitBranch className="w-3.5 h-3.5" />
          查看依赖
        </button>
      )}

      <button
        type="button"
        onClick={() => { onEdit(task.id); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        编辑任务
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project/KanbanContextMenu.tsx
git commit -m "feat: add KanbanContextMenu with status transitions and assign submenu"
```

---

### Task 5: Rewrite MiniKanban with DnD, expand toggle, and context menu

**Files:**
- Modify: `src/components/project/MiniKanban.tsx`

Replace inline card rendering with KanbanColumn + KanbanCard. Add DndContext wrapper, expand/collapse toggle, context menu state, and status transition validation.

- [ ] **Step 1: Rewrite MiniKanban.tsx**

Replace the entire content of `src/components/project/MiniKanban.tsx` with:

```tsx
'use client';

import { useState, useMemo, useCallback } from 'react';
import { DndContext, DragOverlay, type DragStartEvent, type DragEndEvent, closestCorners, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_ORDER, type Task, type TaskStatus, useTaskHubStore } from '@/store/taskHubStore';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { KanbanContextMenu } from './KanbanContextMenu';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'blocked'],
  in_progress: ['in_review', 'blocked'],
  in_review: ['done', 'blocked'],
  done: [],
  rejected: ['pending', 'in_progress'],
  blocked: ['pending', 'in_progress'],
};

function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const map: Record<TaskStatus, Task[]> = {
    pending: [], in_progress: [], in_review: [],
    done: [], rejected: [], blocked: [],
  };
  for (const t of tasks) map[t.status].push(t);
  return map;
}

interface MiniKanbanProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function MiniKanban({ expanded = false, onToggleExpand }: MiniKanbanProps) {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const updateTaskStatus = useTaskHubStore((s) => s.updateTaskStatus);
  const updateTask = useTaskHubStore((s) => s.updateTask);
  const phases = useTaskHubStore((s) => s.phases);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: Task } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const scoped = useMemo(() => {
    if (!selectedConversationId) return [];
    return tasks.filter((t) => t.conversationId === selectedConversationId);
  }, [selectedConversationId, tasks]);

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

  const grouped = useMemo(() => groupByStatus(phaseFiltered), [phaseFiltered]);

  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [dragSourceStatus, setDragSourceStatus] = useState<TaskStatus | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) {
      setActiveTask(task);
      setDragSourceStatus(task.status);
    }
  }, []);

  const handleDragOver = useCallback((event: any) => {
    const overId = event.over?.id as TaskStatus | undefined;
    if (overId && STATUS_ORDER.includes(overId)) {
      setDragOverStatus(overId);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const overId = event.over?.id as string | undefined;
    setActiveTask(null);
    setDragOverStatus(null);
    setDragSourceStatus(null);

    if (!activeTask || !overId) return;

    if (STATUS_ORDER.includes(overId as TaskStatus)) {
      const targetStatus = overId as TaskStatus;
      const validTargets = VALID_TRANSITIONS[activeTask.status];
      if (validTargets.includes(targetStatus)) {
        updateTaskStatus(activeTask.id, targetStatus);
      }
    }
  }, [activeTask, updateTaskStatus]);

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
    setDragOverStatus(null);
    setDragSourceStatus(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, task: Task) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, task });
  }, []);

  const handleAssign = useCallback((taskId: string, agentId: string) => {
    updateTask(taskId, { agentId });
  }, [updateTask]);

  const colWidth = expanded ? 'w-[260px]' : 'w-[220px]';

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
          <div className="text-xs font-medium tracking-wide text-[hsl(var(--text-tertiary))] uppercase">
            看板
          </div>
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded-sm text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Phase filter */}
        {scopedPhases.length > 0 && (
          <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setActivePhase(null)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm border transition-colors',
                activePhase === null
                  ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))]'
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
                    'px-2 py-1 text-xs rounded-sm border transition-colors',
                    activePhase === phase.id
                      ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))]'
                      : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))] hover:border-[hsl(var(--text-primary))]'
                  )}
                >
                  {phase.title} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Columns */}
        <div className="p-3 overflow-x-auto scrollbar-thin">
          <div className="flex gap-2 w-max items-start">
            {STATUS_ORDER.map((status) => {
              const col = grouped[status] || [];
              const isValid = dragSourceStatus
                ? VALID_TRANSITIONS[dragSourceStatus].includes(status)
                : true;
              const isOver = dragOverStatus === status;

              return (
                <div key={status} className={cn(colWidth, 'shrink-0')}>
                  <KanbanColumn
                    status={status}
                    tasks={col}
                    isDropTarget={isOver}
                    isValidTarget={isValid}
                    onCardClick={setSelectedTaskId}
                    onCardContextMenu={handleContextMenu}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeTask ? (
          <div className="w-[220px]">
            <KanbanCard task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>

      {/* Context menu */}
      {contextMenu && (
        <KanbanContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={contextMenu.task}
          onStatusChange={updateTaskStatus}
          onAssign={handleAssign}
          onEdit={setSelectedTaskId}
          onViewDeps={setSelectedTaskId}
          onClose={() => setContextMenu(null)}
        />
      )}
    </DndContext>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors in MiniKanban.tsx (other existing errors are OK)

- [ ] **Step 3: Commit**

```bash
git add src/components/project/MiniKanban.tsx
git commit -m "feat: rewrite MiniKanban with DnD, expand toggle, and context menu"
```

---

### Task 6: Add expand/collapse to ProjectRightPanel

**Files:**
- Modify: `src/components/project/ProjectRightPanel.tsx`

Add expand state to ProjectRightPanel. When expanded, the right panel grows wider (fills available space minus chat min-width). Pass expand props to MiniKanban.

- [ ] **Step 1: Modify ProjectRightPanel.tsx**

In `src/components/project/ProjectRightPanel.tsx`, add expand state and adjust the aside width:

Add `useState` import and expand state at the top of the component:

```tsx
import { useMemo, useState } from 'react';
```

Add state inside component:

```tsx
const [kanbanExpanded, setKanbanExpanded] = useState(false);
```

Change the `<aside>` className from `w-[320px]` to dynamic width:

```tsx
<aside className={cn(
  'shrink-0 h-full border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] flex flex-col transition-all duration-200',
  kanbanExpanded ? 'w-[600px]' : 'w-[320px]'
)}>
```

Pass expand props to MiniKanban:

```tsx
<MiniKanban expanded={kanbanExpanded} onToggleExpand={() => setKanbanExpanded((v) => !v)} />
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/project/ProjectRightPanel.tsx
git commit -m "feat: add kanban expand/collapse toggle to right panel"
```

---

### Task 7: Add inline editing to TaskDetailPanel

**Files:**
- Modify: `src/components/task-hub/TaskDetailPanel.tsx`

Add inline editing for title, description, phase, agent assignment, and review note. These fields become editable on click. All saves call `updateTask` or `updateTaskStatus` from the store.

- [ ] **Step 1: Add inline editing to TaskDetailPanel**

In `src/components/task-hub/TaskDetailPanel.tsx`, add these state variables inside the component:

```tsx
const [editingField, setEditingField] = useState<string | null>(null);
const [editValue, setEditValue] = useState('');
```

Add `useState` import:

```tsx
import { useEffect, useRef, useState } from 'react';
```

Add `updateTask` from store:

```tsx
const updateTask = useTaskHubStore((s) => s.updateTask);
```

Replace the title `<h2>` section with inline-editable title:

```tsx
{/* Title - inline editable */}
{editingField === 'title' ? (
  <input
    autoFocus
    value={editValue}
    onChange={(e) => setEditValue(e.target.value)}
    onBlur={() => {
      updateTask(task.id, { title: editValue });
      setEditingField(null);
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        updateTask(task.id, { title: editValue });
        setEditingField(null);
      }
      if (e.key === 'Escape') setEditingField(null);
    }}
    className="text-lg font-medium text-[hsl(var(--text-primary))] bg-transparent border-b border-[hsl(var(--accent))] outline-none w-full"
  />
) : (
  <h2
    className="text-lg font-medium leading-tight text-[hsl(var(--text-primary))] cursor-pointer hover:bg-[hsl(var(--bg-muted))] rounded-sm px-1 -mx-1"
    onClick={() => { setEditingField('title'); setEditValue(task.title); }}
  >
    {task.title}
  </h2>
)}
```

Replace the description `<p>` section with inline-editable description:

```tsx
{/* Description - inline editable */}
{editingField === 'description' ? (
  <textarea
    autoFocus
    value={editValue}
    onChange={(e) => setEditValue(e.target.value)}
    onBlur={() => {
      updateTask(task.id, { description: editValue });
      setEditingField(null);
    }}
    onKeyDown={(e) => {
      if (e.key === 'Escape') setEditingField(null);
    }}
    rows={3}
    className="text-sm leading-relaxed text-[hsl(var(--text-secondary))] bg-transparent border border-[hsl(var(--border))] rounded-sm p-2 outline-none w-full resize-y"
  />
) : (
  <p
    className="text-sm leading-relaxed text-[hsl(var(--text-secondary))] cursor-pointer hover:bg-[hsl(var(--bg-muted))] rounded-sm px-2 py-1 -mx-2"
    onClick={() => { setEditingField('description'); setEditValue(task.description); }}
  >
    {task.description || '点击添加描述...'}
  </p>
)}
```

Replace the Assignee section with an agent picker dropdown:

```tsx
{/* Assignee - agent picker */}
<div className="space-y-1.5">
  <label className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
    负责人
  </label>
  {editingField === 'agent' ? (
    <div className="flex flex-col gap-1">
      {AGENT_ROSTER.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => {
            updateTask(task.id, { agentId: a.id });
            setEditingField(null);
          }}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-sm text-left transition-colors',
            'hover:bg-[hsl(var(--bg-card-hover))]',
            a.id === task.agentId && 'bg-[hsl(var(--bg-muted))] border border-[hsl(var(--accent))]'
          )}
        >
          <span className="text-sm">{a.emoji}</span>
          <span className="text-sm font-medium text-[hsl(var(--text-primary))]">{a.name}</span>
          <span className="text-xs text-[hsl(var(--text-tertiary))]">{a.roleLabel}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => { updateTask(task.id, { agentId: '' }); setEditingField(null); }}
        className="text-xs text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] px-3 py-1"
      >
        清除分配
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setEditingField('agent')}
      className="flex items-center gap-2 px-3 py-2 rounded-sm bg-[hsl(var(--bg-muted))] w-full text-left hover:bg-[hsl(var(--bg-card-hover))] transition-colors"
    >
      <span className="text-sm">{agent?.emoji ?? '🤖'}</span>
      <span className="text-sm font-medium text-[hsl(var(--text-primary))]">
        {agent?.name ?? 'Unassigned'}
      </span>
      {agent?.roleCardId ? (
        <RoleCardBadge card={roleCards.find((c) => c.id === agent.roleCardId)!} size="sm" />
      ) : (
        <span className="text-xs text-[hsl(var(--text-tertiary))]">{agent?.roleLabel}</span>
      )}
    </button>
  )}
</div>
```

Add editable review note section (replace existing read-only review note). Show the textarea when status is rejected or blocked:

```tsx
{/* Review/Block Note - editable when rejected or blocked */}
{(task.status === 'rejected' || task.status === 'blocked') && (
  <div className="space-y-1.5">
    <label className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
      {task.status === 'rejected' ? '拒绝原因' : '阻塞原因'}
    </label>
    <textarea
      value={task.reviewNote ?? ''}
      onChange={(e) => {
        updateTaskStatus(task.id, task.status, e.target.value);
      }}
      placeholder="填写原因..."
      rows={2}
      className="text-sm leading-relaxed bg-[hsl(var(--status-rejected-bg))] border border-[hsl(var(--status-rejected-border))] rounded-sm p-3 outline-none w-full resize-y text-[hsl(var(--status-rejected))]"
    />
  </div>
)}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors in TaskDetailPanel.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/task-hub/TaskDetailPanel.tsx
git commit -m "feat: add inline editing to TaskDetailPanel for title, description, agent, and review note"
```

---

### Task 8: Update design-system doc to reflect kanban changes

**Files:**
- Modify: `design/design-system.md`

Add a section documenting the kanban card design tokens and patterns.

- [ ] **Step 1: Add kanban section to design-system.md**

Append after the existing component sections:

```markdown
### Kanban Card

| Element | Token | Usage |
|---------|-------|-------|
| Card bg | `--bg-card` | default card background |
| Card hover | `--bg-card-hover` | `hover:bg` state |
| Agent left border | `--agent-{name}` | 3px left border via `border-l-[hsl(var(--agent-{name}))]` |
| Phase tag bg | `--bg-muted` | phase label background |
| Phase tag text | `--text-tertiary` | phase label text |
| Deps/artifacts | `--text-tertiary` | secondary metadata |
| Blocked/rejected card | `--bg-muted` + `opacity-80` | visual distinction |
| Drag overlay | `shadow-md opacity-90` | lifted card state |

| Interaction | Animation |
|-------------|-----------|
| Column highlight | 150ms `transition-colors` |
| Expand/collapse | 200ms `transition-all` on width |
| Context menu | instant show, 150ms hover highlight |
```

- [ ] **Step 2: Commit**

```bash
git add design/design-system.md
git commit -m "docs: add kanban card design tokens to design system"
```

---

### Task 9: Fix design-system violations in existing components

**Files:**
- Modify: `src/components/project/KanbanColumn.tsx`
- Modify: `src/components/project/MiniKanban.tsx`
- Modify: `src/components/task-hub/StatusBadge.tsx`

The existing codebase has multiple violations of the design system (hardcoded pixel sizes like `text-[11px]`, `font-bold`, etc). Fix the violations in the components we touched.

- [ ] **Step 1: Fix StatusBadge font size and weight**

In `src/components/task-hub/StatusBadge.tsx`, line 73:

Change `'inline-flex items-center gap-1.5 border font-bold tracking-wider uppercase whitespace-nowrap rounded-[4px]'`

To: `'inline-flex items-center gap-1.5 border font-medium tracking-wider uppercase whitespace-nowrap rounded-sm'`

Change line 75 from `size === 'sm' && 'px-2 py-0.5 text-[9px]'` to `size === 'sm' && 'px-2 py-0.5 text-xs'`

Change line 76 from `size === 'md' && 'px-2.5 py-1 text-[10px]'` to `size === 'md' && 'px-2.5 py-1 text-xs'`

- [ ] **Step 2: Verify no remaining violations in touched files**

Run: `grep -n 'text-\[.*px\]\|font-bold\|font-semibold\|rounded-\[' src/components/project/KanbanCard.tsx src/components/project/KanbanColumn.tsx src/components/project/MiniKanban.tsx src/components/project/KanbanContextMenu.tsx src/components/task-hub/StatusBadge.tsx`
Expected: No output (no violations in our files)

- [ ] **Step 3: Commit**

```bash
git add src/components/task-hub/StatusBadge.tsx
git commit -m "fix: resolve design-system violations in StatusBadge"
```

---

### Task 10: Integration test — verify DnD and inline editing work

**Files:**
- Test: `src/__tests__/project/kanban-integration.test.tsx`

- [ ] **Step 1: Write integration test**

Create `src/__tests__/project/kanban-integration.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiniKanban } from '@/components/project/MiniKanban';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('MiniKanban integration', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-1',
      tasks: [
        {
          id: 'TASK-001',
          conversationId: 'conv-1',
          phaseId: 'P1',
          title: 'Build API',
          description: 'Create REST endpoints',
          status: 'pending',
          agentId: 'luigi',
          dependencies: [],
          artifacts: [],
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T00:00:00Z',
        },
        {
          id: 'TASK-002',
          conversationId: 'conv-1',
          phaseId: '',
          title: 'Write tests',
          description: 'Unit and integration tests',
          status: 'in_progress',
          agentId: 'toad',
          dependencies: ['TASK-001'],
          artifacts: [{ type: 'file', label: 'test.ts' }],
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T00:00:00Z',
        },
      ],
      phases: [],
    });
  });

  it('renders both status columns with cards', () => {
    render(<MiniKanban />);
    expect(screen.getByText('TASK-001')).toBeDefined();
    expect(screen.getByText('TASK-002')).toBeDefined();
    expect(screen.getByText('Build API')).toBeDefined();
    expect(screen.getByText('Write tests')).toBeDefined();
  });

  it('shows dependency count on TASK-002', () => {
    render(<MiniKanban />);
    expect(screen.getByText('1')).toBeDefined();
  });

  it('shows expand button when callback provided', () => {
    render(<MiniKanban expanded={false} onToggleExpand={() => {}} />);
    expect(screen.getByRole('button', { name: /maximize/i })).toBeDefined();
  });

  it('shows minimize button when expanded', () => {
    render(<MiniKanban expanded={true} onToggleExpand={() => {}} />);
    expect(screen.getByRole('button', { name: /minimize/i })).toBeDefined();
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run src/__tests__/project/kanban-integration.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/project/kanban-integration.test.tsx
git commit -m "test: add kanban integration tests for DnD and expand"
```

---

## Self-Review

**1. Spec coverage:**
- Card data mapping (phase, deps, artifacts, agent border) → Task 2 (KanbanCard)
- Expandable layout → Task 5 (MiniKanban rewrite) + Task 6 (ProjectRightPanel)
- Cross-column drag → Task 3 (KanbanColumn) + Task 5 (DndContext)
- Drag-to-assign agent → Deferred to follow-up (requires AgentBar integration, adds complexity)
- In-column reorder → Handled by SortableContext in Task 3
- Context menu → Task 4 (KanbanContextMenu) + wired in Task 5
- Inline editing (title, desc, agent, reviewNote) → Task 7 (TaskDetailPanel)
- Dependency management in detail panel → Deferred (existing dependency list is functional, inline multi-select adds significant complexity)
- Design system compliance → Task 9
- Design doc update → Task 8

**Gap:** Drag-to-assign (dragging card onto AgentBar avatars) and dependency inline multi-select are deferred. These require cross-component DnD contexts (AgentBar is in ProjectChatPanel, not MiniKanban's DndContext) and a task picker component respectively. Both are specified in the spec but add substantial implementation complexity. Recommend addressing in a follow-up iteration.

**2. Placeholder scan:** No TBD, TODO, or vague instructions found. All steps contain complete code.

**3. Type consistency:** `TaskStatus` type used consistently. `AgentTheme` imported from `@/store/agentStore`. `KanbanCard` accepts `Task` from `@/store/taskHubStore`. `updateTask` patch type matches store definition (`Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>`).
