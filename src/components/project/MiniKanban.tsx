'use client';

import { useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import {
  STATUS_ORDER,
  STATUS_LABELS,
  type Task,
  type TaskStatus,
  useTaskHubStore,
} from '@/store/taskHubStore';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { KanbanContextMenu } from './KanbanContextMenu';
import { Columns3, Users, List } from 'lucide-react';
import { isTaskStatus, nextDirectTaskStatuses } from '@/shared/task-status';

type ViewMode = 'status' | 'agent' | 'list';

// --- Helpers ---

function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const map: Record<TaskStatus, Task[]> = {
    proposed: [],
    ready: [],
    in_progress: [],
    blocked: [],
    in_review: [],
    done: [],
    cancelled: [],
  };
  for (const task of tasks) {
    map[task.status].push(task);
  }
  return map;
}

// --- Sync age hook (pure external store) ---

let syncListeners: Array<() => void> = [];
let syncInterval: ReturnType<typeof setInterval> | null = null;

function startSyncTicker() {
  if (syncInterval) return;
  syncInterval = setInterval(() => {
    for (const l of syncListeners) l();
  }, 10_000);
}

function stopSyncTicker() {
  if (syncInterval && syncListeners.length === 0) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function computeSyncLabel(ts: string | null): string | null {
  if (!ts) return null;
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 10) return 'live';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function useSyncAgo(lastSyncAt: string | null): string | null {
  const subscribe = useCallback((onStoreChange: () => void) => {
    syncListeners.push(onStoreChange);
    startSyncTicker();
    return () => {
      syncListeners = syncListeners.filter((l) => l !== onStoreChange);
      stopSyncTicker();
    };
  }, []);

  const getSnapshot = useCallback(() => computeSyncLabel(lastSyncAt), [lastSyncAt]);
  const getServerSnapshot = useCallback(() => null as string | null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// --- Props ---

interface MiniKanbanProps {
  expanded?: boolean;
}

// --- Component ---

export function MiniKanban(_props: MiniKanbanProps) {
  // Store hooks
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const updateTaskStatus = useTaskHubStore((s) => s.updateTaskStatus);
  const updateTask = useTaskHubStore((s) => s.updateTask);
  const phases = useTaskHubStore((s) => s.phases);
  const lastTaskSyncAt = useTaskHubStore((s) => s.lastTaskSyncAt);

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('status');

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
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
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

  // Derived: grouped by agent
  const groupedByAgent = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of phaseFiltered) {
      const key = t.agentId && t.agentId !== '-' ? t.agentId : '_unassigned';
      (map[key] ??= []).push(t);
    }
    return map;
  }, [phaseFiltered]);

  // Sync indicator via external store (avoids impure Date.now in render)
  const syncAgo = useSyncAgo(lastTaskSyncAt);

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
      const allowed = nextDirectTaskStatuses(activeTask.status);
      if (allowed.includes(targetStatus)) {
        updateTaskStatus({ conversationId: activeTask.conversationId, taskId: activeTask.id }, targetStatus);
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
    if (!selectedConversationId) return;
    updateTaskStatus({ conversationId: selectedConversationId, taskId }, status);
  }

  function handleContextAssign(taskId: string, agentId: string) {
    if (!selectedConversationId) return;
    updateTask({ conversationId: selectedConversationId, taskId }, { agentId });
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
        {/* Header with view toggle + sync indicator */}
        <div className="p-3 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium tracking-wider uppercase text-[hsl(var(--text-tertiary))]">
              看板
            </div>
            <span className="text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">
              {phaseFiltered.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Sync indicator */}
            {syncAgo && (
              <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-tertiary))]">
                <span className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full',
                  syncAgo === 'live' ? 'bg-green-400 animate-pulse' : 'bg-[hsl(var(--text-tertiary))]'
                )} />
                {syncAgo === 'live' ? '同步中' : syncAgo}
              </span>
            )}

            {/* View mode toggle */}
            <div className="flex items-center border border-[hsl(var(--border-subtle))] rounded-[var(--radius-sm)] overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('status')}
                className={cn(
                  'min-h-[32px] min-w-[32px] p-1.5 flex items-center justify-center transition-colors',
                  viewMode === 'status'
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]',
                )}
                title="按状态"
                aria-label="按状态视图"
              >
                <Columns3 size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('agent')}
                className={cn(
                  'min-h-[32px] min-w-[32px] p-1.5 flex items-center justify-center transition-colors',
                  viewMode === 'agent'
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]',
                )}
                title="按执行者"
                aria-label="按执行者视图"
              >
                <Users size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'min-h-[32px] min-w-[32px] p-1.5 flex items-center justify-center transition-colors',
                  viewMode === 'list'
                    ? 'bg-[hsl(var(--accent))] text-white'
                    : 'text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]',
                )}
                title="列表视图"
                aria-label="列表视图"
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Phase filter bar */}
        {scopedPhases.length > 0 && (
          <div className="px-3 py-2 flex gap-1.5 flex-wrap border-b border-[hsl(var(--border-subtle))]">
            <button
              type="button"
              onClick={() => setActivePhase(null)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-medium rounded-sm border transition-colors',
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
                    'px-2 py-0.5 text-[10px] font-medium rounded-sm border transition-colors',
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

        {/* View: Status columns (default DnD kanban) */}
        {viewMode === 'status' && (
          <div className="p-3 overflow-x-auto scrollbar-thin">
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="flex gap-2 w-max items-start">
                {STATUS_ORDER.map((status) => {
                  const columnTasks = grouped[status] || [];
                  const isValidTarget =
                    dragSourceStatus != null &&
                    nextDirectTaskStatuses(dragSourceStatus).includes(status);

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

              <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
                {activeTask ? (
                  <div className="w-[210px] scale-105 shadow-[var(--shadow-lg)] rounded-[var(--radius-md)] ring-2 ring-[hsl(var(--accent)/0.3)]">
                    <KanbanCard task={activeTask} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        )}

        {/* View: Agent groups */}
        {viewMode === 'agent' && (
          <div className="p-3 flex flex-col gap-3 max-h-[500px] overflow-y-auto scrollbar-thin">
            {Object.entries(groupedByAgent)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([agent, agentTasks]) => (
                <div key={agent} className="rounded border border-[hsl(var(--border-subtle))]">
                  <div className="px-2.5 py-1.5 bg-[hsl(var(--bg-muted))] border-b border-[hsl(var(--border-subtle))] flex items-center justify-between">
                    <span className="text-xs font-medium text-[hsl(var(--text-secondary))]">
                      {agent === '_unassigned' ? '未分配' : `@${agent}`}
                    </span>
                    <span className="text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]">{agentTasks.length}</span>
                  </div>
                  <div className="p-2 flex flex-col gap-1.5">
                    {agentTasks
                      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
                      .map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => handleCardClick(task.id)}
                          className="flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[hsl(var(--bg-card-hover))] transition-colors"
                        >
                          <StatusDot status={task.status} />
                          <span className="text-[10px] font-mono text-[hsl(var(--text-tertiary))] shrink-0">{task.id}</span>
                          <span className="text-xs text-[hsl(var(--text-primary))] truncate">{task.title}</span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            {Object.keys(groupedByAgent).length === 0 && (
              <div className="text-xs text-[hsl(var(--text-tertiary))] p-3">暂无任务</div>
            )}
          </div>
        )}

        {/* View: Compact list */}
        {viewMode === 'list' && (
          <div className="max-h-[500px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[hsl(var(--bg-card))]">
                <tr className="border-b border-[hsl(var(--border-subtle))]">
                  <th className="text-left px-2.5 py-1.5 font-medium text-[hsl(var(--text-tertiary))]">ID</th>
                  <th className="text-left px-2.5 py-1.5 font-medium text-[hsl(var(--text-tertiary))]">标题</th>
                  <th className="text-left px-2.5 py-1.5 font-medium text-[hsl(var(--text-tertiary))]">状态</th>
                  <th className="text-left px-2.5 py-1.5 font-medium text-[hsl(var(--text-tertiary))]">执行者</th>
                </tr>
              </thead>
              <tbody>
                {phaseFiltered
                  .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
                  .map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => handleCardClick(task.id)}
                      className="border-b border-[hsl(var(--border-subtle))] hover:bg-[hsl(var(--bg-card-hover))] cursor-pointer transition-colors"
                    >
                      <td className="px-2.5 py-1.5 font-mono text-[10px] text-[hsl(var(--text-tertiary))] whitespace-nowrap">{task.id}</td>
                      <td className="px-2.5 py-1.5 text-[hsl(var(--text-primary))] max-w-[180px] truncate">{task.title}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <StatusDot status={task.status} />
                          <span className="text-[hsl(var(--text-secondary))]">{STATUS_LABELS[task.status]}</span>
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-[hsl(var(--text-secondary))] whitespace-nowrap">
                        {task.agentId && task.agentId !== '-' ? `@${task.agentId}` : '-'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {phaseFiltered.length === 0 && (
              <div className="text-xs text-[hsl(var(--text-tertiary))] p-3">暂无任务</div>
            )}
          </div>
        )}
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

function StatusDot({ status }: { status: TaskStatus }) {
  const colors: Record<TaskStatus, string> = {
    proposed: 'bg-[hsl(var(--status-pending))]',
    ready: 'bg-[hsl(var(--status-pending))]',
    in_progress: 'bg-[hsl(var(--status-progress))]',
    blocked: 'bg-[hsl(var(--status-blocked))]',
    in_review: 'bg-[hsl(var(--status-review))]',
    done: 'bg-[hsl(var(--status-done))]',
    cancelled: 'bg-[hsl(var(--text-tertiary))]',
  };
  return <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', colors[status])} />;
}
