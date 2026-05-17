// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskGraphTimeline } from '@/components/task-hub/TaskGraphTimeline';
import type { TaskGraphApiView } from '@/lib/taskGraphView';

afterEach(cleanup);

function graph(): TaskGraphApiView {
  return {
    conversationId: 'conv-1',
    tasks: [],
    edges: [],
    actions: [
      {
        id: 'act-1',
        actor_id: 'planner',
        actor_type: 'agent',
        type: 'task.split',
        task_ids: JSON.stringify(['task-1']),
        payload: JSON.stringify({ reason: '拆出 UI 分支' }),
        created_at: '2026-05-15T10:00:00.000Z',
      },
    ],
    artifacts: [
      {
        id: 'art-1',
        task_id: 'task-1',
        kind: 'doc',
        label: '设计说明',
        path: 'docs/design.md',
        created_at: '2026-05-15T10:10:00.000Z',
      },
    ],
    bindings: [
      {
        id: 'bind-1',
        message_id: 'msg-1',
        task_id: 'task-1',
        created_at: '2026-05-15T10:20:00.000Z',
      },
    ],
    proofEvents: [
      {
        id: 'proof-1',
        event_type: 'task_graph.policy.blocked',
        task_id: 'task-1',
        actor_id: 'user',
        reason_code: 'task_graph.confirmation_required',
        created_at: '2026-05-15T10:30:00.000Z',
      },
    ],
  };
}

describe('TaskGraphTimeline', () => {
  it('renders action, artifact, chat binding, and proof events for a task', () => {
    render(<TaskGraphTimeline graph={graph()} taskId="task-1" />);

    expect(screen.getByText('任务拆分')).toBeTruthy();
    expect(screen.getByText('产出：设计说明')).toBeTruthy();
    expect(screen.getByText('关联聊天消息')).toBeTruthy();
    expect(screen.getByText('task_graph.policy.blocked')).toBeTruthy();
  });

  it('renders an empty state when no timeline exists', () => {
    render(<TaskGraphTimeline graph={graph()} taskId="missing" />);

    expect(screen.getByText('还没有结构化任务动态')).toBeTruthy();
  });
});
