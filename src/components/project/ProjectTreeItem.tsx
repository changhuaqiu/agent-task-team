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
