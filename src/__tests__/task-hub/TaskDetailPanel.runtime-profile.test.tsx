// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailPanel } from '@/components/task-hub/TaskDetailPanel';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';

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

afterEach(cleanup);

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

describe('TaskDetailPanel runtime profile', () => {
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
        { engine: 'codex', available: true },
      ],
    });

    render(<TaskDetailPanel />);

    expect(screen.queryByText(/opencode/)).toBeNull();
    expect(screen.queryByText(/codex/)).toBeNull();

    act(() => {
      useTaskHubStore.setState({ accounts: [executableAccount()] });
    });

    await waitFor(() => expect(screen.getByText(/codex/)).toBeDefined());
  });
});
