import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server as IOServer } from 'socket.io';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import type { HarnessCoordinator } from '../harness/coordinator';
import { registerHarnessCoordinator } from '../harness/registry';
import type { HarnessTrigger } from '../harness/types';
import { conversationRepo } from '../repositories/conversation-repo';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { resetSeq } from '../repositories/sortable-id';
import { taskRepo } from '../repositories/task-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';
import { AutonomousDeliveryRepository } from './repository';
import {
  HarnessDeliveryActionAdapter,
  RepositoryDeliveryFactsAdapter,
} from './production-adapters';
import { AutonomousDeliverySupervisor } from './supervisor';
import type { GoalContract } from './types';

const contract: GoalContract = {
  goal: '交付登录流程',
  acceptanceCriteria: ['用户可通过 Web UI 登录'],
  scope: { conversationId: 'conv-production', projectPath: process.cwd() },
  authorization: {
    allowCodeChanges: true,
    allowPush: false,
    allowPullRequest: false,
    allowAutoMerge: false,
  },
  recoveryPolicy: {
    maxAttemptsPerAction: 3,
    maxRepairCycles: 2,
    stallTimeoutMs: 60_000,
  },
  deliveryPolicy: {
    requireReview: true,
    requireWebE2E: true,
    requireMerge: false,
  },
};

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  const pack = teamPackRepo.create({
    name: 'delivery-review-team',
    displayName: 'Delivery review team',
    description: 'Independent quality gate',
    roles: [
      {
        id: 'mario',
        displayName: 'Implementer',
        soul: '',
        required: true,
      },
      {
        id: 'peach',
        displayName: 'Quality',
        soul: '',
        required: true,
        roleCardId: 'preset-code-reviewer',
      },
    ],
    teamMode: 'hub_spoke',
    workflow: {
      type: 'state_machine',
      states: [{
        name: 'quality_gate',
        role: 'peach',
        description: 'Peach owns review gate',
        transitions: [],
      }],
    },
    communicationMatrix: {
      mario: { canSendTo: ['peach'], canReceiveFrom: ['peach'] },
      peach: { canSendTo: ['mario'], canReceiveFrom: ['mario'] },
    },
  });
  conversationRepo.create({
    id: contract.scope.conversationId,
    title: '登录',
    team_pack_id: pack.id,
  });
});

afterEach(() => resetDb());

