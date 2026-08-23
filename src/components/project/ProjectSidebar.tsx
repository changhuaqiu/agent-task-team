'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutDashboard, Search } from 'lucide-react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { ProjectTreeItem } from './ProjectTreeItem';
import { WorkspaceSection } from './WorkspaceSection';
import { getProjectStatus } from './getProjectStatus';
import { cn } from '@/lib/utils';
import { createWorkspaceCommandIdempotencyKey, workspaceCommandGateway } from '@/lib/workspace-command';
import type { DeliveryNavigationItem, ProjectNavigationGroup } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

export type WorkspaceSurface = 'overview' | 'delivery';

export function ProjectSidebar({
  navigation,
  activeSurface,
  selectedDeliveryId,
  onOpenOverview,
  onSelectDelivery,
}: {
  navigation: ProjectNavigationGroup[];
  activeSurface: WorkspaceSurface;
  selectedDeliveryId: string | null;
  onOpenOverview: () => void;
  onSelectDelivery: (deliveryId: string) => void;
}) {
  const deleteConversation = useTaskHubStore((state) => state.deleteConversation);
  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [deletedNotice, setDeletedNotice] = useState<DeliveryNavigationItem | null>(null);
  const deleteNoticeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const deliveryCount = navigation.reduce((count, project) => count + project.deliveries.length, 0);

  useEffect(() => () => {
    if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);
  }, []);

  const filteredNavigation = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return navigation;
    return navigation.flatMap((project) => {
      const projectMatch = project.name.toLowerCase().includes(query)
        || project.fullPath?.toLowerCase().includes(query);
      const deliveries = projectMatch
        ? project.deliveries
        : project.deliveries.filter((delivery) => (
          delivery.title.toLowerCase().includes(query)
          || delivery.goal.toLowerCase().includes(query)
        ));
      return deliveries.length > 0 ? [{ ...project, deliveries }] : [];
    });
  }, [navigation, searchQuery]);

  async function handleDelete(delivery: DeliveryNavigationItem) {
    const receipt = await workspaceCommandGateway.submit({
      type: 'delivery.delete',
      idempotencyKey: createWorkspaceCommandIdempotencyKey(`delivery.delete:${delivery.id}`),
      deliveryId: delivery.id,
      projectPath: delivery.projectPath,
      actor: { type: 'user', id: 'webui:local-user' },
      issuedAt: new Date().toISOString(),
    }).catch(() => undefined);
    const deleted = receipt?.status === 'accepted'
      ? await deleteConversation(delivery.id, { persist: false })
      : false;
    if (!deleted) {
      setDeletedNotice(null);
      return;
    }
    setDeletedNotice(delivery);
    if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);
    deleteNoticeTimerRef.current = setTimeout(() => setDeletedNotice(null), 5000);
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] transition-[width] duration-200',
        isExpanded ? 'w-[260px]' : 'w-14',
      )}
      data-testid="delivery-sidebar"
    >
      <div className="flex h-14 shrink-0 items-center border-b border-[hsl(var(--border-subtle))] px-3">
        {isExpanded ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[hsl(var(--text-primary))]">工作区</div>
              <div className="mt-0.5 truncate text-xs text-[hsl(var(--text-tertiary))]">
                {navigation.length} 个项目 · {deliveryCount} 个交付
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]"
              aria-label="收起工作区侧栏"
            >
              <ChevronLeft className="size-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="mx-auto flex size-8 items-center justify-center rounded-md text-[hsl(var(--text-tertiary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]"
            aria-label="展开工作区侧栏"
          >
            <ChevronRight className="size-4" />
          </button>
        )}
      </div>

      {isExpanded ? (
        <>
          <div className="shrink-0 px-2 py-2">
            <button
              type="button"
              onClick={onOpenOverview}
              className={cn(
                'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors',
                activeSurface === 'overview'
                  ? 'bg-[hsl(var(--accent-soft))] font-medium text-[hsl(var(--text-primary))]'
                  : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card-hover))]',
              )}
              aria-current={activeSurface === 'overview' ? 'page' : undefined}
            >
              <LayoutDashboard className="size-4 shrink-0" />
              <span>交付总览</span>
            </button>
          </div>

          {(deliveryCount >= 5 || navigation.length >= 4) && (
            <div className="shrink-0 px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--text-tertiary))]" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索项目或交付…"
                  aria-label="搜索项目或交付"
                  className="h-8 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] pl-8 pr-2 text-xs text-[hsl(var(--text-primary))] outline-none placeholder:text-[hsl(var(--text-tertiary))] focus:border-[hsl(var(--accent))]"
                />
              </div>
            </div>
          )}

          <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--text-tertiary))]">项目</div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-3 scrollbar-thin">
            {deletedNotice && (
              <div className="mx-3 mb-2 rounded-md bg-[hsl(var(--status-pending-bg))] px-3 py-2 text-xs text-[hsl(var(--text-secondary))]">
                已删除交付「{deletedNotice.title}」
              </div>
            )}
            {filteredNavigation.map((project) => (
              <WorkspaceSection
                key={project.key}
                name={project.name}
                fullPath={project.fullPath}
                count={project.deliveries.length}
                collapsed={collapsedProjects[project.key] === true && !(
                  activeSurface === 'delivery'
                  && project.deliveries.some((delivery) => delivery.id === selectedDeliveryId)
                )}
                onToggle={() => setCollapsedProjects((current) => ({
                  ...current,
                  [project.key]: !current[project.key],
                }))}
              >
                {project.deliveries.map((delivery) => (
                  <ProjectTreeItem
                    key={delivery.id}
                    title={delivery.title}
                    goal={delivery.goal}
                    health={getProjectStatus(delivery.work)}
                    isSelected={activeSurface === 'delivery' && delivery.id === selectedDeliveryId}
                    taskCount={delivery.work.total}
                    doneCount={delivery.work.done}
                    blockerCount={delivery.openBlockerCount}
                    onSelect={() => onSelectDelivery(delivery.id)}
                    onDelete={() => void handleDelete(delivery)}
                  />
                ))}
              </WorkspaceSection>
            ))}
            {filteredNavigation.length === 0 && searchQuery && (
              <div className="px-4 py-6 text-center text-xs text-[hsl(var(--text-tertiary))]">没有匹配的项目或交付</div>
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 py-2">
          <button
            type="button"
            onClick={onOpenOverview}
            title="交付总览"
            aria-label="交付总览"
            className={cn(
              'flex size-10 items-center justify-center rounded-lg transition-colors',
              activeSurface === 'overview'
                ? 'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card-hover))]',
            )}
          >
            <LayoutDashboard className="size-4" />
          </button>
          {selectedDeliveryId && (
            <button
              type="button"
              onClick={() => onSelectDelivery(selectedDeliveryId)}
              title="当前交付"
              aria-label="当前交付"
              className={cn(
                'flex size-10 items-center justify-center rounded-lg text-xs font-medium transition-colors',
                activeSurface === 'delivery'
                  ? 'bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]'
                  : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-card-hover))]',
              )}
            >
              {Array.from(navigation.flatMap((project) => project.deliveries).find((delivery) => delivery.id === selectedDeliveryId)?.title ?? '交')[0]}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
