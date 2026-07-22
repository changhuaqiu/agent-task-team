import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, createTestDb, resetDb, setTestDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { resetSeq } from '../repositories/sortable-id';
import { taskRepo } from '../repositories/task-repo';
import { AutonomousDeliveryRepository } from './repository';
import { AutonomousDeliverySupervisor, type DeliveryActionPort, type DeliveryFactsPort } from './supervisor';
import type {
  DeliveryActionKind,
  DeliveryBundle,
  DeliveryRunStatus,
  GoalContract,
} from './types';

const contract: GoalContract = {
  goal: '交付一个可用的项目首页',
  acceptanceCriteria: ['首页可在浏览器中打开', '核心流程通过 Web UI 端到端测试'],
  scope: { conversationId: 'conv-autonomous', projectPath: 'C:/workspace/project' },
  authorization: {
    allowCodeChanges: true,
    allowPush: true,
    allowPullRequest: true,
    allowAutoMerge: false,
  },
  recoveryPolicy: {
    maxAttemptsPerAction: 2,
    maxRepairCycles: 2,
    stallTimeoutMs: 60_000,
  },
  deliveryPolicy: {
    requireReview: true,
    requireWebE2E: true,
    requireMerge: false,
  },
};

const bundle: DeliveryBundle = {
  summary: '首页已交付',
  acceptanceResults: contract.acceptanceCriteria.map((criterion) => ({
    criterion,
    status: 'passed',
    evidenceRefs: [`evidence:${criterion}`],
  })),
  changeRefs: ['commit:abc123'],
  verificationRefs: ['playwright:report'],
  providerRefs: ['pr:42'],
  knownLimitations: [],
  completedAt: '2026-07-19T00:00:00.000Z',
};

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  conversationRepo.create({ id: contract.scope.conversationId, title: '自主交付项目' });
});

afterEach(() => {
  resetDb();
});

