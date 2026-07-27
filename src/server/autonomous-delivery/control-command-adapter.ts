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
import { buildDeliveryBundle } from './delivery-bundle';
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
        return this.dispatch(action, context.decision);
      case 'requestGate':
        return this.requestGate(action, context.decision.runId);
      case 'integrate':
        return this.integrate(action, context.decision);
      case 'finalize':
        return this.finalize(context.decision.runId);
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

  private finalize(runId: string): ControlCommandResult {
    const db = this.database ?? getDb();
    return db.transaction((): ControlCommandResult => {
      const snapshot = this.deliveries.getSnapshot(runId);
      if (!snapshot) return { status: 'rejected', reasonCode: 'delivery_run_missing' };
      if (snapshot.bundle) return { status: 'applied' };
      const facts = this.snapshots.build(runId);
      if (!facts.closure.finalizationReady) {
        return { status: 'rejected', reasonCode: 'delivery_finalization_not_ready' };
      }
      let bundle;
      try {
        bundle = buildDeliveryBundle(snapshot, this.now());
      } catch (error) {
        return {
          status: 'rejected',
          reasonCode: error instanceof Error ? error.message : 'delivery_bundle_invalid',
        };
      }
      const updated = this.deliveries.transitionRun({
        runId,
        to: snapshot.run.status,
        stage: 'delivering',
        rootTaskId: snapshot.run.root_task_id ?? undefined,
        bundle,
        expectedRevision: snapshot.run.revision,
        now: this.now(),
      });
      return updated
        ? { status: 'applied' }
        : { status: 'rejected', reasonCode: 'delivery_run_revision_changed' };
    }).immediate();
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

  private dispatch(
    action: ControlAction,
    decision: Parameters<ControlCommandPort['execute']>[1]['decision'],
  ): ControlCommandResult {
    const runId = decision.runId;
    const task = this.taskFor(action);
    if (!task?.agent_id) return { status: 'rejected', reasonCode: 'control_task_owner_missing' };
    const review = action.targetWorkId?.endsWith(':purpose:review') === true;
    const verification = action.targetWorkId?.endsWith(':purpose:verify') === true;
    const targetAgent = action.targetWorkId?.match(/:agent:([^:]+):purpose:/)?.[1]
      ?? task.agent_id;
    const deliveryReview = review && action.targetWorkId?.startsWith('delivery:') === true;
    const gate = review || verification
      ? qualityGateRepo.listForTarget(
          deliveryReview || verification ? 'delivery_run' : 'task',
          deliveryReview || verification ? runId : task.id,
        ).filter((candidate) => candidate.kind === (
          deliveryReview
            ? 'delivery_review'
            : verification
              ? 'acceptance_verification'
              : 'code_review'
        )).at(-1)
      : undefined;
    const db = this.database ?? getDb();
    db.transaction(() => {
      if (!review && !verification && task.status !== 'in_progress') {
        taskRepo.transition(task.id, {
          to: 'in_progress',
          expectedFrom: task.status,
          expectedRevision: task.revision,
        });
      }
      this.inbox.enqueue({
        projectId: task.conversation_id,
        projectAgentId: targetAgent,
        idempotencyKey: action.actionId,
        command: {
          source: review ? 'review_gate' : verification ? 'test_gate' : 'system',
          correlationId: decision.decisionId,
          causationId: action.actionId,
          workId: action.targetWorkId,
          taskId: task.id,
          deliveryRunId: runId,
          contextScenario: action.type === 'retry'
            ? 'recovery'
            : review
              ? 'code_review'
              : verification
                ? 'verification'
                : 'execution',
          prompt: review || verification
            ? [
                review
                  ? deliveryReview
                    ? 'Review the completed delivery.'
                    : `Review task ${task.id}「${task.title}」.`
                  : 'Verify the delivery acceptance criteria.',
                `Quality Gate: ${gate?.id ?? 'missing'}.`,
                'Submit exactly one structured record_gate_decision AgentOutcome with evidence and receipt.',
              ].join(' ')
            : action.type === 'retry'
            ? `恢复任务 ${task.id}「${task.title}」。根据当前权威事实继续，不要复用旧 attempt 的结果。`
            : `执行任务 ${task.id}「${task.title}」。完成后提交结构化 AgentOutcome 和证据。`,
        },
      });
    }).immediate();
    return { status: 'applied' };
  }

  private requestGate(action: ControlAction, runId: string): ControlCommandResult {
    const deliveryGate = action.targetWorkId?.match(
      /^delivery:[^:]+:purpose:request-(delivery_review|acceptance_verification)$/,
    )?.[1] as 'delivery_review' | 'acceptance_verification' | undefined;
    if (deliveryGate) {
      const snapshot = this.deliveries.getSnapshot(runId);
      if (!snapshot) return { status: 'rejected', reasonCode: 'delivery_run_missing' };
      const task = snapshot.run.root_task_id
        ? taskRepo.getById(snapshot.run.root_task_id)
        : taskRepo.getByConversation(snapshot.run.conversation_id)[0];
      if (!task) return { status: 'rejected', reasonCode: 'delivery_root_task_missing' };
      qualityGateRepo.request({
        conversationId: snapshot.run.conversation_id,
        kind: deliveryGate,
        targetType: 'delivery_run',
        targetId: runId,
        artifactRevision: String(task.revision),
        criteria: deliveryGate === 'delivery_review'
          ? { noOpenMaterialFindings: true }
          : { acceptanceCriteria: snapshot.contract.acceptanceCriteria },
        policy: { deliveryPolicy: snapshot.contract.deliveryPolicy },
        actor: { type: 'system', id: 'delivery-control-process-manager' },
        now: this.now(),
      });
      return { status: 'applied' };
    }
    const task = this.taskFor(action);
    if (!task) return { status: 'rejected', reasonCode: 'control_task_missing' };
    qualityGateRepo.request({
      conversationId: task.conversation_id,
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
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
    const deliveryId = action.targetWorkId.match(/^delivery:([^:]+):/)?.[1];
    if (deliveryId) {
      const delivery = this.deliveries.getRun(deliveryId);
      if (delivery?.root_task_id) return taskRepo.getById(delivery.root_task_id);
      if (delivery) return taskRepo.getByConversation(delivery.conversation_id)[0];
    }
    const db = this.database ?? getDb();
    const row = db.prepare(`
      SELECT task_id FROM work_contract
      WHERE work_id=? ORDER BY work_epoch DESC LIMIT 1
    `).get(action.targetWorkId) as { task_id: string | null } | undefined;
    return row?.task_id ? taskRepo.getById(row.task_id) : undefined;
  }
}
