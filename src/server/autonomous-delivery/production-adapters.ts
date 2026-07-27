import type { Server as IOServer } from 'socket.io';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import { invocationRepo, type InvocationRow } from '../repositories/invocation-repo';
import { proofLogRepo, type ProofEventRow } from '../repositories/proof-log-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskRepo, type TaskRow } from '../repositories/task-repo';
import { sessionRepo } from '../repositories/session-repo';
import { groupChatTaskFlow } from '../task-flow/group-chat-task-flow';
import { resolveAutonomyGuardWakeups } from '../task-flow/autonomy-guard';
import {
  emitTaskState,
  resolveTaskNotificationAudience,
} from '../task-flow/task-notification-publisher';
import { submitTaskWakeupToHarness } from '../harness/registry';
import type { TaskWakeup } from '../task-flow/task-wakeup';
import type { ObservedDeliveryFacts } from './policy';
import type {
  AcceptanceReviewReceipt,
  AcceptanceVerificationReceipt,
  ClaimedDeliveryAction,
  DeliveryActionKind,
  DeliveryBundle,
  DeliveryRunSnapshot,
} from './types';
import {
  failedReviewReceipt,
  reviewReceiptFromProof,
} from './review-receipt';
import {
  failedVerificationReceipt,
  verificationReceiptFromProof,
} from './verification-receipt';
import type {
  DeliveryActionPort,
  DeliveryExecutionResult,
  DeliveryFactsPort,
} from './supervisor';
import { autonomousDeliveryRepo } from './repository';
import {
  ProviderActionError,
  type ProviderActionPort,
} from './provider-actions';
import { buildGoalTaskDescription } from './goal-task-description';
import { qualityGateRepo } from '../quality-gate/repository';
import type {
  QualityGateActor,
  QualityGateKind,
  QualityGateRow,
} from '../quality-gate/types';

const TERMINAL_TASK_STATUSES = new Set(['done', 'cancelled']);
const ACTIVE_ENVELOPE_STATUSES = new Set(['drafted', 'validated', 'routed', 'sent']);
const RECOVERABLE_ENVELOPE_STATUSES = new Set(['rejected', 'expired']);

function scenarioForDeliveryAction(kind: DeliveryActionKind): 'planning' | 'execution' | 'code_review' | 'verification' | 'recovery' {
  if (kind === 'request_review') return 'code_review';
  if (kind === 'run_verification') return 'verification';
  if (kind === 'repair_review' || kind === 'repair_verification') return 'recovery';
  if (kind === 'plan_goal') return 'planning';
  return 'execution';
}

