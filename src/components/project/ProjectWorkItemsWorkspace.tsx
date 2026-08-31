'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Check, Circle, Clock3, FileCheck2, Plus, Rows3, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { projectWorkItems, type ProjectWorkItem } from '@/lib/project-work-items';
import { cn } from '@/lib/utils';
import type { Conversation, WorkspaceProject } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Task, TaskStatus } from '@/store/taskStore';
import { ProjectArtifactSurface } from './ProjectArtifactSurface';

type DetailTab = 'summary' | 'activity' | 'artifacts';
const GROUPS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'blocked', label: '需要处理' }, { status: 'in_progress', label: '进行中' },
  { status: 'in_review', label: '评审中' }, { status: 'ready', label: '待处理' },
  { status: 'proposed', label: '待确认' }, { status: 'done', label: '已完成' },
  { status: 'cancelled', label: '已取消' },
];
const CATEGORY = { issue: 'Issue', change_request: '变更', improvement: '改进' } as const;

export function ProjectWorkItemsWorkspace({ project, conversations, tasks, preferredWorkItem, onCreate }: {
  project: WorkspaceProject;
  conversations: Conversation[];
  tasks: Task[];
  preferredWorkItem?: { conversationId: string; taskId: string } | null;
  onCreate: () => void;
}) {
  const { selectedConversationId, setSelectedConversationId, setSelectedTaskId, agents } = useTaskHubStore(useShallow((state) => ({
    selectedConversationId: state.selectedConversationId,
    setSelectedConversationId: state.setSelectedConversationId,
    setSelectedTaskId: state.setSelectedTaskId,
    agents: state.agentRoster,
  })));
  const items = useMemo(() => projectWorkItems(project, conversations, tasks), [conversations, project, tasks]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('summary');
  const selected = items.find((item) => workItemKey(item) === selectedKey)
    ?? items.find((item) => item.id === preferredWorkItem?.taskId && item.conversationId === preferredWorkItem.conversationId)
    ?? items.find((item) => item.conversationId === selectedConversationId)
    ?? items[0]
    ?? null;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  function select(item: ProjectWorkItem, tab: DetailTab = 'summary') {
    setSelectedKey(workItemKey(item));
    setDetailTab(tab);
    setSelectedTaskId(null);
    setSelectedConversationId(item.conversationId);
  }

  if (items.length === 0) return <section className="flex min-h-0 flex-1 items-center justify-center bg-[hsl(var(--bg-app))]" aria-label="项目工作项"><div className="max-w-md px-6 text-center"><Rows3 className="mx-auto size-7 text-[hsl(var(--text-tertiary))]" /><h3 className="mt-3 text-sm font-semibold">还没有工作项</h3><p className="mt-1.5 text-xs leading-5 text-[hsl(var(--text-tertiary))]">每项工作会获得独立的讨论、任务和交付上下文，不再混入项目群聊。</p><button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))]"><Plus className="size-3.5" />创建第一项工作</button></div></section>;

  return <main className="flex min-h-0 flex-1 flex-col bg-[hsl(var(--bg-app))] md:flex-row" aria-label="项目工作项">
    <aside className="max-h-[240px] w-full shrink-0 overflow-y-auto border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] md:max-h-none md:w-[300px] md:border-b-0 md:border-r" aria-label="工作项列表">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-3 py-3"><div><h3 className="text-xs font-semibold">工作项</h3><p className="mt-0.5 text-[10px] text-[hsl(var(--text-tertiary))]">{items.length} 项</p></div><button type="button" onClick={onCreate} aria-label="创建工作项" className="flex size-8 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg-muted))]"><Plus className="size-4" /></button></header>
      <div className="p-2">{GROUPS.map((group) => {
        const grouped = items.filter((item) => item.status === group.status);
        if (grouped.length === 0) return null;
        return <section key={group.status} className="mb-3" aria-labelledby={`work-item-group-${group.status}`}><h4 id={`work-item-group-${group.status}`} className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium text-[hsl(var(--text-tertiary))]"><WorkStatusIcon status={group.status} />{group.label}<span>{grouped.length}</span></h4><div className="space-y-0.5">{grouped.map((item) => { const active = selected ? workItemKey(selected) === workItemKey(item) : false; return <button key={workItemKey(item)} type="button" onClick={() => select(item)} aria-current={active ? 'page' : undefined} className={cn('w-full rounded-lg px-2.5 py-2.5 text-left hover:bg-[hsl(var(--bg-card-hover))]', active && 'bg-[hsl(var(--accent-soft))]')}><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span><span className="shrink-0 text-[9px] text-[hsl(var(--text-tertiary))]">{CATEGORY[item.category]}</span></span><span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-[hsl(var(--text-tertiary))]"><span>{item.agentId ? agentById.get(item.agentId)?.name ?? item.agentId : '未分配'}</span><span>{item.tasks.length} 个任务</span></span></button>; })}</div></section>;
      })}</div>
    </aside>

    {selected && <section className="flex min-w-0 flex-1 flex-col bg-[hsl(var(--bg-card))]" aria-label={`${selected.title} 工作项详情`}>
      <header className="shrink-0 border-b border-[hsl(var(--border-subtle))] px-5 pt-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><WorkStatusIcon status={selected.status} /><h3 className="truncate text-base font-semibold">{selected.title}</h3>{selected.legacy && <span className="rounded bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--text-tertiary))]">旧项目数据</span>}</div><p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[hsl(var(--text-tertiary))]">{selected.description || '暂无补充说明'}</p></div><span className="shrink-0 rounded-full bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px]">{CATEGORY[selected.category]}</span></div><nav className="mt-4 flex items-center gap-5 overflow-x-auto" aria-label="工作项视图">{([['summary', '详情'], ['activity', '活动'], ['artifacts', '交付件']] as Array<[DetailTab, string]>).map(([id, label]) => <button key={id} type="button" onClick={() => select(selected, id)} className={cn('shrink-0 border-b-2 pb-3 text-xs', detailTab === id ? 'border-[hsl(var(--text-primary))] font-medium' : 'border-transparent text-[hsl(var(--text-tertiary))]')}>{label}</button>)}</nav></header>
      {detailTab === 'summary' && <WorkItemSummary item={selected} agents={agentById} />}
      {detailTab === 'activity' && <div className="min-h-0 flex-1"><GlobalChatRoom variant="embedded" /></div>}
      {detailTab === 'artifacts' && <ProjectArtifactSurface project={project} agents={agents} workId={selected.id} />}
    </section>}
  </main>;
}

