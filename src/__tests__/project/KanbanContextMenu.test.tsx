// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KanbanContextMenu } from '@/components/project/KanbanContextMenu';
import type { Task } from '@/store/taskHubStore';

afterEach(cleanup);

function task(status: Task['status']): Task {
  return {
    id: 'TASK-REVIEW',
    conversationId: 'conv-review',
    phaseId: '',
    title: 'Review task',
    description: '',
    status,
    agentId: '',
    dependencies: [],
    artifacts: [],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

describe('KanbanContextMenu status actions', () => {
  it('never exposes evidence-gated review or completion mutations', () => {
    const props = {
      x: 0,
      y: 0,
      onStatusChange: vi.fn(),
      onAssign: vi.fn(),
      onEdit: vi.fn(),
      onViewDeps: vi.fn(),
      onClose: vi.fn(),
    };
    const { container, rerender } = render(
      <KanbanContextMenu {...props} task={task('in_progress')} />,
    );
    expect(container.querySelector('[data-status-target="in_review"]')).toBeNull();

    rerender(<KanbanContextMenu {...props} task={task('in_review')} />);
    expect(container.querySelector('[data-status-target="done"]')).toBeNull();
    expect(container.querySelectorAll('[data-status-target]')).toHaveLength(3);
  });
});
