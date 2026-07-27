import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { taskRepo } from '../repositories/task-repo';
import { ProductionControlCommandAdapter } from './control-command-adapter';
import { decideControlActions } from './control-decision';
import { RepositoryControlSnapshotBuilder } from './control-snapshot-builder';
import { AutonomousDeliveryRepository } from './repository';

describe('ProductionControlCommandAdapter', () => {
  let db: Database.Database;
  let runId: string;
  let deliveries: AutonomousDeliveryRepository;
  let inbox: AgentInbox;
  let adapter: ProductionControlCommandAdapter;
  const now = new Date('2026-07-28T00:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    deliveries = new AutonomousDeliveryRepository();
    runId = deliveries.createRun({
      goal: 'Ship',
      acceptanceCriteria: ['Works'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 2,
        maxRepairCycles: 1,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: false,
        requireWebE2E: false,
        requireMerge: false,
      },
    }, now).run.id;
    inbox = new AgentInbox({
      db,
      now: () => now,
      idFactory: (prefix) => `${prefix}-1`,
    });
    adapter = new ProductionControlCommandAdapter({
      db,
      inbox,
      deliveries,
      now: () => now,
    });
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'project-1',
      title: 'Implement',
      agent_id: 'agent-1',
    }, now);
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function decide() {
    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    const decision = decideControlActions(snapshot, {
      revision: 1,
      maxConcurrent: 1,
      roleCapacity: { 'agent-1': 1 },
      fairnessAgingMs: 1_000,
    });
    return { snapshot, decision };
  }

  it('turns activate into durable AgentInbox work without starting Runtime directly', async () => {
    const { snapshot, decision } = decide();
    const action = decision.actions[0]!;

    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });

    expect(db.prepare(`
      SELECT project_agent_id,status,command_json FROM agent_inbox_item
    `).get()).toMatchObject({
      project_agent_id: 'agent-1',
      status: 'enqueued',
    });
    expect(JSON.parse((db.prepare(`
      SELECT command_json FROM agent_inbox_item
    `).get() as { command_json: string }).command_json)).toMatchObject({
      source: 'system',
      taskId: 'task-1',
      deliveryRunId: runId,
    });
  });

  it('initializes the root Task through the Task owner before any Agent activation', async () => {
    db.prepare('DELETE FROM task WHERE id=?').run('task-1');
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('planner','Planner','preset-planner','default','P',?,?)
    `).run(now.toISOString(), now.toISOString());
    const { snapshot, decision } = decide();
    const action = decision.actions.find((item) => item.type === 'initializeGraph')!;

    expect(action.slotId).toBeUndefined();
    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });

    const tasks = taskRepo.getByConversation('project-1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Ship',
      agent_id: 'planner',
      status: 'ready',
    });
    expect(deliveries.getRun(runId)?.root_task_id).toBe(tasks[0]?.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM agent_inbox_item').get())
      .toEqual({ count: 0 });

    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });
    expect(taskRepo.getByConversation('project-1')).toHaveLength(1);
  });

  it('requests the authoritative QualityGate for submitted task work', async () => {
    taskRepo.transition('task-1', { to: 'in_progress' }, now);
    taskRepo.transition('task-1', { to: 'in_review' }, now);
    const { snapshot, decision } = decide();
    const action = decision.actions.find((item) => item.type === 'requestGate')!;

    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });
    expect(db.prepare(`
      SELECT kind,target_type,target_id,status FROM quality_gate
    `).get()).toEqual({
      kind: 'code_review',
      target_type: 'task',
      target_id: 'task-1',
      status: 'requested',
    });
  });

  it('rechecks closure in the same transaction before completing Delivery', async () => {
    taskRepo.transition('task-1', { to: 'in_progress' }, now);
    taskRepo.transition('task-1', { to: 'in_review' }, now);
    taskRepo.transition('task-1', { to: 'done' }, now);
    const delivery = deliveries.getSnapshot(runId)!;
    deliveries.transitionRun({
      runId,
      to: 'active',
      stage: delivery.run.current_stage,
      expectedRevision: delivery.run.revision,
      bundle: {
        summary: 'Delivered',
        acceptanceResults: [{ criterion: 'Works', status: 'passed', evidenceRefs: ['test:1'] }],
        changeRefs: ['commit:1'],
        verificationRefs: ['test:1'],
        providerRefs: [],
        knownLimitations: [],
        completedAt: now.toISOString(),
      },
      now,
    });
    const { snapshot, decision } = decide();
    const action = decision.actions.find((item) => item.type === 'terminate')!;

    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });
    expect(deliveries.getRun(runId)?.status).toBe('completed');
  });
});
