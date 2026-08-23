import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { AcpRuntimeDriver } from './acp-runtime-driver';
import { AgentSessionLifecycle } from './agent-session-lifecycle';

describe('AgentSessionLifecycle', () => {
  beforeEach(() => {
    setTestDb(createTestDb());
    conversationRepo.create({ id: 'project-1', title: 'Runtime project' });
  });
  afterEach(() => resetDb());

  it('keeps a live cross-worker Invocation busy and recovers only after its owner lease expires', () => {
    const lifecycle = new AgentSessionLifecycle(new AcpRuntimeDriver());
    const acquired = lifecycle.acquireInvocation({
      agentId: 'mario',
      projectId: 'project-1',
      taskId: 'TASK-1',
      isolationKey: '',
      executionProfile: { engine: 'claude', runtimeId: 'claude-acp' },
      engine: 'claude',
      prompt: 'Implement TASK-1',
      correlationId: 'trace-1',
      causationId: 'envelope-1',
      runtimeOwnerId: 'daemon-1',
      runtimeOwnerToken: 'owner-token-1',
    });

    expect(acquired.agentSession).toMatchObject({
      agent_id: 'mario',
      conversation_id: 'project-1',
      status: 'active',
    });
    expect(acquired.invocation).toMatchObject({
      session_id: acquired.agentSession.id,
    });
    invocationRepo.transition(acquired.invocation.id, {
      to: 'starting',
      expectedFrom: 'planned',
    });
    const retry = () => lifecycle.acquireInvocation({
      agentId: 'mario',
      projectId: 'project-1',
      taskId: 'TASK-1',
      isolationKey: '',
      executionProfile: { engine: 'claude', runtimeId: 'claude-acp' },
      engine: 'claude',
      prompt: 'Duplicate',
      correlationId: 'trace-2',
      runtimeOwnerId: 'daemon-2',
      runtimeOwnerToken: 'owner-token-2',
    });

    expect(retry).toThrow('runtime_lane_busy');
    expect(invocationRepo.getById(acquired.invocation.id)?.status).toBe('starting');
    const expiredAt = '2026-01-01T00:00:00.000Z';
    getDb().prepare('UPDATE invocation SET lease_expiry=? WHERE id=?')
      .run(expiredAt, acquired.invocation.id);
    const recovered = retry();

    expect(invocationRepo.getById(acquired.invocation.id)).toMatchObject({
      status: 'terminated',
      outcome: 'failed',
      reason_code: 'orphaned_runtime_owner_lease_expired',
    });
    expect(lifecycle.get(acquired.agentSession.id)?.status).toBe('sealed');
    expect(recovered.agentSession.id).not.toBe(acquired.agentSession.id);
    expect(recovered.invocation.status).toBe('planned');

    expect(lifecycle.completeOwnedInvocation({
      invocationId: acquired.invocation.id,
      runtimeOwnerToken: 'owner-token-1',
      sessionId: acquired.agentSession.id,
      runtimeSessionId: 'late-runtime-session',
    })).toBeUndefined();
    expect(lifecycle.get(acquired.agentSession.id)?.cli_session_id).toBeNull();
    expect(invocationRepo.getById(acquired.invocation.id)).toMatchObject({
      status: 'terminated',
      outcome: 'failed',
      reason_code: 'orphaned_runtime_owner_lease_expired',
    });
    expect(invocationRepo.getById(recovered.invocation.id)?.status).toBe('planned');
  });
});
