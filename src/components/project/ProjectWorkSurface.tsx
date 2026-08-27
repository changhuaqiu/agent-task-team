'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Eye,
  FileCheck2,
  Pause,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import type { Conversation, WorkspaceProject } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Task, TaskStatus } from '@/store/taskStore';
import type { ProjectArtifactLedgerItem } from '@/shared/project-artifact-ledger';

const GROUPS: Array<{
  status: TaskStatus;
  label: string;
  icon: typeof Circle;
  iconClassName: string;
}> = [
  { status: 'blocked', label: '需要处理', icon: AlertCircle, iconClassName: 'text-[hsl(var(--status-blocked))]' },
  { status: 'in_progress', label: '进行中', icon: Clock3, iconClassName: 'text-[hsl(var(--status-progress))]' },
  { status: 'in_review', label: '评审中', icon: Eye, iconClassName: 'text-[hsl(var(--status-review))]' },
  { status: 'ready', label: '待处理', icon: Circle, iconClassName: 'text-[hsl(var(--text-tertiary))]' },
  { status: 'proposed', label: '待确认', icon: Sparkles, iconClassName: 'text-[hsl(var(--text-tertiary))]' },
  { status: 'done', label: '已完成', icon: Check, iconClassName: 'text-[hsl(var(--status-done))]' },
  { status: 'cancelled', label: '已取消', icon: X, iconClassName: 'text-[hsl(var(--text-tertiary))]' },
];

const CATEGORY_LABELS: Record<NonNullable<Task['category']>, string> = {
  issue: 'Issue',
  change_request: '变更',
  improvement: '改进',
};

