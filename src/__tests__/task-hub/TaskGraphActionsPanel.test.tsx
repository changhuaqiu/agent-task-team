// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskGraphActionsPanel } from '@/components/task-hub/TaskGraphActionsPanel';

const task = {
  id: 'task-1',
  conversationId: 'conv-1',
  projectPath: '',
  title: '群聊 UI',
  status: 'blocked',
  agentId: 'frontend',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ receipt: {
        idempotencyKey: command.idempotencyKey,
        commandType: command.type,
        projectPath: command.projectPath,
        deliveryId: command.deliveryId,
        status: 'accepted',
        duplicate: false,
        targetAgentIds: [],
        recordedAt: command.issuedAt,
      } }),
    };
  }));
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function submittedBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls[0];
  if (!call) throw new Error('Expected fetch to be called');
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

describe('TaskGraphActionsPanel', () => {
  it('resumes blocked tasks through the task graph API', async () => {
    const onChanged = vi.fn();
    render(<TaskGraphActionsPanel task={task} revision={7} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: '检查后重试' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/workspace-commands', expect.objectContaining({
      method: 'POST',
    })));
    expect(submittedBody()).toMatchObject({
      action: 'resumeTask',
      expectedRevision: 7,
      input: { taskId: 'task-1' },
    });
    expect(submittedBody().idempotencyKey).toEqual(expect.any(String));
    expect(onChanged).toHaveBeenCalled();
  });

  it('requires browser confirmation before canceling a task', async () => {
    render(<TaskGraphActionsPanel task={{ ...task, status: 'in_progress' }} revision={7} agents={[{ id: 'frontend', name: 'Frontend' }, { id: 'reviewer', name: 'Reviewer' }]} />);

    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(submittedBody()).toMatchObject({
      action: 'cancelTask',
      input: expect.objectContaining({ confirmed: true }),
    });
  });

  it('submits split children from textarea input', async () => {
    render(<TaskGraphActionsPanel task={{ ...task, status: 'in_progress' }} revision={7} agents={[{ id: 'frontend', name: 'Frontend' }, { id: 'reviewer', name: 'Reviewer' }]} />);

    fireEvent.change(screen.getByLabelText('拆分子任务'), { target: { value: 'API 合约\n群聊组件' } });
    fireEvent.click(screen.getByRole('button', { name: '拆分' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(submittedBody()).toMatchObject({
      action: 'splitTask',
      input: {
        parentTaskId: 'task-1',
        children: [{ title: 'API 合约', ownerAgentId: 'frontend' }, { title: '群聊组件', ownerAgentId: 'frontend' }],
      },
    });
  });

  it('submits reassignment from owner input', async () => {
    render(<TaskGraphActionsPanel task={{ ...task, status: 'in_progress' }} revision={7} agents={[{ id: 'frontend', name: 'Frontend' }, { id: 'reviewer', name: 'Reviewer' }]} />);

    fireEvent.change(screen.getByLabelText('改派给'), { target: { value: 'reviewer' } });
    fireEvent.click(screen.getByRole('button', { name: '改派' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(submittedBody()).toMatchObject({
      action: 'assignTask',
      input: {
        taskId: 'task-1',
        ownerAgentId: 'reviewer',
        confirmed: true,
      },
    });
  });
});
