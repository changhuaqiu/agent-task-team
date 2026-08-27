import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { CollaborationKernel } from '../collaboration-kernel';
import { DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import { qualityGateRepo } from '../quality-gate/repository';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskRepo } from '../repositories/task-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { messageRepo } from '../repositories/message-repo';
import { WorkContractRepository } from '../work-contract/repository';
import { buildWorkIdentity } from '../work-contract/work-identity';
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
      idempotencyKey: 'control-command-adapter-delivery',
      correlationId: 'delivery-root-trace',
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
      collaboration: new CollaborationKernel({ inbox }),
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

  function checkpointGateWork(input: {
    workId: string;
    agentId: string;
    taskId: string;
    suffix: string;
  }) {
    const task = taskRepo.getById(input.taskId)!;
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: input.workId,
      attemptId: `attempt-${input.suffix}`,
      projectId: 'project-1',
      deliveryRunId: runId,
      taskId: task.id,
      agentId: input.agentId,
      goal: 'Finish the Gate evaluation',
      acceptanceCriteria: ['Record the Gate decision with evidence'],
      role: { id: 'reviewer' },
      permissions: {},
      authoritativeRefs: [`task:${task.id}`, `delivery_run:${runId}`],
      authoritativeRevisions: {
        task: task.revision,
        deliveryRun: deliveries.getRun(runId)!.revision,
      },
      contextSnapshotRef: `context-${input.suffix}`,
      allowedOutcomeTypes: ['continue_work', 'record_gate_decision'],
      correlationId: 'delivery-root-trace',
      causationId: `start-${input.suffix}`,
      now,
    });
    invocationRepo.create({
      id: contract.attemptId,
      conversation_id: 'project-1',
      agent_id: input.agentId,
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    }, now);
    expect(contracts.admitOutcome({
      outcomeId: `outcome-${input.suffix}`,
      idempotencyKey: `outcome-${input.suffix}`,
      contractId: contract.contractId,
      outcomeType: 'continue_work',
      payload: {
        schemaVersion: 1,
        reason: 'verification_follow_up',
        summary: `Checkpoint summary ${input.suffix}`,
        nextAction: `Exact next action ${input.suffix}`,
        completedSteps: ['Checked the primary evidence.'],
        remainingSteps: ['Check the remaining evidence.'],
      },
      evidenceRefs: [`trace:${input.suffix}`],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now.toISOString(),
    })).toMatchObject({ status: 'accepted' });
    invocationRepo.transition(contract.attemptId, {
      to: 'terminated',
      outcome: 'completed',
      reason_code: 'agent_requested_continuation',
    }, now);
    return contract;
  }

  it('renders a human boundary without exposing internal ControlAction ids', () => {
    const action = {
      actionId: 'control-action:internal-id',
      type: 'escalateToHuman' as const,
      reasonCode: 'waiting_human',
    };
    const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
    expect(adapter.execute(action, {
      decision: {
        decisionId: 'decision-human-boundary',
        runId,
        snapshotRevision: snapshot.snapshotRevision,
        policyRevision: 7,
        actions: [action],
      },
      snapshot,
      claimToken: 'claim-human-boundary',
    })).toEqual({ status: 'applied' });

    const run = deliveries.getRun(runId)!;
    expect(run.status).toBe('waiting_human');
    expect(run.escalation_detail).toContain('请查看聊天中的具体问题');
    expect(run.escalation_detail).not.toContain('ControlAction');
    expect(run.escalation_detail).not.toContain(action.actionId);
  });

  it('dispatches completion without Outcome as a restricted outcome-only recovery', async () => {
    const workId = buildWorkIdentity({
      scope: 'task',
      targetId: 'task-1',
      agentId: 'agent-1',
      purpose: 'execute',
    });
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId,
      attemptId: 'attempt-completed-without-outcome',
      projectId: 'project-1',
      deliveryRunId: runId,
      taskId: 'task-1',
      agentId: 'agent-1',
      goal: 'Implement',
      acceptanceCriteria: ['Works'],
      role: { id: 'agent-1' },
      permissions: { executionMode: 'standard' },
      authoritativeRefs: ['task:task-1'],
      authoritativeRevisions: { task: taskRepo.getById('task-1')!.revision },
      contextSnapshotRef: 'context-standard',
      allowedOutcomeTypes: ['continue_work', 'submit_task_result', 'request_review'],
      correlationId: 'delivery-root-trace',
      causationId: 'initial-execution',
      now,
    });
    invocationRepo.create({
      id: contract.attemptId,
      conversation_id: 'project-1',
      agent_id: contract.agentId,
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    }, now);
    invocationRepo.transition(contract.attemptId, {
      to: 'terminated',
      outcome: 'completed',
    }, now);
    messageRepo.append({
      conversationId: 'project-1',
      taskId: 'task-1',
      senderType: 'agent',
      senderId: 'agent-1',
      content: '实现与测试已经完成，证据是 reports/voice-e2e.md。',
      invocationId: contract.attemptId,
      projectTeamLog: false,
    }, db);

    const { snapshot, decision } = decide();
    const action = decision.actions.find((candidate) => candidate.targetWorkId === workId)!;
    expect(action).toMatchObject({
      type: 'retry',
      reasonCode: 'invocation_completed_without_outcome',
      retryBudgetKind: 'outcome_recovery',
    });
    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-outcome-recovery',
    })).toEqual({ status: 'applied' });

    const command = JSON.parse((db.prepare(`
      SELECT command_json FROM agent_inbox_item WHERE idempotency_key=?
    `).get(action.actionId) as { command_json: string }).command_json);
    expect(command).toMatchObject({
      source: 'system',
      workId,
      executionMode: 'outcome_recovery',
      contextScenario: 'recovery',
    });
    expect(command.prompt).toContain('不要重新实现');
    expect(command.prompt).toContain('立即调用一次对应的结构化生命周期工具');
    expect(command.prompt).toContain('reports/voice-e2e.md');
  });

  it('accepts an exhausted internal protocol failure as authoritative termination evidence', () => {
    const workId = buildWorkIdentity({
      scope: 'task',
      targetId: 'task-1',
      agentId: 'agent-1',
      purpose: 'execute',
    });
    const contracts = new WorkContractRepository();
    let latestEpoch = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const task = taskRepo.getById('task-1')!;
      const contract = contracts.issue({
        workId,
        attemptId: `attempt-protocol-${attempt}`,
        projectId: 'project-1',
        deliveryRunId: runId,
        taskId: task.id,
        agentId: 'agent-1',
        goal: task.title,
        acceptanceCriteria: ['Works'],
        role: { id: 'agent-1' },
        permissions: {
          executionMode: attempt === 2 ? 'outcome_recovery' : 'standard',
          ...(attempt === 2 ? { tools: ['task_submit_result'] } : {}),
        },
        authoritativeRefs: [`task:${task.id}`, `delivery_run:${runId}`],
        authoritativeRevisions: {
          task: task.revision,
          deliveryRun: deliveries.getRun(runId)!.revision,
        },
        contextSnapshotRef: `context:protocol-${attempt}`,
        allowedOutcomeTypes: ['submit_task_result'],
        correlationId: 'delivery-root-trace',
        causationId: `protocol-start-${attempt}`,
        now,
      });
      latestEpoch = contract.workEpoch;
      invocationRepo.create({
        id: contract.attemptId,
        conversation_id: 'project-1',
        agent_id: 'agent-1',
        work_contract_id: contract.contractId,
        work_id: contract.workId,
        work_epoch: contract.workEpoch,
        fencing_token: contract.fencingToken,
      }, now);
      invocationRepo.transition(contract.attemptId, {
        to: 'terminated',
        outcome: 'completed',
      }, now);
    }

    const { snapshot, decision } = decide();
    const terminate = decision.actions.find((action) => action.type === 'terminate')!;
    expect(terminate).toMatchObject({
      targetWorkId: workId,
      workEpoch: latestEpoch,
      reasonCode: 'outcome_recovery_failed',
      terminationOutcome: 'failed',
    });

    const withoutTarget = { ...terminate };
    delete withoutTarget.targetWorkId;
    const withoutEpoch = { ...terminate };
    delete withoutEpoch.workEpoch;
    for (const forged of [
      withoutTarget,
      withoutEpoch,
      { ...terminate, targetWorkId: 'task:other:agent:agent-1:purpose:execute' },
      { ...terminate, workEpoch: latestEpoch - 1 },
      { ...terminate, reasonCode: 'different_internal_failure' },
    ]) {
      expect(adapter.execute(forged, {
        decision,
        snapshot,
        claimToken: 'claim-invalid-protocol-failure',
      })).toEqual({
        status: 'rejected',
        reasonCode: 'delivery_failure_not_authoritative',
      });
    }

    expect(adapter.execute(terminate, {
      decision,
      snapshot,
      claimToken: 'claim-protocol-failure',
    })).toEqual({ status: 'applied' });
    expect(deliveries.getRun(runId)).toMatchObject({
      status: 'failed',
      escalation_code: 'outcome_recovery_failed',
    });
  });

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
      correlationId: 'delivery-root-trace',
    });
  });

  it('dispatches a dedicated continuation with the admitted checkpoint and evidence', async () => {
    const task = taskRepo.getById('task-1')!;
    const workId = 'task:task-1:agent:agent-1:purpose:execute';
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId,
      attemptId: 'attempt-continuation-1',
      projectId: 'project-1',
      deliveryRunId: runId,
      taskId: task.id,
      agentId: 'agent-1',
      goal: task.title,
      acceptanceCriteria: ['Works'],
      role: { id: 'agent-1' },
      permissions: {},
      authoritativeRefs: [`task:${task.id}`, `delivery_run:${runId}`],
      authoritativeRevisions: {
        task: task.revision,
        deliveryRun: deliveries.getRun(runId)!.revision,
      },
      contextSnapshotRef: 'context:continuation-1',
      allowedOutcomeTypes: ['continue_work', 'submit_task_result'],
      correlationId: 'delivery-root-trace',
      causationId: 'continuation-start',
      now,
    });
    invocationRepo.create({
      id: contract.attemptId,
      conversation_id: 'project-1',
      agent_id: 'agent-1',
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    }, now);
    expect(contracts.admitOutcome({
      outcomeId: 'outcome-continuation-1',
      idempotencyKey: 'outcome-continuation-1',
      contractId: contract.contractId,
      outcomeType: 'continue_work',
      payload: {
        schemaVersion: 1,
        reason: 'multi_step',
        summary: 'Repository mapping is complete.',
        nextAction: 'Implement the scheduler change.',
        completedSteps: ['Mapped the current lifecycle.'],
        remainingSteps: ['Implement the scheduler.', 'Run focused tests.'],
      },
      evidenceRefs: ['trace:repository-map'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now.toISOString(),
    })).toMatchObject({ status: 'accepted' });
    invocationRepo.transition(contract.attemptId, {
      to: 'terminated',
      outcome: 'completed',
      reason_code: 'agent_requested_continuation',
    }, now);

    const { snapshot, decision } = decide();
    const action = decision.actions.find((item) => item.type === 'continue')!;
    expect(action).toMatchObject({ targetWorkId: workId });
    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-continuation',
    })).toEqual({ status: 'applied' });

    const command = JSON.parse((db.prepare(`
      SELECT command_json FROM agent_inbox_item WHERE idempotency_key=?
    `).get(action.actionId) as { command_json: string }).command_json);
    expect(command).toMatchObject({
      source: 'system',
      contextScenario: 'recovery',
      workId,
      taskId: 'task-1',
      deliveryRunId: runId,
    });
    expect(command.prompt).toContain('Repository mapping is complete.');
    expect(command.prompt).toContain('Implement the scheduler change.');
    expect(command.prompt).toContain('trace:repository-map');
  });

  it.each([
    { scope: 'task', purpose: 'review', gateKind: 'code_review', source: 'review_gate' },
    { scope: 'delivery', purpose: 'review', gateKind: 'delivery_review', source: 'review_gate' },
    { scope: 'delivery', purpose: 'verify', gateKind: 'acceptance_verification', source: 'test_gate' },
  ] as const)(
    'combines the checkpoint with $gateKind instructions for Gate continuation',
    async ({ scope, purpose, gateKind, source }) => {
      db.prepare(`
        INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
        VALUES ('reviewer','Reviewer','preset-code-reviewer','default','R',?,?)
      `).run(now.toISOString(), now.toISOString());
      taskRepo.transition('task-1', { to: 'in_progress' }, now);
      taskRepo.transition('task-1', { to: 'in_review' }, now);
      if (scope === 'delivery') taskRepo.transition('task-1', { to: 'done' }, now);
      const task = taskRepo.getById('task-1')!;
      const requested = qualityGateRepo.request({
        conversationId: 'project-1',
        kind: gateKind,
        targetType: scope === 'task' ? 'task' : 'delivery_run',
        targetId: scope === 'task' ? task.id : runId,
        artifactRevision: scope === 'task' ? String(task.revision) : 'delivery-revision-1',
        criteria: {},
        actor: { type: 'system', id: 'test' },
        now,
      });
      const suffix = `${scope}-${purpose}`;
      const workId = buildWorkIdentity({
        scope,
        targetId: scope === 'task' ? task.id : runId,
        agentId: 'reviewer',
        gateId: requested.gate.id,
        purpose,
      });
      checkpointGateWork({ workId, agentId: 'reviewer', taskId: task.id, suffix });

      const snapshot = new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId);
      const decision = decideControlActions(snapshot, {
        revision: 1,
        maxConcurrent: 1,
        roleCapacity: { reviewer: 1 },
        fairnessAgingMs: 1_000,
      });
      const action = decision.actions.find((item) =>
        item.type === 'continue' && item.targetWorkId === workId
      )!;
      expect(action).toBeDefined();
      expect(await adapter.execute(action, {
        decision,
        snapshot,
        claimToken: `claim-${suffix}`,
      })).toEqual({ status: 'applied' });

      const command = JSON.parse((db.prepare(`
        SELECT command_json FROM agent_inbox_item WHERE idempotency_key=?
      `).get(action.actionId) as { command_json: string }).command_json);
      expect(command).toMatchObject({
        source,
        contextScenario: 'recovery',
        workId,
        taskId: task.id,
        deliveryRunId: runId,
      });
      expect(command.prompt).toContain(`Checkpoint summary ${suffix}`);
      expect(command.prompt).toContain(`Exact next action ${suffix}`);
      expect(command.prompt).toContain(`trace:${suffix}`);
      expect(command.prompt).toContain(`Quality Gate: ${requested.gate.id}`);
      expect(command.prompt).toContain('record_gate_decision');
      if (scope === 'delivery') expect(command.prompt).toContain('payload.receipt is required');
    },
  );

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
    expect(db.prepare(`
      SELECT correlation_id FROM platform_event
      WHERE type='task.assigned' ORDER BY recorded_at DESC,id DESC LIMIT 1
    `).get()).toEqual({ correlation_id: 'delivery-root-trace' });

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
    const task = taskRepo.getById('task-1')!;
    taskGraphRepo.appendAction({
      conversationId: task.conversation_id,
      actorId: task.agent_id,
      actorType: 'agent',
      type: 'task.pull_request_submitted',
      taskIds: [task.id],
      payload: {
        artifactRevision: String(task.revision),
        receipt: { headSha: 'a'.repeat(40) },
      },
    });
    const { snapshot, decision } = decide();
    const action = decision.actions.find((item) => item.type === 'requestGate')!;

    expect(await adapter.execute(action, {
      decision,
      snapshot,
      claimToken: 'claim-1',
    })).toEqual({ status: 'applied' });
    const gate = db.prepare(`
      SELECT kind,target_type,target_id,status,criteria_json,policy_json FROM quality_gate
    `).get() as {
      kind: string;
      target_type: string;
      target_id: string;
      status: string;
      criteria_json: string;
      policy_json: string;
    };
    expect(gate).toMatchObject({
      kind: 'code_review',
      target_type: 'task',
      target_id: 'task-1',
      status: 'requested',
    });
    expect(JSON.parse(gate.criteria_json)).toEqual({
      maxBlockerCount: 0,
      providerHeadSha: 'a'.repeat(40),
      providerReviewRequired: true,
      qualityDecision: 'pass',
    });
    expect(JSON.parse(gate.policy_json)).toMatchObject({
      source: 'delivery_control_process_manager',
      prohibitSelfReview: true,
      implementerId: 'agent-1',
    });
    expect(db.prepare(`
      SELECT correlation_id FROM platform_event
      WHERE type='gate.requested' ORDER BY recorded_at DESC,id DESC LIMIT 1
    `).get()).toEqual({ correlation_id: 'delivery-root-trace' });
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

    taskRepo.update('task-1', { agent_id: '' });
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
    expect(command.prompt).toContain('top-level payload.receipt is required');
    expect(command.prompt).toContain('reviewerAgentId');
    expect(new RepositoryControlSnapshotBuilder({ db, now: () => now }).build(runId).workCells)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          workId: activateReview!.targetWorkId,
          state: 'queued',
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
    expect(new RepositoryControlSnapshotBuilder({ db, now: () => now })
      .build(runId).snapshotRevision).toBeGreaterThan(snapshot.snapshotRevision);
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