describe('AutonomousDeliveryRepository', () => {
  it('lists distinct conversation ids for state hydration', () => {
    const repo = new AutonomousDeliveryRepository();
    conversationRepo.create({ id: 'conv-autonomous-second', title: '第二个自主项目' });
    repo.createRun(contract);
    repo.createRun(contract);
    repo.createRun({
      ...contract,
      scope: { ...contract.scope, conversationId: 'conv-autonomous-second' },
    });

    expect(repo.listConversationIds()).toEqual([
      'conv-autonomous',
      'conv-autonomous-second',
    ]);
  });

  it('原子 claim 同一逻辑动作且不会产生重复 attempt', () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    const first = repo.ensureAction({
      runId: run.run.id,
      kind: 'plan_goal',
      idempotencyKey: `${run.run.id}:plan`,
      maxAttempts: 2,
    });
    const duplicate = repo.ensureAction({
      runId: run.run.id,
      kind: 'plan_goal',
      idempotencyKey: `${run.run.id}:plan`,
      maxAttempts: 2,
    });

    expect(duplicate.id).toBe(first.id);
    expect(repo.claimNext({ runId: run.run.id, workerId: 'worker-a', leaseMs: 1_000 })).toBeDefined();
    expect(repo.claimNext({ runId: run.run.id, workerId: 'worker-b', leaseMs: 1_000 })).toBeUndefined();
    expect(repo.getSnapshot(run.run.id)?.attempts).toHaveLength(1);
  });

  it('lease 过期后回收 attempt，并在预算内允许新 attempt', () => {
    const repo = new AutonomousDeliveryRepository();
    const startedAt = new Date('2026-07-19T00:00:00.000Z');
    const run = repo.createRun(contract, startedAt);
    repo.ensureAction({
      runId: run.run.id,
      kind: 'plan_goal',
      idempotencyKey: `${run.run.id}:plan`,
      maxAttempts: 2,
      now: startedAt,
    });
    const first = repo.claimNext({
      runId: run.run.id,
      workerId: 'worker-a',
      leaseMs: 1_000,
      now: startedAt,
    })!;

    expect(repo.abandonExpiredAttempts(new Date('2026-07-19T00:00:02.000Z'))).toBe(1);
    const second = repo.claimNext({
      runId: run.run.id,
      workerId: 'worker-b',
      leaseMs: 1_000,
      now: new Date('2026-07-19T00:00:02.000Z'),
    })!;
    expect(second.attempt.attempt_no).toBe(2);
    expect(repo.getSnapshot(run.run.id)?.attempts.find((item) => item.id === first.attempt.id)?.status)
      .toBe('abandoned');
  });

  it('活跃 attempt 的 heartbeat 会续租，避免长任务被周期 reconcile 误回收', () => {
    const repo = new AutonomousDeliveryRepository();
    const startedAt = new Date('2026-07-19T00:00:00.000Z');
    const run = repo.createRun(contract, startedAt);
    repo.ensureAction({
      runId: run.run.id,
      kind: 'plan_goal',
      idempotencyKey: `${run.run.id}:heartbeat`,
      maxAttempts: 2,
      now: startedAt,
    });
    const claim = repo.claimNext({
      runId: run.run.id,
      workerId: 'worker-heartbeat',
      leaseMs: 1_000,
      now: startedAt,
    })!;
    repo.markAttemptRunning(claim.attempt.id, startedAt);

    expect(repo.heartbeat(
      claim.attempt.id,
      1_000,
      new Date('2026-07-19T00:00:00.800Z'),
    )).toBe(true);
    expect(repo.abandonExpiredAttempts(new Date('2026-07-19T00:00:01.500Z'))).toBe(0);
    expect(repo.abandonExpiredAttempts(new Date('2026-07-19T00:00:01.900Z'))).toBe(1);
  });

  it('旧 attempt 过期后，其迟到结果不能覆盖新 attempt 或写入 receipt', () => {
    const repo = new AutonomousDeliveryRepository();
    const startedAt = new Date('2026-07-19T00:00:00.000Z');
    const run = repo.createRun(contract, startedAt);
    repo.ensureAction({
      runId: run.run.id,
      kind: 'plan_goal',
      idempotencyKey: `${run.run.id}:fencing`,
      maxAttempts: 2,
      now: startedAt,
    });
    const stale = repo.claimNext({
      runId: run.run.id,
      workerId: 'worker-stale',
      leaseMs: 1_000,
      now: startedAt,
    })!;
    repo.markAttemptRunning(stale.attempt.id, startedAt);
    const reclaimedAt = new Date('2026-07-19T00:00:02.000Z');
    repo.abandonExpiredAttempts(reclaimedAt);
    const current = repo.claimNext({
      runId: run.run.id,
      workerId: 'worker-current',
      leaseMs: 1_000,
      now: reclaimedAt,
    })!;
    repo.markAttemptRunning(current.attempt.id, reclaimedAt);

    expect(repo.completeAttempt({
      runId: run.run.id,
      actionId: stale.action.id,
      attemptId: stale.attempt.id,
      receipts: [{ kind: 'stale.result', status: 'succeeded' }],
      now: reclaimedAt,
    })).toBe(false);
    expect(repo.failAttempt({
      actionId: stale.action.id,
      attemptId: stale.attempt.id,
      failureCode: 'transient_runtime',
      retryAt: new Date('2026-07-19T00:00:03.000Z'),
      now: reclaimedAt,
    })).toBe('stale');

    const snapshot = repo.getSnapshot(run.run.id)!;
    expect(snapshot.actions[0]).toMatchObject({
      status: 'running',
      attempt_count: 2,
    });
    expect(snapshot.attempts.find((attempt) => attempt.id === current.attempt.id)?.status)
      .toBe('running');
    expect(snapshot.receipts).toHaveLength(0);
  });
});

