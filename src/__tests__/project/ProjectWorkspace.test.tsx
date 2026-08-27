// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

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
  ProjectsOverview: ({ lens, onOpenTask }: { lens: string; onOpenTask: (taskId: string) => void }) => <section data-testid="projects-overview" data-lens={lens}><button type="button" onClick={() => onOpenTask('task-bravo')}>打开跨项目工作</button></section>,
}));
vi.mock('@/components/agent/AgentsDirectory', () => ({ AgentsDirectory: () => <section data-testid="agents-directory" /> }));
vi.mock('@/components/project/ProjectObjectWorkspace', () => ({
  ProjectObjectWorkspace: ({ project }: { project: WorkspaceProject }) => <section data-testid="project-object-workspace">{project.name}</section>,
}));
vi.mock('@/components/project/AgentObservabilityDrawerHost', () => ({
  AgentObservabilityDrawerHost: () => <aside data-testid="observability-drawer-host" />,
}));

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

  it('switches conversation scope and selected Work atomically from global lenses', () => {
    resetWorkspace('workspace-alpha');
    useTaskHubStore.setState({ tasks: [crossProjectTask] });
    render(<ProjectWorkspace onAddProject={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '收件箱' }));
    fireEvent.click(screen.getByRole('button', { name: '打开跨项目工作' }));

    expect(useTaskHubStore.getState().selectedConversationId).toBe('workspace-bravo');
    expect(useTaskHubStore.getState().selectedTaskId).toBe('task-bravo');
  });
});