function workItemKey(item: Pick<ProjectWorkItem, 'conversationId' | 'id'>): string {
  return `${item.conversationId}\u0000${item.id}`;
}

function WorkItemSummary({ item, agents }: { item: ProjectWorkItem; agents: Map<string, { name: string; emoji: string }> }) {
  return <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-5">
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="rounded-2xl bg-[hsl(var(--bg-card))] p-5">
        <h4 className="text-xs font-semibold">目标与验收上下文</h4>
        <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[hsl(var(--text-secondary))]">{item.description || '该工作项尚未补充目标、约束或验收条件。'}</p>
        {item.sourceLabel && <div className="mt-4 text-[10px] text-[hsl(var(--text-tertiary))]">来源：{item.sourceLabel}</div>}
      </section>
      <section className="rounded-2xl bg-[hsl(var(--bg-card))]">
        <header className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-5 py-4">
          <h4 className="text-xs font-semibold">执行任务</h4>
          <span className="text-[10px] text-[hsl(var(--text-tertiary))]">{item.tasks.length} 项</span>
        </header>
        {item.tasks.length === 0
          ? <p className="px-5 py-6 text-xs text-[hsl(var(--text-tertiary))]">工作项已接收，Agent 正在生成执行计划。</p>
          : <div className="divide-y divide-[hsl(var(--border-subtle))]">{item.tasks.map((task) => {
              const agent = agents.get(task.agentId);
              return <div key={task.id} className="flex items-center gap-3 px-5 py-3">
                <WorkStatusIcon status={task.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{task.title}</span>
                  <span className="mt-1 block truncate text-[10px] text-[hsl(var(--text-tertiary))]">{task.description || (task.id === item.rootTask?.id ? '工作项目标' : '执行拆解')}</span>
                </span>
                <span className="shrink-0 text-[10px] text-[hsl(var(--text-tertiary))]">{agent ? `${agent.emoji} ${agent.name}` : '未分配'}</span>
              </div>;
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
