import type {
  DeliveryActionKind,
  DeliveryBundle,
  DeliveryFailureCode,
  DeliveryRunSnapshot,
  DeliveryRunStatus,
  DeliveryStage,
} from './types';

export type GateState = 'not_required' | 'not_started' | 'pending' | 'passed' | 'failed';

export interface ObservedDeliveryFacts {
  rootTaskId?: string;
  planning: 'pending' | 'completed';
  taskGraph: 'pending' | 'running' | 'blocked' | 'completed';
  review: GateState;
  verification: GateState;
  integration: GateState;
  delivery: 'pending' | 'published';
  runnableTask?: {
    taskId: string;
    agentId: string;
    reasonCode: string;
    prompt: string;
    idempotencyKey: string;
  };
  blockerCode?: string;
  blockerDetail?: string;
  bundle?: DeliveryBundle;
}

export interface ProposedDeliveryAction {
  kind: DeliveryActionKind;
  idempotencyKey: string;
  subjectType?: string;
  subjectId?: string;
}

export type DeliveryDecision =
  | {
      type: 'act';
      status: DeliveryRunStatus;
      stage: DeliveryStage;
      action: ProposedDeliveryAction;
      rootTaskId?: string;
      repairCycle?: number;
    }
  | {
      type: 'wait';
      status: DeliveryRunStatus;
      stage: DeliveryStage;
      rootTaskId?: string;
    }
  | {
      type: 'complete';
      bundle: DeliveryBundle;
      rootTaskId?: string;
    }
  | {
      type: 'escalate';
      stage: DeliveryStage;
      failureCode: DeliveryFailureCode;
      detail: string;
      rootTaskId?: string;
    };

function actionKey(snapshot: DeliveryRunSnapshot, kind: DeliveryActionKind, suffix: string): string {
  return `${snapshot.run.id}:${kind}:${suffix}`;
}

function currentRepairAction(
  snapshot: DeliveryRunSnapshot,
  kind: 'repair_review' | 'repair_verification',
): DeliveryRunSnapshot['actions'][number] | undefined {
  const cycle = snapshot.run.repair_cycle;
  if (cycle < 1) return undefined;
  const key = actionKey(snapshot, kind, String(cycle));
  return snapshot.actions.find((candidate) => candidate.idempotency_key === key);
}

function inFlightRepairCycle(
  snapshot: DeliveryRunSnapshot,
  kind: 'repair_review' | 'repair_verification',
): number | undefined {
  const action = currentRepairAction(snapshot, kind);
  return action && ['ready', 'claimed', 'running', 'retry_wait'].includes(action.status)
    ? snapshot.run.repair_cycle
    : undefined;
}

