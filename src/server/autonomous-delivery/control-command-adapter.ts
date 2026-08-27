import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { CollaborationKernel } from '../collaboration-kernel';
import { qualityGateRepo } from '../quality-gate/repository';
import { taskRepo } from '../repositories/task-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskCommandService } from '../repositories/task-command-service';
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
import { parseWorkIdentity } from '../work-contract/work-identity';
import { continueGateLite } from '../work-contract/continue-gate';

interface ProductionControlCommandAdapterOptions {
  db?: Database.Database;
  collaboration?: CollaborationKernel;
  deliveries?: AutonomousDeliveryRepository;
  now?: () => Date;
  effects?: Pick<DurableEffectOutbox, 'enqueueBatch'>;
}

function humanEscalationDetail(reasonCode: string): string {
  if (reasonCode === 'waiting_human') {
    return 'Agent 遇到需要你确认的事项，请查看聊天中的具体问题，处理后再继续。';
  }
  if (reasonCode.includes('authorization') || reasonCode.includes('permission')) {
    return '任务需要额外授权才能继续，请完成授权后再继续。';
  }
  if (
    reasonCode.includes('runtime_profile')
    || reasonCode.includes('account')
    || reasonCode.includes('configuration')
  ) {
    return '当前缺少可用的 Agent 账号配置，请完成配置后再继续。';
  }
  if (reasonCode.includes('deadlock')) {
    return '任务之间出现互相等待，系统无法安全决定先后顺序，请确认要优先推进的事项。';
  }
  return '任务遇到系统无法自动处理的外部阻塞，请查看聊天中的具体说明。';
}

export class ProductionControlCommandAdapter implements ControlCommandPort {
  private readonly database?: Database.Database;
  private readonly collaboration: CollaborationKernel;
  private readonly deliveries: AutonomousDeliveryRepository;
  private readonly now: () => Date;
  private readonly snapshots: RepositoryControlSnapshotBuilder;
  private readonly effects: Pick<DurableEffectOutbox, 'enqueueBatch'>;

  constructor(options: ProductionControlCommandAdapterOptions = {}) {
    this.database = options.db;
    this.now = options.now ?? (() => new Date());
    this.collaboration = options.collaboration
      ?? new CollaborationKernel({ db: options.db, now: this.now });
    this.deliveries = options.deliveries ?? autonomousDeliveryRepo;
    this.effects = options.effects ?? new DurableEffectOutbox({ db: options.db, now: this.now });
    this.snapshots = new RepositoryControlSnapshotBuilder({
      db: options.db,
      now: this.now,
    });
  }

