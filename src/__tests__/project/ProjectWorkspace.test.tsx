// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';
import { readDesktopRendererSessionToken } from '@/lib/desktop-host/renderer-session';

vi.mock('@/components/project/ProjectSidebar', () => ({
  ProjectSidebar: ({ activeSurface, projects, onOpenActivity, onOpenAgents, onOpenProjects, onSelectProject }: {
    activeSurface: string;
    projects: WorkspaceProject[];
    onOpenActivity: () => void;
    onOpenAgents: () => void;
    onOpenProjects: () => void;
    onSelectProject: (project: WorkspaceProject) => void;
  }) => <aside data-testid="project-sidebar" data-surface={activeSurface}>
    <button type="button" onClick={onOpenActivity}>收件箱</button>
    <button type="button" onClick={onOpenAgents}>Agents</button>
    <button type="button" onClick={onOpenProjects}>Projects</button>
    {projects.map((project) => <button key={project.id} type="button" onClick={() => onSelectProject(project)}>{project.name}</button>)}
  </aside>,
}));
vi.mock('@/components/project/ProjectsOverview', () => ({
  ProjectsOverview: ({ lens, onOpenTask }: { lens: string; onOpenTask: (taskId: string) => void }) => <section data-testid="projects-overview" data-lens={lens}><button type="button" onClick={() => onOpenTask('task-bravo')}>打开跨项目工作</button><button type="button" onClick={() => onOpenTask('pending')}>打开待规划工作</button></section>,
}));
vi.mock('@/components/agent/AgentsDirectory', () => ({ AgentsDirectory: () => <section data-testid="agents-directory" /> }));
vi.mock('@/components/project/ProjectObjectWorkspace', () => ({
  ProjectObjectWorkspace: ({ project, requestedNavigation }: { project: WorkspaceProject; requestedNavigation: unknown }) => <section data-testid="project-object-workspace" data-navigation={JSON.stringify(requestedNavigation)}>{project.name}</section>,
}));
vi.mock('@/components/project/AgentObservabilityDrawerHost', () => ({
  AgentObservabilityDrawerHost: () => <aside data-testid="observability-drawer-host" />,
}));

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

const projects: WorkspaceProject[] = [
  { id: 'alpha', name: 'Alpha', rootPath: 'C:/projects/alpha', workspaceConversationId: 'workspace-alpha', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
  { id: 'bravo', name: 'Bravo', rootPath: 'C:/projects/bravo', workspaceConversationId: 'workspace-bravo', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
];

function resetWorkspace(selectedConversationId: string | null = null) {
  useTaskHubStore.setState({ selectedConversationId, projects, conversations: [], tasks: [], blockersByConversation: {}, chatMessagesByConversation: {} });
}

const crossProjectTask: Task = {
  id: 'task-bravo', conversationId: 'workspace-bravo', phaseId: '', title: 'Bravo work',
  description: '', status: 'proposed', agentId: 'builder', dependencies: [], artifacts: [],
  createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', revision: 1,
};

describe('ProjectWorkspace', () => {
  it('uses activity, agents, and project lenses instead of delivery surfaces', () => {
    resetWorkspace();
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    expect(screen.getByTestId('projects-overview').getAttribute('data-lens')).toBe('activity');
    fireEvent.click(screen.getAllByRole('button', { name: 'Agents' })[0]);
    expect(screen.getByTestId('agents-directory')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByTestId('projects-overview').getAttribute('data-lens')).toBe('projects');
  });

  it('keeps global content and context inside one bounded workspace frame', () => {
    resetWorkspace();
    render(<ProjectWorkspace onAddProject={vi.fn()} />);

    const frame = screen.getByTestId('global-workspace-frame');
    expect(frame.className).toContain('max-w-[1680px]');
    expect(frame.className).toContain('[&>main>div]:!max-w-none');
    expect(frame.className).toContain('[&>main>div]:!w-full');
    expect(frame.contains(screen.getByTestId('projects-overview'))).toBe(true);
    expect(frame.contains(screen.getByRole('complementary', { name: '工作区上下文' }))).toBe(true);
  });

  it('opens a selected project object directly', () => {
    resetWorkspace();
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bravo' }));
    expect(useTaskHubStore.getState().selectedConversationId).toBe('workspace-bravo');
    expect(screen.getByTestId('project-sidebar').getAttribute('data-surface')).toBe('project');
    expect(screen.getByTestId('project-object-workspace').textContent).toBe('Bravo');
  });

  it('opens a project selected by an external create flow', () => {
    resetWorkspace();
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    act(() => useTaskHubStore.getState().setSelectedConversationId('workspace-alpha'));
    expect(screen.getByTestId('project-sidebar').getAttribute('data-surface')).toBe('project');
    expect(screen.getByTestId('project-object-workspace').textContent).toBe('Alpha');
  });

  it('keeps observability outside the primary object surfaces', () => {
    resetWorkspace();
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    expect(screen.getByTestId('observability-drawer-host')).toBeDefined();
    expect(screen.queryByText(/新建交付/)).toBeNull();
  });

  it('opens global work inside its Project hierarchy without launching the legacy Task drawer', () => {
    resetWorkspace('workspace-alpha');
    useTaskHubStore.setState({ tasks: [crossProjectTask] });
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '收件箱' }));
    fireEvent.click(screen.getByRole('button', { name: '打开跨项目工作' }));

    expect(useTaskHubStore.getState().selectedConversationId).toBe('workspace-bravo');
    expect(useTaskHubStore.getState().selectedTaskId).toBeNull();
    expect(screen.getByTestId('project-object-workspace').textContent).toBe('Bravo');
  });
});

