import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { AgentInbox } from '../platform-events/agent-inbox';
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
    vi.restoreAllMocks();
    resetDb();
    db.close();
  });

  it('releases an applied slot when Work Authority closes', async () => {
    const release = vi.spyOn(ControlDecisionRepository.prototype, 'releaseSlotsForWork')
      .mockReturnValue(1);
    const event = new (await import('../platform-events/event-log')).PlatformEventLog({ db }).append({
      type: 'work.authority.closed',
      category: 'coordination',
      projectId: 'project-1',
      streamKey: 'work:task:1:agent:builder:purpose:execute',
      aggregate: {
        type: 'work_authority',
        id: 'task:1:agent:builder:purpose:execute',
        version: 2,
      },
      actor: { type: 'system', id: 'test' },
      correlationId: 'corr-work-close',
      payload: { workEpoch: 2 },
    });

    await new ControlSlotReleaseProcessManager(db).handle(event, {
      signal: new AbortController().signal,
    });

    expect(release).toHaveBeenCalledWith(expect.objectContaining({
      workId: 'task:1:agent:builder:purpose:execute',
      workEpoch: 2,
      reasonCode: 'work_authority_closed',
    }));
  });

  it('releases activate/retry slots when Runtime starts or preflight is blocked', async () => {
    const run = new AutonomousDeliveryRepository().createRun({
      idempotencyKey: 'control-slot-release-delivery',
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

    const retryDecision = decideControlActions({
      runId: run.id,
      snapshotRevision: decisions.projectSnapshotRevision('project-1'),
      observedAt: now.toISOString(),
      workCells: [{
        workId: contract.workId,
        workEpoch: contract.workEpoch,
        roleId: 'implementer',
        state: 'retry_pending',
        priority: 50,
        queuedAt: now.toISOString(),
        failure: {
          reasonCode: 'runtime_profile_missing',
          retryable: true,
          humanRecoverable: true,
          budget: { kind: 'invocation', attemptsUsed: 0, maxAttempts: 1 },
        },
      }],
      waitForEdges: [],
      closure: { satisfied: false },
    }, {
      revision: 2,
      maxConcurrent: 1,
      roleCapacity: { implementer: 1 },
      fairnessAgingMs: 1_000,
    });
    decisions.persist({ projectId: 'project-1', decision: retryDecision, now });
    const [retryClaim] = decisions.claimDecision({
      decisionId: retryDecision.decisionId,
      workerId: 'worker-1',
      leaseMs: 30_000,
      now,
    });
    decisions.complete({
      actionId: retryClaim!.id,
      claimToken: retryClaim!.claim_token!,
      now,
    });

    await new ControlSlotReleaseProcessManager(db).handle({
      eventId: 'context-blocked-1',
      type: 'context.snapshot.rejected',
      category: 'coordination',
      schemaVersion: 1,
      projectId: 'project-1',
      streamKey: 'context_snapshot:rejected-1',
      streamSequence: 1,
      aggregate: { type: 'context_snapshot', id: 'rejected-1' },
      actor: { type: 'system', id: 'context-manager' },
      invocationId: 'preflight-1',
      correlationId: contract.correlationId,
      occurredAt: now.toISOString(),
      recordedAt: now.toISOString(),
      payload: {
        reasonCode: 'required_context_missing',
        workId: contract.workId,
        deliveryRunId: run.id,
        missingRequired: ['task.description'],
      },
    }, { signal: new AbortController().signal });

    expect(decisions.listActions(retryDecision.decisionId)[0]).toMatchObject({
      status: 'cancelled',
      failure_code: 'context_preflight_blocked',
    });

    const inboxDecision = decideControlActions({
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
      revision: 3,
      maxConcurrent: 1,
      roleCapacity: { implementer: 1 },
      fairnessAgingMs: 1_000,
    });
    decisions.persist({ projectId: 'project-1', decision: inboxDecision, now });
    const [inboxClaim] = decisions.claimDecision({
      decisionId: inboxDecision.decisionId,
      workerId: 'worker-1',
      leaseMs: 30_000,
      now,
    });
    decisions.complete({
      actionId: inboxClaim!.id,
      claimToken: inboxClaim!.claim_token!,
      now,
    });
    const item = new AgentInbox({ db, now: () => now }).enqueue({
      projectId: 'project-1',
      projectAgentId: 'agent-1',
      idempotencyKey: 'cancelled-inbox-work',
      command: {
        source: 'system',
        workId: contract.workId,
        prompt: 'Execute',
      },
    });
    await new ControlSlotReleaseProcessManager(db).handle({
      eventId: 'inbox-cancelled-1',
      type: 'agent.work.cancelled',
      category: 'coordination',
      schemaVersion: 1,
      projectId: 'project-1',
      streamKey: 'agent-work:project-1:agent-1',
      streamSequence: 1,
      aggregate: { type: 'agent_inbox_item', id: item.id },
      actor: { type: 'system', id: 'agent-inbox' },
      inboxItemId: item.id,
      correlationId: contract.correlationId,
      occurredAt: now.toISOString(),
      recordedAt: now.toISOString(),
      payload: { reasonCode: 'task_terminal' },
    }, { signal: new AbortController().signal });

    expect(decisions.listActions(inboxDecision.decisionId)[0]).toMatchObject({
      status: 'cancelled',
      failure_code: 'agent.work.cancelled:task_terminal',
    });
  });
});
