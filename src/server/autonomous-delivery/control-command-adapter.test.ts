import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import { qualityGateRepo } from '../quality-gate/repository';
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

  it('requests and dispatches Delivery Gate Work through separate reviewer work identity', async () => {
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
    `).run(now.toISOString(), now.toISOString());
    const current = deliveries.getSnapshot(runId)!;
    db.prepare('UPDATE autonomous_delivery_run SET goal_contract_json=? WHERE id=?').run(
      JSON.stringify({
        ...current.contract,
        deliveryPolicy: { ...current.contract.deliveryPolicy, requireReview: true },
      }),
      runId,
    );
    taskRepo.transition('task-1', { to: 'in_progress' }, now);
    taskRepo.transition('task-1', { to: 'in_review' }, now);
    taskRepo.transition('task-1', { to: 'done' }, now);
    const first = decide();
    const requestReview = first.decision.actions.find((item) =>
      item.type === 'requestGate'
      && item.targetWorkId?.includes('request-delivery_review')
    )!;
    expect(await adapter.execute(requestReview, {
      decision: first.decision,
      snapshot: first.snapshot,
      claimToken: 'claim-review-request',
    })).toEqual({ status: 'applied' });

    const second = decide();
    const activateReview = second.decision.actions.find((item) =>
      item.type === 'activate' && item.targetWorkId?.endsWith(':purpose:review')
    )!;
    expect(await adapter.execute(activateReview, {
      decision: second.decision,
      snapshot: second.snapshot,
      claimToken: 'claim-review',
    })).toEqual({ status: 'applied' });
    const command = JSON.parse((db.prepare(`
      SELECT command_json FROM agent_inbox_item WHERE project_agent_id='reviewer'
    `).get() as { command_json: string }).command_json);
    expect(command).toMatchObject({
      source: 'review_gate',
      taskId: 'task-1',
      deliveryRunId: runId,
      contextScenario: 'code_review',
    });
    expect(command.prompt).toContain('Quality Gate:');
    expect(new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId).workCells)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          workId: 'task:task-1:agent:reviewer:purpose:review',
          state: 'running',
        }),
      ]));
  });

  it('turns integration into a frozen blocking Effect instead of provider I/O', async () => {
    const current = deliveries.getSnapshot(runId)!;
    db.prepare('UPDATE autonomous_delivery_run SET goal_contract_json=? WHERE id=?').run(
      JSON.stringify({
        ...current.contract,
        authorization: {
          ...current.contract.authorization,
          allowPush: true,
          allowPullRequest: true,
          allowAutoMerge: true,
        },
        deliveryPolicy: {
          ...current.contract.deliveryPolicy,
          requireMerge: true,
        },
      }),
      runId,
    );
    const action = {
      actionId: 'control-action-integrate',
      type: 'integrate' as const,
      reasonCode: 'provider_integration_required',
    };
    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    const decision = {
      decisionId: 'decision-integrate',
      runId,
      snapshotRevision: snapshot.snapshotRevision,
      policyRevision: 1,
      actions: [action],
    };

    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });

    expect(new DurableEffectOutbox({ db }).listApplicableBlocking(runId, current.run.revision))
      .toMatchObject([{
        type: 'delivery.github.integrate',
        criticality: 'blocking',
        deliveryRunId: runId,
        appliesFromRevision: current.run.revision,
        sourceActionId: action.actionId,
        status: 'queued',
      }]);
  });

  it('[scenario:delivery-close] freezes a verified bundle before completing Delivery', async () => {
    taskRepo.transition('task-1', { to: 'in_progress' }, now);
    taskRepo.transition('task-1', { to: 'in_review' }, now);
    taskRepo.transition('task-1', { to: 'done' }, now);
    const gate = qualityGateRepo.request({
      conversationId: 'project-1',
      kind: 'acceptance_verification',
      targetType: 'delivery_run',
      targetId: runId,
      artifactRevision: 'verified-revision',
      criteria: { acceptanceCriteria: ['Works'] },
      actor: { type: 'system', id: 'test' },
      now,
    });
    const evidence = qualityGateRepo.submitEvidence({
      gateId: gate.gate.id,
      evidenceType: 'test',
      payload: { passed: true },
      actor: { type: 'system', id: 'test' },
      idempotencyKey: 'verification-evidence',
      now,
    });
    const evaluating = qualityGateRepo.beginEvaluation({
      gateId: gate.gate.id,
      evaluator: { type: 'system', id: 'test' },
      expectedRevision: gate.gate.revision,
      now,
    });
    qualityGateRepo.decide({
      gateId: gate.gate.id,
      decision: 'passed',
      evaluator: { type: 'system', id: 'test' },
      evidenceIds: [evidence.id],
      expectedRevision: evaluating.gate.revision,
      now,
    });
    deliveries.recordReceipt({
      runId,
      receipt: {
        kind: 'verification.acceptance',
        status: 'passed',
        idempotencyKey: 'verification.acceptance:test',
        payload: {
          schemaVersion: 1,
          deliveryRunId: runId,
          status: 'passed',
          method: 'automated_test',
          verifierAgentId: 'test',
          tool: 'vitest',
          reportRef: 'test:report',
          specRefs: ['spec:works'],
          acceptanceResults: [{
            criterion: 'Works',
            status: 'passed',
            evidenceRefs: ['test:report'],
          }],
        },
      },
      now,
    });
    const first = decide();
    const finalize = first.decision.actions.find((item) => item.type === 'finalize')!;

    expect(await adapter.execute(finalize, {
      decision: first.decision,
      snapshot: first.snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });
    expect(deliveries.getRun(runId)).toMatchObject({
      status: 'active',
      current_stage: 'delivering',
    });
    expect(deliveries.getSnapshot(runId)?.bundle).toMatchObject({
      summary: '“Ship”已完成交付，共完成 1 个任务。',
      acceptanceResults: [{
        criterion: 'Works',
        status: 'passed',
        evidenceRefs: ['test:report'],
      }],
      verification: {
        verifierAgentId: 'test',
        tool: 'vitest',
      },
    });

    const second = decide();
    const terminate = second.decision.actions.find((item) => item.type === 'terminate')!;
    expect(await adapter.execute(terminate, {
      decision: second.decision,
      snapshot: second.snapshot,
      claimToken: 'claim-2',
    })).toEqual({ status: 'applied' });
    expect(deliveries.getRun(runId)?.status).toBe('completed');
  });
});
