import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMessenger } from '../a2a';
import { captureDedupState } from '../a2a/dedup';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { PlatformEventDispatcher } from './dispatcher';
import { DurableEffectOutbox } from './durable-effect-outbox';
import { AgentInbox } from './agent-inbox';
import { PlatformEventLog } from './event-log';
import {
  RuntimeCompletionProcessManager,
  runtimeCompletionContextRepo,
} from './runtime-completion-process-manager';
import {
  registerRuntimeCompletionEffectAdapters,
  RUNTIME_COMPLETION_EFFECT_TYPES,
} from './runtime-completion-effects';
import { RuntimeEventPublisher } from './runtime-event-publisher';

describe('RuntimeCompletionProcessManager', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let outbox: DurableEffectOutbox;
  let nextId: number;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-07-25T05:00:00.000Z';
    nextId = 0;
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'project-1',
      agent_id: 'implementer',
      engine: 'codex',
    });
    runtimeCompletionContextRepo.create({
      invocationId: 'inv-1',
      conversationId: 'project-1',
      agentId: 'implementer',
      taskProjectDir: 'C:\\workspace\\project-1',
    });
    log = new PlatformEventLog({ db });
    outbox = new DurableEffectOutbox({
      db,
      workerId: 'effect-worker',
      retryDelayMs: () => 0,
      idFactory: (prefix) => `${prefix}-${++nextId}`,
    });
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function publishCompletedTrace(text = 'handoff @reviewer') {
    const publisher = new RuntimeEventPublisher(log, {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      invocationId: 'inv-1',
      runtimeActorId: 'daemon',
      correlationId: 'envelope-1',
    });
    publisher.publish('runtime.invocation.accepted', {});
    publisher.publish('runtime.invocation.started', { adapter: 'acp', engine: 'codex' });
    publisher.publish('runtime.message.segment.completed', {
      segmentId: 'segment-1',
      text,
    });
    return publisher.publish('runtime.invocation.terminated', {
      outcome: 'completed',
      durationMs: 10,
    });
  }

  it('recovers an appended terminal and atomically accepts its effect lane once', async () => {
    const terminal = publishCompletedTrace();
    const manager = new RuntimeCompletionProcessManager(outbox, db, log);
    const dispatcher = new PlatformEventDispatcher({ db, eventLog: log });
    dispatcher.register({
      id: 'runtime-completion-process-manager:v1',
      pattern: 'runtime.invocation.terminated',
      stereotype: 'process_manager',
      reliability: 'durable',
      handle: manager.handle,
    });

    expect(dispatcher.recover().enqueued).toBe(1);
    expect(await dispatcher.drain()).toMatchObject({ succeeded: 1, failed: 0 });
    expect(outbox.listBySourceEvent(terminal.eventId).map((effect) => effect.type)).toEqual([
      RUNTIME_COMPLETION_EFFECT_TYPES.taskSync,
      RUNTIME_COMPLETION_EFFECT_TYPES.teamLog,
      RUNTIME_COMPLETION_EFFECT_TYPES.a2aResponse,
      RUNTIME_COMPLETION_EFFECT_TYPES.a2aDone,
    ]);

    await manager.handle(terminal, { signal: new AbortController().signal });
    expect(outbox.listBySourceEvent(terminal.eventId)).toHaveLength(4);
    expect(db.prepare(`
      SELECT status,source_event_id FROM runtime_completion_context WHERE invocation_id='inv-1'
    `).get()).toEqual({ status: 'completed', source_event_id: terminal.eventId });
  });

  it('rolls back source binding and completion when effect admission fails', async () => {
    const terminal = publishCompletedTrace();
    const manager = new RuntimeCompletionProcessManager({
      enqueueBatch() {
        throw new Error('effect_outbox_unavailable');
      },
    }, db, log);

    await expect(manager.handle(terminal, { signal: new AbortController().signal }))
      .rejects.toThrow('effect_outbox_unavailable');
    expect(db.prepare(`
      SELECT status,source_event_id FROM runtime_completion_context WHERE invocation_id='inv-1'
    `).get()).toEqual({ status: 'pending', source_event_id: null });
  });

  it('completes held-out evaluation context without production effects', async () => {
    db.prepare(`
      UPDATE runtime_completion_context SET evaluation_execution_id='execution-1'
      WHERE invocation_id='inv-1'
    `).run();
    const terminal = publishCompletedTrace('held-out output');
    const manager = new RuntimeCompletionProcessManager(outbox, db, log);

    await manager.handle(terminal, { signal: new AbortController().signal });

    expect(outbox.listBySourceEvent(terminal.eventId)).toEqual([]);
    expect(db.prepare(`
      SELECT status FROM runtime_completion_context WHERE invocation_id='inv-1'
    `).get()).toEqual({ status: 'completed' });
  });

  it('suppresses v51 steps that were already committed before upgrade', async () => {
    const terminal = publishCompletedTrace('@reviewer 请审查这个实现');
    db.prepare(`
      INSERT INTO runtime_completion_legacy_effect_suppression (event_id,effect_type)
      VALUES (?, 'runtime.task_sync'), (?, 'runtime.a2a_response')
    `).run(terminal.eventId, terminal.eventId);
    const manager = new RuntimeCompletionProcessManager(outbox, db, log);

    await manager.handle(terminal, { signal: new AbortController().signal });

    expect(outbox.listBySourceEvent(terminal.eventId).map((effect) => effect.type)).toEqual([
      'runtime.team_log',
      'runtime.a2a_done',
    ]);
  });

  it('keeps one stable A2A chain and Inbox command when response execution retries', async () => {
    const terminal = publishCompletedTrace('@reviewer 请审查这个实现');
    const inbox = new AgentInbox({ db });
    const emit = vi.fn();
    const io = {
      emit,
      to: () => ({ emit }),
    } as unknown as IOServer;
    const messenger = new AgentMessenger(
      db,
      io,
      [
        { id: 'implementer', mentionPatterns: ['@implementer'] },
        { id: 'reviewer', mentionPatterns: ['@reviewer'] },
      ],
      { getTasks: () => [] },
      (input) => {
        inbox.enqueue({
          projectId: input.conversationId,
          projectAgentId: input.agentId,
          idempotencyKey: `a2a:${input.chainId}:${input.entryId}:${input.agentId}`,
          command: {
            source: 'a2a',
            prompt: input.prompt,
            taskId: input.referencedTaskId,
            fromAgentId: input.fromAgentId,
            chainId: input.chainId,
            passId: input.passId,
          },
        });
        return { handled: true, admitted: true };
      },
      true,
    );
    let failAfterResponse = true;
    let failAfterDone = true;
    const dedupBeforeFailure = captureDedupState();
    registerRuntimeCompletionEffectAdapters(outbox, {
      syncTasks() {},
      recordInvalidExit() {},
      queueClosureEvaluation: () => ({ queued: false }),
      notifyEvaluationQueued() {},
      updateTeamLog() {},
      recordA2AResponse(payload) {
        const application = messenger.orchestrator.applyRuntimeResponse(
          payload.agentId,
          payload.output,
          payload.conversationId,
          payload.taskId,
        );
        if (failAfterResponse) {
          failAfterResponse = false;
          throw new Error('after response');
        }
        return application;
      },
      recordA2ADone(payload) {
        const application = messenger.orchestrator.applyRuntimeDone(
          payload.agentId,
          payload.conversationId,
        );
        if (failAfterDone) {
          failAfterDone = false;
          throw new Error('after done');
        }
        return application;
      },
    });
    const manager = new RuntimeCompletionProcessManager(outbox, db, log);
    await manager.handle(terminal, { signal: new AbortController().signal });

    expect(await outbox.drain()).toMatchObject({ succeeded: 1 }); // task sync
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 }); // team log
    expect(await outbox.drain()).toMatchObject({ failed: 1 }); // response acknowledgement lost
    expect(db.prepare(`SELECT COUNT(*) count FROM invocation_chain`).get())
      .toEqual({ count: 0 });
    expect(inbox.listPending('project-1')).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
    expect(captureDedupState()).toEqual(dedupBeforeFailure);
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 }); // response retry
    expect(await outbox.drain()).toMatchObject({ failed: 1 }); // done acknowledgement lost
    expect(await outbox.drain()).toMatchObject({ succeeded: 1 }); // done retry

    expect(db.prepare(`SELECT COUNT(*) count FROM invocation_chain`).get()).toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT COUNT(*) count FROM chain_worklist WHERE agent_id='reviewer'
    `).get()).toEqual({ count: 1 });
    expect(inbox.listPending('project-1')).toHaveLength(1);
    expect(inbox.listPending('project-1')[0]).toMatchObject({
      projectAgentId: 'reviewer',
      command: { source: 'a2a', chainId: expect.any(String) },
    });
    expect(outbox.listBySourceEvent(terminal.eventId).every(
      (effect) => effect.status === 'succeeded',
    )).toBe(true);
  });
});
