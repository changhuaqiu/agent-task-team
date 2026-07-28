import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
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
  it('adapts to the managed run lifecycle and repairs missing lease projections', () => {
    const managedDb = new Database(':memory:');
    managedDb.pragma('foreign_keys = ON');
    managedDb.exec(`
      CREATE TABLE conversation (id TEXT PRIMARY KEY);
      CREATE TABLE execution_envelope (id TEXT PRIMARY KEY);
      CREATE TABLE autonomous_delivery_run (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
        root_task_id TEXT,
        status TEXT NOT NULL CHECK(status IN (
          'active','waiting_gate','waiting_human','retrying','completed','failed','cancelled'
        )),
        current_stage TEXT NOT NULL CHECK(current_stage IN (
          'planning','executing','reviewing','verifying','integrating','delivering'
        )),
        goal_contract_json TEXT NOT NULL,
        repair_cycle INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        escalation_code TEXT,
        escalation_detail TEXT,
        delivery_bundle_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        start_idempotency_key TEXT NOT NULL UNIQUE
      );
      CREATE TRIGGER trg_delivery_run_start_key_insert
      BEFORE INSERT ON autonomous_delivery_run
      WHEN trim(NEW.start_idempotency_key)=''
      BEGIN
        SELECT RAISE(ABORT, 'delivery_run_start_idempotency_key_required');
      END;
      CREATE TABLE autonomous_delivery_receipt (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        external_id TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        observed_at TEXT NOT NULL
      );
      INSERT INTO conversation (id) VALUES ('conv-autonomous');
    `);
    setTestDb(managedDb);

    const repo = new AutonomousDeliveryRepository();
    const first = repo.createRun(contract);
    const repeated = repo.createRun(contract);
    expect(() => repo.createRun({
      ...contract,
      goal: 'different goal',
    })).toThrow('delivery_run_start_idempotency_conflict');
    managedDb.prepare("INSERT INTO conversation (id) VALUES ('conv-other')").run();
    expect(() => repo.createRun({
      ...contract,
      scope: { ...contract.scope, conversationId: 'conv-other' },
      idempotencyKey: 'delivery-start:conv-autonomous',
    })).toThrow('delivery_run_start_idempotency_conflict');
    expect(() => repo.createRun({
      ...contract,
      idempotencyKey: 'different-start-key',
    })).toThrow('autonomous_delivery_active_run_conflict');
    const action = repo.ensureAction({
      runId: first.run.id,
      kind: 'plan_goal',
      idempotencyKey: `${first.run.id}:plan`,
      maxAttempts: 2,
    });
    const claim = repo.claimNext({
      runId: first.run.id,
      workerId: 'worker-managed',
      leaseMs: 1_000,
    });

    expect(first.run.status).toBe('planning');
    expect(repeated.run.id).toBe(first.run.id);
    expect(action.run_id).toBe(first.run.id);
    expect(claim?.attempt.action_id).toBe(action.id);
    expect(
      managedDb.prepare(
        'SELECT start_idempotency_key FROM autonomous_delivery_run WHERE id=?',
      ).get(first.run.id),
    ).toEqual({ start_idempotency_key: 'delivery-start:conv-autonomous' });
    expect(
      (managedDb.prepare('PRAGMA table_info(autonomous_delivery_receipt)').all() as Array<{ name: string }>)
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['action_id', 'attempt_id']));

    managedDb.prepare(
      "UPDATE autonomous_delivery_run SET status='waiting_gate' WHERE id=?",
    ).run(first.run.id);
    expect(repo.getRun(first.run.id)?.status).toBe('escalated');
    expect(repo.listActive()).toEqual([]);
    expect(repo.claimNext({
      runId: first.run.id,
      workerId: 'worker-after-gate',
      leaseMs: 1_000,
    })).toBeUndefined();
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
  it('manual resume reopens waiting_human and reconciles current durable facts', async () => {
    const repo = new AutonomousDeliveryRepository();
    const started = repo.createRun(contract);
    repo.updateRun({
      runId: started.run.id,
      status: 'escalated',
      stage: 'executing',
      escalationCode: 'poisoned_session',
      escalationDetail: 'old execution failure',
    });
    taskRepo.create({
      id: 'task-root',
      conversation_id: contract.scope.conversationId,
      title: 'completed root task',
      agent_id: 'worker-manual-resume',
    });
    const supervisor = new AutonomousDeliverySupervisor({
      repository: repo,
      workerId: 'worker-manual-resume',
      facts: {
        observe: async () => ({
          rootTaskId: 'task-root',
          planning: 'completed',
          taskGraph: 'completed',
          review: 'passed',
          verification: 'passed',
          integration: 'not_required',
          delivery: 'published',
          bundle,
        }),
      },
      actions: {
        execute: async () => ({ status: 'succeeded' }),
      },
    });

    const result = await supervisor.advance(started.run.id, { kind: 'manual_resume' });

    expect(result.disposition).toBe('completed');
    expect(result.snapshot.run.status).toBe('completed');
    expect(result.snapshot.run.escalation_code).toBeNull();
    expect(result.snapshot.run.escalation_detail).toBeNull();
  });

  it('manual resume rearms the exact failed action with a fresh attempt budget', async () => {
    const repo = new AutonomousDeliveryRepository();
    const started = repo.createRun(contract);
    repo.ensureAction({
      runId: started.run.id,
      kind: 'plan_goal',
      idempotencyKey: `${started.run.id}:plan_goal:v1`,
      maxAttempts: 1,
    });
    const failedClaim = repo.claimNext({
      runId: started.run.id,
      workerId: 'worker-initial-failure',
      leaseMs: 1_000,
    })!;
    repo.markAttemptRunning(failedClaim.attempt.id);
    expect(repo.failAttempt({
      actionId: failedClaim.action.id,
      attemptId: failedClaim.attempt.id,
      failureCode: 'missing_authorization',
      failureDetail: 'authorization required',
    })).toBe('failed');
    repo.updateRun({
      runId: started.run.id,
      status: 'escalated',
      stage: 'planning',
      escalationCode: 'missing_authorization',
      escalationDetail: 'authorization required',
    });
    let planning: 'pending' | 'completed' = 'pending';
    let executeCount = 0;
    const supervisor = new AutonomousDeliverySupervisor({
      repository: repo,
      workerId: 'worker-rearmed',
      facts: {
        observe: async () => ({
          planning,
          taskGraph: planning === 'completed' ? 'running' : 'pending',
          review: 'pending',
          verification: 'not_started',
          integration: 'not_required',
          delivery: 'pending',
        }),
      },
      actions: {
        execute: async () => {
          executeCount += 1;
          planning = 'completed';
          return { status: 'succeeded' };
        },
      },
    });

    const result = await supervisor.advance(started.run.id, { kind: 'manual_resume' });
    const resumedAction = result.snapshot.actions.find(
      (action) => action.id === failedClaim.action.id,
    );

    expect(result.disposition).toBe('acted');
    expect(result.snapshot.run.status).toBe('executing');
    expect(executeCount).toBe(1);
    expect(resumedAction).toMatchObject({
      status: 'succeeded',
      attempt_count: 2,
      max_attempts: 3,
    });
    expect(result.snapshot.attempts).toHaveLength(2);
  });

  it('manual resume rearms at most one failed action', async () => {
    const repo = new AutonomousDeliveryRepository();
    const started = repo.createRun(contract);
    const actionKeys = [
      `${started.run.id}:plan_goal:v1`,
      `${started.run.id}:advance_tasks:root`,
    ];
    for (const [index, idempotencyKey] of actionKeys.entries()) {
      repo.ensureAction({
        runId: started.run.id,
        kind: index === 0 ? 'plan_goal' : 'advance_tasks',
        idempotencyKey,
        maxAttempts: 1,
      });
      const claim = repo.claimNext({
        runId: started.run.id,
        workerId: `worker-history-${index}`,
        leaseMs: 1_000,
      })!;
      repo.markAttemptRunning(claim.attempt.id);
      repo.failAttempt({
        actionId: claim.action.id,
        attemptId: claim.attempt.id,
        failureCode: 'missing_authorization',
      });
    }
    repo.updateRun({
      runId: started.run.id,
      status: 'escalated',
      stage: 'planning',
      escalationCode: 'missing_authorization',
    });
    let planning: 'pending' | 'completed' = 'pending';
    const supervisor = new AutonomousDeliverySupervisor({
      repository: repo,
      workerId: 'worker-single-rearm',
      facts: {
        observe: async () => ({
          planning,
          taskGraph: 'pending',
          review: 'pending',
          verification: 'not_started',
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
    });

    const result = await supervisor.advance(started.run.id, { kind: 'manual_resume' });
    const [planAction, advanceAction] = result.snapshot.actions;

    expect(result.disposition).toBe('escalated');
    expect(planAction).toMatchObject({ status: 'succeeded', attempt_count: 2 });
    expect(advanceAction).toMatchObject({ status: 'failed', attempt_count: 1 });
  });

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
