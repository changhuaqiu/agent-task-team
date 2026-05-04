'use client';

import { useState, useMemo } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import {
  STATUS_ORDER,
  type Task,
  type TaskStatus,
  useTaskHubStore,
} from '@/store/taskHubStore';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { KanbanContextMenu } from './KanbanContextMenu';

// --- Valid status transitions ---

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'blocked'],
  in_progress: ['in_review', 'blocked'],
  in_review: ['done', 'blocked'],
  done: [],
  rejected: ['pending', 'in_progress'],
  blocked: ['pending', 'in_progress'],
};

// --- Helpers ---

function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const map: Record<TaskStatus, Task[]> = {
    pending: [],
    in_progress: [],
    in_review: [],
    done: [],
    rejected: [],
    blocked: [],
  };
  for (const t of tasks) map[t.status].push(t);
  return map;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === 'string' &&
    ['pending', 'in_progress', 'in_review', 'done', 'rejected', 'blocked'].includes(value)
  );
}

// --- Props ---

interface MiniKanbanProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

// --- Component ---

export function MiniKanban({ expanded, onToggleExpand }: MiniKanbanProps) {
  // Store hooks
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const updateTaskStatus = useTaskHubStore((s) => s.updateTaskStatus);
  const updateTask = useTaskHubStore((s) => s.updateTask);
  const phases = useTaskHubStore((s) => s.phases);

  // Drag state
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [dragSourceStatus, setDragSourceStatus] = useState<TaskStatus | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    task: Task;
  } | null>(null);

  // Phase filter
  const [activePhase, setActivePhase] = useState<string | null>(null);

  // Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // Derived: scoped tasks (filtered by selected conversation)
  const scoped = useMemo(() => {
    if (!selectedConversationId) return [];
    return tasks.filter((t) => t.conversationId === selectedConversationId);
  }, [selectedConversationId, tasks]);

  // Derived: scoped phases
  const scopedPhases = useMemo(() => {
    if (!selectedConversationId) return [];
    return phases
      .filter((p) => p.conversationId === selectedConversationId)
      .sort((a, b) => a.order - b.order);
  }, [selectedConversationId, phases]);

  // Derived: phase-filtered tasks
  const phaseFiltered = useMemo(() => {
    if (!activePhase) return scoped;
    return scoped.filter((t) => t.phaseId === activePhase);
  }, [scoped, activePhase]);

  // Derived: grouped by status
  const grouped = useMemo(() => groupByStatus(phaseFiltered), [phaseFiltered]);

  // --- DnD handlers ---

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) {
      setActiveTask(task);
      setDragSourceStatus(task.status);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id;
    if (isTaskStatus(overId)) {
      setDragOverStatus(overId);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (activeTask && isTaskStatus(overId)) {
      const targetStatus = overId as TaskStatus;
      const allowed = VALID_TRANSITIONS[activeTask.status] ?? [];
      if (allowed.includes(targetStatus)) {
        updateTaskStatus(activeTask.id, targetStatus);
      }
    }
    clearDragState();
  }

  function handleDragCancel() {
    clearDragState();
  }

  function clearDragState() {
    setActiveTask(null);
    setDragOverStatus(null);
    setDragSourceStatus(null);
  }

  // --- Card interaction handlers ---

  function handleCardClick(taskId: string) {
    setSelectedTaskId(taskId);
  }

  function handleCardContextMenu(e: React.MouseEvent, task: Task) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, task });
  }

  // --- Context menu handlers ---

  function handleContextStatusChange(taskId: string, status: TaskStatus) {
    updateTaskStatus(taskId, status);
  }

  function handleContextAssign(taskId: string, agentId: string) {
    updateTask(taskId, { agentId });
  }

  function handleContextEdit(taskId: string) {
    setSelectedTaskId(taskId);
  }

  function handleContextViewDeps(taskId: string) {
    setSelectedTaskId(taskId);
  }

  return (
    <>
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
          <div>
            <div className="text-xs font-medium tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
              看板
            </div>
            <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">
              横向滚动查看各状态列，点卡片打开详情。
            </div>
          </div>
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1.5 rounded-md hover:bg-[hsl(var(--bg-muted))] transition-colors text-[hsl(var(--text-tertiary))]"
              title={expanded ? '收起' : '展开'}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
        </div>

        {/* Phase filter bar */}
        {scopedPhases.length > 0 && (
          <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setActivePhase(null)}
              className={cn(
                'px-2 py-1 text-xs font-medium rounded-sm border transition-colors',
                activePhase === null
                  ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))]'
                  : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-card-hover))]',
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
                    'px-2 py-1 text-xs font-medium rounded-sm border transition-colors',
                    activePhase === phase.id
                      ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))]'
                      : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-card-hover))]',
                  )}
                >
                  {phase.title} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Kanban board with DnD */}
        <div className="p-3 overflow-x-auto scrollbar-thin">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="flex gap-3 w-max items-start">
              {STATUS_ORDER.map((status) => {
                const columnTasks = grouped[status] || [];
                const isValidTarget =
                  dragSourceStatus != null &&
                  (VALID_TRANSITIONS[dragSourceStatus] ?? []).includes(status);

                return (
                  <KanbanColumn
                    key={status}
                    status={status}
                    tasks={columnTasks}
                    isDropTarget={dragOverStatus === status}
                    isValidTarget={isValidTarget}
                    onCardClick={handleCardClick}
                    onCardContextMenu={handleCardContextMenu}
                  />
                );
              })}
            </div>

            <DragOverlay>
              {activeTask ? (
                <div className="w-[220px]">
                  <KanbanCard task={activeTask} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* Context menu rendered outside the DndContext */}
      {contextMenu && (
        <KanbanContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={contextMenu.task}
          onStatusChange={handleContextStatusChange}
          onAssign={handleContextAssign}
          onEdit={handleContextEdit}
          onViewDeps={handleContextViewDeps}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
