'use client';

import React, { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { type Task, type TaskStatus, STATUS_LABELS } from '@/store/taskHubStore';
import { AGENT_ROSTER, type AgentTheme } from '@/store/agentStore';
import { KanbanCard } from './KanbanCard';

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
        'w-[220px] shrink-0 rounded-md border bg-[hsl(var(--bg-app))] transition-colors',
        highlighted
          ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.04)]'
          : 'border-[hsl(var(--border-subtle))]',
        dimmed && 'opacity-50',
      )}
    >
      {/* Column header */}
      <div className="p-3 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[hsl(var(--text-secondary))]">
          {STATUS_LABELS[status]}
        </span>
        <span className="text-xs font-normal tabular-nums text-[hsl(var(--text-tertiary))]">
          {tasks.length}
        </span>
      </div>

      {/* Card list */}
      <div className="p-2 flex flex-col gap-2 max-h-[420px] overflow-y-auto scrollbar-thin">
        {sorted.length === 0 ? (
          <div className="text-xs font-normal text-[hsl(var(--text-tertiary))] p-2">
            空
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
