'use client';

import { FileText, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { buildTaskTimeline, type TaskGraphApiView, type TaskTimelineItem } from '@/lib/taskGraphView';
import { cn } from '@/lib/utils';

interface TaskGraphTimelineProps {
  graph: TaskGraphApiView | null | undefined;
  taskId: string;
  className?: string;
}

function iconForType(type: TaskTimelineItem['type']) {
  switch (type) {
    case 'artifact':
      return FileText;
    case 'message':
      return MessageSquare;
    case 'proof':
      return ShieldCheck;
    default:
      return Sparkles;
  }
}

export function TaskGraphTimeline({ graph, taskId, className }: TaskGraphTimelineProps) {
  const items = buildTaskTimeline(graph, taskId);

  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
          任务时间线
        </label>
        <span className="text-[10px] text-[hsl(var(--text-tertiary))] tabular-nums">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[var(--radius-sm)] border border-dashed border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] p-3 text-center text-xs text-[hsl(var(--text-tertiary))]">
          还没有结构化任务动态
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const Icon = iconForType(item.type);
            return (
              <div
                key={item.id}
                className="rounded-[var(--radius-sm)] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] p-2.5"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[hsl(var(--text-primary))]">
                    {item.title}
                  </span>
                  <time className="shrink-0 text-[9px] text-[hsl(var(--text-tertiary))]">
                    {new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </time>
                </div>
                {(item.description || item.actorId) && (
                  <div className="mt-1 flex flex-wrap gap-1.5 pl-5 text-[10px] text-[hsl(var(--text-secondary))]">
                    {item.actorId && <span>@{item.actorId}</span>}
                    {item.description && <span className="line-clamp-2">{item.description}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
