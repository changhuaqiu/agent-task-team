// src/components/project/ProjectSidebar.tsx
'use client';

import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { WorkspaceSection } from './WorkspaceSection';
import { ProjectTreeItem } from './ProjectTreeItem';
import { getProjectStatus } from './getProjectStatus';
import { cn } from '@/lib/utils';
import { createWorkspaceCommandIdempotencyKey, workspaceCommandGateway } from '@/lib/workspace-command';
import type { DeliveryNavigationItem, ProjectNavigationGroup } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

export function ProjectSidebar({ navigation }: { navigation: ProjectNavigationGroup[] }) {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const setSelectedConversationId = useTaskHubStore((s) => s.setSelectedConversationId);
  const deleteConversation = useTaskHubStore((s) => s.deleteConversation);

  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [deletedNotice, setDeletedNotice] = useState<DeliveryNavigationItem | null>(null);
  const deleteNoticeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const deliveries = useMemo(() => navigation.flatMap((group) => group.deliveries), [navigation]);
  const workspaceGroups = navigation;

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return workspaceGroups;
    const q = searchQuery.trim().toLowerCase();
    return workspaceGroups
      .map((group) => {
        const groupMatches = group.name.toLowerCase().includes(q)
          || group.fullPath?.toLowerCase().includes(q);
        return {
          ...group,
          deliveries: groupMatches
            ? group.deliveries
            : group.deliveries.filter(
              (c) => c.title.toLowerCase().includes(q) || (c.goal && c.goal.toLowerCase().includes(q)),
            ),
        };
      })
      .filter((group) => group.deliveries.length > 0);
  }, [workspaceGroups, searchQuery]);

  const showSearch = deliveries.length >= 5;

  async function handleDelete(id: string) {
    const conv = deliveries.find((item) => item.id === id);
    if (!conv) return;
    const receipt = await workspaceCommandGateway.submit({
      type: 'delivery.delete',
      idempotencyKey: createWorkspaceCommandIdempotencyKey(`delivery.delete:${id}`),
      deliveryId: id,
      projectPath: conv.projectPath,
      actor: { type: 'user', id: 'webui:local-user' },
      issuedAt: new Date().toISOString(),
    }).catch(() => undefined);
    const deleted = receipt?.status === 'accepted'
      ? await deleteConversation(id, { persist: false })
      : false;
    if (!deleted) {
      setDeletedNotice(null);
      return;
    }
    setDeletedNotice(conv);
    if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);
    deleteNoticeTimerRef.current = setTimeout(() => setDeletedNotice(null), 5000);
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleCollapsedSelect(id: string) {
    setSelectedConversationId(id);
    setIsExpanded(true);
  }

  return (
    <>
      <aside
        className={cn(
          'shrink-0 h-full border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex flex-col transition-all duration-200',
          isExpanded ? 'w-[248px]' : 'w-[56px]'
        )}
      >
        {/* Global header */}
        <div className="px-3 py-3 border-b border-[hsl(var(--border-subtle))]">
          {isExpanded ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
                title="收起侧栏"
              >
                <span className="text-[10px] font-bold tracking-wider uppercase">◂</span>
              </button>
              <span className="text-[13px] font-medium text-[hsl(var(--text-primary))] truncate min-w-0">
                项目与交付
              </span>
              <span className="text-[11px] text-[hsl(var(--text-tertiary))] tabular-nums">
                {deliveries.length}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-card-hover))] transition-colors"
                title="展开侧栏"
              >
                <span className="text-[10px]">▸</span>
              </button>
            </div>
          )}
        </div>

        {/* Search box */}
        {isExpanded && showSearch && (
          <div className="px-3 py-2 border-b border-[hsl(var(--border-subtle))]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目或交付..."
                className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-[hsl(var(--bg-app))] border border-[hsl(var(--border-subtle))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] focus:outline-none focus:border-[hsl(var(--accent))] transition-colors"
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {isExpanded ? (
            <>
              {deletedNotice && (
                <div className="mx-3 my-1 px-3 py-2 rounded-[var(--radius-md)] bg-[hsl(var(--status-pending-bg))] border border-[hsl(var(--status-pending-border))] flex items-center gap-2 text-[11px]">
                  <span className="text-[hsl(var(--text-secondary))] truncate min-w-0">
                    已删除「{deletedNotice.title}」
                  </span>
                </div>
              )}

              {filteredGroups.map((group) => (
                <WorkspaceSection
                  key={group.key}
                  name={group.name}
                  fullPath={group.fullPath}
                  count={group.deliveries.length}
                  collapsed={collapsedGroups.has(group.key)}
                  onToggle={() => toggleGroup(group.key)}
                >
                  {group.deliveries.map((c) => {
                    const stats = c.work;
                    const openBlockerCount = c.openAttentionCount;
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
                        doneCount={stats.done}
                        blockerCount={openBlockerCount}
                        onSelect={() => setSelectedConversationId(c.id)}
                        onDelete={() => handleDelete(c.id)}
                      />
                    );
                  })}
                </WorkspaceSection>
              ))}

              {filteredGroups.length === 0 && searchQuery && (
                <div className="px-6 py-4 text-[11px] text-[hsl(var(--text-tertiary))] text-center">
                  未找到匹配「{searchQuery}」的项目
                </div>
              )}

              {deliveries.length === 0 && (
                <div className="px-6 py-4 text-[11px] text-[hsl(var(--text-tertiary))]">
                  还没有交付
                </div>
              )}
            </>
          ) : (
            /* Collapsed icon mode — group by workspace with visual separator */
            <div className="flex flex-col gap-1 py-2">
              {workspaceGroups.map((group) => (
                <div key={group.key} className="flex flex-col items-center gap-1">
                  {workspaceGroups.length > 1 && (
                    <div className="w-6 h-px bg-[hsl(var(--border-subtle))] my-0.5" title={group.name} />
                  )}
                  {group.deliveries.map((c) => {
                    const isSelected = c.id === selectedConversationId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        title={`${group.name} / ${c.title}`}
                        onClick={() => handleCollapsedSelect(c.id)}
                        className={cn(
                          'w-10 h-10 rounded-[var(--radius-md)] flex items-center justify-center text-[12px] font-bold transition-colors',
                          isSelected
                            ? 'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                            : 'hover:bg-[hsl(var(--bg-card-hover))] text-[hsl(var(--text-secondary))]'
                        )}
                      >
                        {c.title.charAt(0).toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

    </>
  );
}
