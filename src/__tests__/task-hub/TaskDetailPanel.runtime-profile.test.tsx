// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailPanel } from '@/components/task-hub/TaskDetailPanel';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';
import type { TeamPack } from '@/types/teamPack';

vi.mock('@/components/task-hub/useTaskGraph', () => ({
  useTaskGraph: () => ({ graph: null, isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@/components/task-hub/TerminalView', () => ({
  TerminalView: () => <div data-testid="terminal-view" />,
}));

vi.mock('@/components/task-hub/TaskGraphTimeline', () => ({
  TaskGraphTimeline: () => null,
}));

vi.mock('@/components/task-hub/TaskGraphActionsPanel', () => ({
  TaskGraphActionsPanel: () => null,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function executableAccount(): Account {
  return {
    id: 'account-codex',
    name: 'Codex',
    authMode: 'api_key',
    provider: 'openai',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    hasApiKey: true,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

function teamPackWithCodexAccount(): TeamPack {
  return {
    id: 'team-b',
    specVersion: 'team-pack/0.1',
    name: 'team-b',
    displayName: 'Team B',
    description: '',
    version: '1.0.0',
    tags: [],
    category: 'test',
    roles: [{
      id: 'mario',
      displayName: 'Mario B',
      required: true,
    }],
    teamMode: 'pipeline',
    workflow: { type: 'linear' },
    communicationMatrix: {},
    isPreset: false,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

describe('TaskDetailPanel runtime profile', () => {
  it('shows the Agent identity without a separate role-material label', () => {
    useTaskHubStore.setState({
      selectedTaskId: 'task-role-snapshot',
      selectedConversationId: 'conversation-role-snapshot',
      conversations: [{
        id: 'conversation-role-snapshot', title: 'Snapshot', goal: '', status: 'active', priority: 'p1',
        projectPath: '', breakdownStatus: 'none', teamPackId: 'team-b',
        createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
      }],
      currentTeamPack: teamPackWithCodexAccount(),
      activeAgentIds: ['mario'],
      tasks: [{
        id: 'task-role-snapshot', conversationId: 'conversation-role-snapshot', phaseId: '',
        title: 'Snapshot role task', description: '', status: 'ready', agentId: 'mario',
        dependencies: [], artifacts: [], createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
        revision: 0,
      }],
      accounts: [],
    });

    render(<TaskDetailPanel />);

    expect(screen.getByText('Mario')).toBeDefined();
    expect(screen.queryByText('项目统筹')).toBeNull();
  });

  it('shows a user-facing progress request without exposing runtime availability', () => {
    useTaskHubStore.setState({
      selectedTaskId: 'task-runtime-profile',
      selectedConversationId: 'conversation-runtime-profile',
      tasks: [{
        id: 'task-runtime-profile',
        conversationId: 'conversation-runtime-profile',
        phaseId: '',
        title: 'Runtime profile task',
        description: '',
        status: 'in_progress',
        agentId: 'mario',
        dependencies: [],
        artifacts: [],
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
        revision: 0,
      }],
      accounts: [],
      daemonRuntimes: [
        { engine: 'opencode', available: true },
        { engine: 'codex', available: false },
      ],
    });

    render(<TaskDetailPanel />);

    expect(screen.queryByRole('button', { name: /opencode/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /codex/ })).toBeNull();
    expect(screen.getByRole('button', { name: '请求进度' })).toBeDefined();

    act(() => {
      useTaskHubStore.setState({ accounts: [executableAccount()] });
    });
    expect(screen.queryByRole('button', { name: /codex/ })).toBeNull();
    expect(screen.getByRole('button', { name: '请求进度' })).toBeDefined();
  });

  it('does not render or request progress for a task from a different selected conversation', () => {
    useTaskHubStore.setState({
      selectedTaskId: 'task-project-a',
      selectedConversationId: 'project-b',
      selectedProjectId: 'project-b',
      conversations: [
        { id: 'project-a', title: 'A', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
        { id: 'project-b', title: 'B', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', teamPackId: 'team-b', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
      ],
      currentTeamPack: teamPackWithCodexAccount(),
      tasks: [{
        id: 'task-project-a', conversationId: 'project-a', phaseId: '', title: 'Project A task',
        description: '', status: 'in_progress', agentId: 'mario', dependencies: [], artifacts: [],
        createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
        revision: 0,
      }],
      accounts: [executableAccount()],
      daemonRuntimes: [{ engine: 'codex', available: true }],
    });

    render(<TaskDetailPanel />);

    expect(screen.queryByText('Project A task')).toBeNull();
    expect(screen.queryByRole('button', { name: '请求进度' })).toBeNull();
  });

  it('resolves colliding task ids by the selected conversation', () => {
    useTaskHubStore.setState({
      selectedTaskId: 'shared-task',
      selectedConversationId: 'project-b',
      conversations: [
        { id: 'project-a', title: 'A', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
        { id: 'project-b', title: 'B', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
      ],
      tasks: [
        { id: 'shared-task', conversationId: 'project-a', phaseId: '', title: 'Project A task', description: '', status: 'ready', agentId: 'mario', dependencies: [], artifacts: [], createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', revision: 0 },
        { id: 'shared-task', conversationId: 'project-b', phaseId: '', title: 'Project B task', description: '', status: 'ready', agentId: 'mario', dependencies: [], artifacts: [], createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', revision: 0 },
      ],
      agentRoster: [{ id: 'mario', name: 'Mario', theme: 'mario', emoji: '⭐', isOnline: true, accountIds: [], instructions: '', skillIds: [], canModifyCode: true, canReview: false }],
    });

    render(<TaskDetailPanel />);

    expect(screen.getByText('Project B task')).toBeDefined();
    expect(screen.queryByText('Project A task')).toBeNull();
  });

  it('isolates in-flight progress state and retry keys for colliding task ids', async () => {
    let resolveA!: (response: Response) => void;
    let resolveB!: (response: Response) => void;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((_input, init) => {
      const body = JSON.parse(String(init?.body)) as { deliveryId: string };
      return new Promise<Response>((resolve) => {
        if (body.deliveryId === 'project-a') resolveA = resolve;
        else resolveB = resolve;
      });
    });
    const response = (status: 'accepted' | 'rejected', deliveryId: string, userMessage?: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        receipt: {
          idempotencyKey: `${deliveryId}-receipt`, commandType: 'task.progress.request',
          projectPath: '', deliveryId, status, duplicate: false, targetAgentIds: [],
          recordedAt: '2026-08-15T00:00:00.000Z', userMessage,
        },
      }),
    } as Response);
    const collidingTasks = [
      { id: 'shared-progress', conversationId: 'project-a', phaseId: '', title: 'Project A progress', description: '', status: 'in_progress' as const, agentId: 'mario', dependencies: [], artifacts: [], createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', revision: 0 },
      { id: 'shared-progress', conversationId: 'project-b', phaseId: '', title: 'Project B progress', description: '', status: 'in_progress' as const, agentId: 'mario', dependencies: [], artifacts: [], createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', revision: 0 },
    ];
    useTaskHubStore.setState({
      selectedTaskId: 'shared-progress',
      selectedConversationId: 'project-a',
      conversations: [
        { id: 'project-a', title: 'A', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
        { id: 'project-b', title: 'B', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
      ],
      tasks: collidingTasks,
      agentRoster: [{ id: 'mario', name: 'Mario', theme: 'mario', emoji: '⭐', isOnline: true, accountIds: [], instructions: '', skillIds: [], canModifyCode: true, canReview: false }],
    });

    render(<TaskDetailPanel />);
    fireEvent.click(screen.getByRole('button', { name: '请求进度' }));
    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDefined();

    act(() => useTaskHubStore.setState({ selectedConversationId: 'project-b' }));
    expect(screen.getByText('Project B progress')).toBeDefined();
    expect(screen.getByRole('button', { name: '请求进度' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '请求进度' }));

    const commands = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      deliveryId: string;
      idempotencyKey: string;
    });
    expect(commands.map((command) => command.deliveryId)).toEqual(['project-a', 'project-b']);
    expect(commands[0]?.idempotencyKey).not.toBe(commands[1]?.idempotencyKey);

    act(() => useTaskHubStore.setState({ selectedConversationId: 'project-a' }));
    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDefined();
    expect(screen.getByRole('button', { name: '正在提交…' }).hasAttribute('disabled')).toBe(true);
    act(() => useTaskHubStore.setState({ selectedConversationId: 'project-b' }));
    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDefined();

    resolveA(response('rejected', 'project-a', 'A 请求失败'));
    await waitFor(() => expect(screen.queryByText('A 请求失败')).toBeNull());
    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDefined();

    act(() => useTaskHubStore.setState({ selectedConversationId: 'project-a' }));
    expect(screen.getByRole('button', { name: '请求进度' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '请求进度' }));
    const retryCommands = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      deliveryId: string;
      idempotencyKey: string;
    });
    expect(retryCommands[2]).toMatchObject({
      deliveryId: 'project-a',
      idempotencyKey: retryCommands[0]?.idempotencyKey,
    });

    resolveB(response('accepted', 'project-b'));
    resolveA(response('accepted', 'project-a'));
    await waitFor(() => expect(screen.getByRole('button', { name: '请求进度' })).toBeDefined());
  });

  it('clears task selection when switching projects', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'project-a',
      selectedTaskId: 'task-project-a',
      conversations: [
        { id: 'project-a', title: 'A', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
        { id: 'project-b', title: 'B', goal: '', status: 'active', priority: 'p1', projectPath: '', breakdownStatus: 'none', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
      ],
      refreshConversationMessages: vi.fn().mockResolvedValue(undefined) as never,
    });

    act(() => useTaskHubStore.getState().setSelectedConversationId('project-b'));

    expect(useTaskHubStore.getState().selectedTaskId).toBeNull();
  });
});
