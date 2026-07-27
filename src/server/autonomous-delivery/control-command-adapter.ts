import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { qualityGateRepo } from '../quality-gate/repository';
import { taskRepo } from '../repositories/task-repo';
import { groupChatTaskFlow } from '../task-flow/group-chat-task-flow';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import { AutonomousDeliveryRepository, autonomousDeliveryRepo } from './repository';
import { buildGoalTaskDescription } from './goal-task-description';
import {
  DurableEffectOutbox,
  type EnqueueDurableEffectBatch,
} from '../platform-events/durable-effect-outbox';
import { DELIVERY_EFFECT_TYPES } from './delivery-effects';
import type { ControlAction } from './control-decision';
import type {
  ControlCommandPort,
  ControlCommandResult,
} from './control-process-manager';
import { RepositoryControlSnapshotBuilder } from './control-snapshot-builder';

export interface ProductionControlCommandAdapterOptions {
  db?: Database.Database;
  inbox?: AgentInbox;
  deliveries?: AutonomousDeliveryRepository;
  now?: () => Date;
  effects?: Pick<DurableEffectOutbox, 'enqueueBatch'>;
}

function taskIdFromWorkId(workId: string): string | undefined {
  const match = /^task:(.+):agent:[^:]+:purpose:[^:]+$/.exec(workId);
  return match?.[1];
}

export class ProductionControlCommandAdapter implements ControlCommandPort {
  private readonly database?: Database.Database;
  private readonly inbox: AgentInbox;
  private readonly deliveries: AutonomousDeliveryRepository;
  private readonly now: () => Date;
  private readonly snapshots: RepositoryControlSnapshotBuilder;
  private readonly effects: Pick<DurableEffectOutbox, 'enqueueBatch'>;

  constructor(options: ProductionControlCommandAdapterOptions = {}) {
    this.database = options.db;
    this.inbox = options.inbox ?? new AgentInbox({ db: options.db });
    this.deliveries = options.deliveries ?? autonomousDeliveryRepo;
    this.now = options.now ?? (() => new Date());
    this.effects = options.effects ?? new DurableEffectOutbox({ db: options.db, now: this.now });
    this.snapshots = new RepositoryControlSnapshotBuilder({
      db: options.db,
      now: this.now,
    });
  }

  async execute(
    action: ControlAction,
    context: Parameters<ControlCommandPort['execute']>[1],
  ): Promise<ControlCommandResult> {
    switch (action.type) {
      case 'initializeGraph':
        return this.initializeGraph(action, context.decision.runId);
      case 'activate':
      case 'retry':
        return this.dispatch(action, context.decision.runId);
      case 'requestGate':
        return this.requestGate(action);
      case 'integrate':
        return this.integrate(action, context.decision);
      case 'escalateToHuman':
        return this.escalate(action, context.decision.runId);
      case 'terminate':
        return this.terminate(action, context.decision.runId);
      case 'resume':
        return { status: 'rejected', reasonCode: 'human_resume_command_required' };
      case 'wait':
        return { status: 'applied' };
    }
  }

  private integrate(
    action: ControlAction,
    decision: Parameters<ControlCommandPort['execute']>[1]['decision'],
  ): ControlCommandResult {
    const runId = decision.runId;
    const snapshot = this.deliveries.getSnapshot(runId);
    if (!snapshot) return { status: 'rejected', reasonCode: 'delivery_run_missing' };
    if (!snapshot.contract.deliveryPolicy.requireMerge) {
      return { status: 'rejected', reasonCode: 'delivery_integration_not_required' };
    }
    if (
      !snapshot.contract.authorization.allowPush
      || !snapshot.contract.authorization.allowPullRequest
      || !snapshot.contract.authorization.allowAutoMerge
    ) {
      return { status: 'rejected', reasonCode: 'missing_authorization' };
    }
    const db = this.database ?? getDb();
    const source = db.prepare(`
      SELECT event.id FROM platform_event_ingestion ingestion
      JOIN platform_event event ON event.id=ingestion.event_id
      WHERE ingestion.ingestion_id=? AND event.project_id=?
    `).get(
      decision.snapshotRevision,
      snapshot.run.conversation_id,
    ) as { id: string } | undefined;
    if (!source) {
      return { status: 'rejected', reasonCode: 'control_source_event_missing' };
    }
    const batch: EnqueueDurableEffectBatch = {
      sourceEventId: source.id,
      laneKey: `delivery:${runId}:provider`,
      effects: [{
        type: DELIVERY_EFFECT_TYPES.githubIntegrate,
        targetKey: runId,
        payload: { runId },
        idempotencyKey: `${action.actionId}:github-integrate`,
        criticality: 'blocking',
        deliveryRunId: runId,
        appliesFromRevision: snapshot.run.revision,
        sourceActionId: action.actionId,
      }],
    };
    this.effects.enqueueBatch(batch);
    return { status: 'applied' };
  }

