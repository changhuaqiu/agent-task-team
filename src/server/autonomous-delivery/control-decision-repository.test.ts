import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { WorkContractRepository } from '../work-contract/repository';
import { AutonomousDeliveryRepository } from './repository';
import {
  ControlActionClaimError,
  ControlDecisionRepository,
  StaleControlSnapshotError,
} from './control-decision-repository';
import { decideControlActions, type DeliveryControlSnapshot } from './control-decision';

describe('ControlDecisionRepository', () => {
  let db: Database.Database;
  let store: ControlDecisionRepository;
  let runId: string;
  let snapshot: DeliveryControlSnapshot;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-07-28T00:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    runId = new AutonomousDeliveryRepository().createRun({
      idempotencyKey: 'control-decision-repository-delivery',
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
        requireReview: false,
        requireWebE2E: false,
        requireMerge: false,
      },
    }, new Date(now)).run.id;
    new WorkContractRepository().issue({
      workId: 'work-1',
      attemptId: 'attempt-1',
      projectId: 'project-1',
      deliveryRunId: runId,
      agentId: 'implementer',
      goal: 'Implement',
      acceptanceCriteria: ['Done'],
      role: { id: 'implementer' },
      permissions: {},
      authoritativeRefs: ['task:1'],
      authoritativeRevisions: { task: 1 },
      contextSnapshotRef: 'context:1',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'corr-1',
      causationId: 'cause-1',
      now: new Date(now),
    });
    store = new ControlDecisionRepository(db);
    snapshot = {
      runId,
      snapshotRevision: store.projectSnapshotRevision('project-1'),
      observedAt: now,
      workCells: [{
        workId: 'work-1',
        workEpoch: 1,
        roleId: 'implementer',
        state: 'ready',
        priority: 1,
        queuedAt: now,
      }],
      waitForEdges: [],
      closure: { satisfied: false },
    };
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function decision() {
    return decideControlActions(snapshot, {
      revision: 1,
      maxConcurrent: 1,
      roleCapacity: { implementer: 1 },
      fairnessAgingMs: 1_000,
    });
  }

  it('persists non-wait actions idempotently and claims with snapshot/epoch fencing', () => {
    const computed = decision();
    expect(store.persist({ projectId: 'project-1', decision: computed }))
      .toEqual(store.persist({ projectId: 'project-1', decision: computed }));
    const action = store.listActions(computed.decisionId)[0]!;

    const claimed = store.claim({
      actionId: action.id,
      workerId: 'worker-1',
      leaseMs: 10_000,
      now: new Date('2026-07-28T00:00:01.000Z'),
    });
    expect(claimed).toMatchObject({
      status: 'claimed',
      target_work_id: 'work-1',
      work_epoch: 1,
      slot_id: 'implementer:1',
    });
    expect(store.complete({
      actionId: action.id,
      claimToken: claimed.claim_token!,
      now: new Date('2026-07-28T00:00:02.000Z'),
    })).toBe(true);
    expect(store.releaseSlot({
      actionId: action.id,
      reasonCode: 'invocation_started',
    })).toBe(true);
    new PlatformEventLog({ db }).append({
      type: 'invocation.running',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'domain-invocation:attempt-1',
      aggregate: { type: 'invocation', id: 'attempt-1' },
      actor: { type: 'system', id: 'test' },
      correlationId: 'attempt-1',
      payload: {},
    });
    expect(store.persist({ projectId: 'project-1', decision: computed }).id)
      .toBe(computed.decisionId);
  });

  it('rejects a decision and claim after authoritative project facts advance', () => {
    const computed = decision();
    new PlatformEventLog({ db }).append({
      type: 'task.ready',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:2',
      aggregate: { type: 'task', id: '2' },
      actor: { type: 'system', id: 'test' },
      correlationId: 'task-2',
      payload: {},
    });
    expect(() => store.persist({ projectId: 'project-1', decision: computed }))
      .toThrow(StaleControlSnapshotError);

    snapshot.snapshotRevision = store.projectSnapshotRevision('project-1');
    const current = decision();
    store.persist({ projectId: 'project-1', decision: current });
    const action = store.listActions(current.decisionId)[0]!;
    new PlatformEventLog({ db }).append({
      type: 'gate.requested',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'quality_gate:1',
      aggregate: { type: 'quality_gate', id: '1' },
      actor: { type: 'system', id: 'test' },
      correlationId: 'gate-1',
      payload: {},
    });
    expect(() => store.claim({
      actionId: action.id,
      workerId: 'worker-1',
      leaseMs: 1_000,
    })).toThrow(StaleControlSnapshotError);
  });

  it('rejects a stale work epoch independently of the snapshot cursor guard', () => {
    const computed = decision();
    store.persist({ projectId: 'project-1', decision: computed });
    const action = store.listActions(computed.decisionId)[0]!;
    new WorkContractRepository().issue({
      workId: 'work-1',
      attemptId: 'attempt-2',
      projectId: 'project-1',
      deliveryRunId: runId,
      agentId: 'implementer',
      goal: 'Retry',
      acceptanceCriteria: ['Done'],
      role: { id: 'implementer' },
      permissions: {},
      authoritativeRefs: ['task:1'],
      authoritativeRevisions: { task: 1 },
      contextSnapshotRef: 'context:2',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'corr-1',
      causationId: 'cause-2',
      expectedCurrentEpoch: 1,
    });
    // Hold the cursor guard constant to prove epoch fencing is an independent
    // claim condition rather than an accidental consequence of event ordering.
    db.prepare(`
      UPDATE delivery_control_decision SET snapshot_revision=? WHERE id=?
    `).run(store.projectSnapshotRevision('project-1'), computed.decisionId);

    expect(() => store.claim({
      actionId: action.id,
      workerId: 'worker-1',
      leaseMs: 1_000,
    })).toThrow(ControlActionClaimError);
  });

  it('does not persist wait actions', () => {
    snapshot.workCells[0]!.state = 'running';
    snapshot.workCells[0]!.slotId = 'implementer:1';
    const computed = decision();

    store.persist({ projectId: 'project-1', decision: computed });

    expect(computed.actions[0]?.type).toBe('wait');
    expect(store.listActions(computed.decisionId)).toEqual([]);
  });
});
