'use client';

import { useMemo } from 'react';
import { useTaskHubStore, type Task } from '@/store/taskHubStore';
import { MiniKanban } from './MiniKanban';
import { cn } from '@/lib/utils';

type NextItem = {
  label: string;
  taskId?: string;
};

function buildNextItems(tasks: Task[]): NextItem[] {
  const items: NextItem[] = [];

  for (const t of tasks) {
    if (t.status === 'blocked') items.push({ label: `解除阻塞：${t.id} ${t.title}`, taskId: t.id });
  }
  for (const t of tasks) {
    if (t.status === 'in_review') items.push({ label: `等待评审：${t.id} ${t.title}`, taskId: t.id });
  }
  for (const t of tasks) {
    if (t.status === 'pending') items.push({ label: `可开始：${t.id} ${t.title}`, taskId: t.id });
  }

  return items.slice(0, 6);
}

export function ProjectRightPanel() {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.getOpenBlockersForSelectedConversation());
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);

  const scoped = useMemo(() => {
    if (!selectedConversationId) return [];
    return tasks.filter((t) => t.conversationId === selectedConversationId);
  }, [selectedConversationId, tasks]);

  const nextItems = useMemo(() => buildNextItems(scoped), [scoped]);
  const openBlockers = useMemo(() => blockers.filter((b) => b.status === 'open'), [blockers]);

  return (
    <aside className="w-[320px] shrink-0 h-full border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] flex flex-col">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-4">
        <MiniKanban />

        <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
          <div className="p-4 border-b border-[hsl(var(--border-subtle))]">
            <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
              代办
            </div>
            <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-1">
              从任务状态推导的下一步清单。
            </div>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {nextItems.length === 0 ? (
              <div className="text-[12px] text-[hsl(var(--text-tertiary))] font-semibold p-2">
                暂无代办。
              </div>
            ) : (
              nextItems.map((it, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => it.taskId && setSelectedTaskId(it.taskId)}
                  className={cn(
                    'text-left rounded-[var(--radius-md)] border px-3 py-2 transition-colors',
                    'bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))]',
                    'border-[hsl(var(--border-subtle))]'
                  )}
                >
                  <div className="text-[12px] font-semibold text-[hsl(var(--text-primary))]">
                    {it.label}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
          <div className="p-4 border-b border-[hsl(var(--border-subtle))]">
            <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--danger))]">
              风险 / 阻塞
            </div>
            <div className="text-[12px] text-[hsl(var(--text-tertiary))] mt-1">
              {openBlockers.length} 个未解决
            </div>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {openBlockers.length === 0 ? (
              <div className="text-[12px] text-[hsl(var(--text-tertiary))] font-semibold p-2">
                暂无风险项。
              </div>
            ) : (
              openBlockers.slice(0, 6).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedTaskId(b.taskId)}
                  className={cn(
                    'text-left rounded-[var(--radius-md)] border px-3 py-2 transition-colors',
                    'bg-[hsl(var(--status-rejected-bg))] hover:bg-[hsl(var(--bg-card-hover))]',
                    'border-[hsl(var(--status-rejected-border))]'
                  )}
                >
                  <div className="text-[12px] font-semibold text-[hsl(var(--text-primary))]">
                    {b.taskId} · {b.reasonSummary}
                  </div>
                  {b.evidenceRef && (
                    <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">
                      {b.evidenceRef}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
