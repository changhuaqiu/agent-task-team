import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { WorkContractRepository } from '../work-contract/repository';
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

  it('does not claim closure when the run has no Work Cells', () => {
    expect(new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId))
      .toMatchObject({ workCells: [], closure: { satisfied: false } });
  });
});
