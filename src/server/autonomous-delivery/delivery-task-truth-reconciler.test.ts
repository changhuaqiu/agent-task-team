import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { QualityGateRepository } from '../quality-gate/repository';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskRepo } from '../repositories/task-repo';
import { WorkContractRepository } from '../work-contract/repository';
import { DeliveryTaskTruthReconciler } from './delivery-task-truth-reconciler';
import { AutonomousDeliveryRepository } from './repository';

const CREATED_AT = new Date('2026-08-19T01:00:00.000Z');
const COMPLETED_AT = new Date('2030-08-19T02:00:00.000Z');
const RECONCILED_AT = new Date('2030-08-19T03:00:00.000Z');

describe('DeliveryTaskTruthReconciler', () => {
  let db: Database.Database;
  let delivery: AutonomousDeliveryRepository;
  let runId: string;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(CREATED_AT.toISOString(), CREATED_AT.toISOString());
    delivery = new AutonomousDeliveryRepository(db);
    runId = delivery.createRun({
      idempotencyKey: 'delivery-task-truth-test',
      goal: 'Ship reviewed work',
      acceptanceCriteria: ['Reviewed work is delivered'],
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
    }, CREATED_AT).run.id;
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function createLinkedTask(taskId = 'task-1') {
    const task = taskRepo.create({
      id: taskId,
      conversation_id: 'project-1',
      title: 'Reviewed task',
      agent_id: 'builder',
    });
    new WorkContractRepository().issue({
      workId: `task:${taskId}:agent:builder:purpose:execute`,
      attemptId: `attempt-${taskId}`,
      projectId: 'project-1',
      taskId,
      deliveryRunId: runId,
      agentId: 'builder',
      goal: 'Finish the task',
      acceptanceCriteria: ['Review passes'],
      role: { id: 'implementer' },
      permissions: {},
      authoritativeRefs: [`task:${taskId}`, `delivery:${runId}`],
      authoritativeRevisions: { task: task.revision, deliveryRun: 0 },
      contextSnapshotRef: `context:${taskId}`,
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: runId,
      causationId: `created:${taskId}`,
      now: CREATED_AT,
    });
    return task;
  }

  function completeDelivery(): void {
    const run = delivery.getRun(runId)!;
    delivery.transitionRun({
      runId,
      to: 'completed',
      stage: 'delivering',
      expectedRevision: run.revision,
      now: COMPLETED_AT,
      bundle: {
        summary: 'Reviewed work delivered',
        acceptanceResults: [{
          criterion: 'Reviewed work is delivered',
          status: 'passed',
          evidenceRefs: ['review:task-1'],
        }],
        changeRefs: ['task:task-1'],
        verificationRefs: ['review:task-1'],
        providerRefs: [],
        knownLimitations: [],
        completedAt: COMPLETED_AT.toISOString(),
      },
    });
  }

  function recordPassedReviewAction() {
    const task = taskRepo.getById('task-1')!;
    const gates = new QualityGateRepository(db);
    const requested = gates.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: { blockers: 0 },
      actor: { type: 'agent', id: 'builder' },
      now: new Date('2026-08-19T01:10:00.000Z'),
    });
    const evidence = gates.submitEvidence({
      gateId: requested.gate.id,
      evidenceType: 'review_report',
      payload: { blockers: [] },
      actor: { type: 'agent', id: 'reviewer' },
      idempotencyKey: 'review-task-1',
      now: new Date('2026-08-19T01:11:00.000Z'),
    });
    const evaluating = gates.beginEvaluation({
      gateId: requested.gate.id,
      evaluator: { type: 'agent', id: 'reviewer' },
      expectedRevision: requested.gate.revision,
      now: new Date('2026-08-19T01:12:00.000Z'),
    });
    gates.decide({
      gateId: requested.gate.id,
      decision: 'passed',
      evaluator: { type: 'agent', id: 'reviewer' },
      evidenceIds: [evidence.id],
      expectedRevision: evaluating.gate.revision,
      now: new Date('2026-08-19T01:13:00.000Z'),
    });
    const passedEvent = new PlatformEventLog({ db })
      .listStream(`quality_gate:${requested.gate.id}`)
      .find((event) => event.type === 'gate.passed')!;
    taskRepo.transition('task-1', {
      to: 'done',
      correlationId: runId,
      causationId: passedEvent.eventId,
    });
    return taskGraphRepo.appendAction({
      conversationId: 'project-1',
      actorId: 'reviewer',
      actorType: 'agent',
      type: 'task.review_recorded',
      taskIds: ['task-1'],
      proofEventId: passedEvent.eventId,
      payload: {
        previousStatus: 'in_review',
        status: 'done',
        gateId: requested.gate.id,
        decision: 'passed',
      },
    });
  }

  it('restores a regressed Task from its pre-completion review receipt exactly once', () => {
    createLinkedTask();
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    const reviewAction = recordPassedReviewAction();
    completeDelivery();
    taskRepo.transition('task-1', { to: 'ready' });
    taskRepo.transition('task-1', { to: 'in_progress' });
    db.prepare(`
      UPDATE platform_event
      SET occurred_at='2030-08-19T02:30:00.000Z'
      WHERE stream_key='task:task-1' AND type='task.ready'
    `).run();
    db.prepare(`
      UPDATE platform_event
      SET occurred_at='2030-08-19T02:31:00.000Z'
      WHERE id=(
        SELECT id FROM platform_event
        WHERE stream_key='task:task-1' AND type='task.in_progress'
        ORDER BY stream_sequence DESC LIMIT 1
      )
    `).run();

    const reconciler = new DeliveryTaskTruthReconciler({ now: () => RECONCILED_AT });
    expect(reconciler.runOnce()).toEqual({ scanned: 1, repaired: 1 });
    expect(reconciler.runOnce()).toEqual({ scanned: 0, repaired: 0 });

    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'done', revision: 7 });
    expect(taskGraphRepo.revision('project-1')).toBe(1);
    const reconciliationActions = taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => {
        const payload = JSON.parse(action.payload) as { reasonCode?: string };
        return payload.reasonCode === 'delivery_terminal_projection_reconciled';
      });
    expect(reconciliationActions).toHaveLength(1);
    expect(JSON.parse(reconciliationActions[0]!.payload)).toMatchObject({
      previousStatus: 'in_progress',
      status: 'done',
      deliveryRunId: runId,
      sourceReviewActionId: reviewAction.id,
    });

    const proofs = proofLogRepo.findByType({
      eventType: 'delivery.task_projection_reconciled',
      conversationId: 'project-1',
      taskId: 'task-1',
      reasonCode: 'delivery_terminal_projection_reconciled',
    });
    expect(proofs).toHaveLength(1);
    expect(JSON.parse(proofs[0]!.metadata!)).toMatchObject({
      previousStatus: 'in_progress',
      deliveryRunId: runId,
      sourceReviewActionId: reviewAction.id,
    });

    const event = new PlatformEventLog({ db }).listStream('task:task-1').at(-1);
    expect(event).toMatchObject({
      type: 'task.done',
      actor: { type: 'system', id: 'delivery-task-truth-reconciler' },
      causationId: reviewAction.id,
      payload: {
        previousStatus: 'in_review',
        status: 'done',
        reconciledFromStatus: 'in_progress',
        reasonCode: 'delivery_terminal_projection_reconciled',
        deliveryRunId: runId,
        sourceActionId: reviewAction.id,
      },
    });
  });

  it('does not repair when the latest pre-completion Task status revoked completion', () => {
    createLinkedTask();
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    recordPassedReviewAction();
    taskRepo.transition('task-1', { to: 'ready' });
    taskGraphRepo.appendAction({
      conversationId: 'project-1',
      actorId: 'coordinator',
      actorType: 'agent',
      type: 'task.status_changed',
      taskIds: ['task-1'],
      payload: { previousStatus: 'done', status: 'ready' },
    });
    completeDelivery();

    const reconciler = new DeliveryTaskTruthReconciler({ now: () => RECONCILED_AT });
    expect(reconciler.runOnce()).toEqual({ scanned: 1, repaired: 0 });
    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'ready' });
    expect(proofLogRepo.findByType({
      eventType: 'delivery.task_projection_reconciled',
      conversationId: 'project-1',
      taskId: 'task-1',
    })).toEqual([]);
  });

  it('does not repair a direct Task reopening that happened before delivery completion', () => {
    createLinkedTask();
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    const reviewAction = recordPassedReviewAction();
    db.prepare('UPDATE task_action SET created_at=? WHERE id=?')
      .run('2026-08-19T01:30:00.000Z', reviewAction.id);
    taskRepo.transition('task-1', { to: 'ready' });
    db.prepare(`
      UPDATE platform_event
      SET occurred_at='2026-08-19T01:45:00.000Z'
      WHERE stream_key='task:task-1' AND type IN ('task.done','task.ready')
    `).run();
    completeDelivery();

    const reconciler = new DeliveryTaskTruthReconciler({ now: () => RECONCILED_AT });
    expect(reconciler.runOnce()).toEqual({ scanned: 1, repaired: 0 });
    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'ready' });
  });

  it('walks the legal blocked recovery path before restoring completion', () => {
    createLinkedTask();
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    recordPassedReviewAction();
    completeDelivery();
    taskRepo.transition('task-1', { to: 'ready' });
    taskRepo.transition('task-1', { to: 'blocked' });
    db.prepare(`
      UPDATE platform_event
      SET occurred_at='2030-08-19T02:30:00.000Z'
      WHERE stream_key='task:task-1' AND type IN ('task.ready','task.blocked')
    `).run();

    const reconciler = new DeliveryTaskTruthReconciler({ now: () => RECONCILED_AT });
    expect(reconciler.runOnce()).toEqual({ scanned: 1, repaired: 1 });
    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'done', revision: 8 });
    const action = taskGraphRepo.listActionsForTask('task-1').at(-1)!;
    expect(JSON.parse(action.payload)).toMatchObject({
      previousStatus: 'blocked',
      projectionTransitionPath: ['in_progress', 'in_review', 'done'],
    });
  });

  it('paginates past an ineligible page to repair later Tasks', () => {
    createLinkedTask('task-0');
    createLinkedTask('task-1');
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    recordPassedReviewAction();
    completeDelivery();
    taskRepo.transition('task-1', { to: 'ready' });
    db.prepare(`
      UPDATE platform_event
      SET occurred_at='2030-08-19T02:30:00.000Z'
      WHERE stream_key='task:task-1' AND type='task.ready'
    `).run();

    const reconciler = new DeliveryTaskTruthReconciler({
      batchSize: 1,
      now: () => RECONCILED_AT,
    });
    expect(reconciler.runOnce()).toEqual({ scanned: 2, repaired: 1 });
    expect(taskRepo.getById('task-0')).toMatchObject({ status: 'ready' });
    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'done' });
  });
});