describe('navigation regressions from end-to-end audit', () => {
  it('preserves desktop command authentication across project/global navigation, remount and Back', () => {
    resetWorkspace();
    const initial = '#ath-desktop-session=fixture-renderer-token';
    window.history.replaceState(null, '', initial);
    const view = render(<ProjectWorkspace onAddProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bravo' }));
    expect(readDesktopRendererSessionToken()).toBe('fixture-renderer-token');
    expect(new URLSearchParams(window.location.hash.slice(1)).get('project')).toBe('bravo');
    view.unmount();
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    expect(screen.getByTestId('project-object-workspace').textContent).toBe('Bravo');
    expect(readDesktopRendererSessionToken()).toBe('fixture-renderer-token');
    fireEvent.click(screen.getByRole('button', { name: '收件箱' }));
    expect(readDesktopRendererSessionToken()).toBe('fixture-renderer-token');
    fireEvent.click(screen.getByRole('button', { name: 'Bravo' }));
    window.history.replaceState(null, '', initial);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByTestId('projects-overview').getAttribute('data-lens')).toBe('activity');
    expect(useTaskHubStore.getState().selectedConversationId).toBeNull();
    expect(readDesktopRendererSessionToken()).toBe('fixture-renderer-token');
  });
  const pending = { id: 'pending', projectId: 'bravo', workspaceKind: 'workstream' as const, title: 'Pending goal', goal: 'Goal', status: 'active' as const, priority: 'p2' as const, projectPath: 'C:/projects/bravo', breakdownStatus: 'none' as const, createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z' };
  function target() { return JSON.parse(screen.getByTestId('project-object-workspace').getAttribute('data-navigation')!); }
  it('preserves a deferred exact URL over persisted old selection until hydration', () => {
    resetWorkspace('workspace-alpha');
    const hash = '#project=bravo&view=work&scope=pending&work=pending&detail=activity';
    window.history.replaceState(null, '', hash);
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    expect(window.location.hash).toBe(hash);
    act(() => useTaskHubStore.setState({ conversations: [pending] }));
    expect(target()).toMatchObject({ projectId: 'bravo', work: { conversationId: 'pending', taskId: 'pending' }, detailTab: 'activity' });
  });
  it('opens a pending work item even without an execution task', () => {
    resetWorkspace();
    useTaskHubStore.setState({ conversations: [pending] });
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开待规划工作' }));
    expect(target().work).toEqual({ conversationId: 'pending', taskId: 'pending' });
  });
  it('restores global navigation and clears project scope on Back to empty initial hash', () => {
    resetWorkspace();
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bravo' }));
    window.history.replaceState(null, '', '/');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByTestId('projects-overview').getAttribute('data-lens')).toBe('activity');
    expect(useTaskHubStore.getState().selectedConversationId).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Agents' })[0]);
    expect(window.location.hash).toBe('#workspace=agents');
  });
});
