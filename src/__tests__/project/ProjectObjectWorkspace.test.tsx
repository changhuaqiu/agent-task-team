// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectObjectWorkspace } from '@/components/project/ProjectObjectWorkspace';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';

vi.mock('@/components/task-hub/GlobalChatRoom', () => ({
  GlobalChatRoom: ({ variant }: { variant: string }) => <div data-testid="global-chat-room" data-variant={variant}>Conversation</div>,
}));
vi.mock('@/components/task-hub/A2APossessionStrip', () => ({
  A2APossessionStrip: ({ conversationId }: { conversationId: string }) => <div data-testid="a2a-status-bar" data-conversation-id={conversationId}>Agent status</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project: WorkspaceProject = {
  id: 'alpha', name: 'Alpha', rootPath: 'C:/projects/alpha',
  workspaceConversationId: 'workspace-alpha',
  createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
};

describe('ProjectObjectWorkspace', () => {
  it('opens a Project overview without mounting a global chat composer', () => {
    useTaskHubStore.setState({
      selectedConversationId: project.workspaceConversationId,
      agentRoster: [],
      chatMessagesByConversation: { [project.workspaceConversationId]: [] },
    });

    render(<ProjectObjectWorkspace project={project} conversations={[]} tasks={[]} blockers={{}} />);

    const overview = screen.getByRole('main', { name: '项目概览' });
    const statusBar = screen.getByTestId('a2a-status-bar');
    const projectNavigation = screen.getByRole('navigation', { name: '项目视图' });
    expect(overview).toBeDefined();
    expect(overview.contains(statusBar)).toBe(false);
    expect(screen.getByTestId('project-object-workspace').contains(statusBar)).toBe(true);
    expect(projectNavigation.compareDocumentPosition(statusBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(statusBar.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(statusBar.getAttribute('data-conversation-id')).toBe(project.workspaceConversationId);
    expect(screen.queryByTestId('agent-bar')).toBeNull();
    expect(screen.queryByTestId('global-chat-room')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '工作项' }));
    expect(screen.getByRole('region', { name: '项目工作项' })).toBeDefined();
    expect(screen.getByTestId('a2a-status-bar')).toBeDefined();
    expect(screen.queryByRole('button', { name: '创建工作' })).toBeNull();
    expect(screen.queryByTestId('global-chat-room')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '概览' }));
    expect(screen.getByRole('main', { name: '项目概览' })).toBeDefined();
  });

  it('shows the deployed Agent Team and members in project context', async () => {
    const team = {
      id: 'team-alpha', specVersion: 'team-pack/0.1' as const,
      name: 'alpha-team', displayName: 'Alpha Team', description: '', version: '1.0.0',
      tags: [], category: 'custom', teamMode: 'parallel' as const,
      roles: [
        { id: 'builder', displayName: 'Builder', soul: 'Build', required: true },
        { id: 'reviewer', displayName: 'Reviewer', soul: 'Review', required: true },
      ],
      workflow: { type: 'linear' as const, steps: [] }, communicationMatrix: {},
      isPreset: false, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const conversation = {
      id: project.workspaceConversationId, title: 'Alpha', goal: '', priority: 'p2' as const,
      status: 'active' as const, projectPath: project.rootPath, breakdownStatus: 'none' as const,
      createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
      teamPackId: team.id, projectId: project.id,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).includes('/api/team-packs/') ? team : { messages: [] },
    })));
    useTaskHubStore.setState({
      selectedConversationId: project.workspaceConversationId,
      currentTeamPack: team,
      activeAgentIds: ['builder', 'reviewer'],
      agentRoster: [
        { id: 'builder', name: 'Builder', theme: 'luigi', emoji: '🛠️', isOnline: true, accountIds: [], instructions: 'Build', skillIds: [], canModifyCode: true, canReview: false },
        { id: 'reviewer', name: 'Reviewer', theme: 'peach', emoji: '🔍', isOnline: true, accountIds: [], instructions: 'Review', skillIds: [], canModifyCode: false, canReview: true },
      ],
      conversations: [conversation],
      chatMessagesByConversation: { [project.workspaceConversationId]: [] },
    });

    render(<ProjectObjectWorkspace project={project} conversations={[conversation]} tasks={[]} blockers={{}} />);

    expect(await screen.findByText('Alpha Team')).toBeDefined();
    expect(screen.getByText('Builder')).toBeDefined();
    expect(screen.getByText('Reviewer')).toBeDefined();
  });

  it('adds an existing Agent to the current Project through the project command', async () => {
    const scopedProject = { ...project, agentIds: ['builder'] };
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) as { name?: string; projectId?: string; input?: { agentId?: string } } : {};
      return {
        ok: true,
        json: async () => payload.name === 'project.agent.add'
          ? { status: 'applied', recordedAt: '2026-08-26T00:00:00.000Z', result: { projectId: project.id, agentId: 'reviewer', agentIds: ['builder', 'reviewer'] } }
          : { messages: [] },
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    useTaskHubStore.setState({
      projects: [scopedProject],
      selectedConversationId: project.workspaceConversationId,
      currentTeamPack: null,
      activeAgentIds: ['builder'],
      agentRoster: [
        { id: 'builder', name: 'Builder', theme: 'luigi', emoji: '🛠️', isOnline: true, accountIds: [], instructions: 'Build', skillIds: [], canModifyCode: true, canReview: false },
        { id: 'reviewer', name: 'Reviewer', theme: 'peach', emoji: '🔍', isOnline: true, accountIds: [], instructions: 'Review', skillIds: [], canModifyCode: false, canReview: true },
      ],
      conversations: [],
      chatMessagesByConversation: { [project.workspaceConversationId]: [] },
    });

    render(<ProjectObjectWorkspace project={scopedProject} conversations={[]} tasks={[]} blockers={{}} />);
    fireEvent.click(screen.getByRole('button', { name: '添加 Agent' }));
    expect(screen.getByRole('dialog', { name: '添加 Agent' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Reviewer/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/commands', expect.objectContaining({ method: 'POST' })));
    await vi.waitFor(() => expect(useTaskHubStore.getState().projects[0].agentIds).toEqual(['builder', 'reviewer']));
  });
});
