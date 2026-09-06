'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Circle, Clock3, FileCheck2, Plus, Rows3, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { A2APossessionStrip } from '@/components/task-hub/A2APossessionStrip';
import { projectWorkItems, resolveProjectWorkItem, type WorkItemIdentity, type ProjectWorkItem } from '@/lib/project-work-items';
import type { WorkDetailTab } from '@/lib/project-navigation';
import { projectAttention } from '@/lib/project-attention';
import type { Blocker } from '@/store/taskHubStore';
import { ProjectAttentionList } from './ProjectAttentionList';
import { cn } from '@/lib/utils';
import type { Conversation, WorkspaceProject } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';
import { STATUS_LABELS, type Task, type TaskStatus } from '@/store/taskStore';
import { WorkStartPanel } from './WorkStartPanel';
import { WorkResultPanel } from './WorkResultPanel';
import { ProjectArtifactSurface } from './ProjectArtifactSurface';

type DetailTab = WorkDetailTab;
const GROUPS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'blocked', label: '需要处理' }, { status: 'in_progress', label: '进行中' },
  { status: 'in_review', label: '评审中' }, { status: 'ready', label: '待处理' },
  { status: 'proposed', label: '待确认' }, { status: 'done', label: '已完成' },
  { status: 'cancelled', label: '已取消' },
];
const CATEGORY = { issue: '问题', change_request: '变更', improvement: '改进' } as const;

