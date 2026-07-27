import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { WorkContractRepository } from '../work-contract/repository';
import type { AgentOutcome } from '../work-contract/types';
import { taskGraphRepo } from './task-graph-repo';
import { TaskGraphOutcomeProcessManager } from './task-graph-outcome-process-manager';

const NOW = new Date('2026-07-28T13:00:00.000Z');

describe('TaskGraphOutcomeProcessManager', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-task-graph','Task Graph','active',?,?)
    `).run(NOW.toISOString(), NOW.toISOString());
  });

  afterEach(() => resetDb());

  it('atomically commits an accepted proposal and replays it idempotently', async () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'delivery:plan',
      attemptId: 'inv-plan',
      projectId: 'project-task-graph',
      agentId: 'planner',
      goal: 'Create the project Task Graph',
      acceptanceCriteria: ['Return an acyclic graph'],
      role: { id: 'planner' },
      permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'],
      authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-plan',
      allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-plan',
      causationId: 'delivery-start',
      now: NOW,
    });
    const outcome: AgentOutcome = {
      outcomeId: 'outcome-plan',
      idempotencyKey: 'outcome-plan',
      contractId: contract.contractId,
      outcomeType: 'propose_task_graph',
      payload: {
        expectedRevision: 0,
        tasks: [
          { id: 'task-build', title: 'Build', agentId: 'builder' },
          {
            id: 'task-review',
            title: 'Review',
            agentId: 'reviewer',
            dependencies: ['task-build'],
          },
        ],
      },
      evidenceRefs: [],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    };
    expect(contracts.admitOutcome(outcome)).toMatchObject({ status: 'accepted' });
    const event = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;
    const manager = new TaskGraphOutcomeProcessManager(getDb());

    await manager.handle(event, { signal: new AbortController().signal });
    await manager.handle(event, { signal: new AbortController().signal });

    expect(taskGraphRepo.revision('project-task-graph')).toBe(1);
    expect(taskGraphRepo.getGraph('project-task-graph')).toMatchObject({
      tasks: [{ id: 'task-build' }, { id: 'task-review' }],
      edges: [{
        from_task_id: 'task-review',
        to_task_id: 'task-build',
        type: 'depends_on',
      }],
      actions: [{ type: 'task.split' }],
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM task_graph_commit').get())
      .toEqual({ count: 1 });
  });
});
