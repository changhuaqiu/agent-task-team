import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { WorkContractRepository } from '../work-contract/repository';
import { taskCommandService } from './task-command-service';
import { taskGraphRepo } from './task-graph-repo';
import { taskRepo } from './task-repo';

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
    const oldContract = contracts.issue({
      workId: 'task:task-1:agent:agent-a:purpose:execute',
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
    expect(contracts.getAuthority(
      'task:task-1:agent:agent-a:purpose:execute',
    )).toMatchObject({
      status: 'closed',
      current_epoch: 1,
    });
    expect(contracts.admitOutcome({
      outcomeId: 'late-agent-a',
      idempotencyKey: 'late-agent-a',
      contractId: oldContract.contractId,
      outcomeType: 'submit_task_result',
      payload: { summary: 'late' },
      evidenceRefs: [],
      projectId: oldContract.projectId,
      workId: oldContract.workId,
      workEpoch: oldContract.workEpoch,
      attemptId: oldContract.attemptId,
      fencingToken: oldContract.fencingToken,
      authoritativeRevisions: oldContract.authoritativeRevisions,
      correlationId: oldContract.correlationId,
      causationId: oldContract.contractId,
      occurredAt: new Date().toISOString(),
    })).toMatchObject({
      status: 'rejected',
      outcome: { rejection_reason: 'work_authority_stale' },
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

  it('records runtime projection location without invalidating a frozen Task revision', () => {
    const created = taskCommandService.create({
      conversationId: 'project-1',
      expectedGraphRevision: 0,
      idempotencyKey: 'create-task-projection',
      actor: { type: 'system', id: 'planner' },
      task: {
        id: 'task-projection',
        title: 'Projection metadata',
        agent_id: 'agent-a',
      },
    }).tasks[0]!;

    expect(taskCommandService.recordProjectionLocation({
      conversationId: 'project-1',
      taskId: created.id,
      workDir: 'C:/worktrees/task-projection',
    })).toMatchObject({
      id: created.id,
      revision: created.revision,
      work_dir: 'C:/worktrees/task-projection',
    });
    expect(taskCommandService.recordProjectionLocation({
      conversationId: 'project-1',
      taskId: created.id,
      workDir: 'C:/worktrees/task-projection',
    }).revision).toBe(created.revision);
    expect(taskCommandService.expectedGraphRevision(
      'project-1',
      'unseen-command',
    )).toBe(1);
  });

  it('rejects direct done transitions without a current passed QualityGate event', () => {
    const created = taskCommandService.create({
      conversationId: 'project-1',
      expectedGraphRevision: 0,
      idempotencyKey: 'create-completion-guard',
      actor: { type: 'user', id: 'operator' },
      task: {
        id: 'task-completion-guard',
        title: 'Guard completion',
        agent_id: 'agent-a',
      },
    }).tasks[0]!;
    const started = taskCommandService.transition({
      conversationId: 'project-1',
      taskId: created.id,
      expectedTaskRevision: created.revision,
      expectedGraphRevision: 1,
      idempotencyKey: 'start-completion-guard',
      actor: { type: 'agent', id: 'agent-a' },
      to: 'in_progress',
    }).result.task;
    const review = taskCommandService.transition({
      conversationId: 'project-1',
      taskId: started.id,
      expectedTaskRevision: started.revision,
      expectedGraphRevision: 2,
      idempotencyKey: 'review-completion-guard',
      actor: { type: 'agent', id: 'agent-a' },
      to: 'in_review',
    }).result.task;

    expect(() => taskCommandService.transition({
      conversationId: 'project-1',
      taskId: review.id,
      expectedTaskRevision: review.revision,
      expectedGraphRevision: 3,
      idempotencyKey: 'forge-completion-guard',
      actor: { type: 'system', id: 'generic-adapter' },
      to: 'done',
    })).toThrow('task_completion_gate_required');
    expect(taskRepo.getById(review.id)).toMatchObject({
      status: 'in_review',
      revision: review.revision,
    });
    expect(taskGraphRepo.revision('project-1')).toBe(3);
  });

  it('replaces dependency edges and projection atomically while rejecting cycles', () => {
    const create = (id: string) => taskCommandService.create({
      conversationId: 'project-1',
      expectedGraphRevision: taskGraphRepo.revision('project-1'),
      idempotencyKey: `create-${id}`,
      actor: { type: 'user', id: 'operator' },
      task: { id, title: id, agent_id: 'agent-a' },
    }).tasks[0]!;
    const taskA = create('task-a');
    const taskB = create('task-b');

    const replaced = taskCommandService.replaceDependencies({
      conversationId: 'project-1',
      taskId: taskB.id,
      expectedTaskRevision: taskB.revision,
      expectedGraphRevision: 2,
      idempotencyKey: 'task-b-depends-a',
      actor: { type: 'user', id: 'operator' },
      dependencyTaskIds: [taskA.id],
    });
    expect(JSON.parse(replaced.result.task.dependencies ?? '[]')).toEqual(['task-a']);
    expect(replaced.result.edges).toMatchObject([{
      from_task_id: 'task-b',
      to_task_id: 'task-a',
      type: 'depends_on',
    }]);

    expect(() => taskCommandService.replaceDependencies({
      conversationId: 'project-1',
      taskId: taskA.id,
      expectedTaskRevision: taskA.revision,
      expectedGraphRevision: 3,
      idempotencyKey: 'task-a-depends-b-cycle',
      actor: { type: 'user', id: 'operator' },
      dependencyTaskIds: [taskB.id],
    })).toThrow('cycle');
    expect(taskGraphRepo.revision('project-1')).toBe(3);
    expect(taskGraphRepo.listEdges('project-1')).toHaveLength(1);

    expect(() => taskCommandService.replaceDependencies({
      conversationId: 'project-1',
      taskId: taskA.id,
      expectedTaskRevision: taskA.revision,
      expectedGraphRevision: 3,
      idempotencyKey: 'task-a-depends-missing',
      actor: { type: 'user', id: 'operator' },
      dependencyTaskIds: ['missing'],
    })).toThrow('missing task');
    expect(taskGraphRepo.revision('project-1')).toBe(3);
  });
});
