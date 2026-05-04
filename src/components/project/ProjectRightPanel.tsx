'use client';

import { useMemo, useState } from 'react';
import { useTaskHubStore, type Task } from '@/store/taskHubStore';
import { MiniKanban } from './MiniKanban';
import { cn } from '@/lib/utils';
import { PanelRightOpen, PanelRightClose, X } from 'lucide-react';

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

  const [open, setOpen] = useState(false);

  const scoped = useMemo(() => {
    if (!selectedConversationId) return [];
    return tasks.filter((t) => t.conversationId === selectedConversationId);
  }, [selectedConversationId, tasks]);

  const nextItems = useMemo(() => buildNextItems(scoped), [scoped]);
  const openBlockers = useMemo(() => blockers.filter((b) => b.status === 'open'), [blockers]);

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 p-2 rounded-l-md border border-r-0 border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-card-hover))] transition-colors text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]"
        title={open ? '收起面板' : '展开面板'}
      >
        {open ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
      </button>

      {/* Drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/10 z-30"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-in drawer */}
      <aside
        className={cn(
          'fixed top-0 right-0 h-full w-[380px] z-40 flex flex-col',
          'bg-[hsl(var(--bg-app))] border-l border-[hsl(var(--border))] shadow-lg',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        )}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between p-3 border-b border-[hsl(var(--border-subtle))]">
          <div className="text-xs font-medium tracking-wider uppercase text-[hsl(var(--text-tertiary))]">
            任务面板
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded-sm text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-4">
          <MiniKanban expanded={true} />

          {/* Next actions */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
            <div className="p-3 border-b border-[hsl(var(--border-subtle))]">
              <div className="text-xs font-medium tracking-wider uppercase text-[hsl(var(--text-tertiary))]">
                代办
              </div>
            </div>
            <div className="p-3 flex flex-col gap-2">
              {nextItems.length === 0 ? (
                <div className="text-xs text-[hsl(var(--text-tertiary))] p-2">
                  暂无代办。
                </div>
              ) : (
                nextItems.map((it, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => it.taskId && setSelectedTaskId(it.taskId)}
                    className={cn(
                      'text-left rounded-sm border px-3 py-2 transition-colors',
                      'bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))]',
                      'border-[hsl(var(--border-subtle))]'
                    )}
                  >
                    <div className="text-xs text-[hsl(var(--text-primary))]">
                      {it.label}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Blockers */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
            <div className="p-3 border-b border-[hsl(var(--border-subtle))]">
              <div className="text-xs font-medium tracking-wider uppercase text-[hsl(var(--danger))]">
                风险 / 阻塞
              </div>
              <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">
                {openBlockers.length} 个未解决
              </div>
            </div>
            <div className="p-3 flex flex-col gap-2">
              {openBlockers.length === 0 ? (
                <div className="text-xs text-[hsl(var(--text-tertiary))] p-2">
                  暂无风险项。
                </div>
              ) : (
                openBlockers.slice(0, 6).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedTaskId(b.taskId)}
                    className={cn(
                      'text-left rounded-sm border px-3 py-2 transition-colors',
                      'bg-[hsl(var(--status-rejected-bg))] hover:bg-[hsl(var(--bg-card-hover))]',
                      'border-[hsl(var(--status-rejected-border))]'
                    )}
                  >
                    <div className="text-xs text-[hsl(var(--text-primary))]">
                      {b.taskId} · {b.reasonSummary}
                    </div>
                    {b.evidenceRef && (
                      <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">
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
    </>
  );
}
