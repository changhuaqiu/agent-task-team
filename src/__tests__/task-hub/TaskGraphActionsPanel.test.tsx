// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskGraphActionsPanel } from '@/components/task-hub/TaskGraphActionsPanel';

const task = {
  id: 'task-1',
  conversationId: 'conv-1',
  title: '群聊 UI',
  status: 'blocked',
  agentId: 'frontend',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  })));
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TaskGraphActionsPanel', () => {
  it('resumes blocked tasks through the task graph API', async () => {
    const onChanged = vi.fn();
    render(<TaskGraphActionsPanel task={task} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: '恢复任务' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/task-graph', expect.objectContaining({
      method: 'POST',
    })));
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toMatchObject({
      action: 'resumeTask',
      taskId: 'task-1',
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('requires browser confirmation before canceling a task', async () => {
    render(<TaskGraphActionsPanel task={{ ...task, status: 'in_progress' }} />);

    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toMatchObject({
      action: 'cancelTask',
      confirmed: true,
    });
  });

  it('submits split children from textarea input', async () => {
    render(<TaskGraphActionsPanel task={{ ...task, status: 'in_progress' }} />);

    fireEvent.change(screen.getByLabelText('拆分子任务'), { target: { value: 'API 合约\n群聊组件' } });
    fireEvent.click(screen.getByRole('button', { name: '拆分' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toMatchObject({
      action: 'splitTask',
      parentTaskId: 'task-1',
      children: [{ title: 'API 合约', ownerAgentId: 'frontend' }, { title: '群聊组件', ownerAgentId: 'frontend' }],
    });
  });

  it('submits reassignment from owner input', async () => {
    render(<TaskGraphActionsPanel task={{ ...task, status: 'in_progress' }} />);

    fireEvent.change(screen.getByLabelText('改派给'), { target: { value: 'reviewer' } });
    fireEvent.click(screen.getByRole('button', { name: '改派' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toMatchObject({
      action: 'assignTask',
      taskId: 'task-1',
      ownerAgentId: 'reviewer',
      confirmed: true,
    });
  });
});
