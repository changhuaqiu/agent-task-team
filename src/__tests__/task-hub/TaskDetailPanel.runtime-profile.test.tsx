// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailPanel } from '@/components/task-hub/TaskDetailPanel';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';
import { socket } from '@/store/daemonStore';
import type { TeamPack } from '@/types/teamPack';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { roleCardToSnapshot } from '@/server/team-pack-role-snapshot';

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
      soul: '',
      required: true,
      accountIds: ['account-codex'],
      roleCardSnapshot: roleCardToSnapshot({
        ...PRESET_ROLE_CARDS[0],
        displayName: 'Snapshot Architect',
      }),
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
  it('keeps the TeamPack member name separate from its snapshot RoleCard', () => {
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
      }],
      accounts: [],
    });

    render(<TaskDetailPanel />);

    expect(screen.getByText('Mario B')).toBeDefined();
    expect(screen.getByText('Snapshot Architect')).toBeDefined();
  });

  it('fails closed without a profile and reacts when the canonical profile becomes executable', async () => {
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
      }],
      accounts: [],
      agentAccountOverrides: { mario: ['account-codex'] },
      daemonRuntimes: [
        { engine: 'opencode', available: true },
        { engine: 'codex', available: false },
      ],
    });

    render(<TaskDetailPanel />);

    expect(screen.queryByRole('button', { name: /opencode/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /codex/ })).toBeNull();

    act(() => {
      useTaskHubStore.setState({ accounts: [executableAccount()] });
    });
    expect(screen.queryByRole('button', { name: /codex/ })).toBeNull();

    act(() => {
      useTaskHubStore.setState({ daemonRuntimes: [{ engine: 'codex', available: true }] });
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /codex/ })).toBeDefined());

    act(() => {
      useTaskHubStore.setState({ accounts: [{ ...executableAccount(), status: 'error' }] });
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /codex/ })).toBeNull());
  });

  it('does not render or dispatch a task from a different selected conversation', () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
      }],
      accounts: [executableAccount()],
      agentAccountOverrides: {},
      daemonRuntimes: [{ engine: 'codex', available: true }],
    });

    render(<TaskDetailPanel />);

    expect(screen.queryByText('Project A task')).toBeNull();
    expect(screen.queryByRole('button', { name: /codex/ })).toBeNull();

    act(() => {
      void useTaskHubStore.getState().simulateCliExecution('task-project-a', 'do not dispatch');
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('outside the selected conversation'));
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
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
      refreshPendingDispatches: vi.fn().mockResolvedValue(undefined) as never,
    });

    act(() => useTaskHubStore.getState().setSelectedConversationId('project-b'));

    expect(useTaskHubStore.getState().selectedTaskId).toBeNull();
  });
});
