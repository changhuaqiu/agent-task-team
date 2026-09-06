'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDot, FileText, FolderKanban, GitPullRequest, MessageSquareText } from 'lucide-react';
import type { WorkspaceProject, Conversation, Blocker } from '@/store/taskHubStore';
import type { Agent } from '@/store/agentStore';
import type { ChatMessage } from '@/store/types';
import type { Task } from '@/store/taskStore';
import type { ProjectNavigationTarget } from '@/lib/project-navigation';
import { projectWorkItems } from '@/lib/project-work-items';
import { STATUS_LABELS } from '@/store/taskStore';
import type { ProjectReview } from '@/shared/project-review';
import { socket } from '@/store/daemonStore';
import type { ProjectArtifactLedgerItem } from '@/shared/project-artifact-ledger';

export type WorkspaceLens = 'activity' | 'projects' | 'work' | 'reviews' | 'artifacts';
export type InboxFilter = 'all' | 'needs_action' | 'agents' | 'reviews';

type ScopedTask = Task & { project?: WorkspaceProject };
type PersistentInboxItem = {
  conversationKey: string;
  kind: 'message_thread' | 'work' | 'review' | 'agent_activity' | 'reminder' | 'draft';
  projectId?: string;
  projectName?: string;
  subject: { type: string; id: string };
  actor: { type: string; id: string };
  title: string;
  preview: string;
  actionState: 'informational' | 'needs_action' | 'resolved';
  latestAt: string;
  unreadCount: number;
  metadata: Record<string, unknown>;
};

function projectForConversation(projects: WorkspaceProject[], conversations: Conversation[]) {
  const result = new Map<string, WorkspaceProject>();
  for (const project of projects) result.set(project.workspaceConversationId, project);
  for (const conversation of conversations) {
    const project = projects.find((item) => item.id === conversation.projectId);
    if (project) result.set(conversation.id, project);
  }
  return result;
}

function timeLabel(value: string) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
}

function Empty({ title, description }: { title: string; description: string }) {
  return <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center"><div className="flex size-11 items-center justify-center rounded-full bg-[hsl(var(--bg-muted))]"><CircleDot className="size-4 text-[hsl(var(--text-tertiary))]" /></div><h3 className="mt-4 text-sm font-medium">{title}</h3><p className="mt-1.5 text-xs leading-5 text-[hsl(var(--text-tertiary))]">{description}</p></div>;
}

