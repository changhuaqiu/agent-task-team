import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { AgentOutcomeType } from '../work-contract/types';
import type {
  RetryBudgetKind,
  DeliveryControlSnapshot,
  WorkCellControlSnapshot,
} from './control-decision';
import { ControlDecisionRepository } from './control-decision-repository';
import { DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import { detectWaitForDeadlock, type WaitForEdge } from './wait-for-graph';
import { resolveGoalCorrelationId, type GoalContract } from './types';
import { DELIVERY_EFFECT_TYPES } from './delivery-effects';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';

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
  revision: number;
  created_at: string;
}

interface A2AWaitFactRow {
  source_work_id: string;
  pass_id: string;
  pass_status: string;
}

interface InvocationBlockFactRow {
  ingestion_id: number;
  work_id: string;
  reason_code: string;
}

interface ControlActionFailureFactRow {
  action_id: string;
  target_work_id: string | null;
  reason_code: string;
}

export interface ControlSnapshotRetryLimits {
  invocation: number;
  effect: number;
  task_rework: number;
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

function deliveryGatePurpose(
  workId: string,
): 'delivery_review' | 'acceptance_verification' | undefined {
  if (!workId.startsWith('delivery:')) return undefined;
  if (workId.endsWith(':purpose:review')) return 'delivery_review';
  if (workId.endsWith(':purpose:verify')) return 'acceptance_verification';
  return undefined;
}

export class RepositoryControlSnapshotBuilder {
  private readonly database?: Database.Database;
  private readonly retryLimitOverrides: Partial<ControlSnapshotRetryLimits>;
  private readonly now: () => Date;

  constructor(options: RepositoryControlSnapshotBuilderOptions = {}) {
    this.database = options.db;
    this.retryLimitOverrides = options.retryLimits ?? {};
    this.now = options.now ?? (() => new Date());
  }

