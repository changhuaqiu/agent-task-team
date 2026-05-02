'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, STATUS_ORDER, type Task, type TaskStatus, useTaskHubStore } from '@/store/taskHubStore';
import { StatusBadge } from '@/components/task-hub/StatusBadge';

const MINI_STATUS_ORDER: TaskStatus[] = STATUS_ORDER;

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

export function MiniKanban() {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);

  const scoped = useMemo(() => {
    if (!selectedConversationId) return [];
    return tasks.filter((t) => t.conversationId === selectedConversationId);
  }, [selectedConversationId, tasks]);

  const phases = useTaskHubStore((s) => s.phases);
  const [activePhase, setActivePhase] = useState<string | null>(null);

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

  return (
    <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm overflow-hidden">
      <div className="p-4 border-b border-[hsl(var(--border-subtle))]">
        <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
          看板
        </div>
        <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-1">
          横向滚动查看各状态列，点卡片打开详情。
        </div>
      </div>

      {scopedPhases.length > 0 && (
        <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setActivePhase(null)}
            className={cn(
              'px-2 py-1 text-[10px] font-bold rounded-[2px] border-2 transition-all',
              activePhase === null
                ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))] shadow-[1px_1px_0px_hsl(var(--accent)/0.4)]'
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
                  'px-2 py-1 text-[10px] font-bold rounded-[2px] border-2 transition-all',
                  activePhase === phase.id
                    ? 'bg-[hsl(var(--accent))] text-white border-[hsl(var(--accent))] shadow-[1px_1px_0px_hsl(var(--accent)/0.4)]'
                    : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))] hover:border-[hsl(var(--text-primary))]'
                )}
              >
                {phase.title} ({count})
              </button>
            );
          })}
        </div>
      )}
      <div className="p-3 overflow-x-auto scrollbar-thin">
        <div className="flex gap-3 w-max items-start">
          {MINI_STATUS_ORDER.map((status) => {
            const col = grouped[status] || [];
            return (
              <div
                key={status}
                className="w-[220px] shrink-0 rounded-[var(--radius-lg)] border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))]"
              >
                <div className="p-3 border-b border-[hsl(var(--border-subtle))] flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-[hsl(var(--text-secondary))]">
                    {STATUS_LABELS[status]}
                  </div>
                  <div className="text-[11px] font-bold tabular-nums text-[hsl(var(--text-tertiary))]">
                    {col.length}
                  </div>
                </div>

                <div className="p-2 flex flex-col gap-2 max-h-[420px] overflow-y-auto scrollbar-thin">
                  {col.length === 0 ? (
                    <div className="text-[11px] text-[hsl(var(--text-tertiary))] font-semibold p-2">
                      空
                    </div>
                  ) : (
                    col
                      .slice()
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTaskId(t.id)}
                          className={cn(
                            'text-left rounded-[var(--radius-md)] border px-3 py-2 transition-colors',
                            'bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-card-hover))]',
                            'border-[hsl(var(--border))]'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono font-bold text-[hsl(var(--text-tertiary))] tracking-wider">
                                {t.id}
                              </div>
                              <div className="text-[12px] font-semibold text-[hsl(var(--text-primary))] line-clamp-2 mt-0.5">
                                {t.title}
                              </div>
                              <div className="text-[10px] text-[hsl(var(--text-tertiary))] mt-1">
                                @{t.agentId}
                              </div>
                            </div>
                            <StatusBadge status={t.status} />
                          </div>
                        </button>
                      ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

