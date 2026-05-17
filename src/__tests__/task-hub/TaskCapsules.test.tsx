// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskCapsules, type TaskCapsuleRef } from '@/components/task-hub/TaskCapsules';

afterEach(cleanup);

function makeRefs(): TaskCapsuleRef[] {
  return [
    {
      id: 'task-1',
      title: '协作模型',
      status: 'in_progress',
      ownerAgentId: 'architect',
    },
    {
      id: 'task-2',
      title: '群聊 UI',
      status: 'blocked',
      ownerAgentId: 'frontend',
    },
  ];
}

describe('TaskCapsules', () => {
  it('renders task capsules with title, status, and owner', () => {
    render(<TaskCapsules tasks={makeRefs()} />);

    expect(screen.getByRole('button', { name: /协作模型/ })).toBeTruthy();
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(screen.getByText('@architect')).toBeTruthy();
    expect(screen.getByRole('button', { name: /群聊 UI/ })).toBeTruthy();
    expect(screen.getByText('阻塞')).toBeTruthy();
  });

  it('notifies selected task when clicked', () => {
    const onSelectTask = vi.fn();
    render(<TaskCapsules tasks={makeRefs()} onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByRole('button', { name: /群聊 UI/ }));

    expect(onSelectTask).toHaveBeenCalledWith('task-2');
  });

  it('renders nothing for an empty task list', () => {
    const { container } = render(<TaskCapsules tasks={[]} />);

    expect(container.firstChild).toBeNull();
  });
});