describe('RepositoryDeliveryFactsAdapter', () => {
  it('把无活跃投递的可运行任务推导为下一动作，而不是误判为运行中', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-login',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: task.id,
    });

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.taskGraph).toBe('pending');
    expect(facts.runnableTask).toMatchObject({
      taskId: task.id,
      agentId: 'mario',
      reasonCode: 'owner_ready',
    });
  });

  it('子任务仍在推进时不让根任务历史 Envelope 耗尽整个 DeliveryRun', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const root = taskRepo.create({
      id: 'task-root-orchestration',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    const child = taskRepo.create({
      id: 'task-child-implementation',
      conversation_id: contract.scope.conversationId,
      title: '实现登录 UI',
      agent_id: 'peach',
    });
    taskRepo.updateStatus(root.id, 'in_progress');
    taskRepo.updateStatus(child.id, 'in_progress');
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: root.id,
    });

    for (const [index, status] of ['expired', 'completed', 'failed'].entries()) {
      const envelope = executionEnvelopeRepo.create({
        source: 'system',
        intent: 'implement',
        conversationId: contract.scope.conversationId,
        taskId: root.id,
        fromNodeId: 'daemon:local',
        toNodeId: 'agent:mario',
        toAgentId: 'mario',
        payload: { contextRefs: [`attempt:${index + 1}`] },
      });
      executionEnvelopeRepo.updateStatus(envelope.id, status as 'expired' | 'completed' | 'failed');
    }

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.blockerCode).toBeUndefined();
    expect(facts.taskGraph).not.toBe('blocked');
    expect(facts.runnableTask?.taskId).not.toBe(root.id);
  });

  it('根任务已 stale 时仍优先唤醒可执行子任务而不是从 autonomy guard 旁路恢复根任务', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const root = taskRepo.create({
      id: 'task-stale-root',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    const child = taskRepo.create({
      id: 'task-ready-child',
      conversation_id: contract.scope.conversationId,
      title: '实现登录 UI',
      agent_id: 'peach',
    });
    taskRepo.updateStatus(root.id, 'in_progress');
    getDb().prepare('UPDATE task SET updated_at=? WHERE id=?')
      .run('2026-01-01T00:00:00.000Z', root.id);
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: root.id,
    });

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.blockerCode).toBeUndefined();
    expect(facts.runnableTask).toMatchObject({
      taskId: child.id,
      agentId: 'peach',
      reasonCode: 'owner_ready',
    });
  });

  it('已存在的根 advance action 在子任务活跃时也不能从 action executor 旁路派发', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const root = taskRepo.create({
      id: 'task-root-existing-action',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.create({
      id: 'task-child-existing-action',
      conversation_id: contract.scope.conversationId,
      title: '实现登录 UI',
      agent_id: 'peach',
    });
    taskRepo.updateStatus(root.id, 'in_progress');
    getDb().prepare('UPDATE task SET updated_at=? WHERE id=?')
      .run('2026-01-01T00:00:00.000Z', root.id);
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: root.id,
    });
    repo.ensureAction({
      runId: run.run.id,
      kind: 'advance_tasks',
      subjectType: 'task',
      subjectId: root.id,
      idempotencyKey: `${run.run.id}:advance_tasks:stale-root`,
      maxAttempts: 1,
    });
    const claim = repo.claimNext({
      runId: run.run.id,
      workerId: 'root-bypass-test',
      leaseMs: 30_000,
    })!;
    let submitted: HarnessTrigger | undefined;
    const io = { to: () => ({ emit: () => undefined }) } as unknown as IOServer;
    registerHarnessCoordinator(io, {
      submit(trigger: HarnessTrigger) {
        submitted = trigger;
        return {
          disposition: 'accepted',
          handled: true,
          completion: Promise.resolve({ status: 'accepted' }),
        };
      },
    } as unknown as HarnessCoordinator);

    const result = await new HarnessDeliveryActionAdapter(io).execute(
      claim,
      repo.getSnapshot(run.run.id)!,
    );

    expect(result).toMatchObject({
      status: 'succeeded',
      receipts: [{
        kind: 'harness.dispatch.skipped',
        status: 'succeeded',
        externalId: root.id,
        payload: {
          reasonCode: 'root_superseded_by_active_children',
          activeChildTaskIds: ['task-child-existing-action'],
        },
      }],
    });
    expect(submitted).toBeUndefined();
  });

  it('Supervisor 将活跃子任务取代的旧 root action 成功 no-op，而不是耗尽后升级 Run', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const root = taskRepo.create({
      id: 'task-root-supervisor-noop',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    const child = taskRepo.create({
      id: 'task-child-supervisor-noop',
      conversation_id: contract.scope.conversationId,
      title: '实现登录 UI',
      agent_id: 'peach',
    });
    taskRepo.updateStatus(root.id, 'in_progress');
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: root.id,
    });
    const staleRootAction = repo.ensureAction({
      runId: run.run.id,
      kind: 'advance_tasks',
      subjectType: 'task',
      subjectId: root.id,
      idempotencyKey: `${run.run.id}:advance_tasks:pre-child-root`,
      maxAttempts: 1,
    });
    let submitted: HarnessTrigger | undefined;
    const io = { to: () => ({ emit: () => undefined }) } as unknown as IOServer;
    registerHarnessCoordinator(io, {
      submit(trigger: HarnessTrigger) {
        submitted = trigger;
        return {
          disposition: 'accepted',
          handled: true,
          completion: Promise.resolve({ status: 'accepted' }),
        };
      },
    } as unknown as HarnessCoordinator);
    const supervisor = new AutonomousDeliverySupervisor({
      repository: repo,
      facts: new RepositoryDeliveryFactsAdapter(),
      actions: new HarnessDeliveryActionAdapter(io),
      workerId: 'root-noop-supervisor',
      maxActionsPerAdvance: 1,
    });

    const result = await supervisor.advance(run.run.id, { kind: 'periodic_reconcile' });
    const snapshot = repo.getSnapshot(run.run.id)!;

    expect(result.disposition).toBe('acted');
    expect(snapshot.run.status).not.toBe('escalated');
    expect(snapshot.actions.find((action) => action.id === staleRootAction.id)?.status)
      .toBe('succeeded');
    expect(snapshot.actions).toContainEqual(expect.objectContaining({
      subject_id: child.id,
      kind: 'advance_tasks',
      status: 'ready',
    }));
    expect(snapshot.receipts).toContainEqual(expect.objectContaining({
      action_id: staleRootAction.id,
      kind: 'harness.dispatch.skipped',
      status: 'succeeded',
    }));
    expect(submitted).toBeUndefined();
  });

  it('根任务尚未拆出子任务时仍恢复失败的根执行', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const root = taskRepo.create({
      id: 'task-root-recoverable',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.updateStatus(root.id, 'in_progress');
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: root.id,
    });
    const envelope = executionEnvelopeRepo.create({
      source: 'system',
      intent: 'implement',
      conversationId: contract.scope.conversationId,
      taskId: root.id,
      fromNodeId: 'daemon:local',
      toNodeId: 'agent:mario',
      toAgentId: 'mario',
    });
    executionEnvelopeRepo.updateStatus(envelope.id, 'failed', 'acp_startup_failed');

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.blockerCode).toBeUndefined();
    expect(facts.runnableTask).toMatchObject({
      taskId: root.id,
      agentId: 'mario',
      reasonCode: 'runnable_owned_idle',
    });
  });

  it('子任务全部终态后以不可变收敛 Receipt 重置且不会反复刷新根任务恢复预算', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const root = taskRepo.create({
      id: 'task-root-after-children',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    const child = taskRepo.create({
      id: 'task-finished-child',
      conversation_id: contract.scope.conversationId,
      title: '完成登录 UI',
      agent_id: 'peach',
    });
    taskRepo.updateStatus(root.id, 'in_progress');
    taskRepo.updateStatus(child.id, 'in_progress');
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: root.id,
    });

    for (const status of ['expired', 'completed', 'failed'] as const) {
      const envelope = executionEnvelopeRepo.create({
        source: 'system',
        intent: 'implement',
        conversationId: contract.scope.conversationId,
        taskId: root.id,
        fromNodeId: 'daemon:local',
        toNodeId: 'agent:mario',
        toAgentId: 'mario',
      });
      executionEnvelopeRepo.updateStatus(envelope.id, status);
    }
    taskRepo.updateStatus(child.id, 'done');

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.blockerCode).toBeUndefined();
    expect(facts.runnableTask).toMatchObject({
      taskId: root.id,
      agentId: 'mario',
      reasonCode: 'runnable_owned_idle',
    });

    const convergence = repo.getSnapshot(run.run.id)!.receipts.find((receipt) =>
      receipt.kind === 'root.children.converged'
    );
    expect(convergence).toBeDefined();
    const epoch = new Date(convergence!.observed_at).getTime();

    for (const [index, status] of ['failed', 'expired', 'failed'].entries()) {
      const envelope = executionEnvelopeRepo.create({
        source: 'system',
        intent: 'implement',
        conversationId: contract.scope.conversationId,
        taskId: root.id,
        fromNodeId: 'daemon:local',
        toNodeId: 'agent:mario',
        toAgentId: 'mario',
      });
      executionEnvelopeRepo.updateStatus(envelope.id, status as 'failed' | 'expired');
      getDb().prepare('UPDATE execution_envelope SET updated_at=? WHERE id=?')
        .run(new Date(epoch + (index + 1) * 1_000).toISOString(), envelope.id);
    }

    taskRepo.updateStatus(child.id, 'done');
    getDb().prepare('UPDATE task SET updated_at=? WHERE id=?')
      .run(new Date(epoch + 10_000).toISOString(), child.id);
    const exhausted = await new RepositoryDeliveryFactsAdapter()
      .observe(repo.getSnapshot(run.run.id)!);
    const stableConvergence = repo.getSnapshot(run.run.id)!.receipts.find((receipt) =>
      receipt.idempotency_key === convergence!.idempotency_key
    );

    expect(stableConvergence?.observed_at).toBe(convergence!.observed_at);
    expect(exhausted.blockerCode).toBe('poisoned_session');
    expect(exhausted.blockerDetail).toContain(root.id);
  });

  it('只有任务全 done 且交付证据被 gate 接受时才通过 Web UI 验收', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-login',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.updateStatus(task.id, 'done');
    repo.updateRun({
      runId: run.run.id,
      status: 'verifying',
      stage: 'verifying',
      rootTaskId: task.id,
    });

    const before = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);
    expect(before.taskGraph).toBe('completed');
    expect(before.review).toBe('not_started');
    expect(before.verification).toBe('not_started');

    proofLogRepo.append({
      eventType: 'task_graph.gate_evidence.accepted',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      actorId: 'peach',
      metadata: {
        gateName: 'delivery_evidence',
        evidence: {
          mergedToMain: true,
          mainInstallResult: 'passed',
          mainBuildResult: 'passed',
          mainTestResult: 'passed',
          mainImpactReviewResult: 'passed',
        },
      },
    });
    const legacy = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);
    expect(legacy.verification).toBe('not_started');

    proofLogRepo.append({
      eventType: 'task_graph.gate_evidence.accepted',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      actorId: 'peach',
      metadata: {
        gateName: 'delivery_evidence',
        evidence: {
          reviewReceipt: {
            schemaVersion: 1,
            deliveryRunId: run.run.id,
            status: 'passed',
            reviewerAgentId: 'peach',
            summary: '代码质量、安全与回归风险检查通过',
            evidenceRefs: ['review:login-report'],
            findings: [],
          },
          verificationReceipt: {
            schemaVersion: 1,
            deliveryRunId: 'old-run',
            status: 'passed',
            method: 'automated_test',
            verifierAgentId: 'peach',
            tool: 'vitest',
            reportRef: 'unit-report.xml',
            specRefs: ['unit/login.test.ts'],
            acceptanceResults: [],
          },
        },
      },
    });
    const invalid = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);
    expect(invalid.verification).toBe('failed');

    proofLogRepo.append({
      eventType: 'task_graph.gate_evidence.accepted',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      actorId: 'peach',
      metadata: {
        gateName: 'delivery_evidence',
        evidence: {
          verificationReceipt: {
            schemaVersion: 1,
            deliveryRunId: run.run.id,
            status: 'passed',
            method: 'web_ui_e2e',
            verifierAgentId: 'peach',
            tool: 'playwright',
            reportRef: 'package.json',
            specRefs: ['src/server/autonomous-delivery/production-adapters.test.ts'],
            acceptanceResults: [{
              criterion: contract.acceptanceCriteria[0],
              status: 'passed',
              evidenceRefs: ['trace:login-web-ui'],
            }],
          },
        },
      },
    });
    const after = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);
    expect(after.review).toBe('passed');
    expect(after.verification).toBe('passed');
    expect(after.delivery).toBe('pending');
    expect(after.bundle).toMatchObject({
      summary: expect.any(String),
      verification: {
        method: 'web_ui_e2e',
        verifierAgentId: 'peach',
        tool: 'playwright',
      },
    });
    expect(repo.getSnapshot(run.run.id)?.receipts).toContainEqual(expect.objectContaining({
      kind: 'verification.acceptance',
      status: 'passed',
    }));
    expect(repo.getSnapshot(run.run.id)?.receipts).toContainEqual(expect.objectContaining({
      kind: 'review.acceptance',
      status: 'passed',
    }));
  });

  it('要求合并时必须等待 integration PASS 才生成可发布的 DeliveryBundle', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun({
      ...contract,
      deliveryPolicy: {
        ...contract.deliveryPolicy,
        requireMerge: true,
      },
    });
    const task = taskRepo.create({
      id: 'task-merge-gated',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.updateStatus(task.id, 'done');
    repo.updateRun({
      runId: run.run.id,
      status: 'integrating',
      stage: 'integrating',
      rootTaskId: task.id,
    });
    repo.recordReceipt({
      runId: run.run.id,
      receipt: {
        kind: 'review.acceptance',
        status: 'passed',
        payload: {
          schemaVersion: 1,
          deliveryRunId: run.run.id,
          status: 'passed',
          reviewerAgentId: 'peach',
          summary: '合并前评审通过',
          evidenceRefs: ['review:merge-gated'],
          findings: [],
        },
      },
    });
    repo.recordReceipt({
      runId: run.run.id,
      receipt: {
        kind: 'verification.acceptance',
        status: 'passed',
        payload: {
          schemaVersion: 1,
          deliveryRunId: run.run.id,
          status: 'passed',
          method: 'web_ui_e2e',
          verifierAgentId: 'peach',
          tool: 'playwright',
          reportRef: 'package.json',
          specRefs: ['src/server/autonomous-delivery/production-adapters.test.ts'],
          acceptanceResults: [{
            criterion: contract.acceptanceCriteria[0],
            status: 'passed',
            evidenceRefs: ['browser:merge-gated'],
          }],
        },
      },
    });

    const beforeMerge = await new RepositoryDeliveryFactsAdapter()
      .observe(repo.getSnapshot(run.run.id)!);
    expect(beforeMerge.integration).toBe('failed');
    expect(beforeMerge.bundle).toBeUndefined();

    const afterMerge = await new RepositoryDeliveryFactsAdapter({
      integrate: async () => [],
      observeIntegration: async () => ({
        state: 'passed',
        receipt: {
          kind: 'provider.github.pull_request.merged',
          status: 'succeeded',
          externalId: 'pr-merge-gated',
        },
      }),
    })
      .observe(repo.getSnapshot(run.run.id)!);
    expect(afterMerge.integration).toBe('passed');
    expect(afterMerge.bundle?.providerRefs).toContain(
      'provider.github.pull_request.merged:pr-merge-gated',
    );
  });

  it('任务已 done 时仍可向独立质量门负责人派发 Review', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-review',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.updateStatus(task.id, 'done');
    repo.updateRun({
      runId: run.run.id,
      status: 'reviewing',
      stage: 'reviewing',
      rootTaskId: task.id,
    });
    repo.ensureAction({
      runId: run.run.id,
      kind: 'request_review',
      subjectType: 'task',
      subjectId: task.id,
      idempotencyKey: `${run.run.id}:request_review:0`,
      maxAttempts: 2,
    });
    const claim = repo.claimNext({
      runId: run.run.id,
      workerId: 'review-test',
      leaseMs: 30_000,
    });
    expect(claim).toBeDefined();

    let submitted: HarnessTrigger | undefined;
    const io = { to: () => ({ emit: () => undefined }) } as unknown as IOServer;
    registerHarnessCoordinator(io, {
      submit(trigger: HarnessTrigger) {
        submitted = trigger;
        return {
          disposition: 'accepted',
          handled: true,
          completion: Promise.resolve({ status: 'accepted' }),
        };
      },
    } as unknown as HarnessCoordinator);

    const result = await new HarnessDeliveryActionAdapter(io).execute(
      claim!,
      repo.getSnapshot(run.run.id)!,
    );

    expect(result.status).toBe('succeeded');
    expect(submitted).toMatchObject({
      source: 'review_gate',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      agentId: 'peach',
      deliveryRunId: run.run.id,
      contextScenario: 'code_review',
    });
    expect(submitted?.prompt).toContain('独立质量评审');
    expect(submitted?.prompt).toContain(`deliveryRunId=${run.run.id}`);
  });

  it('任务已 done 时仍可向 QA Harness 派发独立 Web UI 验收', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-login',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.updateStatus(task.id, 'done');
    repo.updateRun({
      runId: run.run.id,
      status: 'verifying',
      stage: 'verifying',
      rootTaskId: task.id,
    });
    repo.ensureAction({
      runId: run.run.id,
      kind: 'run_verification',
      subjectType: 'task',
      subjectId: task.id,
      idempotencyKey: `${run.run.id}:run_verification:0`,
      maxAttempts: 2,
    });
    const claim = repo.claimNext({
      runId: run.run.id,
      workerId: 'verification-test',
      leaseMs: 30_000,
    });
    expect(claim).toBeDefined();

    let submitted: HarnessTrigger | undefined;
    const io = { to: () => ({ emit: () => undefined }) } as unknown as IOServer;
    registerHarnessCoordinator(io, {
      submit(trigger: HarnessTrigger) {
        submitted = trigger;
        return {
          disposition: 'accepted',
          handled: true,
          completion: Promise.resolve({ status: 'accepted' }),
        };
      },
    } as unknown as HarnessCoordinator);

    const result = await new HarnessDeliveryActionAdapter(io).execute(
      claim!,
      repo.getSnapshot(run.run.id)!,
    );

    expect(result.status).toBe('succeeded');
    expect(submitted).toMatchObject({
      source: 'test_gate',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      deliveryRunId: run.run.id,
      contextScenario: 'verification',
    });
    expect(submitted?.prompt).toContain('真实 Browser/Playwright Web UI 端到端测试');
    expect(submitted?.prompt).toContain(`deliveryRunId=${run.run.id}`);
  });

  it('发布动作只返回待事务提交的 Receipt，不在提交前广播临时事件', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    repo.ensureAction({
      runId: run.run.id,
      kind: 'publish_delivery',
      idempotencyKey: `${run.run.id}:publish`,
      maxAttempts: 2,
    });
    const claim = repo.claimNext({
      runId: run.run.id,
      workerId: 'publisher-test',
      leaseMs: 30_000,
    });
    expect(claim).toBeDefined();
    let emitCount = 0;
    const io = {
      to: () => ({
        emit: () => {
          emitCount += 1;
        },
      }),
    } as unknown as IOServer;

    const result = await new HarnessDeliveryActionAdapter(io).execute(
      claim!,
      repo.getSnapshot(run.run.id)!,
    );

    expect(result).toEqual({
      status: 'succeeded',
      receipts: [{
        kind: 'delivery.published',
        status: 'succeeded',
        idempotencyKey: `${run.run.id}:delivery.published`,
      }],
    });
    expect(emitCount).toBe(0);
    expect(repo.getSnapshot(run.run.id)?.receipts).toHaveLength(0);
  });
});