export function ProjectsOverview({ projects, conversations, tasks, blockers, agents = [], lens = 'projects', inboxFilter = 'all', onOpenProject, onOpenTask, onNavigate, onReviewCountChange, onArtifactCountChange }: {
  projects: WorkspaceProject[];
  conversations: Conversation[];
  tasks: Task[];
  blockers: Record<string, Blocker[]>;
  messages?: Record<string, ChatMessage[]>;
  agents?: Agent[];
  lens?: WorkspaceLens;
  inboxFilter?: InboxFilter;
  onOpenProject: (project: WorkspaceProject) => void;
  onOpenTask?: (taskId: string, conversationId?: string) => void;
  onNavigate?: (target: ProjectNavigationTarget) => void;
  onReviewCountChange?: (count: number | null) => void;
  onArtifactCountChange?: (count: number | null) => void;
}) {
  const [projectReviews, setProjectReviews] = useState<ProjectReview[]>([]);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [reviewLoadError, setReviewLoadError] = useState(false);
  const [inboxItems, setInboxItems] = useState<PersistentInboxItem[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [inboxLoadError, setInboxLoadError] = useState(false);
  const [artifacts, setArtifacts] = useState<ProjectArtifactLedgerItem[]>([]);
  const [artifactsLoaded, setArtifactsLoaded] = useState(false);
  const [artifactLoadError, setArtifactLoadError] = useState(false);
  const reviewRequestGeneration = useRef(0);
  const inboxRequestGeneration = useRef(0);
  const artifactRequestGeneration = useRef(0);
  const refreshReviews = useCallback(() => {
    if (lens !== 'reviews' && lens !== 'projects') return;
    if (typeof fetch !== 'function') { setReviewsLoaded(true); return; }
    const generation = ++reviewRequestGeneration.current;
    fetch('/api/reviews', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('review_list_failed')))
      .then((body: { reviews?: ProjectReview[] }) => {
        if (generation !== reviewRequestGeneration.current) return;
        const rows = Array.isArray(body.reviews) ? body.reviews : [];
        setProjectReviews(rows);
        setReviewLoadError(false);
        onReviewCountChange?.(rows.filter((review) => review.status === 'open' || review.status === 'changes_requested').length);
      })
      .catch(() => {
        if (generation !== reviewRequestGeneration.current) return;
        setReviewLoadError(true);
        onReviewCountChange?.(null);
      })
      .finally(() => {
        if (generation === reviewRequestGeneration.current) setReviewsLoaded(true);
      });
  }, [lens, onReviewCountChange]);
  useEffect(() => {
    // Fetch completion and socket callbacks are the external Review projection
    // boundary; they own the component's read-model state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshReviews();
    if (lens !== 'reviews' && lens !== 'projects') return;
    socket.on('project:objects-updated', refreshReviews);
    return () => { socket.off('project:objects-updated', refreshReviews); };
  }, [lens, refreshReviews]);
  const refreshInbox = useCallback(() => {
    if (lens !== 'activity' || typeof fetch !== 'function') return;
    const generation = ++inboxRequestGeneration.current;
    setInboxLoaded(false);
    fetch(`/api/inbox?filter=${encodeURIComponent(inboxFilter)}`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('inbox_read_failed')))
      .then((body: { items?: PersistentInboxItem[]; reviewCount?: number }) => {
        if (generation !== inboxRequestGeneration.current) return;
        setInboxItems(Array.isArray(body.items) ? body.items : []);
        if (typeof body.reviewCount === 'number') onReviewCountChange?.(body.reviewCount);
        setInboxLoadError(false);
      })
      .catch(() => {
        if (generation !== inboxRequestGeneration.current) return;
        setInboxLoadError(true);
        onReviewCountChange?.(null);
      })
      .finally(() => {
        if (generation === inboxRequestGeneration.current) setInboxLoaded(true);
      });
  }, [inboxFilter, lens, onReviewCountChange]);
  useEffect(() => {
    // Fetch completion owns the persistent Inbox read-model state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshInbox();
    if (lens !== 'activity') return;
    socket.on('project:objects-updated', refreshInbox);
    return () => { socket.off('project:objects-updated', refreshInbox); };
  }, [lens, refreshInbox]);
  const refreshArtifacts = useCallback(() => {
    if (lens !== 'artifacts' && lens !== 'projects' && lens !== 'activity') return;
    if (typeof fetch !== 'function') { setArtifactsLoaded(true); return; }
    const generation = ++artifactRequestGeneration.current;
    fetch('/api/artifacts', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('artifact_list_failed')))
      .then((body: { artifacts?: ProjectArtifactLedgerItem[] }) => {
        if (generation !== artifactRequestGeneration.current) return;
        const rows = Array.isArray(body.artifacts) ? body.artifacts : [];
        setArtifacts(rows);
        setArtifactLoadError(false);
        onArtifactCountChange?.(rows.filter((item) => item.status === 'registered').length);
      })
      .catch(() => {
        if (generation !== artifactRequestGeneration.current) return;
        setArtifactLoadError(true);
        onArtifactCountChange?.(null);
      })
      .finally(() => {
        if (generation === artifactRequestGeneration.current) setArtifactsLoaded(true);
      });
  }, [lens, onArtifactCountChange]);
  useEffect(() => {
    // Artifact Ledger is an external server projection, not Task/store state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshArtifacts();
    if (lens !== 'artifacts' && lens !== 'projects' && lens !== 'activity') return;
    socket.on('project:objects-updated', refreshArtifacts);
    return () => { socket.off('project:objects-updated', refreshArtifacts); };
  }, [lens, refreshArtifacts]);
  const conversationProjects = projectForConversation(projects, conversations);
  const scopedTasks: ScopedTask[] = tasks.map((task) => ({ ...task, project: conversationProjects.get(task.conversationId) }));
  const workItems = projects.flatMap((project) => projectWorkItems(project, conversations, tasks).map((item) => ({ ...item, project })));
  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;

  if (lens === 'activity') {
    const openInboxItem = (item: PersistentInboxItem) => {
      if (item.unreadCount > 0) {
        setInboxItems((current) => current.map((candidate) => candidate.conversationKey === item.conversationKey
          ? { ...candidate, unreadCount: 0 }
          : candidate));
        void fetch('/api/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read', conversationKey: item.conversationKey }),
        }).then((response) => { if (!response.ok) refreshInbox(); }).catch(() => refreshInbox());
      }
      const project = projects.find((candidate) => candidate.id === item.projectId);
      if (item.subject.type === 'work') {
        onOpenTask?.(item.subject.id, typeof item.metadata.conversationId === 'string' ? item.metadata.conversationId : undefined);
      } else if (project && onNavigate) {
        const scope = typeof item.metadata.conversationId === 'string' ? item.metadata.conversationId : undefined;
        const targetWork = scope ? workItems.find((work) => work.projectId === project.id && work.conversationId === scope && !work.legacy) : undefined;
        const messageId = typeof item.metadata.messageId === 'string' ? item.metadata.messageId : item.subject.type === 'message_thread' ? item.subject.id : undefined;
        onNavigate({
          projectId: project.id,
          tab: item.subject.type === 'review' ? 'reviews' : item.subject.type === 'artifact' ? 'artifacts' : targetWork ? 'work' : 'activity',
          ...(item.subject.type === 'review' ? { reviewId: item.subject.id } : {}),
          ...(item.subject.type === 'artifact' ? { artifactId: item.subject.id } : {}),
          ...(targetWork ? { work: { conversationId: targetWork.conversationId, taskId: targetWork.id }, detailTab: 'activity' } : {}),
          ...(messageId ? { messageId } : {}),
        });
      } else if (project) onOpenProject(project);
    };
    return <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-card))]" data-testid="projects-overview"><div className="w-full px-6 py-7">
      <header className="mb-6"><h2 className="text-lg font-semibold">收件箱</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">跨项目查看消息、Agent 更新、评审和需要你处理的事实。</p></header>
      {inboxLoadError && <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">收件箱暂时无法读取，请刷新后重试。</div>}
      {!inboxLoaded ? <div className="px-6 py-14 text-center text-xs text-[hsl(var(--text-tertiary))]">正在整理跨项目动态…</div> : inboxItems.length ? <div className="space-y-1">{inboxItems.map((item) => {
        const Icon = item.kind === 'review' ? GitPullRequest : item.kind === 'work' ? CircleDot : MessageSquareText;
        const actor = item.actor.type === 'human' ? '你' : item.actor.type === 'agent' ? agentName(item.actor.id) : '系统';
        const rawStatus = typeof item.metadata.status === 'string' ? item.metadata.status : '';
        const status = rawStatus && rawStatus in STATUS_LABELS
          ? STATUS_LABELS[rawStatus as keyof typeof STATUS_LABELS]
          : item.actionState === 'needs_action' ? '需要处理' : '';
        return <button key={item.conversationKey} type="button" onClick={() => openInboxItem(item)} className="group flex w-full gap-3 rounded-xl px-3 py-3 text-left hover:bg-[hsl(var(--bg-card-hover))]"><div className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]"><Icon className="size-3.5" />{item.unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[hsl(var(--accent))]" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="font-medium">{actor}</span>{item.projectName && <><span className="text-[hsl(var(--text-tertiary))]">在</span><span className="font-medium">{item.projectName}</span></>}<span className="ml-auto text-[10px] text-[hsl(var(--text-tertiary))]">{timeLabel(item.latestAt)}</span></div><div className="mt-1 flex items-center gap-2"><span className="truncate text-sm font-medium">{item.title}</span>{item.unreadCount > 1 && <span className="rounded-full bg-[hsl(var(--accent-soft))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--accent))]">{item.unreadCount}</span>}</div>{item.preview && item.preview !== item.title && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[hsl(var(--text-secondary))]">{item.preview}</p>}{status && <div className="mt-1 text-[10px] text-[hsl(var(--text-tertiary))]">{status}</div>}</div></button>;
      })}</div> : inboxLoadError ? null : <Empty title={inboxFilter === 'all' ? '还没有工作动态' : '当前筛选没有动态'} description={inboxFilter === 'all' ? '创建项目并提出目标后，已确认的工作进展会出现在这里。' : '切换到其他筛选，或等待相关消息和工作事实出现。'} />}
    </div></main>;
  }

  if (lens === 'projects') {
    return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-card))]" data-testid="projects-overview"><div className="mx-auto max-w-5xl px-6 py-7"><header className="mb-6"><h2 className="text-lg font-semibold">项目</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">长期产品与代码上下文；工作、评审和交付件都归属到项目。</p></header>{reviewLoadError && <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">评审数量暂时无法读取，请刷新后重试。</div>}{projects.length ? <div className="grid gap-3 md:grid-cols-2">{projects.map((project) => { const projectTasks = workItems.filter((item) => item.project.id === project.id); const projectReviewCount = projectReviews.filter((review) => review.projectId === project.id && (review.status === 'open' || review.status === 'changes_requested')).length; const projectArtifactCount = artifacts.filter((artifact) => artifact.projectId === project.id && artifact.status === 'registered').length; const openBlockers = conversations.filter((item) => item.projectId === project.id).flatMap((item) => blockers[item.id] ?? []).filter((item) => item.status === 'open').length; return <button key={project.id} type="button" onClick={() => onOpenProject(project)} className="rounded-2xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4 text-left transition hover:border-[hsl(var(--border))] hover:shadow-sm"><div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]"><FolderKanban className="size-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{project.name}</div><div className="mt-1 truncate text-[11px] text-[hsl(var(--text-tertiary))]">{project.rootPath}</div></div></div><div className="mt-4 flex items-center gap-4 text-[11px] text-[hsl(var(--text-tertiary))]"><span>{projectTasks.length} 工作项</span><span>{reviewLoadError ? '—' : projectReviewCount} 评审</span><span>{artifactLoadError || !artifactsLoaded ? '—' : projectArtifactCount} 交付件</span>{openBlockers > 0 && <span className="ml-auto inline-flex items-center gap-1 text-amber-700"><AlertCircle className="size-3" />{openBlockers}</span>}</div></button>; })}</div> : <Empty title="添加第一个项目" description="连接一个长期工作的目录；之后可直接创建工作、发起评审或与 Agent 协作。" />}</div></main>;
  }

  if (lens === 'work') {
    return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-card))]"><div className="mx-auto max-w-5xl px-6 py-7"><header className="mb-5"><h2 className="text-lg font-semibold">工作</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">由已确认操作创建和推进的正式工作项。</p></header>{workItems.length ? <div className="overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))]">{workItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((task) => <button key={`${task.conversationId}:${task.id}`} type="button" onClick={() => onOpenTask?.(task.id, task.conversationId)} className="flex w-full items-center gap-3 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-4 py-3 text-left last:border-b-0 hover:bg-[hsl(var(--bg-card-hover))]"><CircleDot className="size-4 shrink-0 text-[hsl(var(--text-tertiary))]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{task.title}</span><span className="mt-0.5 block truncate text-[10px] text-[hsl(var(--text-tertiary))]">{task.project?.name ?? '未归属项目'} · {agentName(task.agentId)}</span></span><span className="rounded-md bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px]">{STATUS_LABELS[task.status]}</span></button>)}</div> : <Empty title="还没有工作" description="从 Project 上下文创建工作，或让 Agent 提交任务方案。" />}</div></main>;
  }

  if (lens === 'reviews') {
    return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-card))]"><div className="mx-auto max-w-5xl px-6 py-7"><header className="mb-5"><h2 className="text-lg font-semibold">评审</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">独立 Review 对象与质量回执，不从 Task 状态或 Agent 文本推断。</p></header>{reviewLoadError ? <Empty title="评审暂时无法读取" description="统一 Review 事实读取失败，请刷新后重试。" /> : projectReviews.length ? <div className="space-y-2">{projectReviews.map((review) => { const project = projects.find((item) => item.id === review.projectId); return <button key={review.id} type="button" onClick={() => { if (project) { if (onNavigate) onNavigate({ projectId: project.id, tab: 'reviews', reviewId: review.id }); else onOpenProject(project); } }} className="flex w-full gap-3 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4 text-left hover:border-[hsl(var(--border))]"><GitPullRequest className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{review.title}</span><span className="mt-1 block text-[11px] text-[hsl(var(--text-tertiary))]">{project?.name ?? '未知项目'} · {review.baseRef} ← {review.compareRef} · {review.status}</span></span>{review.status === 'approved' && <CheckCircle2 className="size-4 text-emerald-600" />}</button>; })}</div> : reviewsLoaded ? <Empty title="没有正式评审" description="从 Project 发起 Review 后，它会作为独立对象出现在这里。" /> : <Empty title="正在加载评审" description="正在读取统一 Review 事实。" />}</div></main>;
  }

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-card))]"><div className="mx-auto max-w-5xl px-6 py-7"><header className="mb-5"><h2 className="text-lg font-semibold">交付件</h2><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">自动汇总所有 Project 的实际写入与已提交证据。</p></header>{artifactLoadError ? <Empty title="交付件暂时无法读取" description="统一 Artifact Ledger 读取失败，请刷新后重试。" /> : artifacts.length ? <div className="grid gap-2 sm:grid-cols-2">{artifacts.map((artifact) => { const project = projects.find((item) => item.id === artifact.projectId); const task = artifact.workId ? scopedTasks.find((item) => item.id === artifact.workId && item.project?.id === artifact.projectId) : undefined; return <button type="button" onClick={() => { if (project && onNavigate) onNavigate({ projectId: project.id, tab: 'artifacts', artifactId: artifact.id }); else if (task) onOpenTask?.(task.id, task.conversationId); else if (project) onOpenProject(project); }} key={artifact.id} className="flex gap-3 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4 text-left hover:border-[hsl(var(--border))]"><FileText className="size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-medium">{artifact.label}</span><span className={artifact.status === 'registered' ? 'size-1.5 shrink-0 rounded-full bg-emerald-500' : 'size-1.5 shrink-0 rounded-full bg-amber-500'} /></span><span className="mt-1 block truncate text-[10px] text-[hsl(var(--text-tertiary))]">{project?.name ?? '未知项目'}{artifact.workTitle ? ` · ${artifact.workTitle}` : ''}</span></span></button>; })}</div> : artifactsLoaded ? <Empty title="还没有可追踪的交付件" description="Agent 成功写入或提交证据后，会自动出现在这里。" /> : <Empty title="正在整理交付件" description="正在读取统一 Artifact Ledger。" />}</div></main>;
}
