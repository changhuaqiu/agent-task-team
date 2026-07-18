// src/components/project/ProjectSidebar.tsx
'use client';

import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTaskHubStore, type Conversation } from '@/store/taskHubStore';
import { ProjectCreateDialog } from './ProjectCreateDialog';
import { WorkspaceSection } from './WorkspaceSection';
import { ProjectTreeItem } from './ProjectTreeItem';
import { getProjectStatus } from './getProjectStatus';
import { cn } from '@/lib/utils';

interface WorkspaceGroup {
  key: string;
  name: string;
  fullPath: string | null;
  conversations: Conversation[];
}

function extractFolderName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const last = trimmed.split('/').pop() || trimmed;
  return last || path;
}

function groupByWorkspace(conversations: Conversation[]): WorkspaceGroup[] {
  const map = new Map<string, Conversation[]>();
  const ungrouped: Conversation[] = [];

  for (const c of conversations) {
    if (c.projectPath) {
      const existing = map.get(c.projectPath);
      if (existing) {
        existing.push(c);
      } else {
        map.set(c.projectPath, [c]);
      }
    } else {
      ungrouped.push(c);
    }
  }

  const groups: WorkspaceGroup[] = [];
  for (const [path, convs] of map) {
    groups.push({
      key: path,
      name: extractFolderName(path),
      fullPath: path,
      conversations: convs,
    });
  }

  // Sort groups by most recent conversation updatedAt
  groups.sort((a, b) => {
    const aLatest = a.conversations.reduce((max, c) => (c.updatedAt > max ? c.updatedAt : max), '');
    const bLatest = b.conversations.reduce((max, c) => (c.updatedAt > max ? c.updatedAt : max), '');
    return bLatest.localeCompare(aLatest);
  });

  if (ungrouped.length > 0) {
    groups.push({
      key: '__ungrouped__',
      name: '未分类',
      fullPath: null,
      conversations: ungrouped,
    });
  }

  return groups;
}

export function ProjectSidebar() {
  const conversations = useTaskHubStore((s) => s.conversations);
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const setSelectedConversationId = useTaskHubStore((s) => s.setSelectedConversationId);
  const deleteConversation = useTaskHubStore((s) => s.deleteConversation);
  const restoreConversation = useTaskHubStore((s) => s.restoreConversation);
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.blockersByConversation);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [recentlyDeleted, setRecentlyDeleted] = useState<{ id: string; data: Conversation } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

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

  const workspaceGroups = useMemo(() => groupByWorkspace(sorted), [sorted]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return workspaceGroups;
    const q = searchQuery.trim().toLowerCase();
    return workspaceGroups
      .map((group) => ({
        ...group,
        conversations: group.conversations.filter(
          (c) => c.title.toLowerCase().includes(q) || (c.goal && c.goal.toLowerCase().includes(q))
        ),
      }))
      .filter((group) => group.conversations.length > 0);
  }, [workspaceGroups, searchQuery]);

  const showSearch = sorted.length >= 5;

  function handleDelete(id: string) {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    deleteConversation(id);
    setRecentlyDeleted({ id, data: conv });
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setRecentlyDeleted(null), 5000);
  }

  function handleUndo() {
    if (!recentlyDeleted) return;
    restoreConversation(recentlyDeleted.data);
    setRecentlyDeleted(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
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
                项目
              </span>
              <span className="text-[11px] text-[hsl(var(--text-tertiary))] tabular-nums">
                {conversations.length}
              </span>
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="shrink-0 ml-auto p-1 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
                title="新建项目"
              >
                <span className="text-[13px]">+</span>
              </button>
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
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-card-hover))] transition-colors"
                title="新建项目"
              >
                <span className="text-[13px]">+</span>
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
                placeholder="搜索项目..."
                className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-[hsl(var(--bg-app))] border border-[hsl(var(--border-subtle))] rounded-[var(--radius-md)] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-tertiary))] focus:outline-none focus:border-[hsl(var(--accent))] transition-colors"
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {isExpanded ? (
            <>
              {/* Undo bar */}
              {recentlyDeleted && (
                <div className="mx-3 my-1 px-3 py-2 rounded-[var(--radius-md)] bg-[hsl(var(--status-pending-bg))] border border-[hsl(var(--status-pending-border))] flex items-center gap-2 text-[11px]">
                  <span className="text-[hsl(var(--text-secondary))] truncate min-w-0">
                    已删除「{recentlyDeleted.data.title}」
                  </span>
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="text-[hsl(var(--accent))] font-semibold hover:underline shrink-0"
                  >
                    撤销
                  </button>
                </div>
              )}

              {filteredGroups.map((group) => (
                <WorkspaceSection
                  key={group.key}
                  name={group.name}
                  fullPath={group.fullPath}
                  count={group.conversations.length}
                  collapsed={collapsedGroups.has(group.key)}
                  onToggle={() => toggleGroup(group.key)}
                >
                  {group.conversations.map((c) => {
                    const stats = statsByConversation.taskStats.get(c.id) ?? { total: 0, blocked: 0, inProgress: 0, done: 0 };
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

              {sorted.length === 0 && (
                <div className="px-6 py-4 text-[11px] text-[hsl(var(--text-tertiary))]">
                  还没有项目
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
                  {group.conversations.map((c) => {
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

      <ProjectCreateDialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </>
  );
}
