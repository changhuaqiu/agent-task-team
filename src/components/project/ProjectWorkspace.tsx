'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, FileText, FolderKanban, GitPullRequest, ListChecks, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AgentsDirectory } from '@/components/agent/AgentsDirectory';
import { cn } from '@/lib/utils';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';
import { AgentObservabilityDrawerHost } from './AgentObservabilityDrawerHost';
import { ProjectObjectWorkspace } from './ProjectObjectWorkspace';
import { ProjectSidebar, type WorkspaceSurface } from './ProjectSidebar';
import { ProjectsOverview, type InboxFilter, type WorkspaceLens } from './ProjectsOverview';

const LENSES: Array<{ id: WorkspaceLens; label: string; icon: typeof Activity }> = [
  { id: 'activity', label: '动态', icon: Activity },
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'work', label: '工作', icon: ListChecks },
  { id: 'reviews', label: '评审', icon: GitPullRequest },
  { id: 'artifacts', label: '产物', icon: FileText },
];

export function ProjectWorkspace({ onAddProject }: { onAddProject: () => void }) {
  const { selectedConversationId, setSelectedConversationId, setSelectedTaskId, setSettingsOpen, conversations, tasks, blockers, projects, messages, agents } = useTaskHubStore(useShallow((state) => ({
    selectedConversationId: state.selectedConversationId,
    setSelectedConversationId: state.setSelectedConversationId,
    setSelectedTaskId: state.setSelectedTaskId,
    setSettingsOpen: state.setSettingsOpen,
    conversations: state.conversations,
    tasks: state.tasks,
    blockers: state.blockersByConversation,
    projects: state.projects,
    messages: state.chatMessagesByConversation,
    agents: state.agentRoster,
  })));
  const [surface, setSurface] = useState<WorkspaceSurface>('activity');
  const [lens, setLens] = useState<WorkspaceLens>('activity');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const project = projects.find((item) => item.workspaceConversationId === selectedConversationId)
      ?? projects.find((item) => conversations.some((conversation) => conversation.id === selectedConversationId && conversation.projectId === item.id));
    if (!project) return;
    // The selected conversation is an external Zustand navigation signal. The
    // local surface mirrors that authority so API/create/deep-link navigation
    // lands on the same Project object workspace.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedProjectId(project.id);
    setSurface('project');
  }, [conversations, projects, selectedConversationId]);

  function openProject(project: WorkspaceProject) {
    setSelectedProjectId(project.id);
    setSelectedConversationId(project.workspaceConversationId);
    setSurface('project');
  }

  function openLens(next: WorkspaceLens) {
    setLens(next);
    setSurface(next === 'activity' ? 'activity' : 'projects');
  }

  const openTask = useCallback((taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    setSelectedConversationId(task.conversationId);
    setSelectedTaskId(task.id);
  }, [setSelectedConversationId, setSelectedTaskId, tasks]);

  const openWorkCount = tasks.filter((task) => !['done', 'cancelled'].includes(task.status)).length;
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [artifactCount, setArtifactCount] = useState<number | null>(null);

  return <div className="flex min-h-0 flex-1 overflow-hidden">
    <ProjectSidebar
      projects={projects}
      conversations={conversations}
      tasks={tasks}
      activeSurface={surface}
      selectedProjectId={selectedProjectId}
      onOpenActivity={() => openLens('activity')}
      onOpenAgents={() => setSurface('agents')}
      onOpenProjects={() => openLens('projects')}
      onOpenSettings={() => setSettingsOpen(true)}
      onSelectProject={openProject}
    />

    <div className="flex min-w-0 flex-1 flex-col">
      {surface === 'agents' && <AgentsDirectory />}
      {(surface === 'activity' || surface === 'projects') && <>
        <header className="h-14 shrink-0 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-5">
          <div className="mx-auto flex h-full w-full max-w-[1680px] items-center justify-between gap-4">
            <nav className="flex min-w-0 items-center gap-1" aria-label="工作区视图">{LENSES.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => openLens(id)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs', lens === id ? 'bg-[hsl(var(--accent-soft))] font-medium text-[hsl(var(--text-primary))]' : 'text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]')}><Icon className="size-3.5" />{label}</button>)}</nav>
            {lens === 'projects' && <button type="button" onClick={onAddProject} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))]"><Plus className="size-3.5" />添加项目</button>}
          </div>
        </header>
        {lens === 'activity' && <div className="h-11 shrink-0 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] px-5"><div className="mx-auto flex h-full w-full max-w-[1680px] items-center gap-1" aria-label="收件箱过滤">{([['all', '全部'], ['needs_action', '需要处理'], ['agents', 'Agents'], ['reviews', '评审']] as Array<[InboxFilter, string]>).map(([id, label]) => <button key={id} type="button" onClick={() => setInboxFilter(id)} className={cn('h-7 rounded-md px-2.5 text-[11px]', inboxFilter === id ? 'bg-[hsl(var(--bg-muted))] font-medium' : 'text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]')}>{label}</button>)}</div></div>}
        <div className="min-h-0 flex-1 bg-[hsl(var(--bg-card))] px-5">
          <div
            className="mx-auto flex h-full w-full max-w-[1680px] [&>main>div]:!mx-0 [&>main>div]:!w-full [&>main>div]:!max-w-none"
            data-testid="global-workspace-frame"
          >
            <ProjectsOverview projects={projects} conversations={conversations} tasks={tasks} blockers={blockers} messages={messages} agents={agents} lens={lens} inboxFilter={inboxFilter} onOpenProject={openProject} onOpenTask={openTask} onReviewCountChange={setReviewCount} onArtifactCountChange={setArtifactCount} />
            <aside className="hidden w-[252px] shrink-0 overflow-y-auto border-l border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4 xl:block" aria-label="工作区上下文">
              <h3 className="text-xs font-semibold">工作区</h3><p className="mt-1 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">跨 Project 查看已确认的工作事实。</p>
              <div className="mt-5 space-y-3">{[
                ['Projects', projects.length], ['开放工作', openWorkCount], ['待评审', reviewCount ?? '—'], ['正式产物', artifactCount ?? '—'],
              ].map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-lg bg-[hsl(var(--bg-card))] px-3 py-2.5 text-xs"><span className="text-[hsl(var(--text-secondary))]">{label}</span><span className="font-semibold">{value}</span></div>)}</div>
            </aside>
          </div>
        </div>
      </>}
      {surface === 'project' && selectedProject && <ProjectObjectWorkspace project={selectedProject} conversations={conversations} tasks={tasks} blockers={blockers} />}
      {surface === 'project' && !selectedProject && <div className="flex flex-1 items-center justify-center text-sm text-[hsl(var(--text-tertiary))]">请选择项目</div>}
    </div>
    <AgentObservabilityDrawerHost />
  </div>;
}