export function ProjectWorkSurface({
  project,
  conversations,
  tasks,
  onCreate,
}: {
  project: WorkspaceProject;
  conversations: Conversation[];
  tasks: Task[];
  blockers: unknown;
  onCreate?: () => void;
}) {
  const [artifactCountsByWork, setArtifactCountsByWork] = useState<Record<string, number>>({});
  const {
    agentRoster,
    selectedConversationId,
    selectedTaskId,
    openTask,
  } = useTaskHubStore(useShallow((state) => ({
    agentRoster: state.agentRoster,
    selectedConversationId: state.selectedConversationId,
    selectedTaskId: state.selectedTaskId,
    openTask: state.openTask,
  })));
  const scopedTasks = useMemo(() => {
    const conversationIds = new Set(
      conversations
        .filter((conversation) => conversation.projectId === project.id)
        .map((conversation) => conversation.id),
    );
    conversationIds.add(project.workspaceConversationId);
    return tasks
      .filter((task) => conversationIds.has(task.conversationId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [conversations, project.id, project.workspaceConversationId, tasks]);
  const agentById = useMemo(
    () => new Map(agentRoster.map((agent) => [agent.id, agent])),
    [agentRoster],
  );
  const groupedTasks = GROUPS.map((group) => ({
    ...group,
    tasks: scopedTasks.filter((task) => task.status === group.status),
  })).filter((group) => group.tasks.length > 0);
  const openCount = scopedTasks.filter(
    (task) => task.status !== 'done' && task.status !== 'cancelled',
  ).length;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/artifacts?projectId=${encodeURIComponent(project.id)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json() as { artifacts?: ProjectArtifactLedgerItem[] };
        const next: Record<string, number> = {};
        for (const artifact of payload.artifacts ?? []) {
          if (artifact.status !== 'registered' || !artifact.workId) continue;
          next[artifact.workId] = (next[artifact.workId] ?? 0) + 1;
        }
        setArtifactCountsByWork(next);
      } catch {
        if (!controller.signal.aborted) setArtifactCountsByWork({});
      }
    })();
    return () => controller.abort();
  }, [project.id]);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))]" aria-label="项目工作">
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-6 sm:py-6">
        <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]" aria-labelledby="project-work-title">
          <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[hsl(var(--border-subtle))] px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2.5">
                <h3 id="project-work-title" className="text-sm font-semibold">工作</h3>
                <span className="text-[11px] tabular-nums text-[hsl(var(--text-tertiary))]">
                  {openCount} 项开放 · {scopedTasks.length} 项全部
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--text-tertiary))]">
                正式工作按当前阶段组织
              </p>
            </div>
            {onCreate && groupedTasks.length > 0 && (
              <button
                type="button"
                onClick={onCreate}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-2.5 text-xs font-medium transition-colors hover:bg-[hsl(var(--bg-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                <Plus className="size-3.5" />
                创建工作
              </button>
            )}
          </header>

          {groupedTasks.length > 0 ? (
            <div className="px-2 py-2 sm:px-3" data-testid="project-work-list">
              {groupedTasks.map(({ status, label, icon: GroupIcon, iconClassName, tasks: groupTasks }) => (
                <section key={status} className="pt-2 first:pt-0" aria-labelledby={`work-group-${status}`}>
                  <div className="flex h-8 items-center gap-2 rounded-lg bg-[hsl(var(--bg-muted))]/65 px-2.5 text-[11px] text-[hsl(var(--text-tertiary))]">
                    <GroupIcon className={cn('size-3.5 shrink-0', iconClassName)} />
                    <h4 id={`work-group-${status}`} className="font-medium text-[hsl(var(--text-secondary))]">{label}</h4>
                    <span className="tabular-nums">{groupTasks.length}</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {groupTasks.map((task) => {
                      const agent = agentById.get(task.agentId);
                      const selected = selectedConversationId === task.conversationId
                        && selectedTaskId === task.id;
                      const artifactCount = artifactCountsByWork[task.id] ?? 0;
                      return (
                        <button
                          key={`${task.conversationId}:${task.id}`}
                          type="button"
                          data-testid={`project-work-row-${task.conversationId}-${task.id}`}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => openTask({ conversationId: task.conversationId, taskId: task.id })}
                          className={cn(
                            'group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[hsl(var(--bg-card-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
                            selected && 'bg-[hsl(var(--bg-muted))]',
                          )}
                        >
                          <WorkProgressIcon status={task.status} />
                          <span className="sr-only">状态：{label}</span>
                          <span className="min-w-0 flex-1 sm:w-56 sm:flex-none">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-xs font-medium text-[hsl(var(--text-primary))]">{task.title}</span>
                              <span className="shrink-0 rounded bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--text-tertiary))]">
                                {CATEGORY_LABELS[task.category ?? 'issue']}
                              </span>
                            </span>
                          </span>
                          <span className="hidden min-w-0 flex-1 truncate text-[11px] text-[hsl(var(--text-tertiary))] lg:block" title={task.description || undefined}>
                            {task.description || '暂无补充说明'}
                          </span>
                          <span className="hidden w-28 shrink-0 items-center justify-end gap-1.5 text-[11px] text-[hsl(var(--text-secondary))] md:flex">
                            {agent ? (
                              <>
                                <span aria-hidden="true" className="text-xs">{agent.emoji}</span>
                                <span className="truncate">{agent.name}</span>
                              </>
                            ) : (
                              <span className="text-[hsl(var(--text-tertiary))]">未分配</span>
                            )}
                          </span>
                          {artifactCount > 0 && (
                            <span className="hidden w-10 shrink-0 items-center justify-end gap-1 text-[10px] tabular-nums text-[hsl(var(--text-tertiary))] xl:flex" title={`${artifactCount} 个正式产物`}>
                              <FileCheck2 className="size-3.5" />
                              {artifactCount}
                            </span>
                          )}
                          <time
                            dateTime={task.updatedAt}
                            title={formatFullDate(task.updatedAt)}
                            className="hidden w-16 shrink-0 text-right text-[10px] tabular-nums text-[hsl(var(--text-tertiary))] sm:block"
                          >
                            {formatRelativeTime(task.updatedAt)}
                          </time>
                          <ChevronRight className="size-3.5 shrink-0 text-[hsl(var(--text-tertiary))] opacity-40 transition-opacity group-hover:opacity-100" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]">
                <Pause className="size-4" />
              </div>
              <h4 className="mt-3 text-sm font-medium">还没有正式工作</h4>
              <p className="mt-1.5 max-w-sm text-xs leading-5 text-[hsl(var(--text-tertiary))]">
                创建后，工作会在这里按阶段排列，并由 Agent 的结构化操作持续更新。
              </p>
              {onCreate && (
                <button type="button" onClick={onCreate} className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))]">
                  <Plus className="size-3.5" />创建第一项工作
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function WorkProgressIcon({ status }: { status: TaskStatus }) {
  const common = 'size-4 shrink-0';
  if (status === 'done') return <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--status-done))] text-white"><Check className="size-2.5" strokeWidth={3} /></span>;
  if (status === 'cancelled') return <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--text-tertiary))] text-white"><X className="size-2.5" strokeWidth={2.5} /></span>;
  if (status === 'blocked') return <AlertCircle className={cn(common, 'text-[hsl(var(--status-blocked))]')} />;
  if (status === 'in_review') return <Eye className={cn(common, 'text-[hsl(var(--status-review))]')} />;
  if (status === 'in_progress') return <span className="relative size-4 shrink-0 rounded-full border border-[hsl(var(--status-progress))]"><span className="absolute inset-y-0 left-0 w-1/2 rounded-l-full bg-[hsl(var(--status-progress))]" /></span>;
  if (status === 'proposed') return <Sparkles className={cn(common, 'text-[hsl(var(--text-tertiary))]')} />;
  return <Circle className={cn(common, 'text-[hsl(var(--text-tertiary))]')} />;
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '刚刚';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatFullDate(value: string): string | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : undefined;
}
