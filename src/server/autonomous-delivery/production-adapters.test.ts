import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server as IOServer } from 'socket.io';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import type { HarnessCoordinator } from '../harness/coordinator';
import { registerHarnessCoordinator } from '../harness/registry';
import type { HarnessTrigger } from '../harness/types';
import { conversationRepo } from '../repositories/conversation-repo';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { resetSeq } from '../repositories/sortable-id';
import { taskRepo } from '../repositories/task-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';
import { AutonomousDeliveryRepository } from './repository';
import {
  HarnessDeliveryActionAdapter,
  RepositoryDeliveryFactsAdapter,
} from './production-adapters';
import type { GoalContract } from './types';
import { EngineeringCollaborationService } from '../engineering-collaboration/service';
import type { GitProviderVerifier } from '../engineering-collaboration/git-provider';

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

  it('recovers a failed implementer even when a parallel reviewer completes later', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-parallel-recovery',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'peach',
    });
    taskRepo.updateStatus(task.id, 'in_progress');
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: task.id,
    });

    invocationRepo.create({
      id: 'inv-luigi-empty',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'luigi',
      engine: 'opencode',
      account_id: 'account-opencode',
    });
    invocationRepo.updateStatus('inv-luigi-empty', 'failed', {
      reason_code: 'acp_empty_completion',
      error_message: 'ACP ended without a final assistant message',
    });
    invocationRepo.create({
      id: 'inv-peach-review',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'peach',
      engine: 'claude',
      account_id: 'account-claude',
    });
    invocationRepo.updateStatus('inv-peach-review', 'succeeded');

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.taskGraph).toBe('pending');
    expect(facts.runnableTask).toMatchObject({
      taskId: task.id,
      agentId: 'luigi',
      reasonCode: 'runnable_owned_idle',
    });
    expect(facts.runnableTask?.idempotencyKey).toContain('inv-luigi-empty');

    const rejectedRecovery = executionEnvelopeRepo.create({
      source: 'system',
      intent: 'delegate',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      fromNodeId: 'delivery-supervisor',
      toNodeId: 'daemon:local',
      toAgentId: 'luigi',
    });
    executionEnvelopeRepo.updateStatus(
      rejectedRecovery.id,
      'failed',
      'runtime_admission_rejected',
    );

    const afterRejectedAdmission = await new RepositoryDeliveryFactsAdapter()
      .observe(repo.getSnapshot(run.run.id)!);
    expect(afterRejectedAdmission.runnableTask).toMatchObject({
      taskId: task.id,
      agentId: 'luigi',
      reasonCode: 'runnable_owned_idle',
    });
    expect(afterRejectedAdmission.runnableTask?.idempotencyKey).toContain(rejectedRecovery.id);
    expect(afterRejectedAdmission.runnableTask?.idempotencyKey)
      .not.toBe(facts.runnableTask?.idempotencyKey);

    executionEnvelopeRepo.create({
      source: 'system',
      intent: 'delegate',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      fromNodeId: 'delivery-supervisor',
      toNodeId: 'daemon:local',
      toAgentId: 'luigi',
    });
    const whileNextAdmissionIsActive = await new RepositoryDeliveryFactsAdapter()
      .observe(repo.getSnapshot(run.run.id)!);
    expect(whileNextAdmissionIsActive.runnableTask).toBeUndefined();
  });

  it('recovers the latest completed reviewer when its task receipt did not advance', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-review-receipt-recovery',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.updateStatus(task.id, 'in_review');
    getDb().prepare('UPDATE task SET updated_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', task.id);
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'reviewing',
      rootTaskId: task.id,
    });

    invocationRepo.create({
      id: 'inv-implementer-completed',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'luigi',
      engine: 'codex',
      account_id: 'account-codex',
    });
    invocationRepo.updateStatus('inv-implementer-completed', 'succeeded');
    invocationRepo.create({
      id: 'inv-reviewer-completed',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'peach',
      engine: 'claude',
      account_id: 'account-claude',
    });
    invocationRepo.updateStatus('inv-reviewer-completed', 'succeeded');

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.runnableTask).toMatchObject({
      taskId: task.id,
      agentId: 'peach',
      reasonCode: 'runnable_owned_idle',
    });
    expect(facts.runnableTask?.idempotencyKey).toContain('inv-reviewer-completed');
  });

  it('does not recover a completed invocation while its newer admission is active', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-active-completion-recovery',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    taskRepo.updateStatus(task.id, 'in_review');
    getDb().prepare('UPDATE task SET updated_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', task.id);
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'reviewing',
      rootTaskId: task.id,
    });
    invocationRepo.create({
      id: 'inv-reviewer-before-active-admission',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'peach',
      engine: 'claude',
      account_id: 'account-claude',
    });
    invocationRepo.updateStatus('inv-reviewer-before-active-admission', 'succeeded');
    const admission = executionEnvelopeRepo.create({
      source: 'system',
      intent: 'delegate',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      fromNodeId: 'delivery-supervisor',
      toNodeId: 'daemon:local',
      toAgentId: 'peach',
    });
    executionEnvelopeRepo.updateStatus(admission.id, 'acknowledged');
    getDb().prepare('UPDATE execution_envelope SET created_at = ?, updated_at = ? WHERE id = ?')
      .run('2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', admission.id);

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.runnableTask).toBeUndefined();
  });

  it('does not recover an implementer that submitted accepted gate evidence during its invocation', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const task = taskRepo.create({
      id: 'task-progress-during-invocation',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'mario',
    });
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'reviewing',
      rootTaskId: task.id,
    });
    invocationRepo.create({
      id: 'inv-implementer-with-progress',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'luigi',
      engine: 'codex',
      account_id: 'account-codex',
    });
    getDb().prepare('UPDATE invocation SET created_at = ?, updated_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'inv-implementer-with-progress');
    taskRepo.updateStatus(task.id, 'in_review');
    proofLogRepo.append({
      eventType: 'task_graph.gate_evidence.accepted',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      actorId: 'luigi',
      metadata: { status: 'in_review', gateName: 'implementation_evidence' },
    });
    invocationRepo.updateStatus('inv-implementer-with-progress', 'succeeded');
    const reviewAdmission = executionEnvelopeRepo.create({
      source: 'review_gate',
      intent: 'review',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      fromNodeId: 'delivery-supervisor',
      toNodeId: 'daemon:local',
      toAgentId: 'peach',
    });
    executionEnvelopeRepo.updateStatus(reviewAdmission.id, 'acknowledged');

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(facts.runnableTask).toBeUndefined();
  });

  it('treats the verified Git collaboration PR path as task progress', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    conversationRepo.update(contract.scope.conversationId, {
      project_path: 'C:/repo',
      git_repo_root: 'C:/repo',
    });
    const task = taskRepo.create({
      id: 'task-git-progress',
      conversation_id: contract.scope.conversationId,
      title: contract.goal,
      agent_id: 'luigi',
    });
    taskRepo.updateStatus(task.id, 'in_progress');
    repo.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'reviewing',
      rootTaskId: task.id,
    });
    invocationRepo.create({
      id: 'inv-git-implementer-progress',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'luigi',
      engine: 'codex',
      account_id: 'account-codex',
    });
    getDb().prepare('UPDATE invocation SET created_at = ?, updated_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'inv-git-implementer-progress');
    const verifier: GitProviderVerifier = {
      getPullRequest: async () => ({
        provider: 'github',
        repository: 'acme/widget',
        number: 42,
        title: 'Ship',
        url: 'https://github.com/acme/widget/pull/42',
        state: 'open',
        draft: false,
        author: 'luigi',
        baseRef: 'main',
        headRef: 'task/ship',
        headSha: 'a'.repeat(40),
        checks: 'passing',
        verifiedAt: '2026-07-18T00:00:00.000Z',
      }),
      getReview: async () => { throw new Error('not used'); },
      getMerge: async () => { throw new Error('not used'); },
    };
    await new EngineeringCollaborationService(verifier).recordPullRequest({
      taskId: task.id,
      expectedConversationId: contract.scope.conversationId,
      actorAgentId: 'luigi',
      pullRequestUrl: 'https://github.com/acme/widget/pull/42',
      evidence: {
        installResult: 'ok',
        buildResult: 'ok',
        testResult: 'ok',
        impactEvidence: 'ok',
      },
    });
    invocationRepo.updateStatus('inv-git-implementer-progress', 'succeeded');

    const facts = await new RepositoryDeliveryFactsAdapter().observe(repo.getSnapshot(run.run.id)!);

    expect(taskRepo.getById(task.id)?.status).toBe('in_review');
    expect(facts.runnableTask).toBeUndefined();
  });
});