describe('AutonomousDeliverySupervisor', () => {
  it('facts 观察期间 Run 被升级后，旧决策不能回退终态或继续创建 Action', async () => {
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun(contract);
    let markObserved!: () => void;
    let releaseFacts!: (facts: Awaited<ReturnType<DeliveryFactsPort['observe']>>) => void;
    const observed = new Promise<void>((resolve) => {
      markObserved = resolve;
    });
    const facts = new Promise<Awaited<ReturnType<DeliveryFactsPort['observe']>>>((resolve) => {
      releaseFacts = resolve;
    });
    let executeCount = 0;
    const supervisor = new AutonomousDeliverySupervisor({
      repository: repo,
      workerId: 'worker-cas',
      facts: {
        observe: async () => {
          markObserved();
          return facts;
        },
      },
      actions: {
        execute: async () => {
          executeCount += 1;
          return { status: 'succeeded' };
        },
      },
    });

    const advancing = supervisor.advance(run.run.id);
    await observed;
    repo.updateRun({
      runId: run.run.id,
      status: 'escalated',
      stage: 'planning',
      escalationCode: 'missing_authorization',
      escalationDetail: '人工升级',
    });
    releaseFacts({
      planning: 'not_started',
      taskGraph: 'pending',
      review: 'pending',
      verification: 'not_started',
      integration: 'not_required',
      delivery: 'pending',
    });

    const result = await advancing;
    expect(result.disposition).toBe('escalated');
    expect(result.snapshot.run.status).toBe('escalated');
    expect(result.snapshot.actions).toHaveLength(0);
    expect(executeCount).toBe(0);
  });

  it('要求 Web UI E2E 时在创建阶段拒绝没有项目目录的目标', () => {
    const supervisor = new AutonomousDeliverySupervisor({
      repository: new AutonomousDeliveryRepository(),
      facts: {
        observe: async () => ({
          planning: 'pending',
          taskGraph: 'pending',
          review: 'pending',
          verification: 'pending',
          integration: 'not_required',
          delivery: 'pending',
        }),
      },
      actions: {
        execute: async () => ({ status: 'succeeded' }),
      },
      workerId: 'contract-test',
    });

    expect(() => supervisor.start({
      ...contract,
      scope: { conversationId: contract.scope.conversationId },
    })).toThrow('Web UI 端到端验收需要项目目录');
  });

  it('从一次目标提交连续推进到 DeliveryBundle，不需要中间用户输入', async () => {
    const state = {
      planning: 'pending' as const | 'completed',
      taskGraph: 'pending' as const | 'running' | 'completed',
      review: 'not_required' as const | 'pending' | 'passed',
      verification: 'not_started' as const | 'pending' | 'passed',
      delivery: 'pending' as const | 'published',
    };
    const facts: DeliveryFactsPort = {
      observe: async () => ({
        rootTaskId: state.planning === 'completed' ? 'task-root' : undefined,
        planning: state.planning,
        taskGraph: state.taskGraph,
        review: state.review,
        verification: state.verification,
        integration: 'not_required',
        delivery: state.delivery,
        bundle: state.verification === 'passed' ? bundle : undefined,
      }),
    };
    const actions: DeliveryActionPort = {
      execute: async ({ action }) => {
        if (action.kind === 'plan_goal') {
          taskRepo.create({
            id: 'task-root',
            conversation_id: contract.scope.conversationId,
            title: contract.goal,
            agent_id: 'planner',
          });
          state.planning = 'completed';
        }
        if (action.kind === 'advance_tasks') state.taskGraph = 'completed';
        if (action.kind === 'request_review') state.review = 'passed';
        if (action.kind === 'run_verification') state.verification = 'passed';
        if (action.kind === 'publish_delivery') {
          expect(supervisor.get(started.run.id)?.bundle?.summary).toBe('首页已交付');
          state.delivery = 'published';
        }
        return {
          status: 'succeeded',
          receipts: [{ kind: action.kind, status: 'succeeded' }],
        };
      },
    };
    const supervisor = new AutonomousDeliverySupervisor({
      repository: new AutonomousDeliveryRepository(),
      facts,
      actions,
      workerId: 'test-worker',
    });

    const started = supervisor.start(contract);
    const result = await supervisor.advance(started.run.id, { kind: 'started' });

    expect(result.disposition).toBe('completed');
    expect(result.snapshot.run.status).toBe('completed');
    expect(result.snapshot.bundle?.summary).toBe('首页已交付');
    expect(result.snapshot.actions.map((item) => item.kind)).toEqual([
      'plan_goal',
      'advance_tasks',
      'request_review',
      'run_verification',
      'publish_delivery',
    ]);
  });

  it('可重试失败进入 recovering，达到 not_before 后继续且不重复逻辑 action', async () => {
    let attempts = 0;
    let planning: 'pending' | 'completed' = 'pending';
    let current = new Date('2026-07-19T00:00:00.000Z');
    const supervisor = new AutonomousDeliverySupervisor({
      repository: new AutonomousDeliveryRepository(),
      facts: {
        observe: async () => ({
          planning,
          taskGraph: 'running',
          review: 'pending',
          verification: 'pending',
          integration: 'not_required',
          delivery: 'pending',
        }),
      },
      actions: {
        execute: async () => {
          attempts += 1;
          if (attempts === 1) {
            return {
              status: 'failed',
              failureCode: 'transient_runtime',
              retryable: true,
            };
          }
          planning = 'completed';
          return { status: 'succeeded' };
        },
      },
      workerId: 'test-worker',
      now: () => current,
    });
    const started = supervisor.start(contract);
    const first = await supervisor.advance(started.run.id);
    expect(first.snapshot.run.status).toBe('recovering');

    current = new Date('2026-07-19T00:00:02.000Z');
    const second = await supervisor.advance(started.run.id, { kind: 'periodic_reconcile' });
    expect(second.disposition).toBe('acted');
    expect(second.snapshot.run.status).toBe('executing');
    expect(second.snapshot.actions).toHaveLength(1);
    expect(second.snapshot.attempts).toHaveLength(2);
    expect(second.snapshot.actions[0]).toMatchObject({
      attempt_count: 2,
      failure_count: 1,
    });
  });

  it('agent_busy 延迟不消耗失败预算，超过 maxAttempts 后仍可自然成功', async () => {
    let executions = 0;
    let planning: 'pending' | 'completed' = 'pending';
    let current = new Date('2026-07-19T00:00:00.000Z');
    const repository = new AutonomousDeliveryRepository();
    const supervisor = new AutonomousDeliverySupervisor({
      repository,
      facts: {
        observe: async () => ({
          planning,
          taskGraph: 'running',
          review: 'pending',
          verification: 'pending',
          integration: 'not_required',
          delivery: 'pending',
        }),
      },
      actions: {
        execute: async () => {
          executions += 1;
          if (executions <= 3) {
            return { status: 'deferred', reasonCode: 'agent_busy' };
          }
          planning = 'completed';
          return { status: 'succeeded' };
        },
      },
      workerId: 'busy-backpressure-worker',
      now: () => current,
    });
    const started = supervisor.start(contract);

    for (const timestamp of [1_000, 3_000]) {
      const result = await supervisor.advance(started.run.id);
      expect(result.disposition).toBe('waiting');
      expect(result.snapshot.run.status).not.toBe('escalated');
      current = new Date(`2026-07-19T00:00:0${timestamp / 1_000}.000Z`);
    }
    const third = await supervisor.advance(started.run.id);
    expect(third.disposition).toBe('waiting');
    expect(third.snapshot.actions[0]).toMatchObject({
      status: 'retry_wait',
      attempt_count: 3,
      failure_count: 0,
      max_attempts: 2,
    });
    expect(third.snapshot.run.status).not.toBe('escalated');

    current = new Date('2026-07-19T00:00:07.000Z');
    const completedDeferral = await supervisor.advance(started.run.id);
    expect(completedDeferral.snapshot.run.status).not.toBe('escalated');
    expect(completedDeferral.snapshot.actions[0]).toMatchObject({
      status: 'succeeded',
      attempt_count: 4,
      failure_count: 0,
    });
  });

  it('长动作执行期间自动续租，周期 reconcile 不会并发派发第二个 attempt', async () => {
    let planning: 'pending' | 'completed' = 'pending';
    const repository = new AutonomousDeliveryRepository();
    const supervisor = new AutonomousDeliverySupervisor({
      repository,
      facts: {
        observe: async () => ({
          planning,
          taskGraph: 'running',
          review: 'pending',
          verification: 'pending',
          integration: 'not_required',
          delivery: 'pending',
        }),
      },
      actions: {
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 260));
          planning = 'completed';
          return { status: 'succeeded' };
        },
      },
      workerId: 'long-running-worker',
      leaseMs: 120,
    });
    const started = supervisor.start(contract);

    const firstAdvance = supervisor.advance(started.run.id, { kind: 'started' });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const concurrent = await supervisor.advance(started.run.id, { kind: 'periodic_reconcile' });
    const completedExecution = await firstAdvance;

    expect(concurrent.disposition).toBe('busy');
    expect(completedExecution.disposition).toBe('acted');
    expect(repository.getSnapshot(started.run.id)?.attempts).toHaveLength(1);
    expect(repository.getSnapshot(started.run.id)?.attempts[0].status).toBe('succeeded');
  });

  it('进程重启并重新打开持久化数据库后回收过期 attempt，复用原逻辑 action 继续', async () => {
    closeDb();
    const previousDataDir = process.env.ATH_DATA_DIR;
    const dataDir = mkdtempSync(join(tmpdir(), 'ath-delivery-restart-'));
    process.env.ATH_DATA_DIR = dataDir;
    resetDb();

    try {
      const firstRepository = new AutonomousDeliveryRepository();
      const startedAt = new Date('2026-07-19T00:00:00.000Z');
      conversationRepo.create({
        id: contract.scope.conversationId,
        title: '重启恢复项目',
      });
      const run = firstRepository.createRun(contract, startedAt);
      const action = firstRepository.ensureAction({
        runId: run.run.id,
        kind: 'plan_goal',
        idempotencyKey: `${run.run.id}:plan_goal:v1`,
        maxAttempts: contract.recoveryPolicy.maxAttemptsPerAction,
        now: startedAt,
      });
      const interrupted = firstRepository.claimNext({
        runId: run.run.id,
        workerId: 'worker-before-restart',
        leaseMs: 1_000,
        now: startedAt,
      })!;
      firstRepository.markAttemptRunning(interrupted.attempt.id, startedAt);

      // Simulate a real process boundary: close the SQLite handle and rebuild all in-memory objects.
      closeDb();
      resetDb();

      let planning: 'pending' | 'completed' = 'pending';
      const restartedRepository = new AutonomousDeliveryRepository();
      const restartedSupervisor = new AutonomousDeliverySupervisor({
        repository: restartedRepository,
        facts: {
          observe: async () => ({
            planning,
            taskGraph: 'running',
            review: 'pending',
            verification: 'pending',
            integration: 'not_required',
            delivery: 'pending',
          }),
        },
        actions: {
          execute: async () => {
            planning = 'completed';
            return { status: 'succeeded' };
          },
        },
        workerId: 'worker-after-restart',
        leaseMs: 1_000,
        now: () => new Date('2026-07-19T00:00:02.000Z'),
      });

      const result = await restartedSupervisor.advance(run.run.id, {
        kind: 'periodic_reconcile',
        ref: 'startup',
      });

      expect(result.disposition).toBe('acted');
      expect(result.snapshot.actions).toHaveLength(1);
      expect(result.snapshot.actions[0]).toMatchObject({
        id: action.id,
        status: 'succeeded',
        attempt_count: 2,
      });
      expect(result.snapshot.attempts).toHaveLength(2);
      expect(result.snapshot.attempts.map((attempt) => attempt.status))
        .toEqual(['abandoned', 'succeeded']);
    } finally {
      closeDb();
      resetDb();
      if (previousDataDir === undefined) delete process.env.ATH_DATA_DIR;
      else process.env.ATH_DATA_DIR = previousDataDir;
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      stage: 'executing',
      actionKind: 'advance_tasks',
    },
    {
      stage: 'verifying',
      actionKind: 'run_verification',
    },
    {
      stage: 'integrating',
      actionKind: 'integrate_change',
    },
  ] as const)(
    '$stage 阶段进程重启后回收旧 Attempt，并复用同一 $actionKind Action',
    async ({ stage, actionKind }) => {
      closeDb();
      const previousDataDir = process.env.ATH_DATA_DIR;
      const dataDir = mkdtempSync(join(tmpdir(), `ath-delivery-${stage}-restart-`));
      process.env.ATH_DATA_DIR = dataDir;
      resetDb();

      try {
        const stageContract: GoalContract = {
          ...contract,
          authorization: {
            ...contract.authorization,
            allowPush: stage === 'integrating',
            allowPullRequest: stage === 'integrating',
            allowAutoMerge: stage === 'integrating',
          },
          deliveryPolicy: {
            requireReview: false,
            requireWebE2E: stage === 'verifying',
            requireMerge: stage === 'integrating',
          },
        };
        const rootTaskId = `task-${stage}`;
        const startedAt = new Date('2026-07-19T00:00:00.000Z');
        const firstRepository = new AutonomousDeliveryRepository();
        conversationRepo.create({
          id: contract.scope.conversationId,
          title: `${stage} 重启恢复`,
        });
        taskRepo.create({
          id: rootTaskId,
          conversation_id: contract.scope.conversationId,
          title: `${stage} 阶段任务`,
          agent_id: 'mario',
        });
        const run = firstRepository.createRun(stageContract, startedAt);
        firstRepository.updateRun({
          runId: run.run.id,
          status: stage as DeliveryRunStatus,
          stage,
          rootTaskId,
          now: startedAt,
        });
        const idempotencyKey = actionKind === 'advance_tasks'
          ? `${run.run.id}:advance_tasks:wakeup-${stage}`
          : actionKind === 'run_verification'
            ? `${run.run.id}:run_verification:0`
            : `${run.run.id}:integrate_change:${rootTaskId}`;
        const action = firstRepository.ensureAction({
          runId: run.run.id,
          kind: actionKind as DeliveryActionKind,
          idempotencyKey,
          maxAttempts: 2,
          subjectType: 'task',
          subjectId: rootTaskId,
          now: startedAt,
        });
        const interrupted = firstRepository.claimNext({
          runId: run.run.id,
          workerId: `worker-before-${stage}-restart`,
          leaseMs: 1_000,
          now: startedAt,
        })!;
        firstRepository.markAttemptRunning(interrupted.attempt.id, startedAt);

        closeDb();
        resetDb();

        const restartedRepository = new AutonomousDeliveryRepository();
        const factsByStage: Record<typeof stage, DeliveryFactsPort> = {
          executing: {
            observe: async () => ({
              rootTaskId,
              planning: 'completed',
              taskGraph: 'pending',
              review: 'not_required',
              verification: 'not_required',
              integration: 'not_required',
              delivery: 'pending',
              runnableTask: {
                taskId: rootTaskId,
                agentId: 'mario',
                reasonCode: 'owner_ready',
                prompt: 'continue',
                idempotencyKey: `wakeup-${stage}`,
              },
            }),
          },
          verifying: {
            observe: async () => ({
              rootTaskId,
              planning: 'completed',
              taskGraph: 'completed',
              review: 'not_required',
              verification: 'not_started',
              integration: 'not_required',
              delivery: 'pending',
            }),
          },
          integrating: {
            observe: async () => ({
              rootTaskId,
              planning: 'completed',
              taskGraph: 'completed',
              review: 'not_required',
              verification: 'not_required',
              integration: 'failed',
              delivery: 'pending',
            }),
          },
        };
        const restartedSupervisor = new AutonomousDeliverySupervisor({
          repository: restartedRepository,
          facts: factsByStage[stage],
          actions: {
            execute: async () => ({ status: 'succeeded' }),
          },
          workerId: `worker-after-${stage}-restart`,
          leaseMs: 1_000,
          maxActionsPerAdvance: 1,
          now: () => new Date('2026-07-19T00:00:02.000Z'),
        });

        const result = await restartedSupervisor.advance(run.run.id, {
          kind: 'periodic_reconcile',
          ref: 'startup',
        });

        expect(result.disposition).toBe('acted');
        expect(result.snapshot.actions).toHaveLength(1);
        expect(result.snapshot.actions[0]).toMatchObject({
          id: action.id,
          kind: actionKind,
          status: 'succeeded',
          attempt_count: 2,
        });
        expect(result.snapshot.attempts.map((attempt) => attempt.status))
          .toEqual(['abandoned', 'succeeded']);
      } finally {
        closeDb();
        resetDb();
        if (previousDataDir === undefined) delete process.env.ATH_DATA_DIR;
        else process.env.ATH_DATA_DIR = previousDataDir;
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
  );
});
