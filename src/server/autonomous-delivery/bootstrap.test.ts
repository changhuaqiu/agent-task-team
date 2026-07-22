import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { agentBindingRepo } from '../repositories/agent-binding-repo';
import { runtimeNodeRepo } from '../repositories/runtime-node-repo';
import { resetSeq } from '../repositories/sortable-id';
import { taskRepo } from '../repositories/task-repo';
import { reconcileActiveRuns } from './bootstrap';
import { RepositoryDeliveryFactsAdapter } from './production-adapters';
import { AutonomousDeliveryRepository } from './repository';
import type { AutonomousDeliverySupervisor } from './supervisor';
import type { GoalContract } from './types';

const contract: GoalContract = {
  goal: 'recover interrupted implementation',
  acceptanceCriteria: ['implementation resumes without user input'],
  scope: { conversationId: 'conv-stale-envelope', projectPath: process.cwd() },
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
  conversationRepo.create({ id: contract.scope.conversationId, title: 'stale envelope recovery' });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDb();
});

describe('autonomous delivery bootstrap reconcile', () => {
  it('expires a stale started envelope before advancing active runs', async () => {
    const repository = new AutonomousDeliveryRepository();
    const run = repository.createRun(contract);
    const task = taskRepo.create({
      id: 'task-interrupted',
      conversation_id: contract.scope.conversationId,
      title: 'continue implementation',
      agent_id: 'luigi',
    });
    taskRepo.updateStatus(task.id, 'in_progress');
    repository.updateRun({
      runId: run.run.id,
      status: 'executing',
      stage: 'executing',
      rootTaskId: task.id,
    });
    const envelope = executionEnvelopeRepo.create({
      source: 'workflow',
      intent: 'implement',
      conversationId: contract.scope.conversationId,
      taskId: task.id,
      fromNodeId: 'server-before-restart',
      toNodeId: 'local-runtime',
      toAgentId: 'luigi',
      payload: { contextRefs: [], executorKind: 'daemon_process' },
      ttlMs: 60_000,
    });
    executionEnvelopeRepo.updateStatus(envelope.id, 'started');
    invocationRepo.create({
      id: 'inv-interrupted',
      conversation_id: contract.scope.conversationId,
      task_id: task.id,
      agent_id: 'luigi',
    });
    invocationRepo.updateStatus('inv-interrupted', 'running');
    runtimeNodeRepo.register({ id: 'local-runtime', kind: 'daemon', label: 'Local runtime' });
    agentBindingRepo.upsert({
      conversationId: contract.scope.conversationId,
      agentId: 'luigi',
      nodeId: 'local-runtime',
      runtimeId: 'codex',
    });
    agentBindingRepo.markStarted(contract.scope.conversationId, 'luigi', envelope.id);

    const afterEnvelopeRecovery = vi.fn();
    const advance = vi.fn(async (runId: string) => {
      expect(afterEnvelopeRecovery).toHaveBeenCalledOnce();
      expect(executionEnvelopeRepo.getById(envelope.id)?.status).toBe('expired');
      const snapshot = repository.getSnapshot(runId)!;
      const facts = await new RepositoryDeliveryFactsAdapter().observe(snapshot);
      expect(facts.taskGraph).toBe('pending');
      expect(facts.runnableTask).toMatchObject({
        taskId: task.id,
        agentId: 'luigi',
        reasonCode: 'runnable_owned_idle',
      });
    });

    await reconcileActiveRuns(
      { advance } as unknown as AutonomousDeliverySupervisor,
      'startup',
      'local-runtime',
      afterEnvelopeRecovery,
    );

    expect(advance).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledWith(run.run.id, {
      kind: 'periodic_reconcile',
      ref: 'startup',
    });
    expect(invocationRepo.getById('inv-interrupted')).toMatchObject({
      status: 'failed',
      reason_code: 'process_restarted',
    });
    expect(agentBindingRepo.get(contract.scope.conversationId, 'luigi')).toMatchObject({
      status: 'idle',
      active_envelope_id: null,
    });
  });

  it('does not advance runs when persisted envelope expiry fails', async () => {
    new AutonomousDeliveryRepository().createRun(contract);
    vi.spyOn(executionEnvelopeRepo, 'expireStalePending').mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const advance = vi.fn();

    await reconcileActiveRuns({ advance } as unknown as AutonomousDeliverySupervisor, 'periodic');

    expect(advance).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[autonomous-delivery] periodic envelope expiry failed:',
      expect.any(Error),
    );
  });

  it('rolls back all restart state and succeeds on a periodic retry after a transient failure', async () => {
    const envelope = executionEnvelopeRepo.create({
      source: 'workflow',
      intent: 'implement',
      conversationId: contract.scope.conversationId,
      taskId: 'task-transactional-recovery',
      fromNodeId: 'server-before-restart',
      toNodeId: 'local-runtime',
      toAgentId: 'luigi',
      payload: {
        contextRefs: [],
        executorKind: 'daemon_process',
        executorOwnerNodeId: 'local-runtime',
        executorRef: { invocationId: 'inv-transactional-recovery', scopeId: contract.scope.conversationId },
      },
    });
    executionEnvelopeRepo.updateStatus(envelope.id, 'started');
    invocationRepo.create({
      id: 'inv-transactional-recovery',
      conversation_id: contract.scope.conversationId,
      task_id: 'task-transactional-recovery',
      agent_id: 'luigi',
    });
    invocationRepo.updateStatus('inv-transactional-recovery', 'running');
    runtimeNodeRepo.register({ id: 'local-runtime', kind: 'daemon', label: 'Local runtime' });
    agentBindingRepo.upsert({
      conversationId: contract.scope.conversationId,
      agentId: 'luigi',
      nodeId: 'local-runtime',
      runtimeId: 'codex',
    });
    agentBindingRepo.markStarted(contract.scope.conversationId, 'luigi', envelope.id);
    getDb().exec(`
      CREATE TRIGGER fail_restart_invocation_update
      BEFORE UPDATE ON invocation
      WHEN NEW.reason_code = 'process_restarted'
      BEGIN
        SELECT RAISE(ABORT, 'transient invocation write failure');
      END;
    `);
    const advance = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(reconcileActiveRuns(
      { advance } as unknown as AutonomousDeliverySupervisor,
      'startup',
      'local-runtime',
    )).resolves.toBe(false);
    expect(executionEnvelopeRepo.getById(envelope.id)?.status).toBe('started');
    expect(invocationRepo.getById('inv-transactional-recovery')?.status).toBe('running');
    expect(agentBindingRepo.get(contract.scope.conversationId, 'luigi')).toMatchObject({
      status: 'busy',
      active_envelope_id: envelope.id,
    });
    expect(advance).not.toHaveBeenCalled();

    getDb().exec('DROP TRIGGER fail_restart_invocation_update');
    await expect(reconcileActiveRuns(
      { advance } as unknown as AutonomousDeliverySupervisor,
      'periodic',
      'local-runtime',
    )).resolves.toBe(true);
    expect(executionEnvelopeRepo.getById(envelope.id)).toMatchObject({
      status: 'expired',
      reason_code: 'process_restarted',
    });
    expect(invocationRepo.getById('inv-transactional-recovery')).toMatchObject({
      status: 'failed',
      reason_code: 'process_restarted',
    });
    expect(agentBindingRepo.get(contract.scope.conversationId, 'luigi')).toMatchObject({
      status: 'idle',
      active_envelope_id: null,
    });
  });
});
