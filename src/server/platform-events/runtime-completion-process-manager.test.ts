import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMessenger } from '../a2a';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { PlatformEventDispatcher } from './dispatcher';
import { AgentInbox } from './agent-inbox';
import { PlatformEventLog } from './event-log';
import {
  RuntimeCompletionProcessManager,
  runRuntimeCompletionStep,
  runtimeCompletionContextRepo,
} from './runtime-completion-process-manager';
import { RuntimeEventPublisher } from './runtime-event-publisher';

describe('RuntimeCompletionProcessManager', () => {
  let db: Database.Database;
  let log: PlatformEventLog;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-07-25T05:00:00.000Z';
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

  it('recovers an appended terminal and executes its completion once', async () => {
    const terminal = publishCompletedTrace();
    const complete = vi.fn();
    const manager = new RuntimeCompletionProcessManager({ complete }, db, log);
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
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ invocation_id: 'inv-1', source_event_id: terminal.eventId }),
      'handoff @reviewer',
      expect.objectContaining({ eventId: terminal.eventId }),
      expect.any(AbortSignal),
    );

    await manager.handle(terminal, { signal: new AbortController().signal });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(db.prepare(`
      SELECT status,source_event_id FROM runtime_completion_context WHERE invocation_id='inv-1'
    `).get()).toEqual({ status: 'completed', source_event_id: terminal.eventId });
  });

  it('leaves completion pending when the port fails so Dispatcher can retry', async () => {
    const terminal = publishCompletedTrace();
    const complete = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const manager = new RuntimeCompletionProcessManager({ complete }, db, log);

    await expect(manager.handle(terminal, { signal: new AbortController().signal }))
      .rejects.toThrow('temporary');
    expect(db.prepare(`
      SELECT status,source_event_id FROM runtime_completion_context WHERE invocation_id='inv-1'
    `).get()).toEqual({ status: 'pending', source_event_id: terminal.eventId });

    await manager.handle(terminal, { signal: new AbortController().signal });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(db.prepare(`
      SELECT status FROM runtime_completion_context WHERE invocation_id='inv-1'
    `).get()).toEqual({ status: 'completed' });
  });

  it('does not repeat an earlier persisted step when a later step fails', () => {
    const terminal = publishCompletedTrace();
    const firstStep = () => runRuntimeCompletionStep(terminal.eventId, 'proof', () => {
      proofLogRepo.append({
        eventType: 'runtime.completion.test-proof',
        conversationId: 'project-1',
        agentId: 'implementer',
      });
    }, db);
    const laterStep = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('later step failed');
      })
      .mockImplementation(() => {});

    expect(firstStep()).toBe(true);
    expect(() => runRuntimeCompletionStep(
      terminal.eventId,
      'a2a-done',
      laterStep,
      db,
    )).toThrow('later step failed');

    expect(firstStep()).toBe(false);
    expect(runRuntimeCompletionStep(terminal.eventId, 'a2a-done', laterStep, db)).toBe(true);
    expect(proofLogRepo.findByType({
      eventType: 'runtime.completion.test-proof',
      conversationId: 'project-1',
    })).toHaveLength(1);
    expect(db.prepare(`
      SELECT step FROM runtime_completion_step_receipt WHERE event_id=? ORDER BY step
    `).all(terminal.eventId)).toEqual([
      { step: 'a2a-done' },
      { step: 'proof' },
    ]);
  });

  it('keeps one stable chain and Inbox command when a later completion step retries', async () => {
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
        return {
          handled: true,
          admitted: true,
        };
      },
    );
    let failAfterResponse = true;
    const manager = new RuntimeCompletionProcessManager({
      complete(context, output, event) {
        runRuntimeCompletionStep(event.eventId, 'a2a-response', () => {
          messenger.orchestrator.onAgentResponse(
            context.agent_id,
            output,
            context.conversation_id,
            context.task_id ?? undefined,
          );
        }, db);
        if (failAfterResponse) {
          failAfterResponse = false;
          throw new Error('after response');
        }
        runRuntimeCompletionStep(event.eventId, 'a2a-done', () => {
          messenger.orchestrator.onAgentDone(context.agent_id, context.conversation_id);
        }, db);
      },
    }, db, log);

    await expect(manager.handle(terminal, { signal: new AbortController().signal }))
      .rejects.toThrow('after response');
    await manager.handle(terminal, { signal: new AbortController().signal });

    expect(db.prepare(`SELECT COUNT(*) count FROM invocation_chain`).get()).toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT COUNT(*) count FROM chain_worklist WHERE agent_id='reviewer'
    `).get()).toEqual({ count: 1 });
    expect(inbox.listQueued('project-1')).toHaveLength(1);
    expect(inbox.listQueued('project-1')[0]).toMatchObject({
      projectAgentId: 'reviewer',
      command: { source: 'a2a', chainId: expect.any(String) },
    });
  });
});
