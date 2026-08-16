import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import {
  TaskEvidenceRecoveryCommand,
  TaskEvidenceRecoveryIdempotencyConflictError,
} from './task-evidence-recovery-command';
import { createGateEvidenceRecoveryWakeup } from './task-wakeup';

describe('TaskEvidenceRecoveryCommand', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-08-16T00:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('delivery-1','Delivery','active',?,?)
    `).run(now, now);
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'delivery-1',
      title: 'Build the feature',
      agent_id: 'agent-a',
    });
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function input() {
    const task = taskRepo.getById('task-1')!;
    return {
      conversationId: 'delivery-1',
      taskId: 'task-1',
      expectedTaskRevision: 0,
      idempotencyKey: 'recovery-command-1',
      request: { id: 'task-1', status: 'in_review', expectedTaskRevision: 0 },
      error: 'installResult is required',
      wakeup: createGateEvidenceRecoveryWakeup({
        task,
        agentId: 'agent-a',
        reasonCode: 'missing_implementation_evidence',
        gateName: 'implementation_evidence',
        missingFields: ['installResult'],
      }),
    };
  }

  it('CAS-admits the rejection receipt and durable recovery work atomically', () => {
    const command = new TaskEvidenceRecoveryCommand(db);
    const admission = command.admit(input());

    expect(admission.status).toBe('recorded');
    expect(db.prepare('SELECT COUNT(*) count FROM task_command_rejection_receipt').get())
      .toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT project_id,project_agent_id,status FROM agent_inbox_item
    `).get()).toEqual({
      project_id: 'delivery-1',
      project_agent_id: 'agent-a',
      status: 'enqueued',
    });
  });

  it('rejects a recovery admission if the Task revision changed before the transaction', () => {
    const command = new TaskEvidenceRecoveryCommand(db);
    taskRepo.transition('task-1', { to: 'in_progress' });

    expect(command.admit(input())).toEqual({ status: 'stale', actualRevision: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM task_command_rejection_receipt').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM agent_inbox_item').get())
      .toEqual({ count: 0 });
  });

  it('replays the frozen rejection after a service restart without duplicating work', () => {
    const firstService = new TaskEvidenceRecoveryCommand(db);
    const first = firstService.admit(input());
    taskRepo.transition('task-1', { to: 'in_progress' });

    const restartedService = new TaskEvidenceRecoveryCommand(db);
    const replay = restartedService.replay({
      idempotencyKey: input().idempotencyKey,
      request: input().request,
    });
    const admittedReplay = restartedService.admit(input());

    expect(first.status).toBe('recorded');
    expect(replay?.response).toEqual({ ok: false, error: 'installResult is required' });
    expect(admittedReplay.status).toBe('replayed');
    expect(db.prepare('SELECT COUNT(*) count FROM task_command_rejection_receipt').get())
      .toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM agent_inbox_item').get())
      .toEqual({ count: 1 });
  });

  it('retains and replays the rejection after its Task and Delivery are deleted', () => {
    const command = new TaskEvidenceRecoveryCommand(db);
    const original = input();
    expect(command.admit(original).status).toBe('recorded');

    db.prepare(`DELETE FROM task WHERE id='task-1'`).run();
    db.prepare(`DELETE FROM conversation WHERE id='delivery-1'`).run();

    expect(command.replay({
      idempotencyKey: original.idempotencyKey,
      request: original.request,
    })?.response).toEqual({ ok: false, error: 'installResult is required' });
    expect(db.prepare(`
      SELECT conversation_id,task_id FROM task_command_rejection_receipt
      WHERE idempotency_key='recovery-command-1'
    `).get()).toEqual({ conversation_id: 'delivery-1', task_id: 'task-1' });
  });

  it('rejects reuse of the idempotency key for different content', () => {
    const command = new TaskEvidenceRecoveryCommand(db);
    command.admit(input());

    expect(() => command.replay({
      idempotencyKey: input().idempotencyKey,
      request: { ...input().request, status: 'done' },
    })).toThrow(TaskEvidenceRecoveryIdempotencyConflictError);
  });
});
