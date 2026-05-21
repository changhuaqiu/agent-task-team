import { describe, expect, it } from 'vitest';
import type { ExecutionEnvelopeRow } from '@/server/repositories/execution-envelope-repo';
import type { TaskRow } from '@/server/repositories/task-repo';
import { resolveAutonomyGuardWakeups } from '@/server/task-flow/autonomy-guard';

function task(overrides: Partial<TaskRow> & Pick<TaskRow, 'id' | 'agent_id' | 'status'>): TaskRow {
  const now = '2026-05-21T00:00:00.000Z';
  return {
    id: overrides.id,
    conversation_id: overrides.conversation_id ?? 'conv-1',
    title: overrides.title ?? overrides.id,
    description: overrides.description ?? null,
    status: overrides.status,
    agent_id: overrides.agent_id,
    dependencies: overrides.dependencies ?? null,
    artifacts: overrides.artifacts ?? null,
    review_note: overrides.review_note ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

function envelope(overrides: Partial<ExecutionEnvelopeRow> & Pick<ExecutionEnvelopeRow, 'task_id' | 'status'>): ExecutionEnvelopeRow {
  return {
    id: overrides.id ?? 'env-1',
    source: overrides.source ?? 'workflow',
    intent: overrides.intent ?? 'implement',
    conversation_id: overrides.conversation_id ?? 'conv-1',
    task_id: overrides.task_id,
    chain_id: overrides.chain_id ?? null,
    pass_id: overrides.pass_id ?? null,
    from_node_id: overrides.from_node_id ?? 'browser:1',
    from_agent_id: overrides.from_agent_id ?? null,
    to_node_id: overrides.to_node_id ?? 'daemon:local',
    to_agent_id: overrides.to_agent_id ?? 'luigi',
    payload: overrides.payload ?? '{}',
    ttl_ms: overrides.ttl_ms ?? 120000,
    nonce: overrides.nonce ?? 'nonce',
    status: overrides.status,
    reason_code: overrides.reason_code ?? null,
    expires_at: overrides.expires_at ?? '2026-05-21T00:02:00.000Z',
    created_at: overrides.created_at ?? '2026-05-21T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-21T00:00:00.000Z',
  };
}

describe('autonomy guard wakeups', () => {
  it('wakes an owned pending task when dependencies are satisfied and no dispatch is active', () => {
    const wakeups = resolveAutonomyGuardWakeups({
      tasks: [
        task({ id: 'TASK-001', agent_id: 'mario', status: 'done' }),
        task({ id: 'TASK-002', agent_id: 'luigi', status: 'pending', dependencies: '["TASK-001"]' }),
      ],
      envelopes: [],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach'],
      qaAgentIds: ['yoshi'],
      now: new Date('2026-05-21T00:31:00.000Z'),
    });

    expect(wakeups).toMatchObject([{
      taskId: 'TASK-002',
      agentId: 'luigi',
      reasonCode: 'owner_ready',
    }]);
  });

  it('does not duplicate a wakeup while an execution envelope is active', () => {
    const wakeups = resolveAutonomyGuardWakeups({
      tasks: [task({ id: 'TASK-002', agent_id: 'luigi', status: 'pending' })],
      envelopes: [envelope({ task_id: 'TASK-002', status: 'started' })],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach'],
      qaAgentIds: ['yoshi'],
    });

    expect(wakeups).toEqual([]);
  });

  it('wakes gate owners when review and test gates become stale', () => {
    const wakeups = resolveAutonomyGuardWakeups({
      tasks: [
        task({ id: 'TASK-003', agent_id: 'toad', status: 'in_review', updated_at: '2026-05-21T00:00:00.000Z' }),
        task({ id: 'TASK-004', agent_id: 'yoshi', status: 'test_gate', updated_at: '2026-05-21T00:00:00.000Z' }),
      ],
      envelopes: [],
      coordinatorAgentIds: ['mario'],
      reviewAgentIds: ['peach'],
      qaAgentIds: ['yoshi'],
      now: new Date('2026-05-21T00:31:00.000Z'),
      staleMs: 30 * 60 * 1000,
    });

    expect(wakeups).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'TASK-003', agentId: 'peach', reasonCode: 'stale_review_gate' }),
      expect.objectContaining({ taskId: 'TASK-004', agentId: 'yoshi', reasonCode: 'stale_test_gate' }),
    ]));
  });
});
