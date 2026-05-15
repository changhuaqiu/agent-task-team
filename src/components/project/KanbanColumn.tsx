'use client';

import React, { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { type Task, type TaskStatus, STATUS_LABELS, useTaskHubStore } from '@/store/taskHubStore';
import { type AgentTheme } from '@/store/agentStore';
import { KanbanCard } from './KanbanCard';

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
  const getEffectiveRoster = useTaskHubStore((s) => s.getEffectiveRoster);
  const effectiveRoster = getEffectiveRoster();

  const agentTheme = (agentId: string): AgentTheme => {
    const agent = effectiveRoster.find((item) => item.id === agentId);
    return (agent?.theme ?? 'mario') as AgentTheme;
  };

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks],
  );

  const highlighted = isDropTarget && isValidTarget && isOver;
  const dimmed = isDropTarget && !isValidTarget;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-[200px] min-w-[180px] shrink-0 rounded-[var(--radius-md)] border bg-[hsl(var(--bg-app))] transition-colors duration-200',
        highlighted
          ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.04)]'
          : 'border-[hsl(var(--border-subtle))]',
        dimmed && 'opacity-50',
      )}
    >
      {/* Column header */}
      <div className="px-2.5 py-2 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--text-secondary))]">
          {STATUS_LABELS[status]}
        </span>
        <span className="text-[11px] font-normal tabular-nums text-[hsl(var(--text-tertiary))]">
          {tasks.length}
        </span>
      </div>

      {/* Card list */}
      <div className="p-1.5 flex flex-col gap-1.5 min-h-[80px] max-h-[380px] overflow-y-auto scrollbar-thin">
        {sorted.length === 0 ? (
          <div className="text-[11px] font-normal text-[hsl(var(--text-tertiary))] px-2 py-4 text-center">
            —
          </div>
        ) : (
          <SortableContext items={sorted.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {sorted.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                theme={agentTheme(task.agentId)}
                onClick={() => onCardClick(task.id)}
                onContextMenu={(e: React.MouseEvent) => onCardContextMenu(e, task)}
              />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  );
}
