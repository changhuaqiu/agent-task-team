import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { PlatformEventDispatcher } from './dispatcher';
import { DurableEffectOutbox } from './durable-effect-outbox';
import { PlatformEventLog } from './event-log';
import {
  RuntimeCompletionProcessManager,
  runtimeCompletionContextRepo,
} from './runtime-completion-process-manager';
import { RUNTIME_COMPLETION_EFFECT_TYPES } from './runtime-completion-effects';
import { RuntimeEventPublisher } from './runtime-event-publisher';
import { WorkContractRepository } from '../work-contract/repository';

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

  function publishCompletedTrace(text = 'handoff @reviewer', invocationId = 'inv-1') {
    const publisher = new RuntimeEventPublisher(log, {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      invocationId,
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
    ]);

    await manager.handle(terminal, { signal: new AbortController().signal });
    expect(outbox.listBySourceEvent(terminal.eventId)).toHaveLength(2);
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
    ]);
  });

  it('never interprets final text as A2A commands for a WorkContract invocation', async () => {
    const contract = new WorkContractRepository().issue({
      workId: 'task:structured',
      attemptId: 'inv-structured',
      projectId: 'project-1',
      agentId: 'implementer',
      goal: 'Implement',
      acceptanceCriteria: ['submit a structured outcome'],
      role: {},
      permissions: {},
      authoritativeRefs: ['project:project-1'],
      authoritativeRevisions: { project: 1 },
      contextSnapshotRef: 'ctx-structured',
      allowedOutcomeTypes: ['handoff_to_agent', 'submit_task_result'],
      correlationId: 'envelope-1',
      causationId: 'trigger-1',
    });
    invocationRepo.create({
      id: 'inv-structured',
      conversation_id: 'project-1',
      agent_id: 'implementer',
      engine: 'codex',
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    });
    runtimeCompletionContextRepo.create({
      invocationId: 'inv-structured',
      conversationId: 'project-1',
      agentId: 'implementer',
      taskProjectDir: 'C:\\workspace\\project-1',
    });
    const terminal = publishCompletedTrace(
      'This prose mentions @reviewer but is not a command.',
      'inv-structured',
    );
    const manager = new RuntimeCompletionProcessManager(outbox, db, log);

    await manager.handle(terminal, { signal: new AbortController().signal });

    expect(outbox.listBySourceEvent(terminal.eventId).map((effect) => effect.type)).toEqual([
      RUNTIME_COMPLETION_EFFECT_TYPES.taskSync,
      RUNTIME_COMPLETION_EFFECT_TYPES.teamLog,
    ]);
    expect(db.prepare('SELECT COUNT(*) count FROM invocation_chain').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM chain_worklist').get())
      .toEqual({ count: 0 });
  });

});