function metadataOf(proof: ProofEventRow): Record<string, unknown> {
  if (!proof.metadata) return {};
  try {
    const parsed = JSON.parse(proof.metadata);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function terminalTaskFailure(tasks: TaskRow[]): TaskRow | undefined {
  return tasks.find((task) => task.status === 'cancelled');
}

function acceptedDeliveryEvidence(proofs: ProofEventRow[]): ProofEventRow[] {
  return proofs.filter((proof) =>
    proof.event_type === 'task_graph.gate_evidence.accepted'
    && metadataOf(proof).gateName === 'delivery_evidence'
  );
}

interface ExecutionRecovery {
  wakeup?: TaskWakeup;
  exhaustedTask?: TaskRow;
}

function executionRecovery(
  tasks: TaskRow[],
  envelopes: ReturnType<typeof executionEnvelopeRepo.listByConversation>,
  invocations: InvocationRow[],
  maxRecoveries: number,
): ExecutionRecovery {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const candidates = [
    ...envelopes
      .filter((envelope) => envelope.task_id && RECOVERABLE_ENVELOPE_STATUSES.has(envelope.status))
      .map((envelope) => ({
        id: envelope.id,
        taskId: envelope.task_id!,
        agentId: envelope.to_agent_id,
        updatedAt: envelope.updated_at,
        completedWithoutProgress: false,
      })),
    ...invocations
      .filter((invocation) => invocation.task_id && invocation.status === 'terminated')
      .map((invocation) => ({
        id: invocation.id,
        taskId: invocation.task_id!,
        agentId: invocation.agent_id,
        updatedAt: invocation.updated_at,
        completedWithoutProgress: invocation.outcome === 'completed',
      })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const candidate of candidates) {
    const task = taskById.get(candidate.taskId);
    if (!task || TERMINAL_TASK_STATUSES.has(task.status)) continue;
    if (candidate.updatedAt <= task.updated_at) continue;
    const hasActiveWork = envelopes.some((envelope) =>
      envelope.task_id === candidate.taskId
      && ACTIVE_ENVELOPE_STATUSES.has(envelope.status)
    ) || invocations.some((invocation) =>
      invocation.task_id === candidate.taskId
      && invocation.status !== 'terminated'
    );
    if (hasActiveWork) continue;
    const terminalAttempts = candidates.filter((attempt) =>
      attempt.taskId === task.id && attempt.updatedAt > task.updated_at
    );
    if (terminalAttempts.length >= maxRecoveries) {
      return { exhaustedTask: task };
    }
    const agentId = candidate.agentId || task.agent_id;
    if (!agentId) continue;
    return { wakeup: {
      conversationId: task.conversation_id,
      taskId: task.id,
      agentId,
      reasonCode: 'runnable_owned_idle',
      dispatchSource: 'system',
      prompt: candidate.completedWithoutProgress
        ? `上一次执行已经结束，但任务事实没有推进。请从当前工作目录恢复任务 ${task.id}「${task.title}」，完成必要工作并通过任务工具更新状态和证据；不要等待用户追加消息。`
        : `上一次执行没有成功启动。请从当前工作目录恢复并继续完成任务 ${task.id}「${task.title}」；不要等待用户追加消息。`,
      content: `系统正在自动恢复 ${task.id} 的执行。`,
      metadata: {
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        ownerAgentId: agentId,
        reasonCode: 'runnable_owned_idle',
        idempotencyKey: `${task.conversation_id}:${task.id}:${agentId}:recover:${candidate.id}`,
        startsA2AHandoff: false,
        startsDispatch: true,
        reasonSummary: candidate.completedWithoutProgress
          ? 'execution_completed_without_progress'
          : 'execution_dispatch_failed',
      },
    } };
  }
  return {};
}

function deliveryBundle(
  snapshot: DeliveryRunSnapshot,
  tasks: TaskRow[],
  proofs: ProofEventRow[],
  verification: AcceptanceVerificationReceipt,
  review?: AcceptanceReviewReceipt,
): DeliveryBundle {
  const evidenceProofs = acceptedDeliveryEvidence(proofs);
  const proofRefs = evidenceProofs.map((proof) => `proof:${proof.id}`);
  const receiptRefs = snapshot.receipts.map((receipt) => `receipt:${receipt.id}`);
  return {
    summary: `“${snapshot.contract.goal}”已完成交付，共完成 ${tasks.length} 个任务。`,
    acceptanceResults: verification.acceptanceResults,
    changeRefs: tasks.flatMap((task) => {
      if (!task.artifacts) return [];
      try {
        const parsed = JSON.parse(task.artifacts) as Record<string, unknown>;
        return Object.entries(parsed)
          .filter(([, value]) => Boolean(value))
          .map(([key, value]) => `${key}:${String(value)}`);
      } catch {
        return [];
      }
    }),
    verificationRefs: [
      verification.reportRef,
      ...verification.specRefs,
      ...verification.acceptanceResults.flatMap(result => result.evidenceRefs),
      ...proofRefs,
      ...receiptRefs,
    ],
    verification: {
      method: verification.method,
      verifierAgentId: verification.verifierAgentId,
      tool: verification.tool,
      reportRef: verification.reportRef,
      specRefs: verification.specRefs,
      codeRevision: verification.codeRevision,
    },
    review: review ? {
      reviewerAgentId: review.reviewerAgentId,
      summary: review.summary,
      evidenceRefs: review.evidenceRefs,
      codeRevision: review.codeRevision,
    } : undefined,
    providerRefs: snapshot.receipts
      .filter((receipt) => receipt.external_id && receipt.kind.startsWith('provider.'))
      .map((receipt) => `${receipt.kind}:${receipt.external_id}`),
    knownLimitations: [],
    completedAt: new Date().toISOString(),
  };
}

function reviewReceipts(snapshot: DeliveryRunSnapshot): AcceptanceReviewReceipt[] {
  return snapshot.receipts
    .filter(receipt => receipt.kind === 'review.acceptance')
    .flatMap(receipt => {
      try {
        const payload = JSON.parse(receipt.payload_json) as AcceptanceReviewReceipt;
        if (
          payload?.schemaVersion !== 1
          || payload.deliveryRunId !== snapshot.run.id
          || (payload.status !== 'passed' && payload.status !== 'failed')
          || !Array.isArray(payload.findings)
        ) return [];
        return [payload];
      } catch {
        return [];
      }
    });
}

function verificationReceipts(snapshot: DeliveryRunSnapshot): AcceptanceVerificationReceipt[] {
  return snapshot.receipts
    .filter(receipt => receipt.kind === 'verification.acceptance')
    .flatMap(receipt => {
      try {
        const payload = JSON.parse(receipt.payload_json) as AcceptanceVerificationReceipt;
        if (
          payload?.schemaVersion !== 1
          || payload.deliveryRunId !== snapshot.run.id
          || (payload.status !== 'passed' && payload.status !== 'failed')
          || !Array.isArray(payload.acceptanceResults)
        ) return [];
        return [payload];
      } catch {
        return [];
      }
    });
}

function proofActor(proof: ProofEventRow): QualityGateActor {
  return proof.actor_id
    ? { type: 'agent', id: proof.actor_id }
    : { type: 'system', id: 'delivery-gate-ingestion' };
}

function recordDeliveryGate<T extends AcceptanceReviewReceipt | AcceptanceVerificationReceipt>(
  input: {
    snapshot: DeliveryRunSnapshot;
    proof: ProofEventRow;
    kind: Extract<QualityGateKind, 'delivery_review' | 'acceptance_verification'>;
    payload: T;
    valid: boolean;
  },
): T {
  const artifactRevision = input.payload.codeRevision?.trim() || `proof:${input.proof.id}`;
  const requested = qualityGateRepo.request({
    conversationId: input.snapshot.run.conversation_id,
    kind: input.kind,
    targetType: 'delivery_run',
    targetId: input.snapshot.run.id,
    artifactRevision,
    criteria: input.kind === 'delivery_review'
      ? { noOpenMaterialFindings: true }
      : { acceptanceCriteria: input.snapshot.contract.acceptanceCriteria },
    policy: { deliveryPolicy: input.snapshot.contract.deliveryPolicy },
    actor: { type: 'system', id: 'delivery-supervisor' },
  });
  const existingEvidence = requested.evidence.find((evidence) =>
    evidence.idempotency_key === `${input.kind}:${input.proof.id}`
  );
  if (
    ['passed', 'changes_requested', 'rejected', 'cancelled'].includes(requested.gate.status)
    && existingEvidence
  ) {
    return {
      ...input.payload,
      gateId: requested.gate.id,
      gateEvidenceId: existingEvidence.id,
      artifactRevision,
    };
  }
  const evidence = qualityGateRepo.submitEvidence({
    gateId: requested.gate.id,
    evidenceType: input.kind,
    payload: input.payload,
    sourceRef: `proof:${input.proof.id}`,
    actor: proofActor(input.proof),
    idempotencyKey: `${input.kind}:${input.proof.id}`,
  });
  const evaluating = requested.gate.status === 'requested'
    ? qualityGateRepo.beginEvaluation({
        gateId: requested.gate.id,
        evaluator: input.valid
          ? proofActor(input.proof)
          : { type: 'system', id: 'delivery-gate-admission' },
        expectedRevision: requested.gate.revision,
      })
    : requested;
  const decision = input.valid
    ? input.payload.status === 'passed' ? 'passed' : 'changes_requested'
    : 'rejected';
  qualityGateRepo.decide({
    gateId: requested.gate.id,
    decision,
    evaluator: input.valid
      ? proofActor(input.proof)
      : { type: 'system', id: 'delivery-gate-admission' },
    evidenceIds: [evidence.id],
    reason: input.payload.validationErrors?.join(', ')
      ?? (input.payload.status === 'failed' ? `${input.kind}_failed` : undefined),
    expectedRevision: evaluating.gate.revision,
  });
  return {
    ...input.payload,
    gateId: requested.gate.id,
    gateEvidenceId: evidence.id,
    artifactRevision,
  };
}

function latestDeliveryGateState(
  gates: QualityGateRow[],
  kind: Extract<QualityGateKind, 'delivery_review' | 'acceptance_verification'>,
): ObservedDeliveryFacts['review'] {
  const latest = gates.filter((gate) => gate.kind === kind).at(-1);
  if (!latest) return 'not_started';
  if (latest.status === 'requested' || latest.status === 'evaluating') return 'pending';
  if (latest.status === 'passed') return 'passed';
  return 'failed';
}

export class RepositoryDeliveryFactsAdapter implements DeliveryFactsPort {
  constructor(private readonly provider?: ProviderActionPort) {}

  async observe(snapshot: DeliveryRunSnapshot): Promise<ObservedDeliveryFacts> {
    const conversationId = snapshot.run.conversation_id;
    const tasks = taskRepo.getByConversation(conversationId);
    const proofs = proofLogRepo.getByConversation(conversationId, { limit: 2_000 });
    const rootTask = snapshot.run.root_task_id
      ? taskRepo.getById(snapshot.run.root_task_id)
      : tasks[0];
    const failure = terminalTaskFailure(tasks);
    const envelopes = executionEnvelopeRepo.listByConversation(conversationId);
    const invocations = invocationRepo.listByConversation(conversationId);
    const audience = resolveTaskNotificationAudience(conversationId);
    const wakeups = resolveAutonomyGuardWakeups({
      tasks,
      envelopes,
      invocations,
      coordinatorAgentIds: audience.coordinatorAgentIds,
      reviewAgentIds: audience.reviewGateAgentIds,
      qaAgentIds: audience.qaAgentIds,
      edges: taskGraphRepo.listEdges(conversationId),
      closureDispatchedRootTaskIds: proofLogRepo.findByType({
        eventType: 'chain_closure_dispatched',
        conversationId,
        reasonCode: 'chain_ready_for_closure',
      }).map((proof) => proof.task_id).filter((taskId): taskId is string => Boolean(taskId)),
    });
    const recovery = executionRecovery(
      tasks,
      envelopes,
      invocations,
      snapshot.contract.recoveryPolicy.maxAttemptsPerAction,
    );
    const nextWakeup = recovery.wakeup ?? wakeups[0];
    const hasActiveWork = envelopes.some((envelope) =>
      ACTIVE_ENVELOPE_STATUSES.has(envelope.status)
    ) || invocations.some((invocation) => invocation.status !== 'terminated');
    const allDone = tasks.length > 0 && tasks.every((task) => task.status === 'done');
    const deliveryEvidence = acceptedDeliveryEvidence(proofs);
    for (const proof of deliveryEvidence) {
      const reviewCandidate = reviewReceiptFromProof(
        proof,
        snapshot,
        audience.reviewGateAgentIds,
      );
      if (reviewCandidate.present) {
        const reviewPayload = reviewCandidate.valid && reviewCandidate.payload
          ? reviewCandidate.payload
          : failedReviewReceipt(snapshot, proof, reviewCandidate.errors);
        const gatedReviewPayload = recordDeliveryGate({
          snapshot,
          proof,
          kind: 'delivery_review',
          payload: reviewPayload,
          valid: reviewCandidate.valid,
        });
        autonomousDeliveryRepo.recordReceipt({
          runId: snapshot.run.id,
          receipt: {
            kind: 'review.acceptance',
            status: gatedReviewPayload.status,
            externalId: proof.id,
            payload: { ...gatedReviewPayload },
            idempotencyKey: `${snapshot.run.id}:review.acceptance:${proof.id}`,
          },
        });
      }
      const candidate = verificationReceiptFromProof(proof, snapshot, {
        authorizedVerifierIds: [
          ...new Set([...audience.qaAgentIds, ...audience.reviewGateAgentIds]),
        ],
        validateLocalArtifacts: true,
      });
      if (!candidate.present) continue;
      const payload = candidate.valid && candidate.payload
        ? candidate.payload
        : failedVerificationReceipt(snapshot, proof, candidate.errors);
      const gatedVerificationPayload = recordDeliveryGate({
        snapshot,
        proof,
        kind: 'acceptance_verification',
        payload,
        valid: candidate.valid,
      });
      autonomousDeliveryRepo.recordReceipt({
        runId: snapshot.run.id,
        receipt: {
          kind: 'verification.acceptance',
          status: gatedVerificationPayload.status,
          externalId: proof.id,
          payload: { ...gatedVerificationPayload },
          idempotencyKey: `${snapshot.run.id}:verification.acceptance:${proof.id}`,
        },
      });
    }
    const reconciledSnapshot = autonomousDeliveryRepo.getSnapshot(snapshot.run.id) ?? snapshot;
    const latestReview = reviewReceipts(reconciledSnapshot).at(-1);
    const latestVerification = verificationReceipts(reconciledSnapshot).at(-1);
    const deliveryGates = qualityGateRepo.listForTarget('delivery_run', snapshot.run.id);
    const reviewDispatched = reconciledSnapshot.actions.some(action =>
      (action.kind === 'request_review' || action.kind === 'repair_review')
      && ['ready', 'claimed', 'running', 'retry_wait', 'succeeded'].includes(action.status)
    );
    const verificationDispatched = reconciledSnapshot.actions.some(action =>
      (action.kind === 'run_verification' || action.kind === 'repair_verification')
      && ['ready', 'claimed', 'running', 'retry_wait', 'succeeded'].includes(action.status)
    );
    const gateVerificationState = latestDeliveryGateState(
      deliveryGates,
      'acceptance_verification',
    );
    const gateReviewState = latestDeliveryGateState(deliveryGates, 'delivery_review');
    const verificationState: ObservedDeliveryFacts['verification'] =
      gateVerificationState !== 'not_started'
        ? gateVerificationState
      : verificationDispatched
        ? 'pending'
        : 'not_started';
    const reviewState: ObservedDeliveryFacts['review'] = !snapshot.contract.deliveryPolicy.requireReview
      ? 'not_required'
      : gateReviewState !== 'not_started'
        ? gateReviewState
        : reviewDispatched
          ? 'pending'
          : 'not_started';
    const integrationState = await this.integrationState(reconciledSnapshot);
    const postIntegrationSnapshot = autonomousDeliveryRepo.getSnapshot(snapshot.run.id)
      ?? reconciledSnapshot;
    const deliveryReceipt = postIntegrationSnapshot.receipts.find((receipt) =>
      receipt.kind === 'delivery.published' && receipt.status === 'succeeded'
    );

    let taskGraph: ObservedDeliveryFacts['taskGraph'];
    if (failure) taskGraph = 'blocked';
    else if (allDone) taskGraph = 'completed';
    else if (nextWakeup) taskGraph = 'pending';
    else if (hasActiveWork || tasks.some((task) =>
      ['in_progress', 'in_review'].includes(task.status)
    )) taskGraph = 'running';
    else taskGraph = 'pending';

    return {
      rootTaskId: rootTask?.id,
      planning: rootTask ? 'completed' : 'pending',
      taskGraph,
      review: reviewState,
      verification: verificationState,
      integration: integrationState,
      delivery: deliveryReceipt ? 'published' : 'pending',
      runnableTask: nextWakeup ? {
        taskId: nextWakeup.taskId,
        agentId: nextWakeup.agentId,
        reasonCode: nextWakeup.reasonCode,
        prompt: nextWakeup.prompt,
        idempotencyKey: nextWakeup.metadata.idempotencyKey,
      } : undefined,
      blockerCode: failure
        ? 'verification_failed'
        : recovery.exhaustedTask
          ? 'poisoned_session'
          : undefined,
      blockerDetail: failure
        ? `任务 ${failure.id} 以 ${failure.status} 结束，不能满足完整交付`
        : recovery.exhaustedTask
          ? `任务 ${recovery.exhaustedTask.id} 连续执行结束但没有产生可验证的状态进展`
        : undefined,
      bundle: latestVerification?.status === 'passed'
        && (
          !snapshot.contract.deliveryPolicy.requireReview
          || latestReview?.status === 'passed'
        )
        && (
          !snapshot.contract.deliveryPolicy.requireMerge
          || integrationState === 'passed'
        )
        ? deliveryBundle(postIntegrationSnapshot, tasks, proofs, latestVerification, latestReview)
        : undefined,
    };
  }

  private async integrationState(
    snapshot: DeliveryRunSnapshot,
  ): Promise<ObservedDeliveryFacts['integration']> {
    if (!snapshot.contract.deliveryPolicy.requireMerge) return 'not_required';
    const merged = snapshot.receipts.some((receipt) =>
      receipt.kind === 'provider.github.pull_request.merged'
      && receipt.status === 'succeeded'
    );
    if (merged) return 'passed';
    if (!this.provider) return 'failed';
    const observation = await this.provider.observeIntegration(snapshot);
    if (observation.receipt) {
      autonomousDeliveryRepo.recordReceipt({
        runId: snapshot.run.id,
        receipt: observation.receipt,
      });
    }
    return observation.state;
  }
}

export class HarnessDeliveryActionAdapter implements DeliveryActionPort {
  constructor(
    private readonly io: IOServer,
    private readonly provider?: ProviderActionPort,
  ) {}

  async execute(
    claim: ClaimedDeliveryAction,
    snapshot: DeliveryRunSnapshot,
  ): Promise<DeliveryExecutionResult> {
    switch (claim.action.kind) {
      case 'plan_goal':
        return this.planGoal(snapshot);
      case 'advance_tasks':
      case 'request_review':
      case 'repair_review':
      case 'run_verification':
      case 'repair_verification':
        return this.dispatchTask(claim, snapshot);
      case 'integrate_change':
        if (!this.provider) {
          return {
            status: 'failed',
            failureCode: 'permanent_configuration',
            detail: 'Provider Action Adapter 尚未配置，不能执行合并',
            retryable: false,
          };
        }
        try {
          return {
            status: 'succeeded',
            receipts: await this.provider.integrate(snapshot),
          };
        } catch (error) {
          const providerError = error instanceof ProviderActionError
            ? error
            : new ProviderActionError('unknown', error instanceof Error ? error.message : String(error));
          return {
            status: 'failed',
            failureCode: providerError.failureCode,
            detail: providerError.message,
            retryable: providerError.retryable,
          };
        }
      case 'publish_delivery':
        return {
          status: 'succeeded',
          receipts: [{
            kind: 'delivery.published',
            status: 'succeeded',
            idempotencyKey: `${snapshot.run.id}:delivery.published`,
          }],
        };
    }
  }

  private async planGoal(snapshot: DeliveryRunSnapshot): Promise<DeliveryExecutionResult> {
    const audience = resolveTaskNotificationAudience(snapshot.run.conversation_id);
    const ownerAgentId = audience.coordinatorAgentIds[0];
    if (!ownerAgentId) {
      return {
        status: 'failed',
        failureCode: 'permanent_configuration',
        detail: '当前团队没有可用的规划/统筹 Agent',
        retryable: false,
      };
    }
    const existing = taskRepo.getByConversation(snapshot.run.conversation_id)[0];
    const task = existing ?? groupChatTaskFlow.createRootTask({
      conversationId: snapshot.run.conversation_id,
      title: snapshot.contract.goal,
      description: buildGoalTaskDescription(snapshot.contract),
      ownerAgentId,
      actorId: 'autonomous-delivery-supervisor',
      actorType: 'system',
    }).task;
    emitTaskState(this.io, task);
    return {
      status: 'succeeded',
      receipts: [{
        kind: 'goal.planned',
        status: 'succeeded',
        externalId: task.id,
        payload: { rootTaskId: task.id, ownerAgentId },
        idempotencyKey: `${snapshot.run.id}:goal.planned`,
      }],
    };
  }

  private async dispatchTask(
    claim: ClaimedDeliveryAction,
    snapshot: DeliveryRunSnapshot,
  ): Promise<DeliveryExecutionResult> {
    const taskId = claim.action.subject_id ?? snapshot.run.root_task_id;
    const task = taskId ? taskRepo.getById(taskId) : undefined;
    if (!task) {
      return {
        status: 'failed',
        failureCode: 'permanent_configuration',
        detail: '没有可投递的任务',
        retryable: false,
      };
    }
    const wakeup = claim.action.kind === 'request_review'
      || claim.action.kind === 'repair_review'
      ? this.reviewWakeup(snapshot, task, claim.action.kind)
      : claim.action.kind === 'run_verification'
        || claim.action.kind === 'repair_verification'
        ? this.verificationWakeup(snapshot, task, claim.action.kind)
        : this.findWakeup(snapshot, task.id);
    if (!wakeup) {
      return {
        status: 'failed',
        failureCode: 'transient_runtime',
        detail: `任务 ${task.id} 当前没有合法 wakeup`,
        retryable: true,
      };
    }
    if (wakeup.metadata.reasonSummary === 'execution_completed_without_progress') {
      const session = sessionRepo.findActiveByConversation(
        wakeup.agentId,
        snapshot.run.conversation_id,
      );
      if (session) sessionRepo.seal(session.id, 'autonomous_delivery_no_progress');
    }
    const submission = submitTaskWakeupToHarness(
      this.io,
      {
        ...wakeup,
        id: `delivery:${claim.action.id}`,
        metadata: {
          ...wakeup.metadata,
          idempotencyKey: claim.action.idempotency_key,
        },
      },
      scenarioForDeliveryAction(claim.action.kind),
      snapshot.run.id,
    );
    if (!submission?.handled) {
      return {
        status: 'failed',
        failureCode: submission?.disposition === 'deferred'
          ? 'transient_runtime'
          : 'permanent_configuration',
        detail: submission
          ? `Harness 未接收任务：${submission.disposition}`
          : 'Harness Coordinator 尚未注册',
        retryable: submission?.disposition === 'deferred',
      };
    }
    const outcome = await submission.completion;
    if (outcome.status !== 'accepted') {
      return {
        status: 'failed',
        failureCode: outcome.status === 'deferred'
          ? 'transient_runtime'
          : outcome.reasonCode === 'required_context_missing'
            ? 'permanent_configuration'
            : 'unknown',
        detail: 'message' in outcome ? outcome.message : outcome.reasonCode,
        retryable: outcome.status === 'deferred',
      };
    }
    return {
      status: 'succeeded',
      receipts: [{
        kind: 'harness.dispatch.accepted',
        status: 'succeeded',
        externalId: wakeup.taskId,
        payload: {
          taskId: wakeup.taskId,
          agentId: wakeup.agentId,
          reasonCode: wakeup.reasonCode,
        },
        idempotencyKey: `${claim.action.idempotency_key}:accepted`,
      }],
    };
  }

  private verificationWakeup(
    snapshot: DeliveryRunSnapshot,
    task: TaskRow,
    kind: 'run_verification' | 'repair_verification',
  ): TaskWakeup | undefined {
    const audience = resolveTaskNotificationAudience(snapshot.run.conversation_id);
    const agentId = audience.qaAgentIds[0]
      ?? audience.reviewGateAgentIds[0]
      ?? audience.coordinatorAgentIds[0]
      ?? task.agent_id;
    if (!agentId) return undefined;
    const method = snapshot.contract.deliveryPolicy.requireWebE2E
      ? 'web_ui_e2e'
      : 'automated_test';
    const criteria = snapshot.contract.acceptanceCriteria
      .map((criterion, index) => `${index + 1}. ${criterion}`)
      .join('\n');
    return {
      conversationId: snapshot.run.conversation_id,
      taskId: task.id,
      agentId,
      reasonCode: 'test_requested',
      dispatchSource: 'test_gate',
      prompt: [
        kind === 'repair_verification'
          ? '上一轮验收验证失败，请基于失败证据修复后重新验证。'
          : '执行独立验收验证，不要把任务完成状态当作测试结果。',
        snapshot.contract.deliveryPolicy.requireWebE2E
          ? '必须通过真实 Browser/Playwright Web UI 端到端测试，不得用接口调用代替页面操作。'
          : '执行与验收标准匹配的自动化验证。',
        `Delivery Run: ${snapshot.run.id}`,
        '验收标准：',
        criteria,
        '',
        '完成后调用 task_update_status，将当前任务保持为 done，并在 evidence.verificationReceipt 中提交：',
        `schemaVersion=1、deliveryRunId=${snapshot.run.id}、status=passed|failed、method=${method}、verifierAgentId=${agentId}、`,
        'tool、reportRef、specRefs，以及与上述验收标准逐项对应的 acceptanceResults/evidenceRefs。',
        'reportRef 与 specRefs 必须指向授权项目目录内真实存在的报告和测试文件。',
        '同时保留 delivery gate 需要的 mergedToMain、mainInstallResult、mainBuildResult、mainTestResult、mainImpactReviewResult。',
        '任何失败项必须标记 failed；没有真实报告引用时不得提交 passed。',
      ].join('\n'),
      content: `系统请求 @${agentId} 对 ${task.id} 执行独立验收验证。`,
      metadata: {
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        ownerAgentId: agentId,
        reasonCode: 'test_requested',
        idempotencyKey: `${snapshot.run.id}:${kind}:${task.id}`,
        startsA2AHandoff: false,
        startsDispatch: true,
        reasonSummary: kind,
      },
    };
  }

  private reviewWakeup(
    snapshot: DeliveryRunSnapshot,
    task: TaskRow,
    kind: 'request_review' | 'repair_review',
  ): TaskWakeup | undefined {
    const audience = resolveTaskNotificationAudience(snapshot.run.conversation_id);
    const agentId = audience.reviewGateAgentIds[0];
    if (!agentId) return undefined;
    return {
      conversationId: snapshot.run.conversation_id,
      taskId: task.id,
      agentId,
      reasonCode: 'review_requested',
      dispatchSource: 'review_gate',
      prompt: [
        kind === 'repair_review'
          ? '上一轮独立质量评审失败。请基于未解决问题复核修复结果，再提交新回执。'
          : '执行独立质量评审。任务 done 只代表状态门禁通过，不代表 Review PASS。',
        `Delivery Run: ${snapshot.run.id}`,
        `目标：${snapshot.contract.goal}`,
        '请检查实现正确性、安全、回归风险、可维护性和验收可测性。',
        '',
        '完成后调用 task_update_status，将当前任务保持为 done，并在 evidence.reviewReceipt 中提交：',
        `schemaVersion=1、deliveryRunId=${snapshot.run.id}、status=passed|failed、reviewerAgentId=${agentId}、`,
        'summary、evidenceRefs、可选 codeRevision，以及 findings（severity/status/description/evidenceRefs）。',
        '同时保留 delivery gate 需要的 mergedToMain、mainInstallResult、mainBuildResult、mainTestResult、mainImpactReviewResult。',
        '存在未解决 blocking/important finding 时必须提交 failed；不得用实现者自评或笼统文本代替独立回执。',
      ].join('\n'),
      content: `系统请求 @${agentId} 对 ${task.id} 执行独立质量评审。`,
      metadata: {
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        ownerAgentId: agentId,
        reasonCode: 'review_requested',
        idempotencyKey: `${snapshot.run.id}:${kind}:${task.id}`,
        startsA2AHandoff: false,
        startsDispatch: true,
        reasonSummary: kind,
      },
    };
  }

  private findWakeup(snapshot: DeliveryRunSnapshot, taskId: string): TaskWakeup | undefined {
    const conversationId = snapshot.run.conversation_id;
    const audience = resolveTaskNotificationAudience(conversationId);
    const tasks = taskRepo.getByConversation(conversationId);
    const envelopes = executionEnvelopeRepo.listByConversation(conversationId);
    const invocations = invocationRepo.listByConversation(conversationId);
    return executionRecovery(
      tasks,
      envelopes,
      invocations,
      snapshot.contract.recoveryPolicy.maxAttemptsPerAction,
    ).wakeup ?? resolveAutonomyGuardWakeups({
      tasks,
      envelopes,
      coordinatorAgentIds: audience.coordinatorAgentIds,
      reviewAgentIds: audience.reviewGateAgentIds,
      qaAgentIds: audience.qaAgentIds,
      edges: taskGraphRepo.listEdges(conversationId),
    }).find((wakeup) => wakeup.taskId === taskId);
  }
}
