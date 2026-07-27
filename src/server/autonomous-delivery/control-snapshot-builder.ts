import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { AgentOutcomeType } from '../work-contract/types';
import type {
  RetryBudgetKind,
  SupervisorControlSnapshot,
  WorkCellControlSnapshot,
} from './control-decision';
import { ControlDecisionRepository } from './control-decision-repository';
import { DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import { detectWaitForDeadlock, type WaitForEdge } from './wait-for-graph';
import type { GoalContract } from './types';
import { DELIVERY_EFFECT_TYPES } from './delivery-effects';

interface WorkCellFactRow {
  work_id: string;
  current_epoch: number;
  authority_status: 'active' | 'closed';
  contract_id: string;
  agent_id: string;
  role_json: string;
  created_at: string;
  task_id: string | null;
  task_status: string | null;
  invocation_id: string | null;
  invocation_status: string | null;
  invocation_outcome: string | null;
  invocation_reason_code: string | null;
  outcome_type: AgentOutcomeType | null;
}

interface TaskFactRow {
  id: string;
  status: string;
  agent_id: string;
  dependencies: string | null;
  created_at: string;
}

export interface ControlSnapshotRetryLimits {
  invocation: number;
  effect: number;
  task_rework: number;
  agent_local: number;
}

export interface RepositoryControlSnapshotBuilderOptions {
  db?: Database.Database;
  retryLimits?: Partial<ControlSnapshotRetryLimits>;
  now?: () => Date;
}

const DEFAULT_RETRY_LIMITS: ControlSnapshotRetryLimits = {
  invocation: 3,
  effect: 5,
  task_rework: 2,
  agent_local: 3,
};

function roleId(row: WorkCellFactRow): string {
  try {
    const role = JSON.parse(row.role_json) as Record<string, unknown>;
    for (const candidate of [role.id, role.roleId, role.name]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  } catch {
    // The contract remains queryable even if historical role metadata is malformed.
  }
  return row.agent_id;
}

function retryBudget(
  kind: RetryBudgetKind,
  attemptsUsed: number,
  limits: ControlSnapshotRetryLimits,
) {
  return { kind, attemptsUsed, maxAttempts: limits[kind] };
}

export class RepositoryControlSnapshotBuilder {
  private readonly database?: Database.Database;
  private readonly limits: ControlSnapshotRetryLimits;
  private readonly now: () => Date;

  constructor(options: RepositoryControlSnapshotBuilderOptions = {}) {
    this.database = options.db;
    this.limits = { ...DEFAULT_RETRY_LIMITS, ...options.retryLimits };
    this.now = options.now ?? (() => new Date());
  }

  build(runId: string): SupervisorControlSnapshot {
    const db = this.database ?? getDb();
    const run = db.prepare(`
      SELECT id,conversation_id,revision,delivery_bundle_json,goal_contract_json
      FROM autonomous_delivery_run WHERE id=?
    `).get(runId) as {
      id: string;
      conversation_id: string;
      revision: number;
      delivery_bundle_json: string | null;
      goal_contract_json: string;
    } | undefined;
    if (!run) throw new Error(`Delivery run not found: ${runId}`);

    const rows = db.prepare(`
      SELECT
        authority.work_id,
        authority.current_epoch,
        authority.status AS authority_status,
        contract.id AS contract_id,
        contract.agent_id,
        contract.role_json,
        contract.created_at,
        contract.task_id,
        task.status AS task_status,
        invocation.id AS invocation_id,
        invocation.status AS invocation_status,
        invocation.outcome AS invocation_outcome,
        invocation.reason_code AS invocation_reason_code,
        (
          SELECT outcome.outcome_type FROM agent_outcome outcome
          WHERE outcome.contract_id=contract.id
            AND outcome.admission_status='accepted'
            AND outcome.outcome_type<>'continue_work'
          ORDER BY outcome.recorded_at DESC,outcome.id DESC LIMIT 1
        ) AS outcome_type
      FROM work_authority authority
      JOIN work_contract contract ON contract.id=authority.current_contract_id
      LEFT JOIN task ON task.id=contract.task_id
      LEFT JOIN invocation ON invocation.work_contract_id=contract.id
      WHERE contract.delivery_run_id=?
      ORDER BY contract.created_at,authority.work_id
    `).all(runId) as WorkCellFactRow[];

    const workCells = rows.map((row) => this.cell(db, row));
    const representedWork = new Set(workCells.map((cell) => cell.workId));
    const tasks = db.prepare(`
      SELECT id,status,agent_id,dependencies,created_at
      FROM task WHERE conversation_id=? ORDER BY created_at,id
    `).all(run.conversation_id) as TaskFactRow[];
    if (tasks.length === 0 && workCells.length === 0) {
      workCells.push({
        workId: `delivery:${runId}:purpose:initialize-task-graph`,
        workEpoch: 0,
        roleId: 'delivery-planning',
        purpose: 'planning',
        state: 'ready',
        priority: 100,
        queuedAt: this.now().toISOString(),
      });
    }
    const taskStatus = new Map(tasks.map((task) => [task.id, task.status]));
    const taskWorkId = new Map(tasks.map((task) => [
      task.id,
      `task:${task.id}:agent:${task.agent_id}:purpose:execute`,
    ]));
    const waitEdges: WaitForEdge[] = [];
    for (const task of tasks) {
      if (!task.agent_id.trim()) continue;
      const workId = `task:${task.id}:agent:${task.agent_id}:purpose:execute`;
      let dependencies: string[] = [];
      try {
        dependencies = task.dependencies ? JSON.parse(task.dependencies) as string[] : [];
      } catch {
        // Malformed dependency facts remain waiting but do not invent graph edges.
      }
      for (const dependency of dependencies) {
        if (taskStatus.get(dependency) === 'done') continue;
        const blocker = taskWorkId.get(dependency);
        if (blocker) {
          waitEdges.push({ waiter: workId, blocker, reasonCode: 'task_dependency' });
        }
      }
      if (representedWork.has(workId)) continue;
      workCells.push(this.unissuedTaskCell(task, workId, taskStatus));
    }
    const deadlock = detectWaitForDeadlock(waitEdges);
    const blockingEffects = new DurableEffectOutbox({ db })
      .listApplicableBlocking(runId, run.revision);
    const blockingEffect = blockingEffects.find((effect) => effect.status === 'dead_letter')
      ?? blockingEffects[0];
    const contract = JSON.parse(run.goal_contract_json) as GoalContract;
    const gates = db.prepare(`
      SELECT kind,status FROM quality_gate
      WHERE target_type='delivery_run' AND target_id=?
      ORDER BY created_at,id
    `).all(runId) as Array<{ kind: string; status: string }>;
    const latestGateStatus = (kind: string) =>
      gates.filter((gate) => gate.kind === kind).at(-1)?.status;
    const gatesSatisfied = (
      !contract.deliveryPolicy.requireReview
      || latestGateStatus('delivery_review') === 'passed'
    ) && latestGateStatus('acceptance_verification') === 'passed';
    const merged = Boolean(db.prepare(`
      SELECT 1 FROM autonomous_delivery_receipt
      WHERE run_id=? AND kind='provider.github.pull_request.merged' AND status='succeeded'
      LIMIT 1
    `).get(runId));
    const integrationEffect = db.prepare(`
      SELECT status FROM platform_effect_outbox
      WHERE delivery_run_id=? AND effect_type=?
        AND status NOT IN ('cancelled','superseded')
      ORDER BY created_at DESC,id DESC LIMIT 1
    `).get(runId, DELIVERY_EFFECT_TYPES.githubIntegrate) as { status: string } | undefined;
    return {
      runId,
      snapshotRevision: new ControlDecisionRepository(db)
        .projectSnapshotRevision(run.conversation_id),
      observedAt: this.now().toISOString(),
      workCells,
      closure: {
        satisfied: workCells.length > 0
          && workCells.every((cell) => cell.state === 'completed')
          && blockingEffects.length === 0
          && gatesSatisfied
          && (!contract.deliveryPolicy.requireMerge || merged)
          && Boolean(run.delivery_bundle_json),
        ...(blockingEffect ? {
          blockingEffect: {
            effectId: blockingEffect.id,
            status: blockingEffect.status === 'dead_letter'
              ? 'dead_letter' as const
              : 'pending' as const,
            attemptsUsed: blockingEffect.attemptCount,
            maxAttempts: blockingEffect.maxAttempts,
          },
        } : {}),
        ...(deadlock ? {
          deadlock: {
            cycle: deadlock.cycle,
            reasonCode: `wait_for_deadlock:${deadlock.cycle.join('->')}`,
          },
        } : {}),
        integration: {
          required: contract.deliveryPolicy.requireMerge,
          gatesSatisfied,
          merged,
          effectScheduled: Boolean(integrationEffect),
        },
        finalizationReady: workCells.length > 0
          && workCells.every((cell) => cell.state === 'completed')
          && gatesSatisfied
          && blockingEffects.length === 0
          && (!contract.deliveryPolicy.requireMerge || merged)
          && !run.delivery_bundle_json,
      },
    };
  }

  private unissuedTaskCell(
    task: TaskFactRow,
    workId: string,
    taskStatus: ReadonlyMap<string, string>,
  ): WorkCellControlSnapshot {
    const base = {
      workId,
      workEpoch: 0,
      roleId: task.agent_id,
      purpose: 'execution' as const,
      priority: 50,
      queuedAt: task.created_at,
    };
    if (task.status === 'done') return { ...base, state: 'completed' };
    if (task.status === 'cancelled') {
      return {
        ...base,
        state: 'failed',
        failure: {
          reasonCode: 'task_cancelled',
          retryable: false,
          humanRecoverable: false,
          budget: retryBudget('task_rework', 0, this.limits),
        },
      };
    }
    if (task.status === 'blocked') {
      return { ...base, state: 'waiting_human', humanResolution: 'required' };
    }
    if (task.status === 'in_review') {
      return { ...base, state: 'artifact_submitted', gateStatus: 'none' };
    }
    let dependencies: string[] = [];
    try {
      dependencies = task.dependencies ? JSON.parse(task.dependencies) as string[] : [];
    } catch {
      return { ...base, state: 'waiting_dependency' };
    }
    if (
      task.status === 'proposed'
      || dependencies.some((dependency) => taskStatus.get(dependency) !== 'done')
    ) {
      return { ...base, state: 'waiting_dependency' };
    }
    return { ...base, state: 'ready' };
  }

  private cell(db: Database.Database, row: WorkCellFactRow): WorkCellControlSnapshot {
    const base = {
      workId: row.work_id,
      workEpoch: row.current_epoch,
      roleId: roleId(row),
      purpose: 'execution' as const,
      // Priority is policy input, not a Task status concern. Until an explicit
      // scheduling policy assigns one, every Work Cell starts neutral.
      priority: 50,
      queuedAt: row.created_at,
    };
    if (row.authority_status === 'closed' || row.task_status === 'done') {
      return { ...base, state: 'completed' };
    }
    if (row.task_status === 'cancelled') {
      return {
        ...base,
        state: 'failed',
        failure: {
          reasonCode: 'task_cancelled',
          retryable: false,
          humanRecoverable: false,
          budget: retryBudget('task_rework', this.taskReworkAttempts(db, row.task_id), this.limits),
        },
      };
    }
    if (row.outcome_type === 'report_blocked' || row.outcome_type === 'request_human_decision') {
      return {
        ...base,
        state: 'waiting_human',
        humanResolution: 'required',
      };
    }

    const gate = row.task_id ? db.prepare(`
      SELECT status FROM quality_gate
      WHERE target_type='task' AND target_id=?
      ORDER BY updated_at DESC,id DESC LIMIT 1
    `).get(row.task_id) as { status: string } | undefined : undefined;
    if (gate?.status === 'requested' || gate?.status === 'evaluating') {
      return { ...base, state: 'waiting_gate', gateStatus: 'requested' };
    }
    if (gate?.status === 'changes_requested' || gate?.status === 'rejected') {
      const attemptsUsed = this.taskReworkAttempts(db, row.task_id);
      return {
        ...base,
        state: 'retry_pending',
        gateStatus: 'failed',
        failure: {
          reasonCode: 'quality_gate_failed',
          retryable: true,
          humanRecoverable: true,
          budget: retryBudget('task_rework', attemptsUsed, this.limits),
        },
      };
    }
    if (
      row.outcome_type === 'submit_task_result'
      || row.outcome_type === 'request_review'
      || row.outcome_type === 'record_gate_decision'
    ) {
      return {
        ...base,
        state: 'artifact_submitted',
        gateStatus: gate?.status === 'passed' ? 'passed' : 'none',
      };
    }
    if (
      row.invocation_status === 'starting'
      || row.invocation_status === 'running'
      || row.invocation_status === 'terminating'
    ) {
      return {
        ...base,
        state: 'running',
        slotId: `${roleId(row)}:${row.agent_id}`,
      };
    }
    if (row.invocation_status === 'terminated') {
      const attemptsUsed = this.invocationAttempts(db, row.work_id);
      return {
        ...base,
        state: 'retry_pending',
        failure: {
          reasonCode: row.invocation_reason_code
            ?? (row.invocation_outcome === 'completed'
              ? 'invocation_completed_without_outcome'
              : 'invocation_failed'),
          retryable: row.invocation_outcome !== 'cancelled',
          humanRecoverable: true,
          budget: retryBudget('invocation', attemptsUsed, this.limits),
        },
      };
    }
    return { ...base, state: 'ready' };
  }

  private invocationAttempts(db: Database.Database, workId: string): number {
    return (db.prepare(`
      SELECT COUNT(*) AS count FROM invocation
      WHERE work_id=? AND status='terminated'
    `).get(workId) as { count: number }).count;
  }

  private taskReworkAttempts(db: Database.Database, taskId: string | null): number {
    if (!taskId) return 0;
    return (db.prepare(`
      SELECT COUNT(*) AS count FROM quality_gate
      WHERE target_type='task' AND target_id=?
        AND status IN ('changes_requested','rejected')
    `).get(taskId) as { count: number }).count;
  }
}
