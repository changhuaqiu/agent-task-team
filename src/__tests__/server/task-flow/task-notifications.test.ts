import { describe, expect, it } from 'vitest';
import type { TaskEdgeRow } from '@/server/repositories/task-graph-repo';
import type { TaskRow } from '@/server/repositories/task-repo';
import {
  buildTaskNotification,
  resolveTaskNotificationRecipients,
} from '@/server/task-flow/task-notifications';

function task(overrides: Partial<TaskRow> & Pick<TaskRow, 'id' | 'agent_id'>): TaskRow {
  const now = '2026-05-16T00:00:00.000Z';
  return {
    id: overrides.id,
    conversation_id: overrides.conversation_id ?? 'conv-1',
    title: overrides.title ?? overrides.id,
    description: overrides.description ?? null,
    status: overrides.status ?? 'pending',
    agent_id: overrides.agent_id,
    dependencies: overrides.dependencies ?? null,
    artifacts: overrides.artifacts ?? null,
    review_note: overrides.review_note ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

function edge(overrides: Partial<TaskEdgeRow> & Pick<TaskEdgeRow, 'from_task_id' | 'to_task_id' | 'type'>): TaskEdgeRow {
  return {
    id: overrides.id ?? `edge-${overrides.from_task_id}-${overrides.to_task_id}`,
    conversation_id: overrides.conversation_id ?? 'conv-1',
    from_task_id: overrides.from_task_id,
    to_task_id: overrides.to_task_id,
    type: overrides.type,
    created_by_action_id: overrides.created_by_action_id ?? 'action-1',
    created_at: overrides.created_at ?? '2026-05-16T00:00:00.000Z',
  };
}

describe('task notifications', () => {
  it('notifies task owner, coordinator, and downstream dependency owners without creating a handoff', () => {
    const updated = task({ id: 'TASK-003', title: '修复 A2A 通知', agent_id: 'toad', status: 'in_review' });
    const downstream = task({ id: 'TASK-009', title: '前端联调', agent_id: 'luigi' });

    const recipients = resolveTaskNotificationRecipients({
      kind: 'task.status_changed',
      task: updated,
      previousTask: { ...updated, status: 'in_progress' },
      actorId: 'peach',
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach'],
      conversationTasks: [updated, downstream],
      edges: [edge({ from_task_id: 'TASK-003', to_task_id: 'TASK-009', type: 'depends_on' })],
    });

    expect(recipients).toEqual(['toad', 'mario', 'luigi']);
  });

  it('includes previous and next owners when assignment changes', () => {
    const previous = task({ id: 'TASK-010', agent_id: 'toad' });
    const updated = { ...previous, agent_id: 'luigi' };

    expect(resolveTaskNotificationRecipients({
      kind: 'task.updated',
      task: updated,
      previousTask: previous,
      actorId: 'mario',
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: [],
      conversationTasks: [updated],
      edges: [],
    })).toEqual(['luigi', 'toad']);
  });

  it('builds a persisted group-chat notification payload with mentions and task metadata', () => {
    const updated = task({ id: 'TASK-006', title: '代码评审', agent_id: 'toad', status: 'done' });

    const notification = buildTaskNotification({
      kind: 'task.status_changed',
      task: updated,
      previousTask: { ...updated, status: 'in_review' },
      actorId: 'peach',
      actorType: 'agent',
      recipients: ['toad', 'mario'],
      changedFields: ['status', 'review_note'],
    });

    expect(notification).toMatchObject({
      conversationId: 'conv-1',
      taskId: 'TASK-006',
      actorId: 'peach',
      actorType: 'agent',
      recipients: ['toad', 'mario'],
      kind: 'task.status_changed',
      changedFields: ['status', 'review_note'],
    });
    expect(notification.content).toContain('@toad @mario');
    expect(notification.content).toContain('TASK-006');
    expect(notification.metadata.startsA2AHandoff).toBe(false);
  });
});
