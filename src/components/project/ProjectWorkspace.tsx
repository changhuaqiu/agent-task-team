'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, FileText, FolderKanban, GitPullRequest, ListChecks, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AgentsDirectory } from '@/components/agent/AgentsDirectory';
import { cn } from '@/lib/utils';
import { parseProjectNavigationHash, projectNavigationHash, type ProjectNavigationTarget } from '@/lib/project-navigation';
import { projectWorkItems, projectWorkSummary } from '@/lib/project-work-items';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';
import { AgentObservabilityDrawerHost } from './AgentObservabilityDrawerHost';
import { ProjectObjectWorkspace } from './ProjectObjectWorkspace';
import { ProjectSidebar } from './ProjectSidebar';
import { ProjectsOverview, type InboxFilter, type WorkspaceLens } from './ProjectsOverview';

const LENSES: Array<{ id: WorkspaceLens; label: string; icon: typeof Activity }> = [
  { id: 'activity', label: '动态', icon: Activity },
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'work', label: '工作项', icon: ListChecks },
  { id: 'reviews', label: '评审', icon: GitPullRequest },
  { id: 'artifacts', label: '交付件', icon: FileText },
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
  type Navigation = { surface: 'project'; target: ProjectNavigationTarget }
    | { surface: 'activity' | 'projects' | 'agents'; lens: WorkspaceLens };
  const [navigation, setNavigation] = useState<Navigation>({ surface: 'activity', lens: 'activity' });
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const previousConversation = useRef<string | null>(null);
  const appliedNavigationHash = useRef<string | null>(null);
  const surface = navigation.surface;
  const lens = navigation.surface === 'project' ? 'activity' : navigation.lens;
  const requestedNavigation = navigation.surface === 'project' ? navigation.target : null;
  const selectedProjectId = requestedNavigation?.projectId ?? null;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  function writeHistory(hash: string) {
    // The desktop host also uses the fragment for its renderer credential.
    // Keep it scoped to this window while replacing only navigation fields.
    const session = new URLSearchParams(window.location.hash.slice(1)).get('ath-desktop-session');
    const query = new URLSearchParams(hash.replace(/^#/, ''));
    if (session) query.set('ath-desktop-session', session);
    const nextHash = query.size ? '#' + query.toString() : '';
    if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash || window.location.pathname + window.location.search);
    appliedNavigationHash.current = nextHash;
  }

  const navigate = useCallback((target: ProjectNavigationTarget, history = true): boolean => {
    const project = projects.find((candidate) => candidate.id === target.projectId);
    if (!project) return false;
    const scope = target.work?.conversationId ?? project.workspaceConversationId;
    if (scope !== project.workspaceConversationId
      && !conversations.some((conversation) => conversation.id === scope && conversation.projectId === project.id)) return false;
    previousConversation.current = scope;
    setNavigation({ surface: 'project', target });
    if (useTaskHubStore.getState().selectedConversationId !== scope) setSelectedConversationId(scope);
    setSelectedTaskId(null);
    if (history) writeHistory(projectNavigationHash(target));
    return true;
  }, [projects, conversations, setSelectedConversationId, setSelectedTaskId]);

  const openGlobal = useCallback((next: WorkspaceLens | 'agents', history = true) => {
    const surface = next === 'agents' ? 'agents' : next === 'activity' ? 'activity' : 'projects';
    setNavigation({ surface, lens: next === 'agents' ? 'activity' : next });
    previousConversation.current = null;
    if (useTaskHubStore.getState().selectedConversationId !== null) setSelectedConversationId(null);
    if (history) writeHistory('#workspace=' + next);
  }, [setSelectedConversationId]);

  useEffect(() => {
    const restore = () => {
      const hash = window.location.hash;
      const target = parseProjectNavigationHash(hash);
      if (target) {
        // Projects can hydrate before their workstreams. Do not consume the URL
        // until its complete scope can actually be selected.
        if (navigate(target, false)) appliedNavigationHash.current = hash;
        return;
      }
      const query = new URLSearchParams(hash.slice(1));
      const global = query.get('workspace');
      const desktopStart = query.size === 1 && query.has('ath-desktop-session');
      if (!hash || desktopStart || ['activity', 'projects', 'work', 'reviews', 'artifacts', 'agents'].includes(global ?? '')) {
        openGlobal((global ?? 'activity') as WorkspaceLens | 'agents', false);
        appliedNavigationHash.current = hash;
      }
    };
    if (appliedNavigationHash.current !== window.location.hash) restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [navigate, openGlobal]);

  useEffect(() => {
    if (!selectedConversationId || previousConversation.current === selectedConversationId) return;
    if (appliedNavigationHash.current !== window.location.hash && parseProjectNavigationHash(window.location.hash)) return;
    // A store create/deep-link signal must replace the prior local tab/identity.
    // Ignore a stale render after a navigation event has already changed scope.
    if (useTaskHubStore.getState().selectedConversationId !== selectedConversationId) return;
    const project = projects.find((item) => item.workspaceConversationId === selectedConversationId)
      ?? projects.find((item) => conversations.some((conversation) => conversation.id === selectedConversationId && conversation.projectId === item.id));
    if (!project) return;
    const item = projectWorkItems(project, conversations, tasks).find((work) => work.conversationId === selectedConversationId);
    // Synchronize an external Zustand navigation signal with the URL-backed view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    navigate({
      projectId: project.id,
      tab: selectedConversationId === project.workspaceConversationId ? 'overview' : 'work',
      ...(selectedConversationId !== project.workspaceConversationId && item ? { work: { conversationId: item.conversationId, taskId: item.id } } : {}),
    });
  }, [selectedConversationId, projects, conversations, tasks, navigate]);

  function openProject(project: WorkspaceProject) {
    navigate({ projectId: project.id, tab: 'overview' });
  }
  function openLens(next: WorkspaceLens) { openGlobal(next); }

  const openTask = useCallback((taskId: string, conversationId?: string) => {
    const candidates = projects.flatMap((project) => projectWorkItems(project, conversations, tasks))
      .filter((item) => (!conversationId || item.conversationId === conversationId)
        && (item.id === taskId || item.tasks.some((task) => task.id === taskId)));
    if (candidates.length !== 1) {
      const matches = tasks.filter((task) => task.id === taskId && (!conversationId || task.conversationId === conversationId));
      const task = matches.length === 1 ? matches[0] : undefined;
      const project = task && projects.find((project) => project.workspaceConversationId === task.conversationId);
      if (task && project) navigate({ projectId: project.id, tab: 'work', work: { conversationId: task.conversationId, taskId } });
      return;
    }
    const item = candidates[0];
    navigate({ projectId: item.projectId, tab: 'work', work: { conversationId: item.conversationId, taskId } });
  }, [conversations, projects, navigate, tasks]);

  const openWorkCount = projects.reduce((count, project) => count + projectWorkSummary(projectWorkItems(project, conversations, tasks)).open, 0);
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
      onOpenAgents={() => openGlobal('agents')}
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
            <ProjectsOverview projects={projects} conversations={conversations} tasks={tasks} blockers={blockers} messages={messages} agents={agents} lens={lens} inboxFilter={inboxFilter} onOpenProject={openProject} onOpenTask={openTask} onNavigate={navigate} onReviewCountChange={setReviewCount} onArtifactCountChange={setArtifactCount} />
            <aside className="hidden w-[252px] shrink-0 overflow-y-auto border-l border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-4 xl:block" aria-label="工作区上下文">
              <h3 className="text-xs font-semibold">工作区</h3><p className="mt-1 text-[11px] leading-5 text-[hsl(var(--text-tertiary))]">跨项目查看进度、成果和需要你处理的事项。</p>
              <div className="mt-5 space-y-3">{[
                ['项目', projects.length], ['开放工作', openWorkCount], ['待评审', reviewCount ?? '—'], ['交付件', artifactCount ?? '—'],
              ].map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-lg bg-[hsl(var(--bg-card))] px-3 py-2.5 text-xs"><span className="text-[hsl(var(--text-secondary))]">{label}</span><span className="font-semibold">{value}</span></div>)}</div>
            </aside>
          </div>
        </div>
      </>}
      {surface === 'project' && selectedProject && <ProjectObjectWorkspace
        key={selectedProject.id}
        project={selectedProject}
        conversations={conversations}
        tasks={tasks}
        blockers={blockers}
        requestedNavigation={requestedNavigation}
        onNavigate={navigate}
      />}
      {surface === 'project' && !selectedProject && <div className="flex flex-1 items-center justify-center text-sm text-[hsl(var(--text-tertiary))]">请选择项目</div>}
    </div>
    <AgentObservabilityDrawerHost />
  </div>;
}