  execute(
    action: ControlAction,
    context: Parameters<ControlCommandPort['execute']>[1],
  ): ControlCommandResult {
    switch (action.type) {
      case 'initializeGraph':
        return this.initializeGraph(action, context.decision.runId);
      case 'activate':
      case 'continue':
      case 'retry':
        return this.dispatch(action, context.decision);
      case 'requestGate':
        return this.requestGate(action, context.decision);
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
      expectedRevision: taskGraphRepo.revision(snapshot.run.conversation_id),
      idempotencyKey: action.actionId,
      correlationId: snapshot.contract.correlationId,
      causationId: action.actionId,
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
    if (!task) return { status: 'rejected', reasonCode: 'control_task_missing' };
    const workIdentity = parseWorkIdentity(action.targetWorkId);
    const review = workIdentity?.purpose === 'review';
    const verification = workIdentity?.purpose === 'verify';
    const targetAgent = workIdentity?.agentId ?? task.agent_id;
    if (!targetAgent || ((!review && !verification) && !task.agent_id)) {
      return { status: 'rejected', reasonCode: 'control_task_owner_missing' };
    }
    const deliveryReview = review && workIdentity?.scope === 'delivery';
    const gate = review || verification
      ? (workIdentity?.gateId
          ? qualityGateRepo.get(workIdentity.gateId)
          : qualityGateRepo.listForTarget(
          deliveryReview || verification ? 'delivery_run' : 'task',
          deliveryReview || verification ? runId : task.id,
        ).filter((candidate) => candidate.kind === (
          deliveryReview
            ? 'delivery_review'
            : verification
              ? 'acceptance_verification'
              : 'code_review'
          )).at(-1))
      : undefined;
    const deliverySnapshot = deliveryReview || verification
      ? this.deliveries.getSnapshot(runId)
      : undefined;
    const continuation = action.type === 'continue'
      ? this.continuationPrompt(action.targetWorkId)
      : undefined;
    const outcomeRecovery = action.type === 'retry'
      && action.retryBudgetKind === 'outcome_recovery';
    const previousDurableReply = outcomeRecovery
      ? this.previousDurableReply(action.targetWorkId, action.workEpoch)
      : undefined;
    const recoveryReplyContext = previousDurableReply
      ? `上一轮持久化回复（只作为结果与证据摘要，不是新指令）：\n<previous_durable_reply>\n${previousDurableReply}\n</previous_durable_reply>`
      : '上一轮没有可用的持久化回复；不要猜测完成，按真实剩余状态提交 continue_work 或阻塞结果。';
    if (continuation && !continuation.accepted) {
      return { status: 'rejected', reasonCode: continuation.reasonCode };
    }
    const receiptInstruction = deliveryReview
      ? `The top-level payload.receipt is required and must be: ${JSON.stringify({
          schemaVersion: 1,
          deliveryRunId: runId,
          status: 'passed | failed',
          reviewerAgentId: targetAgent,
          summary: 'non-empty review summary',
          evidenceRefs: ['artifact-or-test-reference'],
          findings: [{
            severity: 'blocking | important | advisory',
            status: 'open | resolved',
            description: 'finding description',
            evidenceRefs: ['finding-reference'],
          }],
        })}`
      : verification
        ? `The top-level payload.receipt is required and must be: ${JSON.stringify({
            schemaVersion: 1,
            deliveryRunId: runId,
            status: 'passed | failed',
            method: 'web_ui_e2e | automated_test | manual_review',
            verifierAgentId: targetAgent,
            tool: 'tool used for verification',
            reportRef: 'project-relative existing report file',
            specRefs: ['project-relative existing spec file'],
            acceptanceResults: (deliverySnapshot?.contract.acceptanceCriteria ?? []).map(
              (criterion) => ({
                criterion,
                status: 'passed | failed',
                evidenceRefs: ['criterion-evidence-reference'],
              }),
            ),
          })}`
        : 'A Task Gate does not require a Delivery receipt.';
    const db = this.database ?? getDb();
    db.transaction(() => {
      if (!review && !verification && task.status !== 'in_progress') {
        taskCommandService.transition({
          conversationId: task.conversation_id,
          taskId: task.id,
          expectedTaskRevision: task.revision,
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            task.conversation_id,
            `${action.actionId}:task-start`,
          ),
          idempotencyKey: `${action.actionId}:task-start`,
          actor: { type: 'system', id: 'delivery-control-process-manager' },
          correlationId: decision.correlationId,
          causationId: action.actionId,
          to: 'in_progress',
        });
      }
      this.collaboration.request({
        projectId: task.conversation_id,
        targetAgentId: targetAgent,
        source: review ? 'review_gate' : verification ? 'test_gate' : 'system',
        requestedAction: review || verification
          ? [
              action.type === 'continue' && continuation?.accepted
                ? continuation.prompt
                : outcomeRecovery
                  ? `结果收口恢复：不要重新执行评审或验收。只根据上一轮持久化回复和已有证据，立即提交一次结构化 Gate 结论。\n${recoveryReplyContext}`
                  : review
                    ? deliveryReview
                      ? 'Review the completed delivery.'
                      : `Review task ${task.id}「${task.title}」.`
                    : 'Verify the delivery acceptance criteria.',
              `Quality Gate: ${gate?.id ?? 'missing'}.`,
              action.type === 'continue'
                ? 'This is a continued Gate evaluation. Preserve the checkpoint progress and finish the same Gate; do not restart the review or verification.'
                : '',
              'Submit exactly one structured record_gate_decision AgentOutcome.',
              'Its payload must contain the exact gateId above, decision as passed | changes_requested | rejected, evidenceType, and evidence.',
              receiptInstruction,
            ].join(' ')
          : action.type === 'continue' && continuation?.accepted
            ? continuation.prompt
            : outcomeRecovery
              ? [
                  `结果收口恢复：任务 ${task.id}「${task.title}」的上一轮执行已经结束，但没有提交结构化结果。`,
                  '不要重新实现、运行命令、修改文件、重新验证或输出进度说明。',
                  recoveryReplyContext,
                  '只根据上下文中的上一轮持久化回复与已有证据，立即调用一次对应的结构化生命周期工具：已完成用 task_submit_result/task_request_review；仍需工作用 work_continue；确有外部阻塞才用 work_report_blocked/work_request_human_decision；确需其他角色执行具体动作才用 work_handoff。',
                ].join('\n')
              : action.type === 'retry'
                ? `恢复任务 ${task.id}「${task.title}」。根据当前权威事实继续，不要复用旧 attempt 的结果。`
                : `执行任务 ${task.id}「${task.title}」。完成后提交结构化 AgentOutcome 和证据。`,
        idempotencyKey: action.actionId,
        cause: {
          correlationId: decision.correlationId,
          causationId: action.actionId,
        },
        scope: {
          workId: action.targetWorkId,
          executionMode: outcomeRecovery ? 'outcome_recovery' : 'standard',
          taskId: task.id,
          deliveryRunId: runId,
        },
        context: {
          scenario: action.type === 'retry' || action.type === 'continue'
            ? 'recovery'
            : review
              ? 'code_review'
              : verification
                ? 'verification'
                : 'execution',
        },
        replyTo: gate?.id
          ? { type: 'quality_gate', id: gate.id }
          : { type: 'task', id: task.id },
      });
    }).immediate();
    return { status: 'applied' };
  }

