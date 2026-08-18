import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { WorkContractRepository } from '../work-contract/repository';
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
      sourceWorkId: 'source-work',
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

  it('[scenario:parallel-handoff] returns one bounded callback after every receiver settles', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-parallel',
      holderId: 'lead',
      holderType: 'agent',
      config: { maxDepth: 5 },
    });
    const offered = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      sourceWorkId: 'parallel-source-work',
      expectedSourceRevision: created.rootPossession.revision,
      idempotencyKey: 'parallel-handoff',
      branches: [
        { toAgentId: 'builder', intent: 'implement', packet: packet('build') },
        { toAgentId: 'tester', intent: 'verify', packet: packet('verify') },
      ],
    });
    const started = offered.passes.map((pass) => {
      const admitted = repository.markPassAdmitted(pass.id, pass.revision);
      const starting = repository.markPassStarting(admitted.id, admitted.revision);
      return repository.markPassStarted(starting.id, starting.revision);
    });

    expect(repository.getGroup(offered.group.id)).toMatchObject({
      status: 'active',
      resolvedCount: 0,
    });
    repository.completePossession({
      possessionId: started[0]!.possession.id,
      expectedRevision: started[0]!.possession.revision,
      summary: 'implementation completed',
    });
    expect(repository.getGroup(offered.group.id)).toMatchObject({
      status: 'active',
      resolvedCount: 1,
    });
    expect(repository.getChain(created.chain.id)).toMatchObject({ status: 'active' });

    repository.completePossession({
      possessionId: started[1]!.possession.id,
      expectedRevision: started[1]!.possession.revision,
      summary: 'verification completed',
    });
    const group = repository.getGroup(offered.group.id)!;
    expect(group).toMatchObject({
      status: 'recovering',
      resolvedCount: 2,
      recoveryPossessionId: expect.any(String),
    });
    expect(repository.getChain(created.chain.id)).toMatchObject({ status: 'active' });
    const callbacks = new AgentInbox({ db: getDb() }).listPending('project-a2a-aggregate')
      .filter((item) => item.projectAgentId === 'lead');
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toMatchObject({
      idempotencyKey: expect.stringContaining(`a2a-reconcile:${group.id}`),
      command: {
        workId: 'parallel-source-work',
        possessionId: group.recoveryPossessionId,
        contextScenario: 'recovery',
        a2aHandoff: {
          title: 'a2a-collaboration',
          evidenceRefs: [],
        },
      },
    });
    const callbackBundle = JSON.parse(callbacks[0]!.command.a2aHandoff!.possessionSummary);
    expect(callbackBundle).toMatchObject({
      schemaVersion: 1,
      completeness: 'complete',
      branches: [
        {
          toAgentId: 'builder',
          summary: 'implementation completed',
          status: 'completed',
          outcomeEvidence: 'missing',
          missingOutcomeReason: 'accepted_outcome_not_found',
        },
        {
          toAgentId: 'tester',
          summary: 'verification completed',
          status: 'completed',
          outcomeEvidence: 'missing',
          missingOutcomeReason: 'accepted_outcome_not_found',
        },
      ],
    });
    const reconciliation = repository.getPossession(group.recoveryPossessionId!)!;
    repository.completePossession({
      possessionId: reconciliation.id,
      expectedRevision: reconciliation.revision,
      summary: 'parallel results synthesized',
    });
    expect(repository.getGroup(group.id)).toMatchObject({ status: 'completed' });
    expect(repository.getChain(created.chain.id)).toMatchObject({ status: 'completed' });
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
      sourceWorkId: 'source-work',
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
    expect(repository.getGroup(offered.group.id)).toMatchObject({
      status: 'active',
      resolvedCount: 0,
    });
    const longFailureReason = `runtime_profile_missing:${'x'.repeat(5_000)}`;
    repository.failPass({
      passId: offered.passes[1]!.id,
      expectedRevision: 0,
      status: 'rejected',
      reasonCode: longFailureReason,
      phase: 'start',
    });
    expect(repository.getGroup(offered.group.id)).toMatchObject({
      status: 'active',
      resolvedCount: 1,
    });
    repository.completePossession({
      possessionId: builderStarted.possession.id,
      expectedRevision: builderStarted.possession.revision,
      summary: 'built',
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
      expect.objectContaining({ id: group.recoveryPossessionId, holderId: 'lead' }),
    ]));
    expect(new AgentInbox({ db: getDb() }).listPending('project-a2a-aggregate')
      .filter((item) => item.projectAgentId === 'lead'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({
            workId: 'source-work',
            possessionId: group.recoveryPossessionId,
            contextScenario: 'recovery',
          }),
        }),
      ]));
    const callback = new AgentInbox({ db: getDb() }).listPending('project-a2a-aggregate')
      .find((item) => item.projectAgentId === 'lead')!;
    expect(JSON.parse(callback.command.a2aHandoff!.possessionSummary)).toMatchObject({
      completeness: 'partial',
      branches: [
        { toAgentId: 'builder', status: 'completed', summary: 'built' },
        {
          toAgentId: 'tester',
          status: 'rejected',
          reasonCode: expect.stringContaining('[truncated]'),
          outcomeEvidence: 'missing',
        },
      ],
    });
    const partialBundle = JSON.parse(callback.command.a2aHandoff!.possessionSummary);
    expect(partialBundle.branches[1].reasonCode.length).toBeLessThanOrEqual(1_200);
    expect(callback.command.a2aHandoff!.possessionSummary.length).toBeLessThanOrEqual(24_000);
    const recovery = repository.getPossession(group.recoveryPossessionId!)!;
    repository.completePossession({
      possessionId: recovery.id,
      expectedRevision: recovery.revision,
      summary: 'failure handled',
    });
    expect(repository.getGroup(group.id)).toMatchObject({ status: 'completed' });
    expect(repository.getChain(created.chain.id)).toMatchObject({ status: 'completed' });
  });

  it('keeps human-originated multi-target commands as a direct join', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'human-fanout',
      holderId: 'human',
      holderType: 'user',
    });
    const offered = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: created.rootPossession.revision,
      idempotencyKey: 'human-fanout',
      branches: [
        { toAgentId: 'builder', intent: 'implement', packet: packet('build') },
        { toAgentId: 'reviewer', intent: 'review', packet: packet('review') },
      ],
    });
    for (const pass of offered.passes) {
      const admitted = repository.markPassAdmitted(pass.id, pass.revision);
      const starting = repository.markPassStarting(admitted.id, admitted.revision);
      const started = repository.markPassStarted(starting.id, starting.revision);
      repository.completePossession({
        possessionId: started.possession.id,
        expectedRevision: started.possession.revision,
        summary: `${pass.toAgentId} completed`,
      });
    }

    expect(repository.getGroup(offered.group.id)).toMatchObject({ status: 'completed' });
    expect(repository.getChain(created.chain.id)).toMatchObject({ status: 'completed' });
    expect(new AgentInbox({ db: getDb() }).listPending('project-a2a-aggregate')
      .filter((item) => item.projectAgentId === 'human')).toHaveLength(0);
  });

  it('selects exact accepted outcome evidence without copying branch transcripts', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'system',
      rootTriggerId: 'evidence-callback',
      holderId: 'lead',
      holderType: 'agent',
    });
    const offered = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      sourceWorkId: 'evidence-source-work',
      expectedSourceRevision: created.rootPossession.revision,
      idempotencyKey: 'evidence-fanout',
      branches: [
        { toAgentId: 'builder', intent: 'implement', packet: packet('build the feature') },
        { toAgentId: 'reviewer', intent: 'review', packet: packet('review the feature') },
      ],
    });
    const started = offered.passes.map((pass) => {
      const admitted = repository.markPassAdmitted(pass.id, pass.revision);
      const starting = repository.markPassStarting(admitted.id, admitted.revision);
      return repository.markPassStarted(starting.id, starting.revision);
    });
    const contracts = new WorkContractRepository();
    for (const [index, branch] of started.entries()) {
      const contract = contracts.issue({
        workId: `branch-work-${index}`,
        attemptId: `branch-attempt-${index}`,
        projectId: 'project-a2a-aggregate',
        agentId: branch.pass.toAgentId,
        goal: 'Complete the branch',
        acceptanceCriteria: ['Return evidence'],
        role: {},
        permissions: {},
        authoritativeRefs: [`a2a_pass:${branch.pass.id}`],
        authoritativeRevisions: {},
        contextSnapshotRef: `branch-context-${index}`,
        allowedOutcomeTypes: ['submit_task_result'],
        correlationId: 'evidence-trace',
        causationId: branch.pass.id,
        now: NOW,
      });
      expect(contracts.admitOutcome({
        outcomeId: `branch-outcome-${index}`,
        idempotencyKey: `branch-outcome-${index}`,
        contractId: contract.contractId,
        outcomeType: 'submit_task_result',
        payload: { summary: index === 0 ? 'Implemented with tests' : 'Review passed' },
        evidenceRefs: index === 0
          ? ['src/feature.ts:12', 'tests/feature.test.ts:8']
          : ['review:approved'],
        projectId: contract.projectId,
        workId: contract.workId,
        workEpoch: contract.workEpoch,
        attemptId: contract.attemptId,
        fencingToken: contract.fencingToken,
        authoritativeRevisions: contract.authoritativeRevisions,
        correlationId: contract.correlationId,
        causationId: contract.contractId,
        occurredAt: NOW.toISOString(),
      })).toMatchObject({ status: 'accepted' });
      repository.completePossession({
        possessionId: branch.possession.id,
        expectedRevision: branch.possession.revision,
        summary: index === 0 ? 'Implemented with tests' : 'Review passed',
      });
    }

    const callback = new AgentInbox({ db: getDb() }).listPending('project-a2a-aggregate')
      .find((item) => item.projectAgentId === 'lead')!;
    const bundle = JSON.parse(callback.command.a2aHandoff!.possessionSummary);
    expect(callback.command.a2aHandoff!.evidenceRefs).toEqual([
      'src/feature.ts:12',
      'tests/feature.test.ts:8',
      'review:approved',
    ]);
    expect(bundle.branches).toEqual([
      expect.objectContaining({
        toAgentId: 'builder',
        outcomeId: 'branch-outcome-0',
        outcomeEvidence: 'aligned',
        evidenceRefs: ['src/feature.ts:12', 'tests/feature.test.ts:8'],
      }),
      expect.objectContaining({
        toAgentId: 'reviewer',
        outcomeId: 'branch-outcome-1',
        outcomeEvidence: 'aligned',
        evidenceRefs: ['review:approved'],
      }),
    ]);
    expect(callback.command.a2aHandoff!.possessionSummary).not.toContain('message-1');
  });

  it('rejects more than three fan-out targets before creating aggregate state', () => {
    const created = repository.createChain({
      conversationId: 'project-a2a-aggregate',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-too-wide',
      holderId: 'lead',
      holderType: 'agent',
    });
    expect(() => repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      sourceWorkId: 'wide-work',
      expectedSourceRevision: created.rootPossession.revision,
      idempotencyKey: 'too-wide',
      branches: ['a', 'b', 'c', 'd'].map((toAgentId) => ({
        toAgentId,
        intent: 'delegate' as const,
        packet: packet(`delegate ${toAgentId}`),
      })),
    })).toThrowError(expect.objectContaining({ reasonCode: 'a2a_pass_group_too_wide' }));
    expect(getDb().prepare('SELECT COUNT(*) count FROM a2a_pass_group').get())
      .toEqual({ count: 0 });
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