  build(runId: string): DeliveryControlSnapshot {
    const db = this.database ?? getDb();
    const run = db.prepare(`
      SELECT id,conversation_id,root_task_id,revision,delivery_bundle_json,goal_contract_json
      FROM autonomous_delivery_run WHERE id=?
    `).get(runId) as {
      id: string;
      conversation_id: string;
      root_task_id: string | null;
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

    const contract = JSON.parse(run.goal_contract_json) as GoalContract;
    const limits: ControlSnapshotRetryLimits = {
      ...DEFAULT_RETRY_LIMITS,
      invocation: contract.recoveryPolicy.maxAttemptsPerAction,
      task_rework: contract.recoveryPolicy.maxRepairCycles,
      ...this.retryLimitOverrides,
    };
    const gates = db.prepare(`
      SELECT kind,status,created_at FROM quality_gate
      WHERE target_type='delivery_run' AND target_id=?
      ORDER BY created_at,id
    `).all(runId) as Array<{ kind: string; status: string; created_at: string }>;
    const latestGate = (kind: string) =>
      gates.filter((gate) => gate.kind === kind).at(-1);
    const deliveryGateReworkCycles = {
      delivery_review: this.gateReworkCyclesUsed(db, 'delivery_run', runId, 'delivery_review'),
      acceptance_verification: this.gateReworkCyclesUsed(
        db,
        'delivery_run',
        runId,
        'acceptance_verification',
      ),
    };
    const workCells = rows.map((row) => this.cell(db, row, {
      delivery_review: latestGate('delivery_review')?.status,
      acceptance_verification: latestGate('acceptance_verification')?.status,
    }, deliveryGateReworkCycles, limits));
    const representedWork = new Set(workCells.map((cell) => cell.workId));
    const tasks = db.prepare(`
      SELECT id,status,agent_id,dependencies,revision,created_at
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
    const taskAudience = resolveTaskNotificationAudience(run.conversation_id);
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
      if (!representedWork.has(workId)) {
        workCells.push(this.unissuedTaskCell(task, workId, taskStatus, limits));
        representedWork.add(workId);
      }
      if (task.status !== 'in_review') continue;
      const gate = this.currentTaskGate(db, task.id, task.revision);
      if (!gate || (gate.status !== 'requested' && gate.status !== 'evaluating')) continue;
      const sourceCell = workCells.find((cell) => cell.workId === workId);
      if (sourceCell && sourceCell.state !== 'completed') {
        sourceCell.state = 'waiting_gate';
        sourceCell.gateStatus = 'requested';
        delete sourceCell.failure;
        delete sourceCell.slotId;
      }
      const existingReview = workCells.find((cell) =>
        cell.workId.startsWith(`task:${task.id}:agent:`)
        && cell.workId.endsWith(':purpose:review')
      );
      const reviewerId = existingReview?.roleId
        ?? taskAudience.reviewGateAgentIds.find((agentId) => agentId !== task.agent_id);
      const reviewWorkId = existingReview?.workId
        ?? (reviewerId
          ? `task:${task.id}:agent:${reviewerId}:purpose:review`
          : `task:${task.id}:agent:unassigned:purpose:review`);
      if (!representedWork.has(reviewWorkId)) {
        workCells.push({
          workId: reviewWorkId,
          workEpoch: 0,
          roleId: reviewerId ?? 'unassigned',
          purpose: 'review',
          state: reviewerId ? 'ready' : 'waiting_human',
          ...(reviewerId ? {} : { humanResolution: 'required' as const }),
          gateStatus: 'requested',
          priority: 70,
          queuedAt: gate.created_at,
        });
        representedWork.add(reviewWorkId);
      }
      waitEdges.push({
        waiter: workId,
        blocker: reviewWorkId,
        reasonCode: 'quality_gate',
      });
    }
    if (tasks.length > 0 && tasks.every((task) => task.status === 'done')) {
      const root = tasks.find((task) => task.id === run.root_task_id) ?? tasks[0]!;
      const audience = resolveTaskNotificationAudience(run.conversation_id);
      const requirements = [
        ...(contract.deliveryPolicy.requireReview
          ? [{
              kind: 'delivery_review' as const,
              agentId: audience.reviewGateAgentIds[0],
              purpose: 'review' as const,
            }]
          : []),
        {
          kind: 'acceptance_verification' as const,
          agentId: audience.qaAgentIds[0] ?? audience.reviewGateAgentIds[0],
          purpose: 'verify' as const,
        },
      ];
      for (const requirement of requirements) {
        const gate = latestGate(requirement.kind);
        if (!gate) {
          workCells.push({
            workId: `delivery:${runId}:purpose:request-${requirement.kind}`,
            workEpoch: 0,
            roleId: 'delivery-gate-owner',
            purpose: 'gate_request',
            state: 'artifact_submitted',
            gateStatus: 'none',
            priority: 80,
            queuedAt: root.created_at,
          });
          continue;
        }
        const agentId = requirement.agentId;
        const workId = agentId
          ? `delivery:${runId}:agent:${agentId}:purpose:${requirement.purpose}`
          : `delivery:${runId}:purpose:${requirement.purpose}-owner-missing`;
        if (representedWork.has(workId)) continue;
        const base = {
          workId,
          workEpoch: 0,
          roleId: agentId ?? 'unassigned',
          purpose: requirement.kind === 'delivery_review'
            ? 'review' as const
            : 'verification' as const,
          priority: 70,
          queuedAt: gate.created_at,
        };
        if (gate.status === 'passed') {
          workCells.push({ ...base, state: 'completed', gateStatus: 'passed' });
        } else if (!agentId) {
          workCells.push({
            ...base,
            state: 'waiting_human',
            humanResolution: 'required',
          });
        } else if (gate.status === 'changes_requested' || gate.status === 'rejected') {
          workCells.push({
            ...base,
            state: 'retry_pending',
            gateStatus: 'failed',
            failure: {
              reasonCode: `${requirement.kind}_failed`,
              retryable: true,
              humanRecoverable: true,
              budget: retryBudget(
                'task_rework',
                this.gateReworkCyclesUsed(db, 'delivery_run', runId, requirement.kind),
                limits,
              ),
            },
          });
        } else {
          workCells.push({ ...base, state: 'ready', gateStatus: 'requested' });
        }
      }
    }
    const a2aWaitFacts = db.prepare(`
      SELECT
        pass_group.source_work_id,
        pass.id AS pass_id,
        pass.status AS pass_status
      FROM a2a_pass_group pass_group
      JOIN a2a_pass pass ON pass.group_id=pass_group.id
      WHERE pass_group.delivery_run_id=?
        AND pass_group.source_work_id IS NOT NULL
        AND pass_group.status IN ('offered','active')
        AND pass.status IN ('offered','accepted','starting','started')
      ORDER BY pass_group.created_at,pass.created_at,pass.id
    `).all(runId) as A2AWaitFactRow[];
    for (const fact of a2aWaitFacts) {
      waitEdges.push({
        waiter: fact.source_work_id,
        blocker: `a2a-pass:${fact.pass_id}`,
        reasonCode: 'a2a_join',
      });
      const sourceCell = workCells.find((cell) => cell.workId === fact.source_work_id);
      if (!sourceCell || sourceCell.state === 'completed') continue;
      sourceCell.state = 'waiting_dependency';
      delete sourceCell.failure;
      delete sourceCell.slotId;
    }
    const cellByWorkId = new Map(workCells.map((cell) => [cell.workId, cell]));
    for (const source of rows) {
      const sourceCell = cellByWorkId.get(source.work_id);
      if (
        sourceCell?.state !== 'waiting_gate'
        || !source.task_id
        || deliveryGatePurpose(source.work_id)
      ) continue;
      for (const blocker of rows) {
        if (
          blocker.task_id !== source.task_id
          || blocker.work_id === source.work_id
          || !blocker.work_id.endsWith(':purpose:review')
        ) continue;
        const blockerCell = cellByWorkId.get(blocker.work_id);
        if (!blockerCell || blockerCell.state === 'completed') continue;
        waitEdges.push({
          waiter: source.work_id,
          blocker: blocker.work_id,
          reasonCode: 'quality_gate',
        });
      }
    }
    const activeInbox = db.prepare(`
      SELECT inbox.project_agent_id,inbox.command_json,action.slot_id
      FROM agent_inbox_item inbox
      LEFT JOIN delivery_control_action action ON action.id=inbox.idempotency_key
      WHERE inbox.project_id=? AND inbox.status IN ('enqueued','claimed','admitted')
    `).all(run.conversation_id) as Array<{
      project_agent_id: string;
      command_json: string;
      slot_id: string | null;
    }>;
    const inboxWork = new Map<string, string | null>();
    for (const item of activeInbox) {
      try {
        const command = JSON.parse(item.command_json) as {
          workId?: string;
          taskId?: string;
          deliveryRunId?: string;
          source?: string;
        };
        const purpose = command.source === 'review_gate'
          ? 'review'
          : command.source === 'test_gate'
            ? 'verify'
            : 'execute';
        if (command.workId?.trim()) {
          inboxWork.set(command.workId.trim(), item.slot_id);
          continue;
        }
        if (command.taskId) {
          inboxWork.set(
            `task:${command.taskId}:agent:${item.project_agent_id}:purpose:${purpose}`,
            item.slot_id,
          );
          continue;
        }
        if (command.deliveryRunId) {
          inboxWork.set(
            `delivery:${command.deliveryRunId}:agent:${item.project_agent_id}:purpose:${purpose}`,
            item.slot_id,
          );
        }
      } catch {
        // Invalid historical command payload cannot reserve a control slot.
      }
    }
    for (const cell of workCells) {
      if (!inboxWork.has(cell.workId)) continue;
      if (cell.state !== 'ready' && cell.state !== 'retry_pending') continue;
      cell.state = 'running';
      cell.slotId = inboxWork.get(cell.workId) ?? `${cell.roleId}:inbox`;
      delete cell.failure;
    }
    const lastHumanResume = (db.prepare(`
      SELECT COALESCE(MAX(ingestion.ingestion_id),0) AS ingestion_id
      FROM platform_event event
      JOIN platform_event_ingestion ingestion ON ingestion.event_id=event.id
      WHERE event.type='delivery.run.state_changed'
        AND event.aggregate_type='delivery_run'
        AND event.aggregate_id=?
        AND json_extract(event.payload,'$.previousStatus')='waiting_human'
        AND json_extract(event.payload,'$.status')='active'
    `).get(runId) as { ingestion_id: number }).ingestion_id;
    const invocationBlocks = db.prepare(`
      SELECT
        ingestion.ingestion_id,
        json_extract(event.payload,'$.workId') AS work_id,
        json_extract(event.payload,'$.reasonCode') AS reason_code
      FROM platform_event event
      JOIN platform_event_ingestion ingestion ON ingestion.event_id=event.id
      WHERE event.type IN ('runtime.invocation.blocked','context.snapshot.rejected')
        AND event.project_id=?
        AND json_extract(event.payload,'$.deliveryRunId')=?
        AND json_extract(event.payload,'$.workId') IS NOT NULL
        AND ingestion.ingestion_id>?
      ORDER BY ingestion.ingestion_id
    `).all(run.conversation_id, runId, lastHumanResume) as InvocationBlockFactRow[];
    for (const block of invocationBlocks) {
      if (
        block.reason_code !== 'runtime_profile_missing'
        && block.reason_code !== 'required_context_missing'
      ) continue;
      const cell = cellByWorkId.get(block.work_id);
      if (!cell || (cell.state !== 'ready' && cell.state !== 'retry_pending')) continue;
      cell.state = 'failed';
      cell.failure = {
        reasonCode: block.reason_code,
        retryable: false,
        humanRecoverable: true,
        budget: retryBudget('invocation', 0, limits),
      };
      delete cell.slotId;
    }
    const controlFailures = db.prepare(`
      SELECT
        json_extract(event.payload,'$.actionId') AS action_id,
        json_extract(event.payload,'$.targetWorkId') AS target_work_id,
        json_extract(event.payload,'$.reasonCode') AS reason_code
      FROM platform_event event
      JOIN platform_event_ingestion ingestion ON ingestion.event_id=event.id
      WHERE event.type='control.action.failed'
        AND event.project_id=?
        AND json_extract(event.payload,'$.runId')=?
        AND ingestion.ingestion_id>?
      ORDER BY ingestion.ingestion_id
    `).all(run.conversation_id, runId, lastHumanResume) as ControlActionFailureFactRow[];
    let deliveryControlFailure: ControlActionFailureFactRow | undefined;
    for (const failure of controlFailures) {
      if (!failure.target_work_id) {
        deliveryControlFailure = failure;
        continue;
      }
      const cell = cellByWorkId.get(failure.target_work_id);
      if (!cell || cell.state === 'completed') continue;
      cell.state = 'failed';
      cell.failure = {
        reasonCode: `control_action_failed:${failure.reason_code}`,
        retryable: false,
        humanRecoverable: true,
        budget: retryBudget('invocation', 0, limits),
      };
      delete cell.slotId;
    }
    const deadlock = detectWaitForDeadlock(waitEdges);
    const blockingEffects = new DurableEffectOutbox({ db })
      .listApplicableBlocking(runId, run.revision);
    const blockingEffect = blockingEffects.find((effect) => effect.status === 'dead_letter')
      ?? blockingEffects[0];
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
      correlationId: resolveGoalCorrelationId(contract),
      snapshotRevision: new ControlDecisionRepository(db)
        .projectSnapshotRevision(run.conversation_id),
      observedAt: this.now().toISOString(),
      workCells,
      waitForEdges: waitEdges,
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
        ...(deliveryControlFailure ? {
          controlFailure: {
            actionId: deliveryControlFailure.action_id,
            reasonCode: deliveryControlFailure.reason_code,
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
    limits: ControlSnapshotRetryLimits,
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
          budget: retryBudget('task_rework', 0, limits),
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

  private cell(
    db: Database.Database,
    row: WorkCellFactRow,
    deliveryGateStatus: Record<'delivery_review' | 'acceptance_verification', string | undefined>,
    deliveryGateReworkCycles: Record<'delivery_review' | 'acceptance_verification', number>,
    limits: ControlSnapshotRetryLimits,
  ): WorkCellControlSnapshot {
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
    const taskReview = row.work_id.startsWith('task:')
      && row.work_id.endsWith(':purpose:review')
      && row.task_id;
    if (taskReview) {
      if (row.task_status === 'done') {
        return { ...base, purpose: 'review', state: 'completed', gateStatus: 'passed' };
      }
      const task = taskRepoRevision(db, row.task_id!);
      const latestGate = db.prepare(`
        SELECT status,artifact_revision FROM quality_gate
        WHERE target_type='task' AND target_id=? AND kind='code_review'
        ORDER BY updated_at DESC,id DESC LIMIT 1
      `).get(row.task_id) as {
        status: string;
        artifact_revision: string;
      } | undefined;
      const gate = latestGate
        && task
        && (
          latestGate.artifact_revision === String(task.revision)
          || (
            row.task_status === 'in_progress'
            && Number(latestGate.artifact_revision) === task.revision - 1
          )
        )
        ? latestGate
        : undefined;
      const status = gate?.status;
      if (status === 'passed') return { ...base, purpose: 'review', state: 'completed', gateStatus: 'passed' };
      if (status === 'changes_requested' || status === 'rejected') {
        return {
          ...base,
          purpose: 'review',
          state: 'completed',
          gateStatus: 'failed',
        };
      }
      if (
        row.invocation_status === 'starting'
        || row.invocation_status === 'running'
        || row.invocation_status === 'terminating'
      ) return { ...base, purpose: 'review', state: 'running', gateStatus: 'requested' };
      if (row.outcome_type === 'record_gate_decision') {
        return { ...base, purpose: 'review', state: 'waiting_gate', gateStatus: 'requested' };
      }
      if (row.invocation_status === 'terminated') {
        return {
          ...base,
          purpose: 'review',
          state: 'retry_pending',
          gateStatus: 'requested',
          failure: {
            reasonCode: row.invocation_reason_code ?? 'task_gate_invocation_failed',
            retryable: true,
            humanRecoverable: true,
            budget: retryBudget('invocation', this.invocationAttempts(db, row.work_id), limits),
          },
        };
      }
      return { ...base, purpose: 'review', state: 'ready', gateStatus: 'requested' };
    }
    const gateKind = deliveryGatePurpose(row.work_id);
    if (gateKind) {
      const status = deliveryGateStatus[gateKind];
      if (status === 'passed') return { ...base, state: 'completed', gateStatus: 'passed' };
      if (status === 'changes_requested' || status === 'rejected') {
        return {
          ...base,
          state: 'retry_pending',
          gateStatus: 'failed',
          failure: {
            reasonCode: `${gateKind}_failed`,
            retryable: true,
            humanRecoverable: true,
            budget: retryBudget(
              'task_rework',
              deliveryGateReworkCycles[gateKind],
              limits,
            ),
          },
        };
      }
      if (
        row.invocation_status === 'starting'
        || row.invocation_status === 'running'
        || row.invocation_status === 'terminating'
      ) return { ...base, state: 'running', gateStatus: 'requested' };
      if (row.outcome_type === 'record_gate_decision') {
        return { ...base, state: 'waiting_gate', gateStatus: 'requested' };
      }
      if (row.invocation_status === 'terminated') {
        return {
          ...base,
          state: 'retry_pending',
          gateStatus: 'requested',
          failure: {
            reasonCode: row.invocation_reason_code ?? 'gate_invocation_failed',
            retryable: true,
            humanRecoverable: true,
            budget: retryBudget('invocation', this.invocationAttempts(db, row.work_id), limits),
          },
        };
      }
      return { ...base, state: 'ready', gateStatus: 'requested' };
    }
    if (row.task_status === 'done') {
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
          budget: retryBudget(
            'task_rework',
            row.task_id ? this.gateReworkCyclesUsed(db, 'task', row.task_id) : 0,
            limits,
          ),
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

    const currentTask = row.task_id ? taskRepoRevision(db, row.task_id) : undefined;
    const latestTaskGate = row.task_id && currentTask ? db.prepare(`
      SELECT status,artifact_revision FROM quality_gate
      WHERE target_type='task' AND target_id=?
      ORDER BY updated_at DESC,id DESC LIMIT 1
    `).get(row.task_id) as {
      status: string;
      artifact_revision: string;
    } | undefined : undefined;
    const gate = latestTaskGate && currentTask
      && (
        latestTaskGate.artifact_revision === String(currentTask.revision)
        || (
          row.task_status === 'in_progress'
          && Number(latestTaskGate.artifact_revision) === currentTask.revision - 1
          && (
            latestTaskGate.status === 'changes_requested'
            || latestTaskGate.status === 'rejected'
          )
        )
      )
      ? latestTaskGate
      : undefined;
    if (gate?.status === 'requested' || gate?.status === 'evaluating') {
      return { ...base, state: 'waiting_gate', gateStatus: 'requested' };
    }
    if (gate?.status === 'changes_requested' || gate?.status === 'rejected') {
      const attemptsUsed = row.task_id
        ? this.gateReworkCyclesUsed(db, 'task', row.task_id)
        : 0;
      return {
        ...base,
        state: 'retry_pending',
        gateStatus: 'failed',
        failure: {
          reasonCode: 'quality_gate_failed',
          retryable: true,
          humanRecoverable: true,
          budget: retryBudget('task_rework', attemptsUsed, limits),
        },
      };
    }
    if (
      row.task_status === 'in_review'
      && (
        row.outcome_type === 'submit_task_result'
        || row.outcome_type === 'request_review'
      )
    ) {
      return {
        ...base,
        state: 'artifact_submitted',
        gateStatus: gate?.status === 'passed' ? 'passed' : 'none',
      };
    }
    if (row.authority_status === 'closed') {
      return { ...base, state: 'completed' };
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
          budget: retryBudget('invocation', attemptsUsed, limits),
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

  private gateReworkCyclesUsed(
    db: Database.Database,
    targetType: 'task' | 'delivery_run',
    targetId: string,
    kind?: 'delivery_review' | 'acceptance_verification',
  ): number {
    const failures = (db.prepare(`
      SELECT COUNT(*) AS count FROM quality_gate
      WHERE target_type=? AND target_id=?
        AND (? IS NULL OR kind=?)
        AND status IN ('changes_requested','rejected')
    `).get(targetType, targetId, kind ?? null, kind ?? null) as { count: number }).count;
    return Math.max(0, failures - 1);
  }

  private currentTaskGate(
    db: Database.Database,
    taskId: string,
    taskRevision: number,
  ): { status: string; created_at: string } | undefined {
    return db.prepare(`
      SELECT status,created_at FROM quality_gate
      WHERE target_type='task' AND target_id=? AND kind='code_review'
        AND artifact_revision=?
      ORDER BY updated_at DESC,id DESC LIMIT 1
    `).get(taskId, String(taskRevision)) as {
      status: string;
      created_at: string;
    } | undefined;
  }
}

function taskRepoRevision(
  db: Database.Database,
  taskId: string,
): { revision: number } | undefined {
  return db.prepare('SELECT revision FROM task WHERE id=?')
    .get(taskId) as { revision: number } | undefined;
}
