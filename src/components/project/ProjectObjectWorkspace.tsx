'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, CircleDot, FlaskConical, FolderOpen, GitPullRequest, ListChecks, LoaderCircle, Plus, Users, Wrench, X, type LucideIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { GlobalChatRoom } from '@/components/task-hub/GlobalChatRoom';
import { A2APossessionStrip } from '@/components/task-hub/A2APossessionStrip';
import { cn } from '@/lib/utils';
import type { Blocker, Conversation, WorkspaceProject } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';
import { ProjectWorkSurface } from './ProjectWorkSurface';
import { ProjectObjectCreateDialog, type ProjectCreateKind } from './ProjectObjectCreateDialog';
import { ProjectReviewSurface } from './ProjectReviewSurface';
import { ProjectQueueFailuresPanel } from './ProjectQueueFailuresPanel';
import { ProjectAutomationWorkspace } from './ProjectAutomationWorkspace';
import { ProjectReleaseSurface } from './ProjectReleaseSurface';
import { ProjectArtifactSurface } from './ProjectArtifactSurface';

const ProjectEvaluationWorkspace = dynamic(() => import('./ProjectEvaluationWorkspace').then((mod) => mod.ProjectEvaluationWorkspace));
const ProjectObservabilityPanel = dynamic(() => import('./ProjectObservabilityPanel').then((mod) => mod.ProjectObservabilityPanel));

type ProjectTab = 'collaboration' | 'work' | 'reviews' | 'artifacts' | 'releases' | 'automations' | 'evaluation' | 'diagnostics';

