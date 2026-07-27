import { describe, expect, it } from 'vitest';
import { decideDeliveryNext, type ObservedDeliveryFacts } from './policy';
import type {
  DeliveryActionStatus,
  DeliveryRunSnapshot,
} from './types';

function snapshotWithRepair(
  kind: 'repair_review' | 'repair_verification',
  status: DeliveryActionStatus,
): DeliveryRunSnapshot {
  const runId = 'run-repair';
  return {
    run: {
      id: runId,
      conversation_id: 'conversation-repair',
      root_task_id: 'task-repair',
      status: 'active',
      current_stage: kind === 'repair_review' ? 'reviewing' : 'verifying',
      goal_contract_json: '{}',
      repair_cycle: 1,
      revision: 0,
      escalation_code: null,
      escalation_detail: null,
      delivery_bundle_json: null,
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
      completed_at: null,
    },
    contract: {
      goal: 'repair',
      acceptanceCriteria: ['criterion'],
      scope: { conversationId: 'conversation-repair', projectPath: 'C:\\project' },
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
    },
    actions: [{
      id: 'action-repair-1',
      run_id: runId,
      kind,
      subject_type: 'task',
      subject_id: 'task-repair',
      idempotency_key: `${runId}:${kind}:1`,
      status,
      not_before: '2026-07-20T00:00:00.000Z',
      attempt_count: 1,
      max_attempts: 3,
      last_failure_code: null,
      last_failure_detail: null,
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
    }],
    attempts: [],
    receipts: [],
  };
}

function failedFacts(kind: 'repair_review' | 'repair_verification'): ObservedDeliveryFacts {
  return {
    rootTaskId: 'task-repair',
    planning: 'completed',
    taskGraph: 'completed',
    review: kind === 'repair_review' ? 'failed' : 'passed',
    verification: kind === 'repair_verification' ? 'failed' : 'not_started',
    integration: 'not_required',
    delivery: 'pending',
  };
}

describe('decideDeliveryNext repair cycle stability', () => {
  it.each([
    ['repair_review', 'running'],
    ['repair_review', 'retry_wait'],
    ['repair_verification', 'running'],
    ['repair_verification', 'retry_wait'],
  ] as const)('复用 %s 的 %s action，不重复消耗 repair cycle', (kind, status) => {
    const decision = decideDeliveryNext(snapshotWithRepair(kind, status), failedFacts(kind));
    expect(decision.type).toBe('act');
    if (decision.type !== 'act') return;
    expect(decision.repairCycle).toBe(1);
    expect(decision.action.kind).toBe(kind);
    expect(decision.action.idempotencyKey).toBe(`run-repair:${kind}:1`);
  });

  it.each([
    'repair_review',
    'repair_verification',
  ] as const)('上一轮 %s 已结束且事实仍失败时才进入下一轮', (kind) => {
    const decision = decideDeliveryNext(snapshotWithRepair(kind, 'succeeded'), failedFacts(kind));
    expect(decision.type).toBe('act');
    if (decision.type !== 'act') return;
    expect(decision.repairCycle).toBe(2);
    expect(decision.action.idempotencyKey).toBe(`run-repair:${kind}:2`);
  });

  it.each([
    'repair_review',
    'repair_verification',
  ] as const)('%s 自身失败时直接升级，不误创建下一 repair cycle', (kind) => {
    const snapshot = snapshotWithRepair(kind, 'failed');
    snapshot.actions[0].last_failure_code = 'transient_runtime';
    snapshot.actions[0].last_failure_detail = '修复执行环境不可用';

    const decision = decideDeliveryNext(snapshot, failedFacts(kind));

    expect(decision).toMatchObject({
      type: 'escalate',
      failureCode: 'transient_runtime',
      detail: '修复执行环境不可用',
    });
    expect(snapshot.run.repair_cycle).toBe(1);
  });
});
