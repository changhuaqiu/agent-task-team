'use client';

import { useMemo, useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { ProjectCreateDialog } from './ProjectCreateDialog';

export function ProjectSidebar() {
  const conversations = useTaskHubStore((s) => s.conversations);
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const setSelectedConversationId = useTaskHubStore((s) => s.setSelectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.blockersByConversation);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const statsByConversation = useMemo(() => {
    const taskCounts = new Map<string, { total: number; blocked: number }>();
    for (const t of tasks) {
      const prev = taskCounts.get(t.conversationId) ?? { total: 0, blocked: 0 };
      prev.total += 1;
      if (t.status === 'blocked') prev.blocked += 1;
      taskCounts.set(t.conversationId, prev);
    }
    const openBlockers = new Map<string, number>();
    for (const [cid, list] of Object.entries(blockers)) {
      openBlockers.set(cid, (list || []).filter((b) => b.status === 'open').length);
    }
    return { taskCounts, openBlockers };
  }, [tasks, blockers]);

  const sorted = useMemo(() => {
    return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [conversations]);

  return (
    <>
      <aside className="w-[248px] shrink-0 h-full border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex flex-col">
        <div className="p-4 border-b border-[hsl(var(--border-subtle))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                项目
              </div>
              <div className="text-[13px] font-semibold text-[hsl(var(--text-primary))] mt-1">
                选择当前需求
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card-hover))] hover:text-[hsl(var(--text-primary))]"
              aria-label="新建项目"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-[hsl(var(--border-subtle))]">
          <div className="text-[11px] text-[hsl(var(--text-tertiary))] font-medium">
            点击项目切换上下文，点击右上角 `+` 新建项目。
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 scrollbar-thin">
          {sorted.length === 0 ? (
            <div className="text-[12px] text-[hsl(var(--text-tertiary))] font-semibold p-3">
              还没有项目。点击右上角 `+` 创建一个项目。
            </div>
          ) : (
            sorted.map((c) => {
              const counts = statsByConversation.taskCounts.get(c.id) ?? { total: 0, blocked: 0 };
              const openBlockerCount = statsByConversation.openBlockers.get(c.id) ?? 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedConversationId(c.id)}
                  className={cn(
                    'text-left rounded-[var(--radius-lg)] border p-3 transition-colors',
                    c.id === selectedConversationId
                      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent-soft))]'
                      : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))]'
                  )}
                >
                  <div className="text-[12px] font-semibold text-[hsl(var(--text-primary))] truncate">
                    {c.title}
                  </div>
                  <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1 line-clamp-2">
                    {c.goal}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-[hsl(var(--text-tertiary))]">
                    <span className="tabular-nums">{counts.total} 任务</span>
                    {openBlockerCount > 0 && (
                      <span className="tabular-nums text-[hsl(var(--danger))]">
                        {openBlockerCount} 阻塞
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <ProjectCreateDialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </>
  );
}
