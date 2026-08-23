// src/components/project/ProjectTreeItem.tsx
'use client';

import { cn } from '@/lib/utils';
import { StatusPill } from './StatusDot';
import { ProjectTreeItemActions } from './ProjectTreeItemActions';
import type { ProjectHealth } from './getProjectStatus';

const HEALTH_PROGRESS_COLOR: Record<ProjectHealth, string> = {
  empty: 'hsl(var(--border-subtle))',
  healthy: 'hsl(var(--status-done))',
  attention: 'hsl(var(--status-pending))',
  blocked: 'hsl(var(--status-blocked))',
};

export function ProjectTreeItem({
  title,
  goal,
  health,
  isSelected,
  taskCount,
  doneCount,
  blockerCount,
  onSelect,
  onDelete,
}: {
  title: string;
  goal: string;
  health: ProjectHealth;
  isSelected: boolean;
  taskCount: number;
  doneCount: number;
  blockerCount: number;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const progressPct = taskCount > 0 ? (doneCount / taskCount) * 100 : 0;
  const progressColor = HEALTH_PROGRESS_COLOR[health];

  return (
    <div className="group relative px-1">
      {isSelected && (
        <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-[hsl(var(--accent))]" />
      )}
      <button
        type="button"
        onClick={onSelect}
        title={goal || undefined}
        className={cn(
          'w-full text-left rounded-[var(--radius-md)] px-3 py-2 transition-colors duration-[var(--duration-fast)]',
          isSelected
            ? 'bg-[hsl(var(--accent-soft))]'
            : 'hover:bg-[hsl(var(--bg-card-hover))]'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusPill health={health} />
          <span
            className={cn(
              'text-[12px] text-[hsl(var(--text-primary))] truncate min-w-0',
              isSelected && 'font-medium'
            )}
          >
            {title}
          </span>
          {taskCount > 0 && (
            <span
              className="ml-auto shrink-0 text-[10px] tabular-nums text-[hsl(var(--text-tertiary))]"
              title={`任务完成 ${doneCount}/${taskCount}`}
            >
              任务 {doneCount}/{taskCount}
            </span>
          )}
        </div>

        {taskCount > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-[2px] rounded-full bg-[hsl(var(--bg-muted))] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%`, backgroundColor: progressColor }}
              />
            </div>
            {blockerCount > 0 && (
              <span className="text-[10px] tabular-nums text-[hsl(var(--status-blocked))] shrink-0">
                {blockerCount} 阻塞
              </span>
            )}
          </div>
        )}
      </button>
      <ProjectTreeItemActions onDelete={onDelete} />
    </div>
  );
}
