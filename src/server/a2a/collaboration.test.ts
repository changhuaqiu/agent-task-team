import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import {
  A2ACollaborationInvariantError,
  A2AIdempotencyConflictError,
  A2ACollaborationRepository,
  StaleA2ARevisionError,
} from './collaboration';

const NOW = new Date('2026-07-28T10:00:00.000Z');

function packet(action: string) {
  return {
    title: action,
    requestedAction: action,
    possessionSummary: `Need to ${action}`,
    relevantDecisions: [],
    evidenceRefs: [],
    constraints: [],
    openQuestions: [],
    forbiddenBehaviors: ['Do not acknowledge without acting'],
    sourceMessageIds: ['message-1'],
  };
}

describe('A2ACollaborationRepository', () => {
  let repository: A2ACollaborationRepository;
  let sequence: number;

  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-a2a-aggregate', 'A2A Aggregate', 'active', NOW.toISOString(), NOW.toISOString());
    sequence = 0;
    repository = new A2ACollaborationRepository({
      db,
      inbox: new AgentInbox({
        db,
        now: () => NOW,
        idFactory: (prefix) => `${prefix}-${++sequence}`,
      }),
      now: () => NOW,
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
  });

  afterEach(() => resetDb());

  it('offers fan-out and Agent Inbox admission in one aggregate transaction', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-1',
      holderId: 'lead',
      holderType: 'agent',
      config: { maxDepth: 5 },
    });
    const offered = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'fan-out-1',
      branches: [
        { toAgentId: 'builder', intent: 'implement', taskId: 'TASK-1', packet: packet('implement TASK-1') },
        { toAgentId: 'reviewer', intent: 'review', taskId: 'TASK-2', packet: packet('review TASK-2') },
      ],
    });

    expect(offered).toMatchObject({
      duplicate: false,
      group: { mode: 'fan_out', status: 'offered', expectedCount: 2, hopCount: 1 },
    });
    expect(offered.passes.map((pass) => pass.toAgentId)).toEqual(['builder', 'reviewer']);
    expect(offered.inboxItems).toHaveLength(2);
    expect(offered.inboxItems.map((item) => item.command.passId)).toEqual(
      offered.passes.map((pass) => pass.id),
    );
    expect(repository.getPossession(created.rootPossession.id)).toMatchObject({
      status: 'handoff_offered',
      revision: 1,
    });
  });

  it('keeps successful fan-out branches and atomically opens source recovery for failures', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-fanout',
      holderId: 'lead',
      holderType: 'agent',
      config: { maxDepth: 5 },
    });
    const offered = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'fanout-recovery',
      branches: [
        { toAgentId: 'builder', intent: 'implement', packet: packet('build') },
        { toAgentId: 'tester', intent: 'verify', packet: packet('verify') },
      ],
    });
    const builderAdmitted = repository.markPassAdmitted(offered.passes[0]!.id, 0);
    const builderStarting = repository.markPassStarting(builderAdmitted.id, builderAdmitted.revision);
    const builderStarted = repository.markPassStarted(
      builderStarting.id,
      builderStarting.revision,
    );
    repository.failPass({
      passId: offered.passes[1]!.id,
      expectedRevision: 0,
      status: 'rejected',
      reasonCode: 'runtime_profile_missing',
      phase: 'start',
    });

    const group = repository.getGroup(offered.group.id)!;
    expect(group).toMatchObject({
      status: 'recovering',
      resolvedCount: 2,
      recoveryPossessionId: expect.any(String),
    });
    expect(repository.getPossession(created.rootPossession.id)).toMatchObject({
      status: 'completed',
    });
    expect(repository.listOpenPossessions(created.chain.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: builderStarted.possession.id, holderId: 'builder' }),
      expect.objectContaining({ id: group.recoveryPossessionId, holderId: 'lead' }),
    ]));

    repository.completePossession({
      possessionId: builderStarted.possession.id,
      expectedRevision: builderStarted.possession.revision,
      summary: 'built',
    });
    const recovery = repository.getPossession(group.recoveryPossessionId!)!;
    repository.completePossession({
      possessionId: recovery.id,
      expectedRevision: recovery.revision,
      summary: 'failure handled',
    });
    expect(repository.getGroup(group.id)).toMatchObject({ status: 'completed' });
    expect(repository.getChain(created.chain.id)).toMatchObject({ status: 'completed' });
  });

  it('rejects cycle transfer and hop-budget exhaustion from the possession ancestry', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-cycle',
      holderId: 'agent-a',
      holderType: 'agent',
      config: { maxDepth: 1 },
    });
    const first = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'a-to-b',
      branches: [{ toAgentId: 'agent-b', intent: 'delegate', packet: packet('continue') }],
    });
    const admitted = repository.markPassAdmitted(first.passes[0]!.id, 0);
    const starting = repository.markPassStarting(admitted.id, admitted.revision);
    const started = repository.markPassStarted(starting.id, starting.revision);

    expect(() => repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: started.possession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'b-to-a',
      branches: [{ toAgentId: 'agent-a', intent: 'delegate', packet: packet('send back') }],
    })).toThrowError(expect.objectContaining({ reasonCode: 'a2a_cycle_detected' }));

    expect(() => repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: started.possession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'b-to-c',
      branches: [{ toAgentId: 'agent-c', intent: 'delegate', packet: packet('continue deeper') }],
    })).toThrowError(expect.objectContaining({ reasonCode: 'a2a_hop_budget_exceeded' }));
  });

  it('uses source revision and semantic idempotency as aggregate guards', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'system',
      rootTriggerId: 'trigger-idempotent',
      holderId: 'system',
      holderType: 'system',
    });
    expect(() => repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: 1,
      idempotencyKey: 'guarded',
      branches: [{ toAgentId: 'builder', intent: 'implement', packet: packet('build') }],
    })).toThrow(StaleA2ARevisionError);

    const offered = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'guarded',
      branches: [{ toAgentId: 'builder', intent: 'implement', packet: packet('build') }],
    });
    expect(repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'guarded',
      branches: [{ toAgentId: 'builder', intent: 'implement', packet: packet('build') }],
    })).toMatchObject({
      duplicate: true,
      group: { id: offered.group.id },
    });
    expect(() => repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: 0,
      idempotencyKey: 'guarded',
      branches: [{ toAgentId: 'builder', intent: 'implement', packet: packet('different') }],
    })).toThrow(A2AIdempotencyConflictError);
  });

  it('does not silently accept a second active collaboration chain', () => {
    repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-first',
      holderId: 'user',
      holderType: 'user',
    });
    expect(() => repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-second',
      holderId: 'user',
      holderType: 'user',
    })).toThrow(A2ACollaborationInvariantError);
  });
});
