import { createHash } from 'node:crypto';

export type ControlActionType =
  | 'initializeGraph'
  | 'activate'
  | 'wait'
  | 'retry'
  | 'requestGate'
  | 'resume'
  | 'escalateToHuman'
  | 'terminate';

export type RetryBudgetKind =
  | 'invocation'
  | 'effect'
  | 'task_rework'
  | 'agent_local';

export interface RetryBudgetSnapshot {
  kind: RetryBudgetKind;
  attemptsUsed: number;
  maxAttempts: number;
}

export type WorkCellControlState =
  | 'ready'
  | 'running'
  | 'artifact_submitted'
  | 'waiting_dependency'
  | 'waiting_gate'
  | 'waiting_human'
  | 'retry_pending'
  | 'completed'
  | 'failed';

export interface WorkCellControlSnapshot {
  workId: string;
  workEpoch: number;
  roleId: string;
  purpose?: 'planning' | 'execution';
  state: WorkCellControlState;
  priority: number;
  queuedAt: string;
  slotId?: string;
  gateStatus?: 'none' | 'requested' | 'passed' | 'failed';
  humanResolution?: 'required' | 'resolved';
  failure?: {
    reasonCode: string;
    retryable: boolean;
    humanRecoverable: boolean;
    budget: RetryBudgetSnapshot;
  };
}

export interface SupervisorControlSnapshot {
  runId: string;
  snapshotRevision: number;
  observedAt: string;
  workCells: WorkCellControlSnapshot[];
  closure: {
    satisfied: boolean;
    unrecoverableReasonCode?: string;
    blockingEffect?: {
      effectId: string;
      status: 'pending' | 'dead_letter';
      attemptsUsed: number;
      maxAttempts: number;
    };
    deadlock?: {
      cycle: string[];
      reasonCode: string;
    };
  };
}

export interface SupervisorControlPolicy {
  revision: number;
  maxConcurrent: number;
  roleCapacity: Record<string, number>;
  fairnessAgingMs: number;
}

export interface ControlAction {
  actionId: string;
  type: ControlActionType;
  targetWorkId?: string;
  workEpoch?: number;
  slotId?: string;
  reasonCode: string;
  retryBudgetKind?: RetryBudgetKind;
  terminationOutcome?: 'completed' | 'failed';
}

export interface ControlDecision {
  decisionId: string;
  runId: string;
  snapshotRevision: number;
  policyRevision: number;
  actions: ControlAction[];
}

