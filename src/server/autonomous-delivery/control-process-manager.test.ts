import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { WorkContractRepository } from '../work-contract/repository';
import { AutonomousDeliveryRepository } from './repository';
import { ControlDecisionRepository } from './control-decision-repository';
import { DeliveryControlProcessManager } from './control-process-manager';
import { RepositoryControlSnapshotBuilder } from './control-snapshot-builder';

describe('DeliveryControlProcessManager', () => {
  let db: Database.Database;
  let runId: string;
  const now = new Date('2026-07-28T00:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    runId = new AutonomousDeliveryRepository().createRun({
      idempotencyKey: 'control-process-manager-delivery',
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
    }, now).run.id;
    for (const [index, role] of ['implementer', 'reviewer'].entries()) {
      new WorkContractRepository().issue({
        workId: `work-${index + 1}`,
        attemptId: `attempt-${index + 1}`,
        projectId: 'project-1',
        deliveryRunId: runId,
        agentId: `agent-${index + 1}`,
        goal: `Work ${index + 1}`,
        acceptanceCriteria: ['Done'],
        role: { id: role },
        permissions: {},
        authoritativeRefs: [`work:${index + 1}`],
        authoritativeRevisions: { work: 1 },
        contextSnapshotRef: `context:${index + 1}`,
        allowedOutcomeTypes: ['submit_task_result'],
        correlationId: `corr-${index + 1}`,
        causationId: `cause-${index + 1}`,
        now,
      });
    }
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('claims the complete action set before the first owner Command emits a new fact', async () => {
    let event = 0;
    const execute = vi.fn(async () => {
      event += 1;
      new PlatformEventLog({ db }).append({
        type: 'agent.work.enqueued',
        category: 'coordination',
        projectId: 'project-1',
        streamKey: `work:command-${event}`,
        aggregate: { type: 'agent_work', id: `command-${event}` },
        actor: { type: 'system', id: 'control-command-test' },
        correlationId: `command-${event}`,
        payload: {},
      });
      return { status: 'applied' as const };
    });
    const decisions = new ControlDecisionRepository(db);
    const manager = new DeliveryControlProcessManager({
      snapshots: new RepositoryControlSnapshotBuilder({ db, now: () => now }),
      decisions,
      commands: { execute },
      workerId: 'delivery-control-1',
      now: () => now,
    });

    const result = await manager.reconcile(runId, 'project-1', {
      revision: 1,
      maxConcurrent: 2,
      roleCapacity: { implementer: 1, reviewer: 1 },
      fairnessAgingMs: 1_000,
    });

    expect(result.decision.actions.map((action) => action.type)).toEqual(['activate', 'activate']);
    expect(result.claimed).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(decisions.listActions(result.decision.decisionId).map((action) => action.status))
      .toEqual(['applied', 'applied']);
  });
});
