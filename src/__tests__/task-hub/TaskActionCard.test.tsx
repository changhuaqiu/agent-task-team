// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskActionCard, type TaskActionCardRef } from '@/components/task-hub/TaskActionCard';

afterEach(cleanup);

describe('TaskActionCard', () => {
  it('renders split actions as playful group-chat events', () => {
    const action: TaskActionCardRef = {
      id: 'act-1',
      actionType: 'task.split',
      actorAgentId: 'architect',
      taskIds: ['root', 'api', 'ui'],
      summary: '把总任务拆成 API 与界面两条线',
      createdAt: '2026-05-15T10:00:00.000Z',
    };

    render(<TaskActionCard action={action} />);

    expect(screen.getByText('任务分身术')).toBeTruthy();
    expect(screen.getByText('@architect')).toBeTruthy();
    expect(screen.getByText('把总任务拆成 API 与界面两条线')).toBeTruthy();
    expect(screen.getByText('root → api、ui')).toBeTruthy();
  });

  it('renders merge actions with source and target task lineage', () => {
    const action: TaskActionCardRef = {
      id: 'act-2',
      actionType: 'task.merged',
      taskIds: ['api', 'ui', 'release'],
      summary: 'API 与界面回流到发布任务',
      payload: { sourceTaskIds: ['api', 'ui'], targetTaskId: 'release' },
      createdAt: '2026-05-15T10:30:00.000Z',
    };

    render(<TaskActionCard action={action} />);

    expect(screen.getByText('任务合体')).toBeTruthy();
    expect(screen.getByText('api、ui → release')).toBeTruthy();
  });

  it('notifies selected tasks from the action card', () => {
    const onSelectTask = vi.fn();
    const action: TaskActionCardRef = {
      id: 'act-3',
      actionType: 'task.blocked',
      taskIds: ['task-7'],
      summary: '等待接口确认',
      createdAt: '2026-05-15T11:00:00.000Z',
    };

    render(<TaskActionCard action={action} onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByRole('button', { name: /查看 task-7/ }));

    expect(onSelectTask).toHaveBeenCalledWith('task-7');
  });
});
