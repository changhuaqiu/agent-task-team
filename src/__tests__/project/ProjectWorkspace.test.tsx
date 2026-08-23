// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
import { useTaskHubStore } from '@/store/taskHubStore';

vi.mock('@/components/project/ProjectSidebar', () => ({
  ProjectSidebar: ({
    navigation,
    activeSurface,
    onOpenOverview,
    onSelectDelivery,
  }: {
    navigation: Array<{ deliveries: Array<{ id: string; title: string }> }>;
    activeSurface: string;
    onOpenOverview: () => void;
    onSelectDelivery: (id: string) => void;
  }) => (
    <aside data-testid="project-sidebar" data-surface={activeSurface}>
      <button type="button" onClick={onOpenOverview}>交付总览</button>
      {navigation.flatMap((project) => project.deliveries).map((delivery) => (
        <button key={delivery.id} type="button" onClick={() => onSelectDelivery(delivery.id)}>{delivery.title}</button>
      ))}
    </aside>
  ),
}));
vi.mock('@/components/project/ProjectsOverview', () => ({
  ProjectsOverview: ({ navigation }: { navigation: unknown[] }) => (
    <section data-testid="projects-overview">
      {navigation.length === 0 && <p>使用右上角“新建交付”选择项目目录</p>}
    </section>
  ),
}));
vi.mock('@/components/project/ProjectChatPanel', () => ({
  ProjectChatPanel: () => <section data-testid="collaboration-workspace"/>,
}));
vi.mock('@/components/project/ProjectRightPanel', () => ({
  ProjectRightPanel: () => <aside data-testid="project-right-panel"/>,
}));
vi.mock('@/components/project/ProjectEvaluationWorkspace', () => ({
  ProjectEvaluationWorkspace: ({ conversationId }: { conversationId?: string }) =>
    <section data-testid="evaluation-workspace">{conversationId}</section>,
}));
vi.mock('@/components/project/AgentObservabilityDrawerHost', () => ({
  AgentObservabilityDrawerHost: () => <aside data-testid="observability-drawer-host"/>,
}));

afterEach(cleanup);

describe('ProjectWorkspace', () => {
  it('switches the same selected delivery between delivery and evaluation modes', async () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-platform',
      conversations: [{
        id: 'conv-platform', title: '平台内建评估', goal: '同一项目上下文',
        status: 'active', priority: 'p1', projectPath: '',
        breakdownStatus: 'none', createdAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
      }],
    });
    render(<ProjectWorkspace />);
    expect(screen.getByTestId('projects-overview')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '平台内建评估' }));
    expect(screen.getByTestId('collaboration-workspace')).toBeDefined();
    expect(screen.queryByTestId('evaluation-workspace')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '评估' }));
    expect(screen.queryByTestId('collaboration-workspace')).toBeNull();
    expect((await screen.findByTestId('evaluation-workspace')).textContent).toBe('conv-platform');
    expect(screen.getByTestId('project-sidebar')).toBeDefined();
    expect(screen.getByTestId('observability-drawer-host')).toBeDefined();
  });

  it('selects a delivery inside its named project and opens the delivery surface', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-alpha',
      conversations: [
        {
          id: 'conv-alpha', title: 'Alpha delivery', goal: 'Alpha goal',
          status: 'active', priority: 'p1', projectPath: 'C:/projects/alpha',
          breakdownStatus: 'none', createdAt: '2026-08-23T00:00:00.000Z',
          updatedAt: '2026-08-23T00:00:00.000Z',
        },
        {
          id: 'conv-bravo', title: 'Bravo delivery', goal: 'Bravo goal',
          status: 'active', priority: 'p1', projectPath: 'C:/projects/bravo',
          breakdownStatus: 'none', createdAt: '2026-08-23T01:00:00.000Z',
          updatedAt: '2026-08-23T01:00:00.000Z',
        },
      ],
      tasks: [],
      blockersByConversation: {},
      chatMessagesByConversation: {},
    });

    render(<ProjectWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Bravo delivery' }));

    expect(useTaskHubStore.getState().selectedConversationId).toBe('conv-bravo');
    expect(screen.getByTestId('project-sidebar').getAttribute('data-surface')).toBe('delivery');
    expect(screen.getByTestId('collaboration-workspace')).toBeDefined();
  });

  it('opens a delivery selected by an external create flow after the overview mounted', () => {
    useTaskHubStore.setState({
      selectedConversationId: null,
      conversations: [{
        id: 'conv-created', title: '刚创建的交付', goal: '创建后直接进入',
        status: 'active', priority: 'p1', projectPath: 'C:/projects/created',
        breakdownStatus: 'none', createdAt: '2026-08-23T00:00:00.000Z',
        updatedAt: '2026-08-23T00:00:00.000Z',
      }],
      tasks: [],
      blockersByConversation: {},
      chatMessagesByConversation: {},
    });

    render(<ProjectWorkspace />);
    expect(screen.getByTestId('projects-overview')).toBeDefined();

    act(() => useTaskHubStore.getState().setSelectedConversationId('conv-created'));

    expect(screen.getByTestId('project-sidebar').getAttribute('data-surface')).toBe('delivery');
    expect(screen.getByTestId('collaboration-workspace')).toBeDefined();
  });

  it('renders one empty-state guidance and no delivery-only panels with zero data', () => {
    useTaskHubStore.setState({
      selectedConversationId: null,
      conversations: [],
      tasks: [],
      blockersByConversation: {},
      chatMessagesByConversation: {},
    });

    render(<ProjectWorkspace />);

    expect(screen.getAllByText('使用右上角“新建交付”选择项目目录')).toHaveLength(1);
    expect(screen.queryByTestId('collaboration-workspace')).toBeNull();
    expect(screen.queryByTestId('project-right-panel')).toBeNull();
  });
});