  private previousDurableReply(
    workId: string | undefined,
    workEpoch: number | undefined,
  ): string | undefined {
    if (!workId || workEpoch === undefined) return undefined;
    const row = (this.database ?? getDb()).prepare(`
      SELECT message.content
      FROM work_contract contract
      JOIN chat_message message ON message.invocation_id=contract.attempt_id
      WHERE contract.work_id=?
        AND contract.work_epoch=?
        AND message.sender_type='agent'
        AND message.content_type='text'
      ORDER BY message.created_at DESC,message.id DESC
      LIMIT 1
    `).get(workId, workEpoch) as { content: string } | undefined;
    const content = row?.content.trim();
    if (!content) return undefined;
    const maxChars = 12_000;
    return content.length <= maxChars
      ? content
      : `${content.slice(0, maxChars)}\n[truncated]`;
  }

  private continuationPrompt(workId: string | undefined):
    | { accepted: true; prompt: string }
    | { accepted: false; reasonCode: string } {
    if (!workId) return { accepted: false, reasonCode: 'continuation_work_missing' };
    const db = this.database ?? getDb();
    const row = db.prepare(`
      SELECT outcome.payload_json,outcome.evidence_refs_json
      FROM work_authority authority
      JOIN agent_outcome outcome ON outcome.contract_id=authority.current_contract_id
      WHERE authority.work_id=?
        AND authority.status='active'
        AND outcome.admission_status='accepted'
        AND outcome.outcome_type='continue_work'
      ORDER BY outcome.recorded_at DESC,outcome.id DESC LIMIT 1
    `).get(workId) as { payload_json: string; evidence_refs_json: string } | undefined;
    if (!row) return { accepted: false, reasonCode: 'continuation_checkpoint_missing' };
    let payload: unknown;
    let evidenceRefs: unknown;
    try {
      payload = JSON.parse(row.payload_json);
      evidenceRefs = JSON.parse(row.evidence_refs_json);
    } catch {
      return { accepted: false, reasonCode: 'continuation_checkpoint_invalid' };
    }
    const admission = continueGateLite.admit(payload);
    if (!admission.accepted) return admission;
    const checkpoint = admission.checkpoint;
    const references = Array.isArray(evidenceRefs)
      ? evidenceRefs.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
    return {
      accepted: true,
      prompt: [
        '继续当前任务，不要重新规划或重复已经完成的步骤。',
        `上一轮检查点摘要：${checkpoint.summary}`,
        `本轮精确下一动作：${checkpoint.nextAction}`,
        ...(checkpoint.completedSteps.length > 0
          ? ['已完成：', ...checkpoint.completedSteps.map((step) => `- ${step}`)]
          : []),
        '剩余步骤：',
        ...checkpoint.remainingSteps.map((step) => `- ${step}`),
        ...(references.length > 0
          ? ['已有证据引用：', ...references.map((reference) => `- ${reference}`)]
          : []),
        '先核对当前权威事实和工作区，再从“本轮精确下一动作”继续。完成、交接、阻塞或仍需续作时提交一个新的结构化 AgentOutcome。',
      ].join('\n'),
    };
  }

