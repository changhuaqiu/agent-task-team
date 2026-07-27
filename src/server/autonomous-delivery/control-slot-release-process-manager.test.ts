import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { WorkContractRepository } from '../work-contract/repository';
import { AutonomousDeliveryRepository } from './repository';
import { decideControlActions } from './control-decision';
import { ControlDecisionRepository } from './control-decision-repository';
import { ControlSlotReleaseProcessManager } from './control-slot-release-process-manager';

describe('ControlSlotReleaseProcessManager', () => {
  let db: Database.Database;
  const now = new Date('2026-07-28T00:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('releases an applied activation slot when Runtime confirms Invocation start', async () => {
    const run = new AutonomousDeliveryRepository().createRun({
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
    }, now).run;
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'work-1',
      attemptId: 'attempt-1',
      projectId: 'project-1',
      deliveryRunId: run.id,
      agentId: 'agent-1',
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
      now,
    });
    const decisions = new ControlDecisionRepository(db);
    const decision = decideControlActions({
      runId: run.id,
      snapshotRevision: decisions.projectSnapshotRevision('project-1'),
      observedAt: now.toISOString(),
      workCells: [{
        workId: contract.workId,
        workEpoch: contract.workEpoch,
        roleId: 'implementer',
        state: 'ready',
        priority: 50,
        queuedAt: now.toISOString(),
      }],
      waitForEdges: [],
      closure: { satisfied: false },
    }, {
      revision: 1,
      maxConcurrent: 1,
      roleCapacity: { implementer: 1 },
      fairnessAgingMs: 1_000,
    });
    decisions.persist({ projectId: 'project-1', decision, now });
    const [claim] = decisions.claimDecision({
      decisionId: decision.decisionId,
      workerId: 'worker-1',
      leaseMs: 30_000,
      now,
    });
    decisions.complete({
      actionId: claim!.id,
      claimToken: claim!.claim_token!,
      now,
    });
    invocationRepo.create({
      id: contract.attemptId,
      conversation_id: 'project-1',
      agent_id: 'agent-1',
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    }, now);

    await new ControlSlotReleaseProcessManager(db).handle({
      eventId: 'runtime-started-1',
      type: 'runtime.invocation.started',
      category: 'runtime_lifecycle',
      schemaVersion: 1,
      projectId: 'project-1',
      streamKey: `invocation:${contract.attemptId}`,
      streamSequence: 1,
      aggregate: { type: 'invocation', id: contract.attemptId },
      actor: { type: 'runtime', id: 'daemon' },
      invocationId: contract.attemptId,
      correlationId: contract.correlationId,
      occurredAt: now.toISOString(),
      recordedAt: now.toISOString(),
      payload: { adapter: 'acp', engine: 'codex' },
    }, { signal: new AbortController().signal });

    expect(decisions.listActions(decision.decisionId)[0]).toMatchObject({
      status: 'cancelled',
      failure_code: 'invocation_started',
    });
  });
});
