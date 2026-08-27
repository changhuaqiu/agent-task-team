// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectAutomationWorkspace } from '@/components/project/ProjectAutomationWorkspace';
import type { WorkspaceProject } from '@/store/taskHubStore';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const project: WorkspaceProject = {
  id: 'alpha', name: 'Alpha', rootPath: 'C:/alpha', workspaceConversationId: 'workspace-alpha',
  createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
};
const agents = [{ id: 'reviewer', name: 'Reviewer', theme: 'peach' as const, emoji: '🔎', isOnline: true, accountIds: [], instructions: 'Review', skillIds: [], canModifyCode: false, canReview: true }];

describe('ProjectAutomationWorkspace', () => {
  it('creates a Project-scoped disabled automation and does not ask for Project again', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
      if (url.startsWith('/api/automations')) return { ok: true, json: async () => ({ automations: [] }) };
      return { ok: true, json: async () => ({ status: 'applied' }) };
    }));
    render(<ProjectAutomationWorkspace project={project} agents={agents} />);
    fireEvent.click((await screen.findAllByRole('button', { name: '创建自动化' }))[0]);
    fireEvent.change(screen.getByPlaceholderText('例如：评审通过后复核'), { target: { value: '评审通过后复核' } });
    fireEvent.change(screen.getByPlaceholderText('通知内容'), { target: { value: '评审通过' } });
    fireEvent.click(screen.getByRole('button', { name: '保存自动化' }));

    await waitFor(() => expect(calls.some((call) => call.url === '/api/commands')).toBe(true));
    const command = calls.find((call) => call.url === '/api/commands')!.body!;
    expect(command).toMatchObject({ name: 'automation.create', projectId: project.id, input: { name: '评审通过后复核' } });
    expect((command.input as Record<string, unknown>).enabled).toBeUndefined();
    expect(screen.queryByText('选择项目')).toBeNull();
  });

  it('opens definition code from an empty draft so import is a real creation path', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith('/api/automations')) return { ok: true, json: async () => ({ automations: [] }) };
      return { ok: true, json: async () => ({ status: 'applied' }) };
    }));
    render(<ProjectAutomationWorkspace project={project} agents={agents} />);
    fireEvent.click((await screen.findAllByRole('button', { name: '创建自动化' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: '定义代码' }));
    const editor = screen.getByRole('textbox', { name: '自动化定义代码' }) as HTMLTextAreaElement;
    expect(editor.value).toContain('"schemaVersion": 1');
    expect(editor.value).toContain('"name": ""');
    expect(screen.getByRole('button', { name: '校验并应用' })).toBeTruthy();
  });

  it('shows natural-language behavior, run history, explicit enable and run-now commands', async () => {
    const automation = {
      id: 'automation-1', projectId: project.id, name: '评审复核', description: '', enabled: false,
      trigger: { type: 'event', eventType: 'review.decision_recorded', conditions: [] },
      actions: [{ id: 'dispatch', type: 'dispatch_agent', agentId: 'reviewer', prompt: '复核' }],
      revision: 2, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
      runs: [{ id: 'run-1', automationId: 'automation-1', projectId: project.id, status: 'completed', triggerContext: {}, trace: [], createdAt: '2026-08-25T01:00:00.000Z', updatedAt: '2026-08-25T01:00:00.000Z' }],
    };
    const commands: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/automations')) return { ok: true, json: async () => ({ automations: [automation] }) };
      commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ status: 'applied' }) };
    }));
    render(<ProjectAutomationWorkspace project={project} agents={agents} />);
    expect((await screen.findAllByText('当“评审产生决定”时，交给 Reviewer。')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch', { name: '启用自动化' }));
    await waitFor(() => expect(commands[0]).toMatchObject({ name: 'automation.set_enabled', expectedRevision: 2, input: { enabled: true } }));
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }));
    await waitFor(() => expect(commands.some((command) => command.name === 'automation.trigger')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /运行记录/ }));
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
  });

  it('expands step trace and retries a failed run through the command kernel', async () => {
    const automation = {
      id: 'automation-failed', projectId: project.id, name: '失败自动化', description: '', enabled: true,
      trigger: { type: 'manual' }, actions: [{ id: 'notify', type: 'notify', message: '通知' }],
      revision: 4, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
      runs: [{
        id: 'run-failed', automationId: 'automation-failed', projectId: project.id, status: 'failed',
        triggerContext: {}, definitionRevision: 3, triggerSnapshot: { type: 'manual' },
        actionsSnapshot: [{ id: 'notify', type: 'notify', message: '通知' }], retryCount: 0,
        trace: [{ stepId: 'notify', actionType: 'notify', status: 'failed', startedAt: '2026-08-25T01:00:00.000Z', completedAt: '2026-08-25T01:01:00.000Z', error: 'automation_notification_failed' }],
        errorCode: 'automation_notification_failed', errorMessage: 'automation_notification_failed',
        createdAt: '2026-08-25T01:00:00.000Z', updatedAt: '2026-08-25T01:01:00.000Z',
      }],
    };
    const commands: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/automations')) return { ok: true, json: async () => ({ automations: [automation] }) };
      commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ status: 'applied' }) };
    }));

    render(<ProjectAutomationWorkspace project={project} agents={agents} />);
    await screen.findByText('失败自动化');
    fireEvent.click(screen.getByRole('button', { name: /运行记录/ }));
    fireEvent.click(screen.getByRole('button', { name: /失败.*定义 v3/ }));
    expect(screen.getByText('1. 通知项目')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(commands[0]).toMatchObject({ name: 'automation.retry', projectId: project.id, input: { runId: 'run-failed' } }));
  });

  it('renders a durable pending decision in the run trace and submits the real decide command', async () => {
    const automation = {
      id: 'automation-decision', projectId: project.id, name: '人工确认', description: '', enabled: true,
      trigger: { type: 'manual' }, actions: [{ id: 'confirm', type: 'request_decision', prompt: '是否继续？' }],
      revision: 1, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
      runs: [{
        id: 'run-decision', automationId: 'automation-decision', projectId: project.id, status: 'waiting_decision', currentStep: 0,
        triggerContext: {}, definitionRevision: 1, triggerSnapshot: { type: 'manual' },
        actionsSnapshot: [{ id: 'confirm', type: 'request_decision', prompt: '是否继续？' }], retryCount: 0,
        trace: [{ stepId: 'confirm', actionType: 'request_decision', status: 'waiting_decision', startedAt: '2026-08-25T01:00:00.000Z', output: { decisionId: 'decision-1' } }],
        decisions: [{ id: 'decision-1', automationId: 'automation-decision', runId: 'run-decision', projectId: project.id, stepId: 'confirm', prompt: '是否继续？', status: 'pending', requestedBy: 'automation-runtime', createdAt: '2026-08-25T01:00:00.000Z' }],
        createdAt: '2026-08-25T01:00:00.000Z', updatedAt: '2026-08-25T01:00:00.000Z',
      }],
    };
    const commands: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/automations')) return { ok: true, json: async () => ({ automations: [automation] }) };
      commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ status: 'applied' }) };
    }));

    render(<ProjectAutomationWorkspace project={project} agents={agents} />);
    await screen.findByText('人工确认');
    fireEvent.click(screen.getByRole('button', { name: /运行记录/ }));
    fireEvent.click(screen.getByRole('button', { name: /等待决定.*定义 v1/ }));
    expect(screen.getByText('是否继续？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '批准继续' }));
    await waitFor(() => expect(commands[0]).toMatchObject({
      name: 'automation.decide', projectId: project.id,
      input: { decisionId: 'decision-1', decision: 'approved' },
    }));
  });
});