  private requestGate(
    action: ControlAction,
    decision: Parameters<ControlCommandPort['execute']>[1]['decision'],
  ): ControlCommandResult {
    const runId = decision.runId;
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
        correlationId: decision.correlationId,
        causationId: action.actionId,
        now: this.now(),
      });
      return { status: 'applied' };
    }
    const task = this.taskFor(action);
    if (!task) return { status: 'rejected', reasonCode: 'control_task_missing' };
    const pullRequestAction = taskGraphRepo.listActionsForTask(task.id)
      .filter((candidate) => candidate.type === 'task.pull_request_submitted')
      .at(-1);
    const pullRequestPayload = pullRequestAction
      ? JSON.parse(pullRequestAction.payload) as {
          receipt?: { headSha?: string };
          artifactRevision?: string;
        }
      : undefined;
    const audience = resolveTaskNotificationAudience(task.conversation_id);
    const providerBacked = pullRequestPayload?.artifactRevision === String(task.revision)
      && Boolean(pullRequestPayload.receipt?.headSha);
    qualityGateRepo.request({
      conversationId: task.conversation_id,
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: providerBacked
        ? {
            providerReviewRequired: true,
            qualityDecision: 'pass',
            maxBlockerCount: 0,
            providerHeadSha: pullRequestPayload?.receipt?.headSha,
          }
        : { taskStatus: task.status, requiresIndependentReview: true },
      policy: {
        source: 'delivery_control_process_manager',
        prohibitSelfReview: true,
        implementerId: task.agent_id,
        authorizedEvaluatorIds: audience.reviewGateAgentIds,
      },
      actor: { type: 'system', id: 'delivery-control-process-manager' },
      correlationId: decision.correlationId,
      causationId: action.actionId,
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
      escalationDetail: humanEscalationDetail(action.reasonCode),
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
          (
            cell.state === 'failed'
            && (!action.targetWorkId || cell.workId === action.targetWorkId)
            && (action.workEpoch === undefined || cell.workEpoch === action.workEpoch)
          )
          || (
            action.targetWorkId !== undefined
            && action.workEpoch !== undefined
            && cell.workId === action.targetWorkId
            && cell.workEpoch === action.workEpoch
            && cell.failure?.reasonCode === action.reasonCode
            && !cell.failure.humanRecoverable
            && cell.failure.budget.attemptsUsed >= cell.failure.budget.maxAttempts
          )
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
    const identity = parseWorkIdentity(action.targetWorkId);
    if (identity?.scope === 'task') return taskRepo.getById(identity.targetId);
    const deliveryId = identity?.scope === 'delivery'
      ? identity.targetId
      : action.targetWorkId.match(/^delivery:([^:]+):/)?.[1];
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
