'use client';

import { GitBranch, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskCapsuleRef {
  id: string;
  title: string;
  status?: string;
  ownerAgentId?: string;
}

interface TaskCapsulesProps {
  tasks: TaskCapsuleRef[];
  onSelectTask?: (taskId: string) => void;
  className?: string;
}

const STATUS_LABELS: Record<string, string> = {
  proposed: '待确认',
  ready: '待处理',
  in_progress: '进行中',
  in_review: '评审中',
  done: '完成',
  blocked: '阻塞',
  cancelled: '取消',
};

function statusTone(status: string | undefined): string {
  switch (status) {
    case 'in_progress':
      return 'border-blue-400/60 text-blue-500 bg-blue-500/10';
    case 'in_review':
      return 'border-violet-400/60 text-violet-500 bg-violet-500/10';
    case 'done':
      return 'border-emerald-400/60 text-emerald-500 bg-emerald-500/10';
    case 'blocked':
      return 'border-amber-400/70 text-amber-600 bg-amber-500/10';
    case 'cancelled':
      return 'border-gray-400/60 text-gray-500 bg-gray-500/10';
    default:
      return 'border-[hsl(var(--border-subtle))] text-[hsl(var(--text-secondary))] bg-[hsl(var(--bg-muted))]';
  }
}

export function TaskCapsules({ tasks, onSelectTask, className }: TaskCapsulesProps) {
  if (tasks.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {tasks.map((task) => {
        const status = task.status ? (STATUS_LABELS[task.status] ?? task.status) : undefined;
        return (
          <button
            key={task.id}
            type="button"
            onClick={() => onSelectTask?.(task.id)}
            className={cn(
              'group inline-flex max-w-full items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[10px] font-bold transition-colors',
              'hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]',
              statusTone(task.status),
            )}
            aria-label={`${task.title} ${status ?? ''}`.trim()}
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">
              #{task.id} {task.title}
            </span>
            {status && (
              <span className="shrink-0 rounded-[2px] bg-[hsl(var(--bg-card))]/70 px-1 py-0.5 text-[9px]">
                {status}
              </span>
            )}
            {task.ownerAgentId && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] opacity-75">
                <UserRound className="h-2.5 w-2.5" />
                @{task.ownerAgentId}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
