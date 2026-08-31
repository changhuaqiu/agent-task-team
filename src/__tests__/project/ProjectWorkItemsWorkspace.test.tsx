// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectWorkItemsWorkspace } from '@/components/project/ProjectWorkItemsWorkspace';
import { useTaskHubStore, type Conversation, type WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

vi.mock('@/components/task-hub/GlobalChatRoom', () => ({
  GlobalChatRoom: () => <div data-testid="scoped-chat">{useTaskHubStore.getState().selectedConversationId}</div>,
}));
vi.mock('@/components/task-hub/A2APossessionStrip', () => ({
  A2APossessionStrip: ({ conversationId }: { conversationId: string }) => <div data-testid="scoped-possession">{conversationId}</div>,
}));
vi.mock('@/components/project/ProjectArtifactSurface', () => ({
  ProjectArtifactSurface: ({ conversationId, workIds }: { conversationId?: string; workIds?: string[] }) => <div data-testid="scoped-artifacts">{conversationId}:{workIds?.join(',')}</div>,
}));

afterEach(() => cleanup());

const project: WorkspaceProject = {
  id: 'alpha', name: 'Alpha', rootPath: 'C:/alpha', workspaceConversationId: 'workspace-alpha',
  createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
};
const conversations: Conversation[] = [
  { id: 'workspace-alpha', title: 'Alpha', goal: '', status: 'active', priority: 'p2', projectPath: 'C:/alpha', breakdownStatus: 'none', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z', projectId: 'alpha', workspaceKind: 'project_workspace' },
  { id: 'workstream-a', title: 'Issue A', goal: '', status: 'active', priority: 'p2', projectPath: 'C:/alpha', breakdownStatus: 'none', createdAt: '2026-08-31T00:01:00.000Z', updatedAt: '2026-08-31T00:01:00.000Z', projectId: 'alpha', workspaceKind: 'workstream', rootTaskId: 'work-a' },
  { id: 'workstream-b', title: 'Issue B', goal: '', status: 'active', priority: 'p2', projectPath: 'C:/alpha', breakdownStatus: 'none', createdAt: '2026-08-31T00:02:00.000Z', updatedAt: '2026-08-31T00:02:00.000Z', projectId: 'alpha', workspaceKind: 'workstream', rootTaskId: 'work-b' },
];

function task(id: string, conversationId: string, updatedAt: string): Task {
  return { id, conversationId, phaseId: '', title: id === 'work-a' ? 'Issue A' : 'Issue B', category: 'issue', description: `${id} description`, status: 'ready', agentId: '', dependencies: [], artifacts: [], createdAt: updatedAt, updatedAt, revision: 1 };
}

describe('ProjectWorkItemsWorkspace', () => {
  it('scopes chat and role deliverables to the selected WorkItem', () => {
    useTaskHubStore.setState({
      selectedConversationId: project.workspaceConversationId,
      selectedTaskId: null,
      conversations,
      tasks: [],
      agentRoster: [],
    });
    render(<ProjectWorkItemsWorkspace project={project} conversations={conversations} tasks={[
      task('work-a', 'workstream-a', '2026-08-31T00:01:00.000Z'),
      task('work-b', 'workstream-b', '2026-08-31T00:02:00.000Z'),
    ]} onCreate={vi.fn()} />);

    const workItemList = screen.getByRole('complementary', { name: '工作项列表' });
    expect(workItemList.className).toContain('w-full');
    expect(workItemList.className).toContain('md:w-[300px]');
    expect(screen.getByRole('main', { name: '项目工作项' }).className).toContain('md:flex-row');
    expect(screen.queryByTestId('scoped-chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Issue A/ }));
    expect(useTaskHubStore.getState().selectedConversationId).toBe('workstream-a');
    expect(useTaskHubStore.getState().selectedTaskId).toBeNull();
    expect(screen.getByTestId('scoped-possession').textContent).toBe('workstream-a');

    fireEvent.click(screen.getByRole('button', { name: '活动' }));
    expect(screen.getByTestId('scoped-chat').textContent).toBe('workstream-a');

    fireEvent.click(screen.getByRole('button', { name: '交付件' }));
    expect(screen.getByTestId('scoped-artifacts').textContent).toBe('workstream-a:work-a');

    fireEvent.click(screen.getByRole('button', { name: /Issue B/ }));
    fireEvent.click(screen.getByRole('button', { name: '活动' }));
    expect(screen.getByTestId('scoped-chat').textContent).toBe('workstream-b');
    expect(screen.getByRole('region', { name: 'Issue B 工作项详情' })).toBeDefined();
    expect(screen.getByTestId('scoped-possession').textContent).toBe('workstream-b');

    act(() => useTaskHubStore.getState().setSelectedConversationId('workstream-a'));
    expect(screen.getByRole('region', { name: 'Issue A 工作项详情' })).toBeDefined();
    expect(screen.getByTestId('scoped-chat').textContent).toBe('workstream-a');
    expect(screen.getByTestId('scoped-possession').textContent).toBe('workstream-a');
  });

  it('keeps separate legacy WorkItems selectable inside their shared Project conversation', () => {
    useTaskHubStore.setState({
      selectedConversationId: project.workspaceConversationId,
      selectedTaskId: null,
      conversations,
      tasks: [],
      agentRoster: [],
    });
    render(<ProjectWorkItemsWorkspace project={project} conversations={conversations} tasks={[
      { ...task('legacy-a', project.workspaceConversationId, '2026-08-31T00:01:00.000Z'), title: 'Legacy A' },
      { ...task('legacy-b', project.workspaceConversationId, '2026-08-31T00:02:00.000Z'), title: 'Legacy B' },
    ]} onCreate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Legacy A/ }));
    expect(screen.getByRole('region', { name: 'Legacy A 工作项详情' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Legacy B/ }));
    expect(screen.getByRole('region', { name: 'Legacy B 工作项详情' })).toBeDefined();
    expect(useTaskHubStore.getState().selectedConversationId).toBe(project.workspaceConversationId);
  });
});
