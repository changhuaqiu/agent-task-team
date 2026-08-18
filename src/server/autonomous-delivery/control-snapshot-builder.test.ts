import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { taskRepo } from '../repositories/task-repo';
import { WorkContractRepository } from '../work-contract/repository';
import { buildWorkIdentity } from '../work-contract/work-identity';
import { DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import { qualityGateRepo } from '../quality-gate/repository';
import { A2ACollaborationRepository } from '../a2a/collaboration';
import { AgentInbox } from '../platform-events/agent-inbox';
import { AutonomousDeliveryRepository } from './repository';
import { decideControlActions } from './control-decision';
import { ControlDecisionRepository } from './control-decision-repository';
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
      idempotencyKey: 'control-snapshot-delivery',
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

  function issue(workId: string, agentId: string, attemptId: string, taskId?: string) {
    return contracts.issue({
      workId,
      attemptId,
      projectId: 'project-1',
      deliveryRunId: runId,
      taskId,
      agentId,
      goal: workId,
      acceptanceCriteria: ['Done'],
      role: { id: agentId === 'agent-a' ? 'implementer' : 'reviewer' },
      permissions: {},
      authoritativeRefs: [`work:${workId}`],
      authoritativeRevisions: {
        work: 1,
        deliveryRun: new AutonomousDeliveryRepository().getRun(runId)!.revision,
      },
      contextSnapshotRef: `context:${workId}`,
      allowedOutcomeTypes: ['continue_work', 'submit_task_result', 'report_blocked'],
      correlationId: `corr:${workId}`,
      causationId: `cause:${workId}`,
      now,
    });
  }

  function admitContinuation(contract: ReturnType<typeof issue>, suffix: string) {
    return contracts.admitOutcome({
      outcomeId: `continuation-${suffix}`,
      idempotencyKey: `continuation-${suffix}`,
      contractId: contract.contractId,
      outcomeType: 'continue_work',
      payload: {
        schemaVersion: 1,
        reason: 'verification_follow_up',
        summary: 'The first verification pass is complete.',
        nextAction: 'Finish the remaining verification checks.',
        completedSteps: ['Reviewed the primary evidence.'],
        remainingSteps: ['Verify the remaining evidence.'],
      },
      evidenceRefs: [`trace:${suffix}`],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now.toISOString(),
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

  it('projects a planned continuation separately from Invocation failure retry', () => {
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
    const continuationAdmission = contracts.admitOutcome({
      outcomeId: 'continuation-a',
      idempotencyKey: 'continuation-a',
      contractId: contract.contractId,
      outcomeType: 'continue_work',
      payload: {
        schemaVersion: 1,
        reason: 'multi_step',
        summary: 'The current architecture is mapped.',
        nextAction: 'Implement the scheduler change.',
        completedSteps: ['Mapped the current path.'],
        remainingSteps: ['Implement the change.', 'Run focused tests.'],
      },
      evidenceRefs: ['trace:architecture-map'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now.toISOString(),
    });
    expect(continuationAdmission).toMatchObject({ status: 'accepted' });
    invocationRepo.transition(contract.attemptId, {
      to: 'terminated',
      outcome: 'completed',
      reason_code: 'agent_requested_continuation',
    }, now);

    const snapshot = new RepositoryControlSnapshotBuilder({
      db,
      retryLimits: { invocation: 1, continuation: 4 },
      now: () => now,
    }).build(runId);

    expect(snapshot.workCells[0]).toMatchObject({
      workId: contract.workId,
      state: 'continuation_pending',
      continuation: { requestsUsed: 1, maxRequests: 4 },
    });
    expect(snapshot.workCells[0].failure).toBeUndefined();
  });

  it('keeps a legacy unversioned continue_work on the failure-retry path', () => {
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
    db.prepare(`
      INSERT INTO agent_outcome (
        id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,
        fencing_token,outcome_type,payload_json,evidence_refs_json,
        authoritative_revisions_json,correlation_id,causation_id,occurred_at,
        admission_status,rejection_reason,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'legacy-continuation-a',
      'legacy-continuation-a',
      contract.contractId,
      contract.projectId,
      contract.workId,
      contract.workEpoch,
      contract.attemptId,
      contract.fencingToken,
      'continue_work',
      JSON.stringify({ summary: 'legacy progress update' }),
      '[]',
      JSON.stringify(contract.authoritativeRevisions),
      contract.correlationId,
      contract.contractId,
      now.toISOString(),
      'accepted',
      null,
      now.toISOString(),
    );
    invocationRepo.transition(contract.attemptId, {
      to: 'terminated',
      outcome: 'completed',
      reason_code: 'legacy_progress_exit',
    }, now);

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);

    expect(snapshot.workCells[0]).toMatchObject({
      workId: contract.workId,
      state: 'retry_pending',
      failure: { reasonCode: 'legacy_progress_exit' },
    });
    expect(snapshot.workCells[0].continuation).toBeUndefined();
  });

  it('does not let a terminal admitted Inbox item mask a failed Invocation retry', () => {
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
      reason_code: 'runtime_process_failed',
    }, now);
    const inbox = new AgentInbox({ db, now: () => now });
    inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'agent-a',
      idempotencyKey: 'activation-a',
      command: {
        source: 'system',
        prompt: 'Run work-a',
        workId: contract.workId,
        deliveryRunId: runId,
      },
    });
    const claimed = inbox.claimNext()!;
    expect(inbox.admit(claimed.id, claimed.leaseToken!)).toBe(true);

    const snapshot = new RepositoryControlSnapshotBuilder({
      db,
      retryLimits: { invocation: 4 },
      now: () => now,
    }).build(runId);

    expect(snapshot.workCells[0]).toMatchObject({
      workId: contract.workId,
      state: 'retry_pending',
      failure: {
        reasonCode: 'runtime_process_failed',
        budget: { kind: 'invocation', attemptsUsed: 1, maxAttempts: 4 },
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

  it('projects an explicit Gate Work Cell as the blocker of task work', () => {
    taskRepo.create({
      id: 'task-gated',
      conversation_id: 'project-1',
      title: 'Gated task',
      agent_id: 'agent-a',
    }, now);
    const source = issue(
      'task:task-gated:agent:agent-a:purpose:execute',
      'agent-a',
      'attempt-source',
      'task-gated',
    );
    const gateWork = issue(
      'task:task-gated:agent:reviewer:purpose:review',
      'reviewer',
      'attempt-gate',
      'task-gated',
    );
    let gatedTask = taskRepo.getById('task-gated')!;
    gatedTask = taskRepo.transition(gatedTask.id, {
      to: 'in_progress',
      expectedFrom: 'ready',
      expectedRevision: gatedTask.revision,
    })!;
    gatedTask = taskRepo.transition(gatedTask.id, {
      to: 'in_review',
      expectedFrom: 'in_progress',
      expectedRevision: gatedTask.revision,
    })!;
    qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: 'task-gated',
      artifactRevision: String(gatedTask.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);

    expect(snapshot.workCells.find((cell) => cell.workId === source.workId))
      .toMatchObject({ state: 'waiting_gate' });
    expect(snapshot.waitForEdges).toContainEqual({
      waiter: source.workId,
      blocker: gateWork.workId,
      reasonCode: 'quality_gate',
    });
  });

  it('creates an independent reviewer Work Cell when a Task Gate opens', () => {
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
    `).run(now.toISOString(), now.toISOString());
    taskRepo.create({
      id: 'task-review-cell',
      conversation_id: 'project-1',
      title: 'Reviewable task',
      agent_id: 'agent-a',
    });
    let task = taskRepo.getById('task-review-cell')!;
    task = taskRepo.transition(task.id, {
      to: 'in_progress',
      expectedFrom: 'ready',
      expectedRevision: task.revision,
    })!;
    task = taskRepo.transition(task.id, {
      to: 'in_review',
      expectedFrom: 'in_progress',
      expectedRevision: task.revision,
    })!;
    const requestedGate = qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: 'task-review-cell',
      artifactRevision: String(task.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    const sourceWorkId = `task:${task.id}:agent:agent-a:purpose:execute`;
    const reviewerWorkId = buildWorkIdentity({
      scope: 'task',
      targetId: task.id,
      agentId: 'reviewer',
      gateId: requestedGate.gate.id,
      purpose: 'review',
    });
    expect(snapshot.workCells).toEqual(expect.arrayContaining([
      expect.objectContaining({ workId: sourceWorkId, state: 'waiting_gate' }),
      expect.objectContaining({
        workId: reviewerWorkId,
        purpose: 'review',
        state: 'ready',
      }),
    ]));
    expect(snapshot.waitForEdges).toContainEqual({
      waiter: sourceWorkId,
      blocker: reviewerWorkId,
      reasonCode: 'quality_gate',
    });
    new AgentInbox({ db, now: () => now }).enqueue({
      projectId: 'project-1',
      projectAgentId: 'reviewer',
      idempotencyKey: 'queued-review-work',
      command: {
        source: 'review_gate',
        workId: reviewerWorkId,
        taskId: task.id,
        deliveryRunId: runId,
        prompt: 'Review',
      },
    });
    const queuedSnapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now })
      .build(runId);
    expect(queuedSnapshot.workCells.find((cell) => cell.workId === reviewerWorkId))
      .toMatchObject({ state: 'queued' });
    expect(decideControlActions(queuedSnapshot, {
      revision: 5,
      maxConcurrent: 2,
      roleCapacity: { reviewer: 1 },
      fairnessAgingMs: 1_000,
    }).actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'wait',
        targetWorkId: reviewerWorkId,
        reasonCode: 'dispatch_pending',
      }),
    ]));
  });

  it('starts a fresh Gate-scoped review after a legacy review authority has closed', () => {
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
    `).run(now.toISOString(), now.toISOString());
    let task = taskRepo.create({
      id: 'task-second-review',
      conversation_id: 'project-1',
      title: 'Review the next artifact revision',
      agent_id: 'agent-a',
    }, now);
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;

    const legacy = issue(
      `task:${task.id}:agent:reviewer:purpose:review`,
      'reviewer',
      'legacy-review-attempt',
      task.id,
    );
    contracts.close({
      workId: legacy.workId,
      expectedEpoch: legacy.workEpoch,
      correlationId: legacy.correlationId,
      causationId: legacy.contractId,
      now,
    });
    const requested = qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });
    const expectedWorkId = buildWorkIdentity({
      scope: 'task',
      targetId: task.id,
      agentId: 'reviewer',
      gateId: requested.gate.id,
      purpose: 'review',
    });

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(snapshot.workCells).toEqual(expect.arrayContaining([
      expect.objectContaining({ workId: legacy.workId, state: 'completed' }),
      expect.objectContaining({ workId: expectedWorkId, state: 'ready' }),
    ]));
    expect(decideControlActions(snapshot, {
      revision: 1,
      maxConcurrent: 2,
      roleCapacity: { reviewer: 1 },
      fairnessAgingMs: 1_000,
    }).actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'activate', targetWorkId: expectedWorkId }),
    ]));
  });

  it('keeps an open Gate schedulable after implementer assignment metadata changes', () => {
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
    `).run(now.toISOString(), now.toISOString());
    let task = taskRepo.create({
      id: 'task-unassigned-after-submit',
      conversation_id: 'project-1',
      title: 'Review submitted work independently',
      agent_id: 'agent-a',
    }, now);
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;
    const requested = qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });
    const revisionBeforeMetadataChange = new ControlDecisionRepository(db)
      .projectSnapshotRevision('project-1');
    const changed = taskRepo.update(task.id, { agent_id: '' })!;
    expect(changed.revision).toBeGreaterThan(task.revision);
    expect(new ControlDecisionRepository(db).projectSnapshotRevision('project-1'))
      .toBeGreaterThan(revisionBeforeMetadataChange);
    const reviewWorkId = buildWorkIdentity({
      scope: 'task',
      targetId: task.id,
      agentId: 'reviewer',
      gateId: requested.gate.id,
      purpose: 'review',
    });

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(snapshot.workCells).toEqual(expect.arrayContaining([
      expect.objectContaining({ workId: reviewWorkId, state: 'ready' }),
    ]));
    expect(decideControlActions(snapshot, {
      revision: 3,
      maxConcurrent: 2,
      roleCapacity: { reviewer: 1 },
      fairnessAgingMs: 1_000,
    }).actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'activate', targetWorkId: reviewWorkId }),
    ]));
  });

  it('projects an accepted Gate blocker as waiting_human instead of retrying the evaluator', () => {
    let task = taskRepo.create({
      id: 'task-gate-blocked',
      conversation_id: 'project-1',
      title: 'Review needs external permission',
      agent_id: 'agent-a',
    }, now);
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;
    const requested = qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });
    const workId = buildWorkIdentity({
      scope: 'task',
      targetId: task.id,
      agentId: 'reviewer',
      gateId: requested.gate.id,
      purpose: 'review',
    });
    const deliveryRevision = (db.prepare(`
      SELECT revision FROM autonomous_delivery_run WHERE id=?
    `).get(runId) as { revision: number }).revision;
    const contract = contracts.issue({
      workId,
      attemptId: 'attempt-gate-blocked',
      projectId: 'project-1',
      deliveryRunId: runId,
      taskId: task.id,
      agentId: 'reviewer',
      goal: 'Review with external permission',
      acceptanceCriteria: ['Report a blocker when permission is unavailable'],
      role: { id: 'reviewer' },
      permissions: {},
      authoritativeRefs: [`task:${task.id}`, `delivery:${runId}`],
      authoritativeRevisions: { task: task.revision, deliveryRun: deliveryRevision },
      contextSnapshotRef: 'context:gate-blocked',
      allowedOutcomeTypes: ['report_blocked'],
      correlationId: 'corr:gate-blocked',
      causationId: requested.gate.id,
      now,
    });
    expect(contracts.admitOutcome({
      outcomeId: 'outcome-gate-blocked',
      idempotencyKey: 'outcome-gate-blocked',
      contractId: contract.contractId,
      outcomeType: 'report_blocked',
      payload: { reason: 'browser_permission_required' },
      evidenceRefs: ['permission:browser'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now.toISOString(),
    }, now)).toMatchObject({ status: 'accepted' });

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(snapshot.workCells.find((cell) => cell.workId === workId)).toMatchObject({
      state: 'waiting_human',
      humanResolution: 'required',
      gateStatus: 'requested',
    });
    expect(decideControlActions(snapshot, {
      revision: 5,
      maxConcurrent: 2,
      roleCapacity: { reviewer: 1 },
      fairnessAgingMs: 1_000,
    }).actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'escalateToHuman', targetWorkId: workId }),
    ]));
  });

  it('[scenario:review-rework] derives a bounded rework action from authoritative Gate history', () => {
    taskRepo.create({
      id: 'task-rework',
      conversation_id: 'project-1',
      title: 'Rework task',
      agent_id: 'agent-a',
    }, now);
    const source = issue(
      'task:task-rework:agent:agent-a:purpose:execute',
      'agent-a',
      'attempt-source',
      'task-rework',
    );
    let reworkTask = taskRepo.getById('task-rework')!;
    reworkTask = taskRepo.transition(reworkTask.id, {
      to: 'in_progress',
      expectedFrom: 'ready',
      expectedRevision: reworkTask.revision,
    })!;
    reworkTask = taskRepo.transition(reworkTask.id, {
      to: 'in_review',
      expectedFrom: 'in_progress',
      expectedRevision: reworkTask.revision,
    })!;
    const failGate = (artifactRevision: string) => {
      const requested = qualityGateRepo.request({
        conversationId: 'project-1',
        kind: 'code_review',
        targetType: 'task',
        targetId: 'task-rework',
        artifactRevision,
        criteria: {},
        actor: { type: 'system', id: 'test' },
        now,
      });
      const evaluating = qualityGateRepo.beginEvaluation({
        gateId: requested.gate.id,
        evaluator: { type: 'agent', id: 'reviewer' },
        expectedRevision: requested.gate.revision,
        now,
      });
      const evidence = qualityGateRepo.submitEvidence({
        gateId: requested.gate.id,
        evidenceType: 'review',
        payload: { artifactRevision },
        actor: { type: 'agent', id: 'reviewer' },
        idempotencyKey: `evidence:${artifactRevision}`,
        now,
      });
      qualityGateRepo.decide({
        gateId: requested.gate.id,
        decision: 'changes_requested',
        evaluator: { type: 'agent', id: 'reviewer' },
        evidenceIds: [evidence.id],
        reason: 'Needs repair',
        expectedRevision: evaluating.gate.revision,
        now,
      });
    };

    failGate(String(reworkTask.revision));
    const firstSnapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now })
      .build(runId);
    const first = firstSnapshot.workCells.find((cell) => cell.workId === source.workId);
    expect(first).toMatchObject({
      state: 'retry_pending',
      failure: {
        budget: { kind: 'task_rework', attemptsUsed: 0, maxAttempts: 1 },
      },
    });
    expect(decideControlActions(firstSnapshot, {
      revision: 1,
      maxConcurrent: 1,
      roleCapacity: { 'agent-a': 1 },
      fairnessAgingMs: 1_000,
    }).actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'retry',
        targetWorkId: source.workId,
        retryBudgetKind: 'task_rework',
        slotId: 'implementer:1',
      }),
    ]));

    reworkTask = taskRepo.transition(reworkTask.id, {
      to: 'in_progress',
      expectedFrom: 'in_review',
      expectedRevision: reworkTask.revision,
    })!;
    reworkTask = taskRepo.transition(reworkTask.id, {
      to: 'in_review',
      expectedFrom: 'in_progress',
      expectedRevision: reworkTask.revision,
    })!;
    failGate(String(reworkTask.revision));
    const second = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId)
      .workCells.find((cell) => cell.workId === source.workId);
    expect(second).toMatchObject({
      state: 'retry_pending',
      failure: {
        budget: { kind: 'task_rework', attemptsUsed: 1, maxAttempts: 1 },
      },
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

  it('uses existing authority epoch when a task contract predates delivery ownership', () => {
    const task = taskRepo.create({
      id: 'task-existing-authority',
      conversation_id: 'project-1',
      title: 'Existing task',
      agent_id: 'agent-a',
    }, now);
    const workId = `task:${task.id}:agent:${task.agent_id}:purpose:execute`;
    const external = contracts.issue({
      workId,
      attemptId: 'external-attempt',
      projectId: 'project-1',
      taskId: task.id,
      agentId: task.agent_id,
      goal: task.title,
      acceptanceCriteria: ['Done'],
      role: { id: 'implementer' },
      permissions: {},
      authoritativeRefs: [`work:${workId}`],
      authoritativeRevisions: {
        work: 1,
        task: task.revision,
        deliveryRun: new AutonomousDeliveryRepository().getRun(runId)!.revision,
      },
      contextSnapshotRef: `context:${workId}`,
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: `corr:${workId}`,
      causationId: `cause:${workId}`,
      now,
    });

    const cell = new RepositoryControlSnapshotBuilder({ db, now: () => now })
      .build(runId)
      .workCells.find((candidate) => candidate.workId === workId);

    expect(cell).toMatchObject({
      workId,
      workEpoch: external.workEpoch,
      state: 'ready',
    });
  });

  it('continues a delivery-owned Task Gate review from a valid checkpoint', () => {
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
    `).run(now.toISOString(), now.toISOString());
    let task = taskRepo.create({
      id: 'task-existing-reviewer',
      conversation_id: 'project-1',
      title: 'Review existing task',
      agent_id: 'agent-a',
    }, now);
    task = taskRepo.transition(task.id, { to: 'in_progress' }, now)!;
    task = taskRepo.transition(task.id, { to: 'in_review' }, now)!;
    qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });
    const reviewWorkId = `task:${task.id}:agent:reviewer:purpose:review`;
    const external = contracts.issue({
      workId: reviewWorkId,
      attemptId: 'external-review-attempt',
      projectId: 'project-1',
      deliveryRunId: runId,
      taskId: task.id,
      agentId: 'reviewer',
      goal: task.title,
      acceptanceCriteria: ['Review'],
      role: { id: 'reviewer' },
      permissions: {},
      authoritativeRefs: [`work:${reviewWorkId}`],
      authoritativeRevisions: {
        work: 1,
        task: task.revision,
        deliveryRun: new AutonomousDeliveryRepository().getRun(runId)!.revision,
      },
      contextSnapshotRef: `context:${reviewWorkId}`,
      allowedOutcomeTypes: ['continue_work', 'record_gate_decision'],
      correlationId: `corr:${reviewWorkId}`,
      causationId: `cause:${reviewWorkId}`,
      now,
    });

    invocationRepo.create({
      id: external.attemptId,
      conversation_id: 'project-1',
      agent_id: 'reviewer',
      work_contract_id: external.contractId,
      work_id: external.workId,
      work_epoch: external.workEpoch,
      fencing_token: external.fencingToken,
    }, now);
    expect(admitContinuation(external, 'task-gate')).toMatchObject({ status: 'accepted' });
    invocationRepo.transition(external.attemptId, {
      to: 'terminated',
      outcome: 'completed',
      reason_code: 'agent_requested_continuation',
    }, now);

    const cell = new RepositoryControlSnapshotBuilder({ db, now: () => now })
      .build(runId)
      .workCells.find((candidate) => candidate.workId === reviewWorkId);

    expect(cell).toMatchObject({
      workEpoch: external.workEpoch,
      state: 'continuation_pending',
      purpose: 'review',
      gateStatus: 'requested',
      continuation: { requestsUsed: 1 },
    });
  });

  it('continues a Delivery Gate verification from a valid checkpoint', () => {
    taskRepo.create({
      id: 'task-delivery-continuation',
      conversation_id: 'project-1',
      title: 'Delivery ready for verification',
      agent_id: 'agent-a',
    }, now);
    taskRepo.transition('task-delivery-continuation', { to: 'in_progress' }, now);
    taskRepo.transition('task-delivery-continuation', { to: 'in_review' }, now);
    taskRepo.transition('task-delivery-continuation', { to: 'done' }, now);
    const requested = qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'acceptance_verification',
      targetType: 'delivery_run',
      targetId: runId,
      artifactRevision: 'revision-1',
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });
    const workId = buildWorkIdentity({
      scope: 'delivery',
      targetId: runId,
      agentId: 'reviewer',
      gateId: requested.gate.id,
      purpose: 'verify',
    });
    const contract = issue(workId, 'reviewer', 'delivery-verification-attempt');
    invocationRepo.create({
      id: contract.attemptId,
      conversation_id: 'project-1',
      agent_id: 'reviewer',
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    }, now);
    expect(admitContinuation(contract, 'delivery-gate')).toMatchObject({ status: 'accepted' });
    invocationRepo.transition(contract.attemptId, {
      to: 'terminated',
      outcome: 'completed',
      reason_code: 'agent_requested_continuation',
    }, now);

    const cell = new RepositoryControlSnapshotBuilder({ db, now: () => now })
      .build(runId)
      .workCells.find((candidate) => candidate.workId === workId);

    expect(cell).toMatchObject({
      state: 'continuation_pending',
      purpose: 'verification',
      gateStatus: 'requested',
      continuation: { requestsUsed: 1 },
    });
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

    const gates = new Map<string, string>();
    for (const kind of ['delivery_review', 'acceptance_verification'] as const) {
      const requested = qualityGateRepo.request({
        conversationId: 'project-1',
        kind,
        targetType: 'delivery_run',
        targetId: runId,
        artifactRevision: 'revision-1',
        criteria: {},
        actor: { type: 'system', id: 'test' },
        now,
      });
      gates.set(kind, requested.gate.id);
    }
    const after = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(after.workCells.filter((cell) =>
      cell.purpose === 'review' || cell.purpose === 'verification'
    )).toMatchObject([
      {
        workId: buildWorkIdentity({
          scope: 'delivery',
          targetId: runId,
          agentId: 'reviewer',
          gateId: gates.get('delivery_review')!,
          purpose: 'review',
        }),
        state: 'ready',
      },
      {
        workId: buildWorkIdentity({
          scope: 'delivery',
          targetId: runId,
          agentId: 'reviewer',
          gateId: gates.get('acceptance_verification')!,
          purpose: 'verify',
        }),
        state: 'ready',
      },
    ]);
  });

  it('escalates a terminal Delivery Gate failure instead of retrying the same Gate', () => {
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
    `).run(now.toISOString(), now.toISOString());
    taskRepo.create({
      id: 'task-delivery-failed',
      conversation_id: 'project-1',
      title: 'Delivery',
      agent_id: 'agent-a',
    }, now);
    taskRepo.transition('task-delivery-failed', { to: 'in_progress' }, now);
    taskRepo.transition('task-delivery-failed', { to: 'in_review' }, now);
    taskRepo.transition('task-delivery-failed', { to: 'done' }, now);
    const requested = qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'delivery_review',
      targetType: 'delivery_run',
      targetId: runId,
      artifactRevision: '3',
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now,
    });
    const evidence = qualityGateRepo.submitEvidence({
      gateId: requested.gate.id,
      evidenceType: 'review',
      payload: { finding: 'material' },
      actor: { type: 'agent', id: 'reviewer' },
      idempotencyKey: 'delivery-review-failed',
      now,
    });
    const evaluating = qualityGateRepo.beginEvaluation({
      gateId: requested.gate.id,
      evaluator: { type: 'agent', id: 'reviewer' },
      expectedRevision: requested.gate.revision,
      now,
    });
    qualityGateRepo.decide({
      gateId: requested.gate.id,
      decision: 'changes_requested',
      evaluator: { type: 'agent', id: 'reviewer' },
      evidenceIds: [evidence.id],
      reason: 'Replan required',
      expectedRevision: evaluating.gate.revision,
      now,
    });

    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(snapshot.workCells.find((cell) => cell.purpose === 'review')).toMatchObject({
      state: 'failed',
      gateStatus: 'failed',
      failure: {
        reasonCode: 'delivery_review_failed',
        retryable: false,
        humanRecoverable: true,
      },
    });
    expect(decideControlActions(snapshot, {
      revision: 1,
      maxConcurrent: 2,
      roleCapacity: { reviewer: 1 },
      fairnessAgingMs: 1_000,
    }).actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'escalateToHuman',
        reasonCode: 'delivery_review_failed',
      }),
    ]));
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
