// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsDirectory } from '@/components/agent/AgentsDirectory';
import { useTaskHubStore } from '@/store/taskHubStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentsDirectory', () => {
  it('edits account bindings and permissions on the Agent object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        runtimes: [{
          id: 'codex', label: 'Codex', delivery: 'native', available: true,
          capabilities: [], status: 'ready',
        }],
      }),
    })));
    useTaskHubStore.setState({
      agentRoster: [{
        id: 'owned-agent',
        name: 'Owned Agent',
        theme: 'mario',
        emoji: '🤖',
        isOnline: true,
        cliEngine: 'codex',
        accountIds: ['account-primary'],
        instructions: 'Own the profile.',
        model: 'gpt-owned',
        skillIds: [],
        canModifyCode: true,
        canReview: false,
      }],
      accounts: [{
        id: 'account-primary', name: 'Primary Codex', provider: 'openai',
        authMode: 'oauth', models: [], enabled: true, status: 'valid',
        createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
      }],
      skillsMap: {},
      activeRunsByAgent: {},
      projects: [{
        id: 'project-owned', name: 'Owned Project', rootPath: 'C:/owned',
        workspaceConversationId: 'workspace-owned',
        createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
      }],
      conversations: [],
      chatMessagesByConversation: {
        'workspace-owned': [{
          id: 'message-owned', agentId: 'owned-agent', conversationId: 'workspace-owned',
          invocationId: 'inv-owned', content: '完成结果已提交。', timestamp: '2026-08-24T01:00:00.000Z',
          toolEvents: [{ id: 'tool-owned', type: 'tool_use', label: 'ath task submit', timestamp: '2026-08-24T00:59:00.000Z' }],
        }],
      },
    });

    render(<AgentsDirectory />);
    expect(screen.getByRole('button', { name: '活动' })).toBeDefined();
    expect(screen.getByText('完成结果已提交。')).toBeDefined();
    expect(screen.getByRole('button', { name: /已处理 1 个操作.*查看运行详情/ })).toBeDefined();
    expect(screen.queryByText('ath task submit')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '频道' }));
    expect(screen.getByText('Owned Project')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '编辑 Agent' }));

    expect(await screen.findByText('Primary Codex')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: '可以修改代码' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: '可以执行独立评审' })).toHaveProperty('checked', false);
  });

  it('sends a direct Agent message through the project command path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ runtimes: [] }),
    })));
    const addChatMessage = vi.fn(async (_message: Record<string, unknown>) => ({ ok: true as const }));
    useTaskHubStore.setState({
      agentRoster: [{
        id: 'reviewer', name: 'Reviewer',
        theme: 'mario', emoji: '🔎', isOnline: true, cliEngine: 'codex',
        accountIds: [], instructions: 'Review.', skillIds: [], canModifyCode: false, canReview: true,
      }],
      accounts: [], skillsMap: {}, activeRunsByAgent: {}, conversations: [], chatMessagesByConversation: {},
      projects: [{
        id: 'project-review', name: 'Review Project', rootPath: 'C:/review',
        workspaceConversationId: 'workspace-review',
        createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
      }],
      addChatMessage,
    });

    render(<AgentsDirectory />);
    fireEvent.click(screen.getByRole('button', { name: '发消息' }));
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '检查最新改动' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(addChatMessage).toHaveBeenCalledTimes(1));
    expect(addChatMessage.mock.calls[0][0]).toMatchObject({
      agentId: 'human',
      content: '@reviewer 检查最新改动',
      conversationId: 'workspace-review',
    });
  });

  it('loads and stops a real managed runtime from the Agent runtime tab', async () => {
    const runtime = {
      key: { agentId: 'runner', projectId: 'workspace-run', runtimeNodeId: 'local', runtimeId: 'codex' },
      generation: 2, lifecycle: 'ready', acceptingWork: true,
      readyWorkers: 1, totalWorkers: 1, failureCount: 0,
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/agent-runtime-control') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ runtimes: [{ ...runtime, lifecycle: 'stopped', acceptingWork: false, readyWorkers: 0 }], cancelledInvocations: 1 }) };
      }
      if (url.startsWith('/api/agent-runtime-control')) {
        return { ok: true, json: async () => ({ runtimes: [runtime] }) };
      }
      return { ok: true, json: async () => ({ runtimes: [{ id: 'codex', label: 'Codex', available: true }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    useTaskHubStore.setState({
      agentRoster: [{
        id: 'runner', name: 'Runner',
        theme: 'mario', emoji: '🏃', isOnline: true, cliEngine: 'codex',
        accountIds: [], instructions: 'Run.', skillIds: [], canModifyCode: true, canReview: false,
      }],
      accounts: [], skillsMap: {}, activeRunsByAgent: {}, projects: [{
        id: 'workspace-run', name: 'Runtime Project', rootPath: 'C:/runtime',
        workspaceConversationId: 'workspace-runtime',
        createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
      }], conversations: [], chatMessagesByConversation: {},
    });

    render(<AgentsDirectory />);
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(await screen.findByText('ready · 1/1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '停止 Runtime Project' }));

    expect((await screen.findByRole('status')).textContent).toContain('已停止 1 个运行实例，取消 1 个当前任务');
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtime-control', expect.objectContaining({ method: 'POST' }));
    const controlRequest = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(controlRequest?.[1]?.body))).toMatchObject({
      agentId: 'runner',
      projectId: 'workspace-run',
      action: 'stop',
    });
  });

  it('reports the observed restart failure instead of claiming success', async () => {
    const runtime = {
      key: { agentId: 'runner', projectId: 'workspace-run', runtimeNodeId: 'local', runtimeId: 'codex' },
      generation: 2, lifecycle: 'ready', acceptingWork: true,
      readyWorkers: 1, totalWorkers: 1, failureCount: 0,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/agent-runtime-control') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ runtimes: [{ ...runtime, generation: 3, lifecycle: 'failed', acceptingWork: false, readyWorkers: 0, reasonCode: 'runtime_start_failed' }] }) };
      }
      if (url.startsWith('/api/agent-runtime-control')) {
        return { ok: true, json: async () => ({ runtimes: [runtime] }) };
      }
      return { ok: true, json: async () => ({ runtimes: [{ id: 'codex', label: 'Codex', available: true }] }) };
    }));
    useTaskHubStore.setState({
      agentRoster: [{
        id: 'runner', name: 'Runner',
        theme: 'mario', emoji: '🏃', isOnline: true, cliEngine: 'codex',
        accountIds: [], instructions: 'Run.', skillIds: [], canModifyCode: true, canReview: false,
      }],
      accounts: [], skillsMap: {}, activeRunsByAgent: {}, projects: [{
        id: 'workspace-run', name: 'Runtime Project', rootPath: 'C:/runtime',
        workspaceConversationId: 'workspace-runtime',
        createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
      }], conversations: [], chatMessagesByConversation: {},
    });

    render(<AgentsDirectory />);
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(await screen.findByText('ready · 1/1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重启 Runtime Project' }));

    expect((await screen.findByRole('alert')).textContent).toContain('1 个运行实例启动失败');
    expect(screen.getByText('runtime_start_failed')).toBeDefined();
  });
});
