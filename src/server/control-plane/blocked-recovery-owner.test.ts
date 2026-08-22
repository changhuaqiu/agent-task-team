import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { taskRepo } from '../repositories/task-repo';
import { TaskOutcomeProcessManager } from '../repositories/task-outcome-process-manager';
import { WorkContractRepository } from '../work-contract/repository';
import { buildWorkIdentity } from '../work-contract/work-identity';
import {
  BlockedRecoveryOwner,
  ExecutionCapabilityRecoveryProbe,
  type BlockedRecoveryCandidate,
  type BlockedRecoveryProbe,
} from './blocked-recovery-owner';
import { resolveExecutionProfile } from '../invocation-pipeline/execution-profile';

describe('BlockedRecoveryOwner', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  const now = new Date('2026-08-21T02:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    log = new PlatformEventLog({ db });
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  async function createBlockedTask(payload: unknown) {
    const task = taskRepo.create({
      id: 'task-1', conversation_id: 'project-1', title: 'Verify browser UI', agent_id: 'builder',
    });
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: buildWorkIdentity({
        scope: 'task', targetId: task.id, agentId: 'builder', purpose: 'execute',
      }),
      attemptId: 'attempt-1', projectId: 'project-1', taskId: task.id, agentId: 'builder',
      goal: 'Verify browser UI', acceptanceCriteria: ['UI verified'], role: {}, permissions: {},
      authoritativeRefs: [`task:${task.id}`], authoritativeRevisions: { task: task.revision },
      contextSnapshotRef: 'context-1', allowedOutcomeTypes: ['report_blocked'],
      correlationId: 'corr-1', causationId: 'cause-1', now,
    });
    const admission = contracts.admitOutcome({
      outcomeId: 'outcome-1', idempotencyKey: 'outcome-key-1', contractId: contract.contractId,
      outcomeType: 'report_blocked', payload, evidenceRefs: [], projectId: 'project-1',
      workId: contract.workId, workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: now.toISOString(),
    }, now);
    expect(admission.status).toBe('accepted');
    const accepted = log.listStream(`work:${contract.workId}`)
      .find((event) => event.type === 'agent.outcome.accepted')!;
    await new TaskOutcomeProcessManager().handle(accepted, {
      signal: new AbortController().signal,
    });
    return taskRepo.getById(task.id)!;
  }

  it('resumes a structured blocker only after its probe proves recovery', async () => {
    await createBlockedTask({
      blocker: {
        type: 'permission_boundary',
        detail: 'Chromium spawn EPERM',
        recoveryCondition: 'Allow a headless Chromium process',
      },
    });
    const probe: BlockedRecoveryProbe = {
      evaluate: () => ({
        satisfied: true,
        reasonCode: 'execution_capability_added',
        fingerprint: 'browser_verification:skill-browser',
      }),
    };

    const result = new BlockedRecoveryOwner(probe).runOnce();

    expect(result).toMatchObject({ inspected: 1, recovered: 1, deferred: [] });
    expect(taskRepo.getById('task-1')?.status).toBe('ready');
    const resumed = taskGraphActions('task-1').filter((action) => action.type === 'task.resumed');
    expect(resumed).toHaveLength(1);
    expect(new BlockedRecoveryOwner(probe).runOnce().recovered).toBe(0);
  });

  it('fails closed when report_blocked has no structured recovery condition', async () => {
    await createBlockedTask({ summary: 'Cannot continue' });
    const probe: BlockedRecoveryProbe = {
      evaluate: () => ({ satisfied: true, reasonCode: 'test', fingerprint: 'test' }),
    };

    const result = new BlockedRecoveryOwner(probe).runOnce();

    expect(result).toMatchObject({
      inspected: 1,
      recovered: 0,
      deferred: [{ taskId: 'task-1', reasonCode: 'structured_blocker_missing' }],
    });
    expect(taskRepo.getById('task-1')?.status).toBe('blocked');
  });

  it('requires a real execution-capability delta instead of retrying an unchanged permission blocker', () => {
    const beforeBinding = resolveExecutionProfile({
      source: 'workflow',
      prompt: 'Verify in browser',
      task: { title: 'Verify in browser' },
      skills: [{ id: 'status', name: 'task-status-receipt' }],
    });
    const afterBinding = resolveExecutionProfile({
      source: 'workflow',
      prompt: 'Verify in browser',
      task: { title: 'Verify in browser' },
      skills: [
        { id: 'status', name: 'task-status-receipt' },
        { id: 'skill-browser', name: 'browser-verification' },
      ],
    });
    expect(beforeBinding).toMatchObject({
      capabilities: ['task_receipt'],
      missingRequiredSkillNames: ['browser-verification'],
    });
    expect(afterBinding.capabilities).toContain('browser_verification');
    const candidate = {
      task: {
        id: 'task-browser',
        conversation_id: 'project-1',
        title: 'Verify in browser',
        description: null,
        status: 'blocked',
        agent_id: 'builder',
        dependencies: null,
        artifacts: null,
        review_note: null,
        revision: 2,
        work_dir: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      outcome: { id: 'outcome-browser' },
      contract: {
        work_id: buildWorkIdentity({
          scope: 'task', targetId: 'task-browser', agentId: 'builder', purpose: 'execute',
        }),
        permissions_json: JSON.stringify({ executionProfile: beforeBinding }),
      },
      blocker: {
        type: 'permission_boundary',
        detail: 'Playwright Chromium spawn EPERM',
        recoveryCondition: 'Allow the headless browser',
      },
    } as BlockedRecoveryCandidate;
    const probe = new ExecutionCapabilityRecoveryProbe(() => afterBinding);

    expect(probe.evaluate(candidate)).toEqual({
      satisfied: true,
      reasonCode: 'execution_capability_added',
      fingerprint: 'browser_verification:skill-browser',
    });

    candidate.contract.permissions_json = JSON.stringify({
      executionProfile: { capabilities: ['browser_verification'] },
    });
    expect(probe.evaluate(candidate)).toEqual({
      satisfied: false,
      reasonCode: 'recovery_condition_unchanged',
    });
  });

  function taskGraphActions(taskId: string) {
    return db.prepare(`SELECT * FROM task_action ORDER BY created_at,id`).all()
      .filter((row) => JSON.parse((row as { task_ids: string }).task_ids).includes(taskId)) as Array<{
        type: string;
      }>;
  }
});