export function decideDeliveryNext(
  snapshot: DeliveryRunSnapshot,
  facts: ObservedDeliveryFacts,
): DeliveryDecision {
  const { contract } = snapshot;
  const rootTaskId = facts.rootTaskId ?? snapshot.run.root_task_id ?? undefined;

  if (facts.blockerCode) {
    return {
      type: 'escalate',
      stage: snapshot.run.current_stage,
      failureCode: facts.blockerCode as DeliveryFailureCode,
      detail: facts.blockerDetail ?? facts.blockerCode,
      rootTaskId,
    };
  }

  if (facts.planning !== 'completed') {
    return {
      type: 'act',
      status: 'active',
      stage: 'planning',
      action: {
        kind: 'plan_goal',
        idempotencyKey: actionKey(snapshot, 'plan_goal', 'v1'),
      },
    };
  }

  if (facts.taskGraph === 'blocked') {
    return {
      type: 'escalate',
      stage: 'executing',
      failureCode: 'unknown',
      detail: '任务图存在无法自动消解的 blocker',
      rootTaskId,
    };
  }
  if (facts.taskGraph !== 'completed') {
    if (facts.taskGraph === 'running') {
      return { type: 'wait', status: 'active', stage: 'executing', rootTaskId };
    }
    return {
      type: 'act',
      status: 'active',
      stage: 'executing',
      rootTaskId,
      action: {
        kind: 'advance_tasks',
        idempotencyKey: facts.runnableTask
          ? actionKey(snapshot, 'advance_tasks', facts.runnableTask.idempotencyKey)
          : actionKey(snapshot, 'advance_tasks', rootTaskId ?? 'root'),
        subjectType: 'task',
        subjectId: facts.runnableTask?.taskId ?? rootTaskId,
      },
    };
  }

  if (contract.deliveryPolicy.requireReview && facts.review !== 'passed') {
    if (facts.review === 'pending') {
      return { type: 'wait', status: 'waiting_gate', stage: 'reviewing', rootTaskId };
    }
    const currentRepair = currentRepairAction(snapshot, 'repair_review');
    if (
      facts.review === 'failed'
      && currentRepair
      && ['failed', 'cancelled'].includes(currentRepair.status)
    ) {
      return {
        type: 'escalate',
        stage: 'reviewing',
        failureCode: (currentRepair.last_failure_code ?? 'unknown') as DeliveryFailureCode,
        detail: currentRepair.last_failure_detail ?? '评审修复动作未能完成',
        rootTaskId,
      };
    }
    const repairCycle = facts.review === 'failed'
      ? inFlightRepairCycle(snapshot, 'repair_review') ?? snapshot.run.repair_cycle + 1
      : snapshot.run.repair_cycle;
    if (repairCycle > contract.recoveryPolicy.maxRepairCycles) {
      return {
        type: 'escalate',
        stage: 'reviewing',
        failureCode: 'verification_failed',
        detail: '评审修复次数已达到上限',
        rootTaskId,
      };
    }
    const kind: DeliveryActionKind = facts.review === 'failed' ? 'repair_review' : 'request_review';
    return {
      type: 'act',
      status: 'active',
      stage: 'reviewing',
      rootTaskId,
      repairCycle,
      action: {
        kind,
        idempotencyKey: actionKey(snapshot, kind, String(repairCycle)),
        subjectType: 'task',
        subjectId: rootTaskId,
      },
    };
  }

  if (facts.verification !== 'passed' && facts.verification !== 'not_required') {
    if (facts.verification === 'pending') {
      return { type: 'wait', status: 'waiting_gate', stage: 'verifying', rootTaskId };
    }
    const currentRepair = currentRepairAction(snapshot, 'repair_verification');
    if (
      facts.verification === 'failed'
      && currentRepair
      && ['failed', 'cancelled'].includes(currentRepair.status)
    ) {
      return {
        type: 'escalate',
        stage: 'verifying',
        failureCode: (currentRepair.last_failure_code ?? 'unknown') as DeliveryFailureCode,
        detail: currentRepair.last_failure_detail ?? '验证修复动作未能完成',
        rootTaskId,
      };
    }
    const repairCycle = facts.verification === 'failed'
      ? inFlightRepairCycle(snapshot, 'repair_verification') ?? snapshot.run.repair_cycle + 1
      : snapshot.run.repair_cycle;
    if (repairCycle > contract.recoveryPolicy.maxRepairCycles) {
      return {
        type: 'escalate',
        stage: 'verifying',
        failureCode: 'verification_failed',
        detail: '验证修复次数已达到上限',
        rootTaskId,
      };
    }
    const kind: DeliveryActionKind = facts.verification === 'failed'
      ? 'repair_verification'
      : 'run_verification';
    return {
      type: 'act',
      status: 'active',
      stage: 'verifying',
      rootTaskId,
      repairCycle,
      action: {
        kind,
        idempotencyKey: actionKey(snapshot, kind, String(repairCycle)),
        subjectType: 'task',
        subjectId: rootTaskId,
      },
    };
  }

  if (contract.deliveryPolicy.requireMerge && facts.integration !== 'passed') {
    if (!contract.authorization.allowAutoMerge) {
      return {
        type: 'escalate',
        stage: 'integrating',
        failureCode: 'missing_authorization',
        detail: '交付要求合并，但当前目标未授权自动合并',
        rootTaskId,
      };
    }
    if (facts.integration === 'pending') {
      return { type: 'wait', status: 'waiting_gate', stage: 'integrating', rootTaskId };
    }
    return {
      type: 'act',
      status: 'active',
      stage: 'integrating',
      rootTaskId,
      action: {
        kind: 'integrate_change',
        idempotencyKey: actionKey(snapshot, 'integrate_change', rootTaskId ?? 'root'),
        subjectType: 'task',
        subjectId: rootTaskId,
      },
    };
  }

  if (facts.delivery !== 'published') {
    return {
      type: 'act',
      status: 'active',
      stage: 'delivering',
      rootTaskId,
      action: {
        kind: 'publish_delivery',
        idempotencyKey: actionKey(snapshot, 'publish_delivery', 'final'),
        subjectType: 'run',
        subjectId: snapshot.run.id,
      },
    };
  }

  if (!facts.bundle) {
    return {
      type: 'escalate',
      stage: 'delivering',
      failureCode: 'unknown',
      detail: '交付已发布，但缺少可持久化的 DeliveryBundle',
      rootTaskId,
    };
  }
  return { type: 'complete', bundle: facts.bundle, rootTaskId };
}
