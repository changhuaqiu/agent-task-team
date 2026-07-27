import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { taskRepo } from '../repositories/task-repo';
import { WorkContractRepository } from '../work-contract/repository';
import { DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import { qualityGateRepo } from '../quality-gate/repository';
import { A2ACollaborationRepository } from '../a2a/collaboration';
import { AutonomousDeliveryRepository } from './repository';
import { RepositoryControlSnapshotBuilder } from './control-snapshot-builder';

describe('RepositoryControlSnapshotBuilder', () => {
  let db: Database.Database;
  let runId: string;
  let contracts: WorkContractRepository;
  const now = new Date('2026-07-28T00:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    runId = new AutonomousDeliveryRepository().createRun({
      goal: 'Ship',
      acceptanceCriteria: ['Works'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 2,
        maxRepairCycles: 1,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: true,
        requireWebE2E: false,
        requireMerge: false,
      },
    }, now).run.id;
    contracts = new WorkContractRepository();
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function issue(workId: string, agentId: string, attemptId: string) {
    return contracts.issue({
      workId,
      attemptId,
      projectId: 'project-1',
      deliveryRunId: runId,
      agentId,
      goal: workId,
      acceptanceCriteria: ['Done'],
      role: { id: agentId === 'agent-a' ? 'implementer' : 'reviewer' },
      permissions: {},
      authoritativeRefs: [`work:${workId}`],
      authoritativeRevisions: { work: 1 },
      contextSnapshotRef: `context:${workId}`,
      allowedOutcomeTypes: ['submit_task_result', 'report_blocked'],
      correlationId: `corr:${workId}`,
      causationId: `cause:${workId}`,
      now,
    });
  }

  it('builds simultaneous running and ready Work Cells from owner facts', () => {
    const running = issue('work-a', 'agent-a', 'attempt-a');
    issue('work-b', 'agent-b', 'attempt-b');
    invocationRepo.create({
      id: running.attemptId,
      conversation_id: 'project-1',
      agent_id: 'agent-a',
      work_contract_id: running.contractId,
      work_id: running.workId,
      work_epoch: running.workEpoch,
      fencing_token: running.fencingToken,
    }, now);
    invocationRepo.transition(running.attemptId, { to: 'starting' }, now);
    invocationRepo.transition(running.attemptId, { to: 'running' }, now);

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);

    expect(snapshot.workCells).toMatchObject([
      {
        workId: 'work-a',
        roleId: 'implementer',
        state: 'running',
      },
      {
        workId: 'work-b',
        roleId: 'reviewer',
        state: 'ready',
      },
    ]);
    expect(snapshot.snapshotRevision).toBeGreaterThan(0);
    expect(snapshot.closure.satisfied).toBe(false);
  });

  it('classifies Invocation failure with its own persisted retry budget', () => {
    const contract = issue('work-a', 'agent-a', 'attempt-a');
    invocationRepo.create({
      id: contract.attemptId,
      conversation_id: 'project-1',
      agent_id: 'agent-a',
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    }, now);
    invocationRepo.transition(contract.attemptId, {
      to: 'terminated',
      outcome: 'failed',
      reason_code: 'runtime_transport_lost',
    }, now);

    const snapshot = new RepositoryControlSnapshotBuilder({
      db,
      retryLimits: { invocation: 4 },
      now: () => now,
    }).build(runId);

    expect(snapshot.workCells[0]).toMatchObject({
      state: 'retry_pending',
      failure: {
        reasonCode: 'runtime_transport_lost',
        retryable: true,
        budget: {
          kind: 'invocation',
          attemptsUsed: 1,
          maxAttempts: 4,
        },
      },
    });
  });

  it('projects an open A2A join as a wait instead of retrying the source Invocation', () => {
    const source = issue('work-a', 'agent-a', 'attempt-a');
    invocationRepo.create({
      id: source.attemptId,
      conversation_id: 'project-1',
      agent_id: 'agent-a',
      work_contract_id: source.contractId,
      work_id: source.workId,
      work_epoch: source.workEpoch,
      fencing_token: source.fencingToken,
    }, now);
    invocationRepo.transition(source.attemptId, {
      to: 'terminated',
      outcome: 'completed',
      reason_code: 'structured_handoff',
    }, now);
    const collaboration = new A2ACollaborationRepository({ db, now: () => now });
    const chain = collaboration.createChain({
      conversationId: 'project-1',
      rootTriggerType: 'system',
      rootTriggerId: 'outcome-a',
      holderId: 'agent-a',
      holderType: 'agent',
    });
    const offered = collaboration.offerPassGroup({
      chainId: chain.chain.id,
      sourcePossessionId: chain.rootPossession.id,
      sourceWorkId: source.workId,
      deliveryRunId: runId,
      expectedSourceRevision: chain.rootPossession.revision,
      idempotencyKey: 'join-a',
      branches: [{
        toAgentId: 'agent-b',
        intent: 'review',
        packet: {
          title: 'Review',
          requestedAction: 'Review work-a',
          possessionSummary: 'work-a is ready',
          relevantDecisions: [],
          evidenceRefs: [],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: [],
        },
      }],
    });

    expect(offered.group).toMatchObject({
      sourceWorkId: source.workId,
      deliveryRunId: runId,
    });
    expect(new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId))
      .toMatchObject({
        workCells: [expect.objectContaining({
          workId: source.workId,
          state: 'waiting_dependency',
        })],
      });
  });

  it('creates a planning Work Cell when the run has no Task Graph', () => {
    expect(new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId))
      .toMatchObject({
        workCells: [{
          workId: `delivery:${runId}:purpose:initialize-task-graph`,
          workEpoch: 0,
          purpose: 'planning',
          state: 'ready',
        }],
        closure: { satisfied: false },
      });
  });

  it('creates pre-Contract Work Cells from assigned Tasks and honors dependencies', () => {
    taskRepo.create({
      id: 'task-a',
      conversation_id: 'project-1',
      title: 'Foundation',
      agent_id: 'agent-a',
    }, now);
    taskRepo.create({
      id: 'task-b',
      conversation_id: 'project-1',
      title: 'Dependent',
      agent_id: 'agent-b',
      dependencies: ['task-a'],
    }, now);

    const before = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(before.workCells).toMatchObject([
      {
        workId: 'task:task-a:agent:agent-a:purpose:execute',
        workEpoch: 0,
        state: 'ready',
      },
      {
        workId: 'task:task-b:agent:agent-b:purpose:execute',
        workEpoch: 0,
        state: 'waiting_dependency',
      },
    ]);

    taskRepo.transition('task-a', { to: 'in_progress' }, now);
    taskRepo.transition('task-a', { to: 'in_review' }, now);
    taskRepo.transition('task-a', { to: 'done' }, now);
    const after = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(after.workCells.find((cell) => cell.workId.includes('task-b'))?.state).toBe('ready');
  });

  it('turns completed delivery work into independent review and verification Gate Work Cells', () => {
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
    `).run(now.toISOString(), now.toISOString());
    taskRepo.create({
      id: 'task-delivery',
      conversation_id: 'project-1',
      title: 'Delivery',
      agent_id: 'agent-a',
    }, now);
    taskRepo.transition('task-delivery', { to: 'in_progress' }, now);
    taskRepo.transition('task-delivery', { to: 'in_review' }, now);
    taskRepo.transition('task-delivery', { to: 'done' }, now);

    const before = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(before.workCells.filter((cell) => cell.purpose === 'gate_request')).toMatchObject([
      { state: 'artifact_submitted' },
      { state: 'artifact_submitted' },
    ]);

    for (const kind of ['delivery_review', 'acceptance_verification'] as const) {
      qualityGateRepo.request({
        conversationId: 'project-1',
        kind,
        targetType: 'delivery_run',
        targetId: runId,
        artifactRevision: 'revision-1',
        criteria: {},
        actor: { type: 'system', id: 'test' },
        now,
      });
    }
    const after = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(after.workCells.filter((cell) =>
      cell.purpose === 'review' || cell.purpose === 'verification'
    )).toMatchObject([
      {
        workId: 'task:task-delivery:agent:reviewer:purpose:review',
        state: 'ready',
      },
      {
        workId: 'task:task-delivery:agent:reviewer:purpose:verify',
        state: 'ready',
      },
    ]);
  });

  it('projects a cyclic Task dependency as a wait-for deadlock', () => {
    taskRepo.create({
      id: 'task-a',
      conversation_id: 'project-1',
      title: 'A',
      agent_id: 'agent-a',
      dependencies: ['task-b'],
    }, now);
    taskRepo.create({
      id: 'task-b',
      conversation_id: 'project-1',
      title: 'B',
      agent_id: 'agent-b',
      dependencies: ['task-a'],
    }, now);

    expect(new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId).closure)
      .toMatchObject({
        deadlock: {
          cycle: [
            'task:task-a:agent:agent-a:purpose:execute',
            'task:task-b:agent:agent-b:purpose:execute',
            'task:task-a:agent:agent-a:purpose:execute',
          ],
        },
      });
  });

  it('keeps completed Work Cells open while a blocking Effect remains applicable', () => {
    const contract = issue('work-a', 'agent-a', 'attempt-a');
    contracts.close({
      workId: contract.workId,
      expectedEpoch: contract.workEpoch,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      now,
    });
    const source = db.prepare(`
      SELECT id FROM platform_event WHERE project_id='project-1'
      ORDER BY recorded_at DESC,id DESC LIMIT 1
    `).get() as { id: string };
    const [effect] = new DurableEffectOutbox({ db, now: () => now }).enqueueBatch({
      sourceEventId: source.id,
      laneKey: `delivery:${runId}`,
      effects: [{
        type: 'delivery.publish',
        targetKey: runId,
        payload: {},
        criticality: 'blocking',
        deliveryRunId: runId,
        appliesFromRevision: 0,
      }],
    });

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);

    expect(snapshot.workCells[0]?.state).toBe('completed');
    expect(snapshot.closure).toMatchObject({
      satisfied: false,
      blockingEffect: {
        effectId: effect!.id,
        status: 'pending',
        attemptsUsed: 0,
        maxAttempts: 5,
      },
    });
  });
});