export function ProjectWorkItemsWorkspace({ project, conversations, tasks, preferredWorkItem, preferredDetailTab, focusMessageId, onSelectWorkItem, blockers = [], onOpenReviews, onManageTeam, onCreate }: {
  project: WorkspaceProject;
  conversations: Conversation[];
  tasks: Task[];
  preferredWorkItem?: { conversationId: string; taskId: string } | null;
  preferredDetailTab?: WorkDetailTab;
  focusMessageId?: string;
  onSelectWorkItem?: (identity: WorkItemIdentity, tab?: WorkDetailTab) => void;
  blockers?: Blocker[];
  onOpenReviews?: () => void;
  onManageTeam?: () => void;
  onCreate: () => void;
}) {
  const { selectedConversationId, setSelectedConversationId, setSelectedTaskId, agents } = useTaskHubStore(useShallow((state) => ({
    selectedConversationId: state.selectedConversationId,
    setSelectedConversationId: state.setSelectedConversationId,
    setSelectedTaskId: state.setSelectedTaskId,
    agents: state.agentRoster,
  })));
  const items = useMemo(() => projectWorkItems(project, conversations, tasks), [conversations, project, tasks]);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => preferredWorkItem
    ? workItemKey({ conversationId: preferredWorkItem.conversationId, id: preferredWorkItem.taskId })
    : null);
  const [localDetailTab, setDetailTab] = useState<DetailTab>(preferredDetailTab ?? 'summary');
  const detailTab = onSelectWorkItem ? preferredDetailTab ?? localDetailTab : localDetailTab;
  const localSelected = items.find((item) => workItemKey(item) === selectedKey);
  const preferredSelected = preferredWorkItem ? resolveProjectWorkItem(items, preferredWorkItem) : undefined;
  const conversationSelected = items.find((item) => item.conversationId === selectedConversationId);
  const selected = preferredWorkItem ? preferredSelected ?? null : (preferredSelected?.conversationId === selectedConversationId ? preferredSelected : undefined)
    ?? (localSelected?.conversationId === selectedConversationId ? localSelected : conversationSelected)
    ?? localSelected
    ?? items[0]
    ?? null;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const requestedConversationId = preferredWorkItem?.conversationId;
  const requestedTaskId = preferredWorkItem?.taskId;
  const requestedChild = Boolean(preferredSelected && preferredSelected.id !== requestedTaskId);
  useEffect(() => {
    if (requestedChild && requestedConversationId && requestedTaskId) {
      useTaskHubStore.getState().openTask({ conversationId: requestedConversationId, taskId: requestedTaskId });
    }
  }, [requestedConversationId, requestedTaskId, requestedChild]);

  function select(item: ProjectWorkItem, tab: DetailTab = 'summary') {
    setSelectedKey(workItemKey(item));
    onSelectWorkItem?.({ conversationId: item.conversationId, taskId: item.id }, tab);
    setDetailTab(tab);
    setSelectedTaskId(null);
    if (selectedConversationId !== item.conversationId) setSelectedConversationId(item.conversationId);
  }

  if (preferredWorkItem && !preferredSelected) return <section aria-label="工作项不可用" className="flex flex-1 items-center justify-center p-6"><p className="max-w-md text-sm leading-6">正在等待此工作项的数据。如果加载完成后仍未显示，它可能已被删除或不属于当前项目。请从项目概览重新选择，不会替你打开其他工作项。</p></section>;

  if (items.length === 0) return <section className="flex min-h-0 flex-1 items-center justify-center bg-[hsl(var(--bg-app))]" aria-label="项目工作项"><div className="max-w-md px-6 text-center"><Rows3 className="mx-auto size-7 text-[hsl(var(--text-tertiary))]" /><h3 className="mt-3 text-sm font-semibold">还没有工作项</h3><p className="mt-1.5 text-xs leading-5 text-[hsl(var(--text-tertiary))]">每项工作会获得独立的讨论、任务和交付上下文，不再混入项目群聊。</p><button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))]"><Plus className="size-3.5" />创建第一项工作</button></div></section>;

  return <main className="flex min-h-0 flex-1 flex-col bg-[hsl(var(--bg-app))] md:flex-row" aria-label="项目工作项">
    <aside className="max-h-[240px] w-full shrink-0 overflow-y-auto border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] md:max-h-none md:w-[300px] md:border-b-0 md:border-r" aria-label="工作项列表">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-3 py-3"><div><h3 className="text-xs font-semibold">工作项</h3><p className="mt-0.5 text-xs text-[hsl(var(--text-tertiary))]">{items.length} 项</p></div><button type="button" onClick={onCreate} aria-label="创建工作项" className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]"><Plus className="size-4" /></button></header>
      <div className="p-2">{GROUPS.map((group) => {
        const grouped = items.filter((item) => item.status === group.status);
        if (grouped.length === 0) return null;
        return <section key={group.status} className="mb-3" aria-labelledby={`work-item-group-${group.status}`}><h4 id={`work-item-group-${group.status}`} className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-[hsl(var(--text-tertiary))]"><WorkStatusIcon status={group.status} />{group.label}<span>{grouped.length}</span></h4><div className="space-y-0.5">{grouped.map((item) => { const active = selected ? workItemKey(selected) === workItemKey(item) : false; return <button key={workItemKey(item)} type="button" onClick={() => select(item)} aria-current={active ? 'page' : undefined} className={cn('w-full rounded-lg px-2.5 py-2.5 text-left hover:bg-[hsl(var(--bg-card-hover))]', active && 'bg-[hsl(var(--accent-soft))]')}><span className="flex items-center gap-2"><span className="min-w-0 flex-1 line-clamp-2 text-sm font-medium">{item.title}</span><span className="shrink-0 text-xs text-[hsl(var(--text-tertiary))]">{CATEGORY[item.category]}</span></span><span className="mt-1.5 flex items-center justify-between gap-2 text-xs text-[hsl(var(--text-tertiary))]"><span>{item.agentId ? agentById.get(item.agentId)?.name ?? item.agentId : '未分配'}</span><span>{item.tasks.length} 个任务</span></span></button>; })}</div></section>;
      })}</div>
    </aside>

    {selected && <section className="flex min-w-0 flex-1 flex-col bg-[hsl(var(--bg-card))]" aria-label={`${selected.title} 工作项详情`}>
      <header className="shrink-0 border-b border-[hsl(var(--border-subtle))] px-5 pt-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><WorkStatusIcon status={selected.status} /><h3 className="break-words text-base font-semibold">{selected.title}</h3>{selected.legacy && <span className="rounded bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-xs text-[hsl(var(--text-tertiary))]">旧项目数据</span>}</div><p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[hsl(var(--text-tertiary))]">{selected.description || '暂无补充说明'}</p></div><span className="shrink-0 rounded-full bg-[hsl(var(--bg-muted))] px-2 py-1 text-xs">{CATEGORY[selected.category]}</span></div><nav className="mt-4 flex items-center gap-5 overflow-x-auto" aria-label="工作项视图">{([['summary', '详情'], ['activity', '活动'], ['artifacts', '成果与验收']] as Array<[DetailTab, string]>).map(([id, label]) => <button key={id} type="button" onClick={() => select(selected, id)} className={cn('shrink-0 border-b-2 pb-3 text-xs', detailTab === id ? 'border-[hsl(var(--text-primary))] font-medium' : 'border-transparent text-[hsl(var(--text-tertiary))]')}>{label}</button>)}</nav></header>
      <A2APossessionStrip conversationId={selected.conversationId} />
      {detailTab === 'summary' && <WorkItemSummary item={selected} project={project} onOpenActivity={() => select(selected, 'activity')} onManageTeam={onManageTeam} allTasks={tasks} agents={agentById} blockers={blockers} onOpenResult={() => select(selected, 'artifacts')} />}
      {detailTab === 'activity' && <div className="min-h-0 flex-1"><GlobalChatRoom key={`${selected.conversationId}:${selected.id}`} variant="embedded" focusMessageId={focusMessageId} /></div>}
      {detailTab === 'artifacts' && <div className="min-h-0 flex-1 overflow-y-auto"><WorkResultPanel item={selected} onOpenReviews={onOpenReviews} /><ProjectArtifactSurface
        key={`${selected.conversationId}:${selected.id}`}
        onOpenWork={(identity) => { const item = resolveProjectWorkItem(items, identity); if (item) select(item); }}
        project={project}
        agents={agents}
        conversationId={selected.legacy ? undefined : selected.conversationId}
        workIds={selected.tasks.map((task) => task.id)}
      /></div>}
    </section>}
  </main>;
}