  private initializeGraph(action: ControlAction, runId: string): ControlCommandResult {
    const snapshot = this.deliveries.getSnapshot(runId);
    if (!snapshot) return { status: 'rejected', reasonCode: 'delivery_run_missing' };
    const existing = taskRepo.getByConversation(snapshot.run.conversation_id)[0];
    const ownerAgentId = existing?.agent_id
      ?? resolveTaskNotificationAudience(snapshot.run.conversation_id).coordinatorAgentIds[0];
    if (!ownerAgentId) {
      return { status: 'rejected', reasonCode: 'delivery_planning_owner_missing' };
    }
    const task = existing ?? groupChatTaskFlow.createRootTask({
      conversationId: snapshot.run.conversation_id,
      title: snapshot.contract.goal,
      description: buildGoalTaskDescription(snapshot.contract),
      ownerAgentId,
      actorId: 'delivery-control-process-manager',
      actorType: 'system',
    }).task;
    const current = this.deliveries.getSnapshot(runId);
    if (!current) return { status: 'rejected', reasonCode: 'delivery_run_missing' };
    if (current.run.root_task_id === task.id) return { status: 'applied' };
    const updated = this.deliveries.transitionRun({
      runId,
      to: current.run.status,
      stage: 'planning',
      rootTaskId: task.id,
      expectedRevision: current.run.revision,
      now: this.now(),
    });
    return updated
      ? { status: 'applied' }
      : { status: 'rejected', reasonCode: `delivery_root_task_revision_changed:${action.actionId}` };
  }

  private dispatch(action: ControlAction, runId: string): ControlCommandResult {
    const task = this.taskFor(action);
    if (!task?.agent_id) return { status: 'rejected', reasonCode: 'control_task_owner_missing' };
    this.inbox.enqueue({
      projectId: task.conversation_id,
      projectAgentId: task.agent_id,
      idempotencyKey: action.actionId,
      command: {
        source: 'system',
        taskId: task.id,
        deliveryRunId: runId,
        contextScenario: action.type === 'retry' ? 'recovery' : 'execution',
        prompt: action.type === 'retry'
          ? `恢复任务 ${task.id}「${task.title}」。根据当前权威事实继续，不要复用旧 attempt 的结果。`
          : `执行任务 ${task.id}「${task.title}」。完成后提交结构化 AgentOutcome 和证据。`,
      },
    });
    return { status: 'applied' };
  }

  private requestGate(action: ControlAction): ControlCommandResult {
    const task = this.taskFor(action);
    if (!task) return { status: 'rejected', reasonCode: 'control_task_missing' };
    qualityGateRepo.request({
      conversationId: task.conversation_id,
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: task.updated_at,
      criteria: { taskStatus: task.status, requiresIndependentReview: true },
      policy: { source: 'delivery_control_process_manager' },
      actor: { type: 'system', id: 'delivery-control-process-manager' },
      now: this.now(),
    });
    return { status: 'applied' };
  }

  private escalate(action: ControlAction, runId: string): ControlCommandResult {
    const snapshot = this.deliveries.getSnapshot(runId);
    if (!snapshot) return { status: 'rejected', reasonCode: 'delivery_run_missing' };
    if (snapshot.run.status === 'waiting_human') return { status: 'applied' };
    const transitioned = this.deliveries.transitionRun({
      runId,
      to: 'waiting_human',
      stage: snapshot.run.current_stage,
      expectedRevision: snapshot.run.revision,
      escalationCode: action.reasonCode,
      escalationDetail: `ControlAction ${action.actionId} requires human resolution`,
      now: this.now(),
    });
    return transitioned
      ? { status: 'applied' }
      : { status: 'rejected', reasonCode: 'delivery_run_revision_changed' };
  }

  private terminate(action: ControlAction, runId: string): ControlCommandResult {
    const db = this.database ?? getDb();
    return db.transaction((): ControlCommandResult => {
      const delivery = this.deliveries.getSnapshot(runId);
      if (!delivery) return { status: 'rejected', reasonCode: 'delivery_run_missing' };
      const facts = this.snapshots.build(runId);
      const to = action.terminationOutcome === 'completed' ? 'completed' : 'failed';
      if (
        to === 'completed'
        && (
          !facts.closure.satisfied
          || facts.workCells.some((cell) => cell.state !== 'completed')
        )
      ) {
        return { status: 'rejected', reasonCode: 'delivery_closure_not_satisfied' };
      }
      if (
        to === 'failed'
        && !facts.closure.unrecoverableReasonCode
        && !facts.workCells.some((cell) => (
          cell.state === 'failed'
          && (!action.targetWorkId || cell.workId === action.targetWorkId)
        ))
      ) {
        return { status: 'rejected', reasonCode: 'delivery_failure_not_authoritative' };
      }
      const transitioned = this.deliveries.transitionRun({
        runId,
        to,
        stage: delivery.run.current_stage,
        expectedRevision: delivery.run.revision,
        escalationCode: to === 'failed' ? action.reasonCode : undefined,
        now: this.now(),
      });
      return transitioned
        ? { status: 'applied' }
        : { status: 'rejected', reasonCode: 'delivery_run_revision_changed' };
    }).immediate();
  }

  private taskFor(action: ControlAction) {
    if (!action.targetWorkId) return undefined;
    const direct = taskIdFromWorkId(action.targetWorkId);
    if (direct) return taskRepo.getById(direct);
    const db = this.database ?? getDb();
    const row = db.prepare(`
      SELECT task_id FROM work_contract
      WHERE work_id=? ORDER BY work_epoch DESC LIMIT 1
    `).get(action.targetWorkId) as { task_id: string | null } | undefined;
    return row?.task_id ? taskRepo.getById(row.task_id) : undefined;
  }
}
