import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { InvocationFailureEventPublisher } from '../invocation-pipeline/failure-event-publisher';
import { AgentInbox } from '../platform-events/agent-inbox';
import { PlatformEventLog } from '../platform-events/event-log';
import { ControlSlotReleaseProcessManager } from './control-slot-release-process-manager';
import { DeliveryControlRuntime } from './control-runtime';

describe('DeliveryControlRuntime', () => {
  let db: Database.Database;
  const now = new Date('2026-07-28T12:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('planner','Planner','preset-planner','default','P',?,?)
    `).run(now.toISOString(), now.toISOString());
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('[scenario:project-start] boots through ControlDecision and Inbox without legacy actions', async () => {
    const runtime = new DeliveryControlRuntime({
      workerId: 'test-worker',
      now: () => now,
      policy: {
        revision: 1,
        maxConcurrent: 1,
        roleCapacity: {},
        fairnessAgingMs: 1_000,
      },
    });
    const contract = {
      idempotencyKey: 'project-start-command-1',
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
    };
    const started = runtime.start(contract);
    expect(runtime.start(contract).run.id).toBe(started.run.id);
    expect(() => runtime.start({ ...contract, goal: 'Different goal' }))
      .toThrow('Delivery start idempotency key is already bound to different content');

    expect(await runtime.advance(started.run.id, { kind: 'started' }))
      .toMatchObject({ disposition: 'acted' });
    expect(db.prepare('SELECT title,agent_id,status FROM task').all()).toEqual([{
      title: 'Ship',
      agent_id: 'planner',
      status: 'ready',
    }]);
    expect(db.prepare(`
      SELECT project_agent_id,status,json_extract(command_json,'$.source') AS source
      FROM agent_inbox_item
    `).all()).toEqual([{
      project_agent_id: 'planner',
      status: 'enqueued',
      source: 'system',
    }]);
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM delivery_control_action
    `).get() as { count: number }).count).toBeGreaterThan(0);
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('autonomous_delivery_action','autonomous_delivery_attempt')
    `).all()).toEqual([]);
  });

  it('[scenario:human-resume] waits for an explicit Human Command before resuming work', async () => {
    const runtime = new DeliveryControlRuntime({
      workerId: 'test-worker',
      now: () => now,
      policy: {
        revision: 1,
        maxConcurrent: 1,
        roleCapacity: {},
        fairnessAgingMs: 1_000,
      },
    });
    const started = runtime.start({
      idempotencyKey: 'human-resume-command-1',
      goal: 'Ship after approval',
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
    });
    expect(await runtime.advance(started.run.id, { kind: 'started' }))
      .toMatchObject({ disposition: 'acted' });
    const inbox = new AgentInbox({ db, now: () => now });
    const blocked = inbox.claimNext()!;
    inbox.expire(blocked.id, blocked.leaseToken!, 'runtime_profile_missing');
    const eventLog = new PlatformEventLog({ db, now: () => now });
    const trigger = {
      id: `inbox:${blocked.id}:${blocked.attemptCount}`,
      idempotencyKey: blocked.idempotencyKey,
      source: blocked.command.source,
      conversationId: blocked.projectId,
      agentId: blocked.projectAgentId,
      prompt: blocked.command.prompt,
      correlationId: blocked.command.correlationId,
      causationId: blocked.command.causationId,
      workId: blocked.command.workId,
      taskId: blocked.command.taskId,
      deliveryRunId: blocked.command.deliveryRunId,
    };
    new InvocationFailureEventPublisher({
      eventLog,
      runtimeActorId: 'test-runtime',
    }).publish(trigger, {
      status: 'blocked',
      reasonCode: 'runtime_profile_missing',
      message: 'No configured runtime profile',
    });
    await new ControlSlotReleaseProcessManager(db).handle(
      eventLog.listByInvocation(trigger.id)[0]!,
      { signal: new AbortController().signal },
    );

    expect(await runtime.advance(started.run.id, { kind: 'fact_changed' }))
      .toMatchObject({
        disposition: 'waiting_human',
        snapshot: { run: { status: 'waiting_human' } },
      });
    expect(await runtime.advance(started.run.id, { kind: 'periodic_reconcile' }))
      .toMatchObject({
        disposition: 'waiting_human',
        snapshot: { run: { status: 'waiting_human' } },
      });
    expect(db.prepare('SELECT COUNT(*) AS count FROM task').get()).toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT status,last_error FROM agent_inbox_item ORDER BY created_at,id
    `).all()).toEqual([{
      status: 'expired',
      last_error: 'runtime_profile_missing',
    }]);

    expect(await runtime.advance(started.run.id, { kind: 'manual_resume' }))
      .toMatchObject({ disposition: 'acted' });
    expect(runtime.get(started.run.id)?.run).toMatchObject({
      status: 'active',
      escalation_code: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM task').get()).toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT status FROM agent_inbox_item ORDER BY created_at,id
    `).all()).toEqual([
      { status: 'expired' },
      { status: 'enqueued' },
    ]);
  });
});
