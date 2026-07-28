import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { WorkContractRepository } from '../work-contract/repository';
import { taskCommandService } from './task-command-service';

describe('taskCommandService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-07-28T08:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('advances the graph once and fences the old WorkAuthority when ownership changes', () => {
    const created = taskCommandService.create({
      conversationId: 'project-1',
      expectedGraphRevision: 0,
      idempotencyKey: 'create-task-1',
      actor: { type: 'user', id: 'operator' },
      correlationId: 'goal-trace-1',
      task: {
        id: 'task-1',
        title: 'Implement',
        agent_id: 'agent-a',
      },
    }).tasks[0]!;
    const contracts = new WorkContractRepository();
    contracts.issue({
      workId: 'task:task-1',
      attemptId: 'attempt-1',
      projectId: 'project-1',
      taskId: 'task-1',
      agentId: 'agent-a',
      goal: 'Implement',
      acceptanceCriteria: ['Works'],
      role: { id: 'implementer' },
      permissions: {},
      authoritativeRefs: ['task:task-1'],
      authoritativeRevisions: { task: created.revision },
      contextSnapshotRef: 'context-1',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'goal-trace-1',
      causationId: 'task-created',
    });

    const result = taskCommandService.update({
      conversationId: 'project-1',
      taskId: 'task-1',
      expectedTaskRevision: created.revision,
      expectedGraphRevision: 1,
      idempotencyKey: 'assign-task-1-agent-b',
      actor: { type: 'user', id: 'operator' },
      correlationId: 'goal-trace-1',
      causationId: 'human-assignment',
      updates: { agent_id: 'agent-b' },
    });

    expect(result).toMatchObject({
      revision: 2,
      result: { task: { agent_id: 'agent-b', revision: 1 } },
    });
    expect(contracts.getAuthority('task:task-1')).toMatchObject({
      status: 'closed',
      current_epoch: 1,
    });
    expect(taskCommandService.update({
      conversationId: 'project-1',
      taskId: 'task-1',
      expectedTaskRevision: created.revision,
      expectedGraphRevision: 1,
      idempotencyKey: 'assign-task-1-agent-b',
      actor: { type: 'user', id: 'operator' },
      correlationId: 'goal-trace-1',
      causationId: 'human-assignment',
      updates: { agent_id: 'agent-b' },
    })).toEqual({ ...result, replayed: true });
  });
});
