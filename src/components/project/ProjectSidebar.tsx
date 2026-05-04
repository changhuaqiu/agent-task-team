// src/components/project/ProjectSidebar.tsx
'use client';

import { useMemo, useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { ProjectCreateDialog } from './ProjectCreateDialog';
import { WorkspaceRootRow } from './WorkspaceRootRow';
import { ProjectTreeItem } from './ProjectTreeItem';
import { getProjectStatus } from './getProjectStatus';

export function ProjectSidebar() {
  const conversations = useTaskHubStore((s) => s.conversations);
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const setSelectedConversationId = useTaskHubStore((s) => s.setSelectedConversationId);
  const deleteConversation = useTaskHubStore((s) => s.deleteConversation);
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.blockersByConversation);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const statsByConversation = useMemo(() => {
    const taskStats = new Map<
      string,
      { total: number; blocked: number; inProgress: number; done: number }
    >();
    for (const t of tasks) {
      const prev = taskStats.get(t.conversationId) ?? { total: 0, blocked: 0, inProgress: 0, done: 0 };
      prev.total += 1;
      if (t.status === 'blocked') prev.blocked += 1;
      if (t.status === 'in_progress') prev.inProgress += 1;
      if (t.status === 'done') prev.done += 1;
      taskStats.set(t.conversationId, prev);
    }

    const openBlockers = new Map<string, number>();
    for (const [cid, list] of Object.entries(blockers)) {
      openBlockers.set(cid, (list || []).filter((b) => b.status === 'open').length);
    }

    return { taskStats, openBlockers };
  }, [tasks, blockers]);

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [conversations]
  );

  return (
    <>
      <aside className="w-[248px] shrink-0 h-full border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex flex-col">
        <WorkspaceRootRow
          conversations={conversations}
          expanded={isExpanded}
          onToggle={() => setIsExpanded((prev) => !prev)}
          onCreateProject={() => setIsCreateOpen(true)}
        />

        <div className="flex-1 overflow-y-auto py-1 flex flex-col gap-px scrollbar-thin">
          {isExpanded &&
            sorted.map((c) => {
              const stats = statsByConversation.taskStats.get(c.id) ?? {
                total: 0,
                blocked: 0,
                inProgress: 0,
                done: 0,
              };
              const openBlockerCount = statsByConversation.openBlockers.get(c.id) ?? 0;
              const health = getProjectStatus(stats);
              const isSelected = c.id === selectedConversationId;

              return (
                <ProjectTreeItem
                  key={c.id}
                  title={c.title}
                  goal={c.goal}
                  health={health}
                  isSelected={isSelected}
                  taskCount={stats.total}
                  blockerCount={openBlockerCount}
                  onSelect={() => setSelectedConversationId(c.id)}
                  onDelete={() => {
                    if (confirm(`删除项目「${c.title}」及其所有任务？`)) {
                      deleteConversation(c.id);
                    }
                  }}
                />
              );
            })}

          {isExpanded && sorted.length === 0 && (
            <div className="px-6 py-4 text-[var(--text-xs)] text-[hsl(var(--text-tertiary))]">
              还没有项目
            </div>
          )}
        </div>
      </aside>

      <ProjectCreateDialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </>
  );
}
