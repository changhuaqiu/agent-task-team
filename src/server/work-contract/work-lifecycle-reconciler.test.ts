import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { AgentInbox } from '../platform-events/agent-inbox';
import { PlatformEventLog } from '../platform-events/event-log';
import { buildWorkIdentity } from './work-identity';
import { WorkContractRepository } from './repository';
import { WorkLifecycleReconciler } from './work-lifecycle-reconciler';

describe('WorkLifecycleReconciler', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let inbox: AgentInbox;
  let contracts: WorkContractRepository;
  const now = new Date('2026-08-21T01:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    log = new PlatformEventLog({ db });
    inbox = new AgentInbox({ db, eventLog: log, now: () => now });
    contracts = new WorkContractRepository();
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('closes only Task-scoped Work at Task terminal, then all Delivery Work at Delivery terminal', async () => {
    const delivery = new AutonomousDeliveryRepository(db).createRun({
      idempotencyKey: 'delivery-1',
      goal: 'Ship',
      acceptanceCriteria: ['Done'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: { maxAttemptsPerAction: 2, maxRepairCycles: 1, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: true, requireWebE2E: false, requireMerge: false },
    }, now).run;
    const task = taskRepo.create({
      id: 'task-1',
      conversation_id: 'project-1',
      title: 'Implement',
      agent_id: 'builder',
    });
    const taskWorkId = buildWorkIdentity({
      scope: 'task', targetId: task.id, agentId: 'builder', purpose: 'execute',
    });
    const deliveryWorkId = buildWorkIdentity({
      scope: 'delivery', targetId: delivery.id, agentId: 'reviewer', purpose: 'review',
      gateId: 'gate-1',
    });
    contracts.issue({
      workId: taskWorkId,
      attemptId: 'attempt-task',
      projectId: 'project-1',
      taskId: task.id,
      deliveryRunId: delivery.id,
      agentId: 'builder',
      goal: 'Implement', acceptanceCriteria: ['Done'], role: {}, permissions: {},
      authoritativeRefs: [`task:${task.id}`],
      authoritativeRevisions: { task: task.revision, deliveryRun: delivery.revision },
      contextSnapshotRef: 'context-task', allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'corr-1', causationId: 'cause-1', now,
    });
    contracts.issue({
      workId: deliveryWorkId,
      attemptId: 'attempt-delivery',
      projectId: 'project-1',
      taskId: task.id,
      deliveryRunId: delivery.id,
      agentId: 'reviewer',
      goal: 'Review', acceptanceCriteria: ['Passed'], role: {}, permissions: {},
      authoritativeRefs: [`delivery:${delivery.id}`],
      authoritativeRevisions: { task: task.revision, deliveryRun: delivery.revision },
      contextSnapshotRef: 'context-delivery', allowedOutcomeTypes: ['record_gate_decision'],
      correlationId: 'corr-1', causationId: 'cause-2', now,
    });
    const taskInbox = inbox.enqueue({
      projectId: 'project-1', projectAgentId: 'builder', idempotencyKey: 'task-command',
      command: { source: 'workflow', taskId: task.id, workId: taskWorkId, prompt: 'Implement' },
    });
    const deliveryInbox = inbox.enqueue({
      projectId: 'project-1', projectAgentId: 'reviewer', idempotencyKey: 'delivery-command',
      command: {
        source: 'review_gate', taskId: task.id, deliveryRunId: delivery.id,
        workId: deliveryWorkId, prompt: 'Review',
      },
    });
    const claimedTaskInbox = inbox.claimNext();
    expect(claimedTaskInbox?.id).toBe(taskInbox.id);
    taskRepo.transition(task.id, { to: 'in_progress' });
    taskRepo.transition(task.id, { to: 'in_review' });
    taskRepo.transition(task.id, { to: 'done' });
    const taskDone = log.listStream(`task:${task.id}`).find((event) => event.type === 'task.done')!;
    const reconciler = new WorkLifecycleReconciler({ inbox, contracts });

    await reconciler.handle(taskDone, { signal: new AbortController().signal });

    expect(contracts.getAuthority(taskWorkId)?.status).toBe('closed');
    expect(contracts.getAuthority(deliveryWorkId)?.status).toBe('active');
    expect(inbox.get(taskInbox.id)?.status).toBe('cancelled');
    expect(inbox.get(taskInbox.id)?.leaseToken).toBeUndefined();
    expect(inbox.get(deliveryInbox.id)?.status).toBe('enqueued');

    const lateTaskInbox = inbox.enqueue({
      projectId: 'project-1', projectAgentId: 'builder', idempotencyKey: 'late-task-command',
      command: { source: 'workflow', taskId: task.id, workId: taskWorkId, prompt: 'Late retry' },
    });
    const lateEnqueued = log.listStream('agent-work:project-1:builder')
      .filter((event) => event.type === 'agent.work.enqueued')
      .at(-1)!;
    await reconciler.handle(lateEnqueued, { signal: new AbortController().signal });
    expect(inbox.get(lateTaskInbox.id)?.status).toBe('cancelled');

    new AutonomousDeliveryRepository(db).transitionRun({
      runId: delivery.id,
      to: 'failed',
      stage: 'planning',
      expectedRevision: delivery.revision,
      actor: { type: 'system', id: 'test' },
      correlationId: 'corr-1',
      causationId: 'test-terminal',
      now,
    });
    const deliveryDone = log.listStream(`delivery_run:${delivery.id}`)
      .find((event) => event.type === 'delivery.run.failed')!;

    await reconciler.handle(deliveryDone, { signal: new AbortController().signal });

    expect(contracts.getAuthority(deliveryWorkId)?.status).toBe('closed');
    expect(inbox.get(deliveryInbox.id)?.status).toBe('cancelled');
  });

  it('cancels claimed Task and Delivery commands even before a WorkContract exists', async () => {
    const task = taskRepo.create({
      id: 'task-unissued',
      conversation_id: 'project-1',
      title: 'Unissued work',
      agent_id: 'builder',
    });
    const taskWorkId = buildWorkIdentity({
      scope: 'task', targetId: task.id, agentId: 'builder', purpose: 'execute',
    });
    const taskItem = inbox.enqueue({
      projectId: 'project-1', projectAgentId: 'builder', idempotencyKey: 'unissued-task',
      command: { source: 'workflow', taskId: task.id, workId: taskWorkId, prompt: 'Build' },
    });
    expect(inbox.claimNext()?.id).toBe(taskItem.id);
    taskRepo.transition(task.id, { to: 'in_progress' });
    taskRepo.transition(task.id, { to: 'cancelled' });
    const taskTerminal = log.listStream(`task:${task.id}`)
      .find((event) => event.type === 'task.cancelled')!;
    const reconciler = new WorkLifecycleReconciler({ inbox, contracts });

    await reconciler.handle(taskTerminal, { signal: new AbortController().signal });

    expect(inbox.get(taskItem.id)).toMatchObject({ status: 'cancelled' });
    expect(contracts.getAuthority(taskWorkId)).toBeUndefined();

    const delivery = new AutonomousDeliveryRepository(db).createRun({
      idempotencyKey: 'unissued-delivery',
      goal: 'Ship', acceptanceCriteria: ['Done'], scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true, allowPush: false, allowPullRequest: false, allowAutoMerge: false,
      },
      recoveryPolicy: { maxAttemptsPerAction: 2, maxRepairCycles: 1, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: true, requireWebE2E: false, requireMerge: false },
    }, now).run;
    const deliveryWorkId = buildWorkIdentity({
      scope: 'delivery', targetId: delivery.id, agentId: 'reviewer', purpose: 'review',
    });
    const deliveryItem = inbox.enqueue({
      projectId: 'project-1', projectAgentId: 'reviewer', idempotencyKey: 'unissued-delivery',
      command: {
        source: 'review_gate', deliveryRunId: delivery.id, workId: deliveryWorkId, prompt: 'Review',
      },
    });
    expect(inbox.claimNext()?.id).toBe(deliveryItem.id);
    new AutonomousDeliveryRepository(db).transitionRun({
      runId: delivery.id, to: 'failed', stage: 'planning', expectedRevision: delivery.revision,
      actor: { type: 'system', id: 'test' }, now,
    });
    const deliveryTerminal = log.listStream(`delivery_run:${delivery.id}`)
      .find((event) => event.type === 'delivery.run.failed')!;

    await reconciler.handle(deliveryTerminal, { signal: new AbortController().signal });

    expect(inbox.get(deliveryItem.id)).toMatchObject({ status: 'cancelled' });
    expect(contracts.getAuthority(deliveryWorkId)).toBeUndefined();
  });
});