function workItemKey(item: Pick<ProjectWorkItem, 'conversationId' | 'id'>): string {
  return `${item.conversationId}\u0000${item.id}`;
}

function WorkItemSummary({ item, allTasks, agents, blockers, onOpenResult, project, onOpenActivity, onManageTeam }: {
  item: ProjectWorkItem;
  allTasks: Task[];
  blockers: Blocker[];
  onOpenResult: () => void;
  project: WorkspaceProject;
  onOpenActivity: () => void;
  onManageTeam?: () => void;
  agents: Map<string, { name: string; emoji: string }>;
}) {
  const executionRows = item.rootTask ? [item.rootTask, ...item.childTasks] : item.tasks;
  const taskById = new Map(allTasks.filter((task) => task.conversationId === item.conversationId).map((task) => [task.id, task]));
  const strandedAssignedTasks = item.tasks.filter((task) => task.status === 'proposed' && Boolean(task.agentId));
  return <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-5">
    <div className="mx-auto max-w-4xl space-y-4">
      {!item.agentId && item.childTasks.length === 0 && ['ready', 'proposed'].includes(item.status) && <WorkStartPanel key={`${item.conversationId}:${item.id}`} item={item} project={project} onOpenActivity={onOpenActivity} onManageTeam={onManageTeam} />}
      <ProjectAttentionList items={projectAttention([item], blockers.filter((blocker) => blocker.conversationId === item.conversationId && item.tasks.some((task) => task.id === blocker.taskId)))} onOpen={(target) => useTaskHubStore.getState().openTask(target)} />
      {item.status === 'done' && <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"><h4 className="text-sm font-medium">工作已完成，查收成果</h4><p className="mt-1 text-xs leading-5">查看验收依据、交付件和未覆盖风险，不必从聊天中拼接结果。</p><button type="button" onClick={onOpenResult} className="mt-3 rounded-lg bg-[hsl(var(--text-primary))] px-3 py-2 text-xs text-[hsl(var(--text-inverse))]">查收成果与验收</button></section>}
      <section className="rounded-2xl bg-[hsl(var(--bg-card))] p-5">
        <h4 className="text-xs font-semibold">目标与验收上下文</h4>
        <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[hsl(var(--text-secondary))]">{item.description || '该工作项尚未补充目标、约束或验收条件。'}</p>
        {item.sourceLabel && <div className="mt-4 text-xs text-[hsl(var(--text-tertiary))]">来源：{item.sourceLabel}</div>}
      </section>
      {strandedAssignedTasks.length > 0 && <section className="flex gap-3 rounded-2xl border border-amber-400/40 bg-amber-50 p-4 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300" role="alert">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="block text-xs font-semibold">计划已分配，但尚未激活</span>
          <span className="mt-1 block text-xs leading-5">{strandedAssignedTasks.length} 项任务已有负责人却仍处于待确认状态；系统会尝试恢复，恢复前不会把接纳回执当作正在执行。</span>
        </span>
      </section>}
      <section className="rounded-2xl bg-[hsl(var(--bg-card))]">
        <header className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4">
          <h4 className="text-xs font-semibold">目标任务与执行拆解</h4>
          <span className="text-xs text-[hsl(var(--text-tertiary))]">{item.tasks.length} 项</span>
        </header>
        {item.tasks.length === 0
          ? <p className="px-5 py-6 text-xs text-[hsl(var(--text-tertiary))]">目标已记录，尚无执行计划。请在活动中要求团队安排。</p>
           : <div className="divide-y divide-[hsl(var(--border-subtle))]">{executionRows.map((task) => {
               const agent = agents.get(task.agentId);
               const dependencies = task.dependencies.map((dependencyId) => ({
                 id: dependencyId,
                 task: taskById.get(dependencyId),
               }));
               const unresolvedDependencies = dependencies.filter(({ task: dependency }) => (
                 !dependency || dependency.status !== 'done'
               ));
               return <button type="button" key={task.id} aria-label={`打开任务：${task.title}`} onClick={() => useTaskHubStore.getState().openTask({ conversationId: task.conversationId, taskId: task.id })} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[hsl(var(--bg-muted))]">
                 <WorkStatusIcon status={task.status} />
                 <span className="min-w-0 flex-1">
                   <span className="block break-words text-sm font-medium">{task.title}</span>
                   <span className="mt-1 block truncate text-xs text-[hsl(var(--text-tertiary))]">{task.description || (task.id === item.rootTask?.id ? '工作项目标' : '执行拆解')}</span>
                   {dependencies.length > 0 && <span className="mt-1 block truncate text-xs text-[hsl(var(--text-secondary))]">
                     {unresolvedDependencies.length > 0
                       ? `等待：${unresolvedDependencies.map(({ id, task: dependency }) => dependency?.title ?? id).join('、')}`
                       : '依赖已满足'}
                   </span>}
                 </span>
                 <span className="shrink-0 text-right text-xs text-[hsl(var(--text-tertiary))]">
                   <span className="block font-medium text-[hsl(var(--text-secondary))]">{STATUS_LABELS[task.status]}</span>
                   <span className="mt-1 block">{agent ? `${agent.emoji} ${agent.name}` : '未分配'}</span>
                 </span>
               </button>;
            })}</div>}
      </section>
    </div>
  </div>;
}

function WorkStatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'done') return <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="size-2.5" /></span>;
  if (status === 'blocked') return <AlertCircle className="size-4 shrink-0 text-red-500" />;
  if (status === 'in_progress') return <Clock3 className="size-4 shrink-0 text-blue-500" />;
  if (status === 'in_review') return <FileCheck2 className="size-4 shrink-0 text-violet-500" />;
  if (status === 'proposed') return <Sparkles className="size-4 shrink-0 text-amber-500" />;
  return <Circle className="size-4 shrink-0 text-[hsl(var(--text-tertiary))]" />;
}
