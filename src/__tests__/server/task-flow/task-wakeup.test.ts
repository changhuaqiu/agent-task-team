import { describe, expect, it } from 'vitest';
import type { TaskEdgeRow } from '@/server/repositories/task-graph-repo';
import type { TaskRow } from '@/server/repositories/task-repo';
import { resolveTaskWakeups } from '@/server/task-flow/task-wakeup';

function task(overrides: Partial<TaskRow> & Pick<TaskRow, 'id' | 'agent_id'>): TaskRow {
  const now = '2026-05-17T00:00:00.000Z';
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
    created_at: overrides.created_at ?? '2026-05-17T00:00:00.000Z',
  };
}

describe('task wakeup resolver', () => {
  it('wakes an owner when a pending task is ready and has no blockers', () => {
    const next = task({ id: 'TASK-008', agent_id: 'toad', status: 'pending', title: 'Execution Adapter' });

    const wakeups = resolveTaskWakeups({
      task: next,
      previousTask: { ...next, status: 'blocked' },
      actorId: 'system',
      changedFields: ['status'],
      coordinatorAgentIds: [],
      reviewAgentIds: [],
      conversationTasks: [next],
      edges: [],
    });

    expect(wakeups).toMatchObject([{
      taskId: 'TASK-008',
      agentId: 'toad',
      reasonCode: 'owner_ready',
      dispatchSource: 'workflow',
    }]);
    expect(wakeups[0].content).toContain('系统轻推 @toad');
    expect(wakeups[0].metadata.startsA2AHandoff).toBe(false);
  });

  it('does not wake a pending owner while dependencies are unresolved', () => {
    const dependency = task({ id: 'TASK-001', agent_id: 'luigi', status: 'in_progress' });
    const next = task({ id: 'TASK-002', agent_id: 'toad', status: 'pending', dependencies: '["TASK-001"]' });

    const wakeups = resolveTaskWakeups({
      task: next,
      previousTask: { ...next, status: 'blocked' },
      actorId: 'system',
      changedFields: ['status'],
      coordinatorAgentIds: [],
      reviewAgentIds: [],
      conversationTasks: [dependency, next],
      edges: [],
    });

    expect(wakeups).toEqual([]);
  });

  it('wakes review roles when a task enters review and skips the actor', () => {
    const reviewed = task({ id: 'TASK-003', agent_id: 'toad', status: 'in_review' });

    const wakeups = resolveTaskWakeups({
      task: reviewed,
      previousTask: { ...reviewed, status: 'in_progress' },
      actorId: 'peach',
      changedFields: ['status'],
      coordinatorAgentIds: [],
      reviewAgentIds: ['peach', 'dk'],
      conversationTasks: [reviewed],
      edges: [],
    });

    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]).toMatchObject({
      taskId: 'TASK-003',
      agentId: 'dk',
      reasonCode: 'review_requested',
      dispatchSource: 'review_gate',
    });
  });

  it('wakes coordinators when a reviewer submits a review decision', () => {
    const reviewed = task({
      id: 'TASK-003',
      agent_id: 'toad',
      status: 'in_review',
      review_note: 'PASS: architecture review approved',
    });

    const wakeups = resolveTaskWakeups({
      task: reviewed,
      previousTask: { ...reviewed, review_note: null },
      actorId: 'dk',
      changedFields: ['review_note'],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach', 'dk'],
      conversationTasks: [reviewed],
      edges: [],
    });

    expect(wakeups).toMatchObject([{
      taskId: 'TASK-003',
      agentId: 'mario',
      reasonCode: 'review_decision_ready',
      dispatchSource: 'review_gate',
    }]);
    expect(wakeups[0].content).toContain('请确认评审结论');
    expect(wakeups[0].metadata.startsA2AHandoff).toBe(false);
  });

  it('wakes QA when a reviewer submits a passing review decision', () => {
    const reviewed = task({
      id: 'TASK-004',
      agent_id: 'toad',
      status: 'in_review',
      review_note: 'PASS-WITH-NOTES: review approved, ready for test gate',
    });

    const wakeups = resolveTaskWakeups({
      task: reviewed,
      previousTask: { ...reviewed, review_note: null },
      actorId: 'peach',
      changedFields: ['review_note'],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach', 'dk'],
      qaAgentIds: ['yoshi'],
      conversationTasks: [reviewed],
      edges: [],
    });

    expect(wakeups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: 'TASK-004',
        agentId: 'mario',
        reasonCode: 'review_decision_ready',
        dispatchSource: 'review_gate',
      }),
      expect.objectContaining({
        taskId: 'TASK-004',
        agentId: 'yoshi',
        reasonCode: 'test_requested',
        dispatchSource: 'test_gate',
      }),
    ]));
  });

  it('does not wake QA when a reviewer rejects the task', () => {
    const reviewed = task({
      id: 'TASK-004',
      agent_id: 'toad',
      status: 'in_review',
      review_note: 'REJECTED: blocking issue must be fixed before QA',
    });

    const wakeups = resolveTaskWakeups({
      task: reviewed,
      previousTask: { ...reviewed, review_note: null },
      actorId: 'peach',
      changedFields: ['review_note'],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach', 'dk'],
      qaAgentIds: ['yoshi'],
      conversationTasks: [reviewed],
      edges: [],
    });

    expect(wakeups.some((wakeup) => wakeup.reasonCode === 'test_requested')).toBe(false);
  });

  it('infers a reviewer-owned file sync as a review decision callback', () => {
    const reviewed = task({
      id: 'TASK-010',
      agent_id: 'dk',
      status: 'in_review',
      title: 'Architecture checkpoint',
    });

    const wakeups = resolveTaskWakeups({
      task: reviewed,
      previousTask: { ...reviewed, status: 'in_progress' },
      actorId: 'system',
      changedFields: ['status'],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach', 'dk'],
      conversationTasks: [reviewed],
      edges: [],
    });

    expect(wakeups).toMatchObject([{
      taskId: 'TASK-010',
      agentId: 'mario',
      reasonCode: 'review_decision_ready',
      dispatchSource: 'review_gate',
    }]);
  });

  it('wakes downstream pending owners when dependencies become done', () => {
    const completed = task({ id: 'TASK-004', agent_id: 'toad', status: 'done' });
    const downstream = task({ id: 'TASK-005', agent_id: 'luigi', status: 'pending' });

    const wakeups = resolveTaskWakeups({
      task: completed,
      previousTask: { ...completed, status: 'in_review' },
      actorId: 'toad',
      changedFields: ['status'],
      coordinatorAgentIds: [],
      reviewAgentIds: [],
      conversationTasks: [completed, downstream],
      edges: [edge({ from_task_id: 'TASK-004', to_task_id: 'TASK-005', type: 'depends_on' })],
    });

    expect(wakeups).toMatchObject([{
      taskId: 'TASK-005',
      agentId: 'luigi',
      reasonCode: 'dependency_resolved',
      dispatchSource: 'workflow',
    }]);
  });

  it('resolves downstream wakeups from compatibility dependency fields without task edges', () => {
    const completed = task({ id: 'TASK-004', agent_id: 'toad', status: 'done' });
    const downstream = task({
      id: 'TASK-005',
      agent_id: 'luigi',
      status: 'pending',
      dependencies: '["TASK-004"]',
    });

    const wakeups = resolveTaskWakeups({
      task: completed,
      previousTask: { ...completed, status: 'in_review' },
      actorId: 'toad',
      changedFields: ['status'],
      coordinatorAgentIds: [],
      reviewAgentIds: [],
      conversationTasks: [completed, downstream],
      edges: [],
    });

    expect(wakeups).toMatchObject([{
      taskId: 'TASK-005',
      agentId: 'luigi',
      reasonCode: 'dependency_resolved',
      dispatchSource: 'workflow',
    }]);
  });

  it('wakes coordinators when a downstream pending task has all dependencies met but no owner', () => {
    const completed = task({ id: 'TASK-004', agent_id: 'toad', status: 'done' });
    const downstream = task({ id: 'TASK-007', agent_id: '', status: 'pending' });

    const wakeups = resolveTaskWakeups({
      task: completed,
      previousTask: { ...completed, status: 'in_progress' },
      actorId: 'toad',
      changedFields: ['status'],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: [],
      conversationTasks: [completed, downstream],
      edges: [edge({ from_task_id: 'TASK-004', to_task_id: 'TASK-007', type: 'depends_on' })],
    });

    expect(wakeups).toMatchObject([{
      taskId: 'TASK-007',
      agentId: 'mario',
      reasonCode: 'unblocked_unassigned',
      dispatchSource: 'workflow',
    }]);
  });
});
