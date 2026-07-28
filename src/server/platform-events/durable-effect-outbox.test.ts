import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { proofLogRepo } from '../repositories/proof-log-repo';
import {
  DurableEffectConflictError,
  DurableEffectOutbox,
  type TransactionalEffectRegistration,
} from './durable-effect-outbox';
import { PlatformEventLog } from './event-log';

describe('DurableEffectOutbox', () => {
  let db: Database.Database;
  let sourceEventId: string;
  let clock: Date;
  let nextId: number;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    clock = new Date('2026-07-25T08:00:00.000Z');
    nextId = 0;
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(clock.toISOString(), clock.toISOString());
    sourceEventId = new PlatformEventLog({ db }).append({
      type: 'runtime.invocation.terminated',
      category: 'runtime_lifecycle',
      projectId: 'project-1',
      streamKey: 'invocation:inv-1',
      aggregate: { type: 'invocation', id: 'inv-1' },
      actor: { type: 'runtime', id: 'daemon' },
      invocationId: 'inv-1',
      correlationId: 'trace-1',
      payload: { outcome: 'completed', durationMs: 1 },
    }).eventId;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDb();
    db.close();
  });

  function createOutbox(
    workerId = 'worker-1',
    options: { leaseMs?: number; retryDelayMs?: (attempt: number) => number } = {},
  ): DurableEffectOutbox {
    return new DurableEffectOutbox({
      db,
      workerId,
      now: () => clock,
      idFactory: (prefix) => `${prefix}-${++nextId}`,
      leaseMs: options.leaseMs ?? 30_000,
      retryDelayMs: options.retryDelayMs ?? (() => 0),
    });
  }

  it('atomically accepts a batch and rejects idempotency content drift', () => {
    const outbox = createOutbox();
    const input = {
      sourceEventId,
      laneKey: 'runtime-completion:inv-1',
      effects: [
        { type: 'runtime.task_sync', targetKey: 'inv-1', payload: { projectId: 'project-1' } },
        { type: 'runtime.a2a_done', targetKey: 'inv-1', payload: { agentId: 'implementer' } },
      ],
    };

    const first = outbox.enqueueBatch(input);
    const duplicate = outbox.enqueueBatch(input);
    expect(duplicate.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(first.map((item) => item.laneSequence)).toEqual([1, 2]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM platform_event WHERE type='effect.enqueued'
    `).get()).toEqual({ count: 2 });

    expect(() => outbox.enqueueBatch({
      ...input,
      effects: [
        { type: 'runtime.task_sync', targetKey: 'inv-1', payload: { projectId: 'other' } },
      ],
    })).toThrow(DurableEffectConflictError);

    expect(() => db.transaction(() => {
      db.prepare("UPDATE conversation SET title='changed' WHERE id='project-1'").run();
      outbox.enqueueBatch({
        sourceEventId,
        laneKey: 'rollback-lane',
        effects: [{ type: 'test.rollback', targetKey: 'one', payload: {} }],
      });
      throw new Error('rollback');
    }).immediate()).toThrow('rollback');
    expect(db.prepare("SELECT title FROM conversation WHERE id='project-1'").get())
      .toEqual({ title: 'Project' });
    expect(db.prepare(
      "SELECT COUNT(*) count FROM platform_effect_outbox WHERE lane_key='rollback-lane'",
    ).get()).toEqual({ count: 0 });
  });

  it('freezes blocking applicability and retry budget at Effect creation', () => {
    db.prepare(`
      INSERT INTO autonomous_delivery_run (
        id,conversation_id,start_idempotency_key,status,current_stage,goal_contract_json,repair_cycle,
        revision,created_at,updated_at
      ) VALUES ('run-1','project-1','effect-test-run-1','active','executing','{}',0,3,?,?)
    `).run(clock.toISOString(), clock.toISOString());
    const outbox = createOutbox();
    outbox.register({
      type: 'test.blocking',
      execution: 'transactional',
      maxAttempts: 2,
      execute() {},
    });
    const [effect] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'delivery:run-1',
      effects: [{
        type: 'test.blocking',
        targetKey: 'publish',
        payload: {},
        criticality: 'blocking',
        deliveryRunId: 'run-1',
        appliesFromRevision: 3,
        sourceActionId: 'control-action-1',
      }],
    });

    expect(effect).toMatchObject({
      criticality: 'blocking',
      deliveryRunId: 'run-1',
      appliesFromRevision: 3,
      sourceActionId: 'control-action-1',
      maxAttempts: 2,
    });
    expect(outbox.listApplicableBlocking('run-1', 2)).toEqual([]);
    expect(outbox.listApplicableBlocking('run-1', 3).map((item) => item.id))
      .toEqual([effect!.id]);

    const afterRestart = createOutbox('worker-after-restart');
    afterRestart.register({
      type: 'test.blocking',
      execution: 'transactional',
      maxAttempts: 9,
      execute() {},
    });
    expect(afterRestart.enqueueBatch({
      sourceEventId,
      laneKey: 'delivery:run-1',
      effects: [{
        type: 'test.blocking',
        targetKey: 'publish',
        payload: {},
        criticality: 'blocking',
        deliveryRunId: 'run-1',
        appliesFromRevision: 3,
        sourceActionId: 'control-action-1',
      }],
    })[0]?.maxAttempts).toBe(2);
  });

  it('requires explicit cancellation or supersession to remove a blocking Effect', () => {
    db.prepare(`
      INSERT INTO autonomous_delivery_run (
        id,conversation_id,start_idempotency_key,status,current_stage,goal_contract_json,repair_cycle,
        revision,created_at,updated_at
      ) VALUES ('run-1','project-1','effect-test-run-1','active','executing','{}',0,4,?,?)
    `).run(clock.toISOString(), clock.toISOString());
    const outbox = createOutbox();
    const [cancelled, superseded] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'delivery:run-1',
      effects: ['cancel', 'supersede'].map((targetKey) => ({
        type: 'test.effect',
        targetKey,
        payload: {},
        criticality: 'blocking' as const,
        deliveryRunId: 'run-1',
        appliesFromRevision: 4,
      })),
    });

    expect(outbox.cancel({
      effectId: cancelled!.id,
      reason: 'delivery policy changed',
    })).toBe(true);
    expect(outbox.supersede({
      effectId: superseded!.id,
      atRevision: 5,
      reason: 'new artifact revision',
      successorEffectId: 'effect-successor',
    })).toBe(true);

    expect(outbox.get(cancelled!.id)).toMatchObject({
      status: 'cancelled',
      dispositionReason: 'delivery policy changed',
    });
    expect(outbox.get(superseded!.id)).toMatchObject({
      status: 'superseded',
      supersededAtRevision: 5,
      successorEffectId: 'effect-successor',
      dispositionReason: 'new artifact revision',
    });
    expect(outbox.listApplicableBlocking('run-1', 5)).toEqual([]);
  });

  it('serializes one lane while allowing another lane to run', async () => {
    const outbox = createOutbox();
    const calls: string[] = [];
    outbox.register({
      type: 'test.effect',
      execution: 'transactional',
      execute(effect) {
        calls.push(effect.targetKey);
      },
    });
    outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'lane-a',
      effects: [
        { type: 'test.effect', targetKey: 'a1', payload: {} },
        { type: 'test.effect', targetKey: 'a2', payload: {} },
      ],
    });
    outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'lane-b',
      effects: [{ type: 'test.effect', targetKey: 'b1', payload: {} }],
    });

    expect(await outbox.drain()).toEqual({
      succeeded: 2,
      failed: 0,
      deadLettered: 0,
      fenced: 0,
    });
    expect(new Set(calls)).toEqual(new Set(['a1', 'b1']));
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 });
    expect(calls.at(-1)).toBe('a2');
  });

  it('commits a transactional action and success receipt together', async () => {
    const outbox = createOutbox();
    let fail = true;
    outbox.register({
      type: 'test.proof',
      execution: 'transactional',
      execute() {
        proofLogRepo.append({
          eventType: 'durable.effect.test',
          conversationId: 'project-1',
        });
        if (fail) throw new Error('after local write');
      },
    });
    const [effect] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'proof-lane',
      effects: [{ type: 'test.proof', targetKey: 'proof', payload: {} }],
    });

    expect(await outbox.drain()).toMatchObject({ failed: 1 });
    expect(proofLogRepo.findByType({
      eventType: 'durable.effect.test',
      conversationId: 'project-1',
    })).toHaveLength(0);
    expect(outbox.get(effect!.id)?.status).toBe('queued');

    fail = false;
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 });
    expect(proofLogRepo.findByType({
      eventType: 'durable.effect.test',
      conversationId: 'project-1',
    })).toHaveLength(1);
    expect(outbox.get(effect!.id)?.status).toBe('succeeded');
    expect(new PlatformEventLog({ db }).listStream(`effect:${effect!.id}`)
      .map((event) => event.type)).toEqual([
      'effect.enqueued',
      'effect.retry_scheduled',
      'effect.succeeded',
    ]);
  });

  it('runs best-effort notification only after transactional commit', async () => {
    const observedStatuses: string[] = [];
    const afterCommitError = vi.fn();
    const effectOutbox = new DurableEffectOutbox({
      db,
      workerId: 'after-commit-worker',
      now: () => clock,
      idFactory: (prefix) => `${prefix}-${++nextId}`,
      retryDelayMs: () => 0,
      onAfterCommitError: afterCommitError,
    });
    effectOutbox.register({
      type: 'test.after-commit',
      execution: 'transactional',
      execute(effect) {
        proofLogRepo.append({
          eventType: 'durable.effect.after-commit',
          conversationId: 'project-1',
        });
        return {
          afterCommit() {
            observedStatuses.push(effectOutbox.get(effect.id)!.status);
            throw new Error('socket unavailable');
          },
        };
      },
    });
    const [effect] = effectOutbox.enqueueBatch({
      sourceEventId,
      laneKey: 'after-commit-lane',
      effects: [{ type: 'test.after-commit', targetKey: 'one', payload: {} }],
    });

    expect(await effectOutbox.drain()).toMatchObject({ succeeded: 1, failed: 0 });
    expect(observedStatuses).toEqual(['succeeded']);
    expect(afterCommitError).toHaveBeenCalledTimes(1);
    expect(effectOutbox.get(effect!.id)?.status).toBe('succeeded');
  });

  it('rejects an asynchronous transactional adapter', async () => {
    const outbox = createOutbox();
    outbox.register({
      type: 'test.async-transaction',
      execution: 'transactional',
      execute: (() => Promise.resolve()) as unknown as TransactionalEffectRegistration['execute'],
    });
    const [effect] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'async-lane',
      effects: [{ type: 'test.async-transaction', targetKey: 'one', payload: {} }],
    });

    expect(await outbox.drain()).toMatchObject({ failed: 1 });
    expect(outbox.get(effect!.id)?.lastError)
      .toContain('durable_effect_transactional_adapter_async');
  });

  it('retries an idempotent adapter with the same key after an ambiguous success', async () => {
    const outbox = createOutbox();
    const observedKeys: string[] = [];
    outbox.register({
      type: 'test.external',
      execution: 'idempotent',
      async execute(_effect, context) {
        observedKeys.push(context.idempotencyKey);
        if (observedKeys.length === 1) {
          // Simulates a downstream success followed by a lost acknowledgement.
          throw new Error('acknowledgement_lost');
        }
      },
    });
    const [effect] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'external-lane',
      effects: [{ type: 'test.external', targetKey: 'remote-1', payload: {} }],
    });

    expect(await outbox.drain()).toMatchObject({ failed: 1 });
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 });
    expect(observedKeys).toEqual([effect!.idempotencyKey, effect!.idempotencyKey]);
  });

  it('aborts on timeout and waits for the adapter to release before retrying', async () => {
    vi.useFakeTimers();
    const outbox = createOutbox();
    let released = false;
    outbox.register({
      type: 'test.timeout',
      execution: 'idempotent',
      timeoutMs: 20,
      execute(_effect, context) {
        return new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => {
            released = true;
            resolve();
          }, { once: true });
        });
      },
    });
    const [effect] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'timeout-lane',
      effects: [{ type: 'test.timeout', targetKey: 'one', payload: {} }],
    });

    const draining = outbox.drain();
    await vi.advanceTimersByTimeAsync(20);
    expect(await draining).toMatchObject({ failed: 1 });
    expect(released).toBe(true);
    expect(outbox.get(effect!.id)?.status).toBe('queued');
  });

  it('recovers expired work and fences the old attempt', async () => {
    const oldWorker = createOutbox('worker-old', { leaseMs: 60_000 });
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const keys: string[] = [];
    oldWorker.register({
      type: 'test.fenced',
      execution: 'idempotent',
      async execute(_effect, context) {
        keys.push(context.idempotencyKey);
        await oldGate;
      },
    });
    const [effect] = oldWorker.enqueueBatch({
      sourceEventId,
      laneKey: 'fenced-lane',
      effects: [{ type: 'test.fenced', targetKey: 'one', payload: {} }],
    });
    const oldDrain = oldWorker.drain();
    await vi.waitFor(() => {
      expect(keys).toHaveLength(1);
    });

    db.prepare(`
      UPDATE platform_effect_outbox SET lease_expires_at=?
      WHERE id=?
    `).run('2026-07-25T07:59:59.000Z', effect!.id);
    const newWorker = createOutbox('worker-new', { leaseMs: 60_000 });
    newWorker.register({
      type: 'test.fenced',
      execution: 'idempotent',
      execute(_command, context) {
        keys.push(context.idempotencyKey);
      },
    });
    expect(newWorker.recover()).toEqual({
      recovered: 1,
      abandonedAttempts: 1,
      deadLettered: 0,
    });
    expect(await newWorker.drain()).toMatchObject({ succeeded: 1 });

    releaseOld();
    expect(await oldDrain).toMatchObject({ fenced: 1 });
    expect(keys).toEqual([effect!.idempotencyKey, effect!.idempotencyKey]);
    expect(newWorker.get(effect!.id)?.status).toBe('succeeded');
  });

  it('dead-letters lease-abandoned work when the attempt budget is exhausted', async () => {
    const outbox = createOutbox('worker-crashing', { leaseMs: 60_000 });
    const releases: Array<() => void> = [];
    outbox.register({
      type: 'test.crash-budget',
      execution: 'idempotent',
      maxAttempts: 2,
      execute() {
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    });
    outbox.register({
      type: 'test.after-crash-budget',
      execution: 'transactional',
      execute() {},
    });
    const [effect, successor] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'lane-crash-budget',
      effects: [
        { type: 'test.crash-budget', targetKey: 'target', payload: {} },
        { type: 'test.after-crash-budget', targetKey: 'successor', payload: {} },
      ],
    });

    const firstDrain = outbox.drain();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    db.prepare(`
      UPDATE platform_effect_outbox SET lease_expires_at='2026-07-25T07:59:59.000Z'
      WHERE id=?
    `).run(effect!.id);
    expect(outbox.recover()).toEqual({
      recovered: 1,
      abandonedAttempts: 1,
      deadLettered: 0,
    });

    const secondDrain = outbox.drain();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    db.prepare(`
      UPDATE platform_effect_outbox SET lease_expires_at='2026-07-25T07:59:59.000Z'
      WHERE id=?
    `).run(effect!.id);
    expect(outbox.recover()).toEqual({
      recovered: 0,
      abandonedAttempts: 1,
      deadLettered: 1,
    });
    expect(outbox.get(effect!.id)?.status).toBe('dead_letter');

    for (const release of releases) release();
    expect(await firstDrain).toMatchObject({ fenced: 1 });
    expect(await secondDrain).toMatchObject({ fenced: 1 });
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 });
    expect(outbox.get(successor!.id)?.status).toBe('succeeded');
  });

  it('dead-letters an exhausted predecessor and then releases its successor', async () => {
    const outbox = createOutbox();
    const calls: string[] = [];
    outbox.register({
      type: 'test.dead',
      execution: 'transactional',
      maxAttempts: 2,
      execute(effect) {
        calls.push(effect.targetKey);
        if (effect.targetKey === 'first') throw new Error('permanent');
      },
    });
    outbox.enqueueBatch({
      sourceEventId,
      laneKey: 'dead-lane',
      effects: [
        { type: 'test.dead', targetKey: 'first', payload: {} },
        { type: 'test.dead', targetKey: 'second', payload: {} },
      ],
    });

    expect(await outbox.drain()).toMatchObject({ failed: 1, deadLettered: 0 });
    expect(await outbox.drain()).toMatchObject({ failed: 1, deadLettered: 1 });
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 });
    expect(calls).toEqual(['first', 'first', 'second']);
  });
});