interface ProposedControlAction extends Omit<ControlAction, 'actionId'> {
  rank: number;
  order: number;
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function decisionIdentity(
  snapshot: SupervisorControlSnapshot,
  policy: SupervisorControlPolicy,
): string {
  return `control-decision:${stableHash([
    snapshot.runId,
    snapshot.snapshotRevision,
    policy.revision,
  ].join(':'))}`;
}

function actionIdentity(
  decisionId: string,
  action: Omit<ProposedControlAction, 'rank' | 'order'>,
): string {
  return `control-action:${stableHash(JSON.stringify([
    decisionId,
    action.type,
    action.targetWorkId ?? '',
    action.workEpoch ?? '',
    action.slotId ?? '',
    action.reasonCode,
    action.retryBudgetKind ?? '',
    action.terminationOutcome ?? '',
  ]))}`;
}

function materializeAction(
  decisionId: string,
  proposal: ProposedControlAction,
): ControlAction {
  const action: Omit<ProposedControlAction, 'rank' | 'order'> = {
    type: proposal.type,
    targetWorkId: proposal.targetWorkId,
    workEpoch: proposal.workEpoch,
    slotId: proposal.slotId,
    reasonCode: proposal.reasonCode,
    retryBudgetKind: proposal.retryBudgetKind,
    terminationOutcome: proposal.terminationOutcome,
  };
  return { ...action, actionId: actionIdentity(decisionId, action) };
}

function parseTime(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_${field}`);
  return parsed;
}

function validate(
  snapshot: SupervisorControlSnapshot,
  policy: SupervisorControlPolicy,
): void {
  if (!snapshot.runId.trim()) throw new Error('control_run_id_required');
  if (!Number.isSafeInteger(snapshot.snapshotRevision) || snapshot.snapshotRevision < 0) {
    throw new Error('invalid_control_snapshot_revision');
  }
  if (!Number.isSafeInteger(policy.revision) || policy.revision < 0) {
    throw new Error('invalid_control_policy_revision');
  }
  if (!Number.isSafeInteger(policy.maxConcurrent) || policy.maxConcurrent < 0) {
    throw new Error('invalid_control_max_concurrent');
  }
  if (!Number.isFinite(policy.fairnessAgingMs) || policy.fairnessAgingMs <= 0) {
    throw new Error('invalid_control_fairness_aging');
  }
  parseTime(snapshot.observedAt, 'control_observed_at');
  const workIds = new Set<string>();
  for (const cell of snapshot.workCells) {
    if (!cell.workId.trim() || workIds.has(cell.workId)) {
      throw new Error('invalid_control_work_identity');
    }
    workIds.add(cell.workId);
    if (!Number.isSafeInteger(cell.workEpoch) || cell.workEpoch < 0) {
      throw new Error('invalid_control_work_epoch');
    }
    parseTime(cell.queuedAt, 'control_queued_at');
    const roleLimit = policy.roleCapacity[cell.roleId];
    if (roleLimit !== undefined && (!Number.isSafeInteger(roleLimit) || roleLimit < 0)) {
      throw new Error('invalid_control_role_capacity');
    }
    if (cell.failure) {
      const { budget } = cell.failure;
      if (
        !Number.isSafeInteger(budget.attemptsUsed)
        || !Number.isSafeInteger(budget.maxAttempts)
        || budget.attemptsUsed < 0
        || budget.maxAttempts < 0
      ) throw new Error('invalid_control_retry_budget');
    }
  }
}

function effectivePriority(
  cell: WorkCellControlSnapshot,
  observedAt: number,
  fairnessAgingMs: number,
): number {
  const queuedAt = parseTime(cell.queuedAt, 'control_queued_at');
  const ageBoost = Math.max(0, Math.floor((observedAt - queuedAt) / fairnessAgingMs));
  return cell.priority + ageBoost;
}

function stableCellOrder(
  cells: WorkCellControlSnapshot[],
  observedAt: number,
  fairnessAgingMs: number,
): WorkCellControlSnapshot[] {
  return [...cells].sort((left, right) => {
    const priority = effectivePriority(right, observedAt, fairnessAgingMs)
      - effectivePriority(left, observedAt, fairnessAgingMs);
    if (priority !== 0) return priority;
    const queued = left.queuedAt.localeCompare(right.queuedAt);
    return queued !== 0 ? queued : left.workId.localeCompare(right.workId);
  });
}

function firstFreeSlot(roleId: string, limit: number, occupied: Set<string>): string | undefined {
  for (let index = 0; index < limit; index += 1) {
    const candidate = `${roleId}:${index + 1}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Pure deterministic Process Manager decision.
 *
 * It reads immutable facts and policy, returns an ordered action set, and does
 * not mutate domain rows or perform I/O. Command handlers must re-check the
 * snapshot revision, work epoch and slot capacity when claiming an action.
 */
export function decideControlActions(
  snapshot: SupervisorControlSnapshot,
  policy: SupervisorControlPolicy,
): ControlDecision {
  validate(snapshot, policy);
  const decisionId = decisionIdentity(snapshot, policy);
  const observedAt = parseTime(snapshot.observedAt, 'control_observed_at');
  const cells = stableCellOrder(snapshot.workCells, observedAt, policy.fairnessAgingMs);
  const proposals: ProposedControlAction[] = [];

  if (snapshot.closure.unrecoverableReasonCode) {
    const action = {
      type: 'terminate' as const,
      reasonCode: snapshot.closure.unrecoverableReasonCode,
      terminationOutcome: 'failed' as const,
    };
    return {
      decisionId,
      runId: snapshot.runId,
      snapshotRevision: snapshot.snapshotRevision,
      policyRevision: policy.revision,
      actions: [{ ...action, actionId: actionIdentity(decisionId, action) }],
    };
  }
  if (snapshot.closure.blockingEffect?.status === 'dead_letter') {
    const effect = snapshot.closure.blockingEffect;
    const action = {
      type: 'escalateToHuman' as const,
      reasonCode: `blocking_effect_dead_letter:${effect.effectId}`,
      retryBudgetKind: 'effect' as const,
    };
    return {
      decisionId,
      runId: snapshot.runId,
      snapshotRevision: snapshot.snapshotRevision,
      policyRevision: policy.revision,
      actions: [{ ...action, actionId: actionIdentity(decisionId, action) }],
    };
  }
  if (snapshot.closure.deadlock) {
    const action = {
      type: 'escalateToHuman' as const,
      reasonCode: snapshot.closure.deadlock.reasonCode,
    };
    return {
      decisionId,
      runId: snapshot.runId,
      snapshotRevision: snapshot.snapshotRevision,
      policyRevision: policy.revision,
      actions: [{ ...action, actionId: actionIdentity(decisionId, action) }],
    };
  }

  const occupiedSlots = new Set(
    cells.filter((cell) => cell.state === 'running' && cell.slotId)
      .map((cell) => cell.slotId!),
  );
  let activeCount = cells.filter((cell) => cell.state === 'running').length;
  const activeByRole = new Map<string, number>();
  for (const cell of cells) {
    if (cell.state !== 'running') continue;
    activeByRole.set(cell.roleId, (activeByRole.get(cell.roleId) ?? 0) + 1);
  }

  for (const [order, cell] of cells.entries()) {
    const base = { targetWorkId: cell.workId, workEpoch: cell.workEpoch, order };
    if (cell.state === 'failed') {
      proposals.push(cell.failure?.humanRecoverable
        ? { ...base, rank: 10, type: 'escalateToHuman', reasonCode: cell.failure.reasonCode }
        : {
            ...base,
            rank: 0,
            type: 'terminate',
            reasonCode: cell.failure?.reasonCode ?? 'work_failed',
            terminationOutcome: 'failed',
          });
      continue;
    }
    if (cell.state === 'waiting_human') {
      proposals.push(cell.humanResolution === 'resolved'
        ? { ...base, rank: 20, type: 'resume', reasonCode: 'human_resolution_received' }
        : { ...base, rank: 60, type: 'wait', reasonCode: 'waiting_human' });
      continue;
    }
    if (cell.state === 'artifact_submitted' && (cell.gateStatus ?? 'none') === 'none') {
      proposals.push({ ...base, rank: 30, type: 'requestGate', reasonCode: 'artifact_requires_gate' });
      continue;
    }
    if (cell.state === 'retry_pending') {
      const failure = cell.failure;
      if (
        failure?.retryable
        && failure.budget.attemptsUsed < failure.budget.maxAttempts
      ) {
        proposals.push({
          ...base,
          rank: 40,
          type: 'retry',
          reasonCode: failure.reasonCode,
          retryBudgetKind: failure.budget.kind,
        });
      } else if (failure?.humanRecoverable) {
        proposals.push({
          ...base,
          rank: 10,
          type: 'escalateToHuman',
          reasonCode: failure.reasonCode,
        });
      } else {
        proposals.push({
          ...base,
          rank: 0,
          type: 'terminate',
          reasonCode: failure?.reasonCode ?? 'retry_budget_exhausted',
          terminationOutcome: 'failed',
        });
      }
      continue;
    }
    if (cell.state === 'running') {
      proposals.push({
        ...base,
        rank: 60,
        type: 'wait',
        slotId: cell.slotId,
        reasonCode: 'invocation_running',
      });
      continue;
    }
    if (cell.state === 'waiting_gate') {
      proposals.push({ ...base, rank: 60, type: 'wait', reasonCode: 'gate_pending' });
      continue;
    }
    if (cell.state === 'waiting_dependency') {
      proposals.push({ ...base, rank: 60, type: 'wait', reasonCode: 'dependency_pending' });
    }
  }

  for (const [order, cell] of cells.entries()) {
    if (cell.state !== 'ready') continue;
    if (cell.purpose === 'planning') {
      proposals.push({
        targetWorkId: cell.workId,
        workEpoch: cell.workEpoch,
        rank: 45,
        order,
        type: 'initializeGraph',
        reasonCode: 'delivery_task_graph_missing',
      });
      continue;
    }
    const roleLimit = policy.roleCapacity[cell.roleId] ?? policy.maxConcurrent;
    const roleActive = activeByRole.get(cell.roleId) ?? 0;
    const hasGlobalCapacity = activeCount < policy.maxConcurrent;
    const hasRoleCapacity = roleActive < roleLimit;
    const slotId = hasGlobalCapacity && hasRoleCapacity
      ? firstFreeSlot(cell.roleId, roleLimit, occupiedSlots)
      : undefined;
    if (!slotId) {
      proposals.push({
        targetWorkId: cell.workId,
        workEpoch: cell.workEpoch,
        rank: 60,
        order,
        type: 'wait',
        reasonCode: hasGlobalCapacity ? 'role_capacity_exhausted' : 'global_capacity_exhausted',
      });
      continue;
    }
    occupiedSlots.add(slotId);
    activeCount += 1;
    activeByRole.set(cell.roleId, roleActive + 1);
    proposals.push({
      targetWorkId: cell.workId,
      workEpoch: cell.workEpoch,
      rank: 50,
      order,
      type: 'activate',
      slotId,
      reasonCode: 'work_ready',
    });
  }

  if (snapshot.closure.satisfied && snapshot.workCells.every((cell) => cell.state === 'completed')) {
    proposals.push({
      rank: 70,
      order: Number.MAX_SAFE_INTEGER,
      type: 'terminate',
      reasonCode: 'delivery_complete',
      terminationOutcome: 'completed',
    });
  }
  if (
    snapshot.workCells.every((cell) => cell.state === 'completed')
    && snapshot.closure.blockingEffect?.status === 'pending'
  ) {
    proposals.push({
      rank: 60,
      order: Number.MAX_SAFE_INTEGER,
      type: 'wait',
      reasonCode: `blocking_effect_pending:${snapshot.closure.blockingEffect.effectId}`,
      retryBudgetKind: 'effect',
    });
  }

  const actions = proposals
    .sort((left, right) => left.rank - right.rank
      || left.order - right.order
      || (left.targetWorkId ?? '').localeCompare(right.targetWorkId ?? ''))
    .map((proposal) => materializeAction(decisionId, proposal));

  return {
    decisionId,
    runId: snapshot.runId,
    snapshotRevision: snapshot.snapshotRevision,
    policyRevision: policy.revision,
    actions,
  };
}
