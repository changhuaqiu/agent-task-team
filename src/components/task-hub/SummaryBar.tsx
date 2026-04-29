'use client';

import { useMemo } from 'react';
import { type TaskStatus, STATUS_LABELS, useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';

const statOrder: TaskStatus[] = [
  'blocked',
  'rejected',
  'in_progress',
  'in_review',
  'pending',
  'done',
];

const dotColors: Record<TaskStatus, string> = {
  blocked:     'bg-[hsl(var(--status-blocked))]',
  rejected:    'bg-[hsl(var(--status-rejected))]',
  in_progress: 'bg-[hsl(var(--status-progress))] animate-pulse-dot',
  in_review:   'bg-[hsl(var(--status-review))]',
  pending:     'bg-[hsl(var(--status-pending))]',
  done:        'bg-[hsl(var(--status-done))]',
};

export function SummaryBar() {
  const tasks = useTaskHubStore((s) => s.tasks);

  const counts = useMemo(() => {
    const map: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      rejected: 0,
      blocked: 0,
    };
    for (const t of tasks) map[t.status]++;
    return map;
  }, [tasks]);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {statOrder.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', dotColors[s])} />
          <span className="text-[11px] text-[hsl(var(--text-secondary))] font-medium">
            {STATUS_LABELS[s]}
          </span>
          <span className="text-[11px] font-bold text-[hsl(var(--text-primary))] tabular-nums">
            {counts[s]}
          </span>
        </div>
      ))}
      <div className="ml-auto text-[11px] text-[hsl(var(--text-tertiary))] font-medium tabular-nums">
        {tasks.length} total
      </div>
    </div>
  );
}