export function ProjectObjectWorkspace({ project, conversations, tasks, blockers }: {
  project: WorkspaceProject;
  conversations: Conversation[];
  tasks: Task[];
  blockers: Record<string, Blocker[]>;
}) {
  const [tab, setTab] = useState<ProjectTab>('collaboration');
  const [createKind, setCreateKind] = useState<ProjectCreateKind | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [addingAgentId, setAddingAgentId] = useState<string | null>(null);
  const [agentPickerError, setAgentPickerError] = useState<string | null>(null);
  const { agentRoster, currentTeamPack, activeAgentIds, addProjectAgent, setSelectedConversationId } = useTaskHubStore(useShallow((state) => ({
    agentRoster: state.agentRoster,
    currentTeamPack: state.currentTeamPack,
    activeAgentIds: state.activeAgentIds,
    addProjectAgent: state.addProjectAgent,
    setSelectedConversationId: state.setSelectedConversationId,
  })));
  const conversationIds = useMemo(() => {
    const ids = new Set(conversations.filter((item) => item.projectId === project.id).map((item) => item.id));
    ids.add(project.workspaceConversationId);
    return ids;
  }, [conversations, project]);
  const scopedTasks = useMemo(() => tasks.filter((task) => conversationIds.has(task.conversationId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [conversationIds, tasks]);
  const openBlockers = [...conversationIds].flatMap((id) => blockers[id] ?? []).filter((item) => item.status === 'open');
  const workspaceConversation = conversations.find((item) => item.id === project.workspaceConversationId);
  const deployedTeam = workspaceConversation?.teamPackId && currentTeamPack?.id === workspaceConversation.teamPackId
    ? currentTeamPack
    : null;
  const fallbackAgentIds = deployedTeam ? deployedTeam.roles.map((role) => role.id) : activeAgentIds;
  const projectAgentIds = project.agentIds ?? fallbackAgentIds;
  const activeAgents = agentRoster.filter((agent) => projectAgentIds.includes(agent.id));
  const availableAgents = agentRoster.filter((agent) => !projectAgentIds.includes(agent.id));

  const handleAddAgent = async (agentId: string) => {
    setAddingAgentId(agentId);
    setAgentPickerError(null);
    try {
      await addProjectAgent(project.id, agentId);
      setAgentPickerOpen(false);
    } catch (error) {
      setAgentPickerError(error instanceof Error ? error.message : '添加 Agent 失败');
    } finally {
      setAddingAgentId(null);
    }
  };

  useEffect(() => {
    setSelectedConversationId(project.workspaceConversationId);
  }, [project.workspaceConversationId, setSelectedConversationId]);

  return <div className="flex min-h-0 flex-1 bg-[hsl(var(--bg-card))]" data-testid="project-object-workspace">
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[hsl(var(--border-subtle))] px-6 pt-4">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-lg font-semibold">{project.name}</h2><span className="rounded-full bg-[hsl(var(--bg-muted))] px-2 py-1 text-[10px] text-[hsl(var(--text-tertiary))]">Project</span></div><p className="mt-1 truncate text-xs text-[hsl(var(--text-tertiary))]" title={project.rootPath}>{project.rootPath}</p></div>{tab !== 'work' && <div className="relative flex shrink-0 items-center"><button type="button" onClick={() => setCreateKind('work')} className="inline-flex h-9 items-center gap-1.5 rounded-l-lg bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))]"><Plus className="size-3.5" />创建工作</button><button type="button" onClick={() => setCreateMenuOpen((value) => !value)} aria-label="更多创建选项" className="flex h-9 w-8 items-center justify-center rounded-r-lg border-l border-white/20 bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))]"><ChevronDown className="size-3.5" /></button>{createMenuOpen && <div className="absolute right-0 top-11 z-20 w-44 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-1 shadow-lg"><button type="button" onClick={() => { setCreateKind('work'); setCreateMenuOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs hover:bg-[hsl(var(--bg-muted))]"><ListChecks className="size-3.5" />创建工作</button><button type="button" onClick={() => { setCreateKind('review'); setCreateMenuOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs hover:bg-[hsl(var(--bg-muted))]"><GitPullRequest className="size-3.5" />发起评审</button></div>}</div>}</div>
        <nav className="mt-4 flex items-center gap-5" aria-label="项目视图">{([
          ['collaboration', '协作'], ['work', '工作'], ['reviews', '评审'], ['artifacts', '产物'], ['releases', '发布'], ['automations', '自动化'],
        ] as Array<[ProjectTab, string]>).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={cn('shrink-0 border-b-2 px-0.5 pb-3 text-xs', tab === id ? 'border-[hsl(var(--text-primary))] font-medium' : 'border-transparent text-[hsl(var(--text-tertiary))]')}>{label}</button>)}<div className="relative"><button type="button" onClick={() => setMoreOpen((value) => !value)} className={cn('inline-flex items-center gap-1 border-b-2 px-0.5 pb-3 text-xs', ['evaluation', 'diagnostics'].includes(tab) ? 'border-[hsl(var(--text-primary))] font-medium' : 'border-transparent text-[hsl(var(--text-tertiary))]')}>更多<ChevronDown className="size-3" /></button>{moreOpen && <div className="absolute left-0 top-8 z-20 w-40 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-1 shadow-lg"><button type="button" onClick={() => { setTab('evaluation'); setMoreOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-xs hover:bg-[hsl(var(--bg-muted))]"><FlaskConical className="size-3.5" />评估实验室</button><button type="button" onClick={() => { setTab('diagnostics'); setMoreOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-xs hover:bg-[hsl(var(--bg-muted))]"><Wrench className="size-3.5" />运行诊断</button></div>}</div></nav>
      </header>

      <A2APossessionStrip conversationId={project.workspaceConversationId} />

      {tab === 'collaboration' && <main className="flex min-h-0 flex-1 flex-col bg-[hsl(var(--bg-card))]" aria-label="项目协作流">
        <div className="min-h-0 flex-1"><GlobalChatRoom variant="embedded" /></div>
      </main>}
      {tab === 'work' && <ProjectWorkSurface project={project} conversations={conversations} tasks={tasks} blockers={blockers} onCreate={() => setCreateKind('work')} />}
      {tab === 'reviews' && <ProjectReviewSurface project={project} refreshToken={reviewRefreshToken} onCreate={() => setCreateKind('review')} />}
      {tab === 'artifacts' && <ProjectArtifactSurface project={project} agents={agentRoster} />}
      {tab === 'automations' && <ProjectAutomationWorkspace project={project} agents={agentRoster} />}
      {tab === 'releases' && <ProjectReleaseSurface project={project} tasks={scopedTasks} />}
      {tab === 'evaluation' && <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-6"><ProjectEvaluationWorkspace conversationId={project.workspaceConversationId} /></main>}
      {tab === 'diagnostics' && <main className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--bg-app))] p-4"><ProjectQueueFailuresPanel projectId={project.workspaceConversationId} /><ProjectObservabilityPanel conversationId={project.workspaceConversationId} /></main>}
    </section>

    <aside className="hidden w-[268px] shrink-0 overflow-y-auto border-l border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4 xl:block" aria-label="项目上下文">
      <h3 className="text-xs font-semibold">项目上下文</h3>
      <div className="mt-4 space-y-4"><ContextItem icon={FolderOpen} label="工作目录" value={project.rootPath} />{deployedTeam && <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3"><div className="flex items-center gap-2"><Users className="size-3.5 text-[hsl(var(--text-tertiary))]" /><div className="min-w-0"><div className="text-[10px] text-[hsl(var(--text-tertiary))]">Agent Team</div><div className="mt-0.5 truncate text-xs font-medium">{deployedTeam.displayName}</div></div></div></div>}<div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Users className="size-3.5 text-[hsl(var(--text-tertiary))]" /><span className="text-xs font-medium">Agents</span></div><button type="button" onClick={() => { setAgentPickerError(null); setAgentPickerOpen(true); }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))]" aria-label="添加 Agent"><Plus className="size-3" />添加</button></div>{activeAgents.length > 0 ? <div className="mt-2.5 space-y-1">{activeAgents.map((agent) => <div key={agent.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5"><span className="flex size-6 items-center justify-center rounded-full bg-[hsl(var(--bg-muted))] text-xs">{agent.emoji}</span><span className="min-w-0 flex-1 truncate text-[11px] text-[hsl(var(--text-secondary))]">{agent.name}</span><span className={cn('size-1.5 rounded-full', agent.isOnline ? 'bg-emerald-500' : 'bg-[hsl(var(--text-disabled))]')} /></div>)}</div> : <button type="button" onClick={() => setAgentPickerOpen(true)} className="mt-2.5 w-full rounded-lg border border-dashed border-[hsl(var(--border))] px-2 py-3 text-[11px] text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]">添加第一个 Agent</button>}</div><ContextItem icon={CircleDot} label="开放工作" value={`${scopedTasks.filter((task) => !['done', 'cancelled'].includes(task.status)).length} 项`} />{openBlockers.length > 0 && <ContextItem icon={AlertCircle} label="需要处理" value={`${openBlockers.length} 项`} />}</div>
      <div className="mt-6 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3"><div className="text-xs font-medium">完成口径</div><p className="mt-1.5 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">正式产物、当前工作权威和独立质量门共同决定结果；运行结束不等于完成。</p></div>
    </aside>

    {createKind && <ProjectObjectCreateDialog kind={createKind} project={project} tasks={scopedTasks} onClose={() => setCreateKind(null)} onReviewCreated={() => { setReviewRefreshToken((value) => value + 1); setTab('reviews'); }} />}
    {agentPickerOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !addingAgentId) setAgentPickerOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="project-agent-picker-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-2xl"><header className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border-subtle))] px-4 py-3.5"><div><h3 id="project-agent-picker-title" className="text-sm font-semibold">添加 Agent</h3><p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">选择一个 Agent 加入 {project.name}</p></div><button type="button" disabled={Boolean(addingAgentId)} onClick={() => setAgentPickerOpen(false)} className="flex size-8 items-center justify-center rounded-lg text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]" aria-label="关闭"><X className="size-4" /></button></header><div className="max-h-[420px] overflow-y-auto p-2">{availableAgents.length > 0 ? availableAgents.map((agent) => <button key={agent.id} type="button" disabled={Boolean(addingAgentId)} onClick={() => void handleAddAgent(agent.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[hsl(var(--bg-muted))] disabled:opacity-60"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--bg-muted))] text-base">{agent.emoji}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{agent.name}</span><span className="mt-0.5 block truncate text-[10px] text-[hsl(var(--text-tertiary))]">{agent.instructions || '可加入当前项目协作'}</span></span>{addingAgentId === agent.id ? <LoaderCircle className="size-4 animate-spin text-[hsl(var(--text-tertiary))]" /> : <Plus className="size-4 text-[hsl(var(--text-tertiary))]" />}</button>) : <div className="px-4 py-10 text-center"><div className="text-sm font-medium">所有 Agent 都已加入</div><p className="mt-1.5 text-xs text-[hsl(var(--text-tertiary))]">可在 Agents 页面创建新的 Agent。</p></div>}</div>{agentPickerError && <div role="alert" className="border-t border-[hsl(var(--border-subtle))] px-4 py-3 text-xs text-red-500">{agentPickerError}</div>}</section></div>}

  </div>;
}

function ContextItem({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <div className="flex items-start gap-2.5"><Icon className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--text-tertiary))]" /><div className="min-w-0"><div className="text-[10px] text-[hsl(var(--text-tertiary))]">{label}</div><div className="mt-0.5 break-all text-xs text-[hsl(var(--text-secondary))]">{value}</div></div></div>;
}
