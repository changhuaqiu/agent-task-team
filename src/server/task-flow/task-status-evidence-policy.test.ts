import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { qualityGateRepo } from '../quality-gate/repository';
import { TaskStatusEvidencePolicy } from './task-status-evidence-policy';

describe('TaskStatusEvidencePolicy', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = '2026-07-28T00:00:00.000Z';
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-task-gate', 'Task Gate', 'active', now, now);
    taskRepo.create({
      id: 'task-gated',
      conversation_id: 'project-task-gate',
      title: 'Gated task',
      agent_id: 'implementer',
    });
    taskRepo.transition('task-gated', { to: 'in_progress' });
  });

  afterEach(() => resetDb());

  it('validates evidence without creating a Gate or another persistent fact', () => {
    const policy = new TaskStatusEvidencePolicy();
    const task = taskRepo.getById('task-gated')!;
    const blocked = policy.evaluate({
      task,
      nextStatus: 'in_review',
      evidence: { buildResult: 'passed' },
      actor: { type: 'agent', id: 'implementer' },
    });

    expect(blocked).toMatchObject({
      allowed: false,
      required: true,
      gateName: 'implementation_evidence',
    });

    const accepted = policy.evaluate({
      task,
      nextStatus: 'in_review',
      evidence: {
        installResult: 'passed',
        buildResult: 'passed',
        testResult: 'passed',
        impactEvidence: 'reviewed',
      },
      actor: { type: 'agent', id: 'implementer' },
    });
    expect(accepted).toMatchObject({
      allowed: true,
    });
    expect(qualityGateRepo.listForTarget('task', task.id)).toEqual([]);
  });
});
