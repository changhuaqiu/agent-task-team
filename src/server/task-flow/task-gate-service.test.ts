import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskRepo } from '../repositories/task-repo';
import { qualityGateRepo } from '../quality-gate/repository';
import { TaskGateService } from './task-gate-service';

describe('TaskGateService', () => {
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

  it('turns missing evidence into an open Gate and complete evidence into its passed decision', () => {
    const service = new TaskGateService();
    const task = taskRepo.getById('task-gated')!;
    const blocked = service.evaluate({
      task,
      nextStatus: 'in_review',
      evidence: { buildResult: 'passed' },
      actor: { type: 'agent', id: 'implementer' },
    });

    expect(blocked).toMatchObject({
      allowed: false,
      required: true,
      gateName: 'implementation_evidence',
      gate: { gate: { status: 'requested', kind: 'implementation_readiness' } },
    });
    expect(blocked.gate?.evidence).toHaveLength(0);

    const accepted = service.evaluate({
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
      gate: {
        gate: {
          id: blocked.gate?.gate.id,
          status: 'passed',
          evaluator_type: 'system',
          evaluator_id: 'task-evidence-policy',
        },
        decision: { decision: 'passed' },
      },
    });
    expect(accepted.gate?.evidence).toHaveLength(1);
    expect(qualityGateRepo.listForTarget('task', task.id)).toHaveLength(1);
    expect(proofLogRepo.findByType({
      eventType: 'task_graph.gate_evidence.blocked',
      conversationId: task.conversation_id,
      taskId: task.id,
    })[0].metadata).toContain(blocked.gate!.gate.id);
    expect(proofLogRepo.findByType({
      eventType: 'task_graph.gate_evidence.accepted',
      conversationId: task.conversation_id,
      taskId: task.id,
    })[0].metadata).toContain(accepted.gate!.gate.id);
  });
});
