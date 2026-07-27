import { createHash } from 'node:crypto';
import { conversationRepo } from '../repositories/conversation-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskGraphRepo, type TaskActionRow } from '../repositories/task-graph-repo';
import type { TaskRow, TaskStatus } from '../repositories/task-repo';
import { qualityGateRepo } from '../quality-gate/repository';
import type { QualityGateActor, QualityGateKind, QualityGateSnapshot } from '../quality-gate/types';
import {
  evaluateTaskStatusEvidenceGate,
  hasCurrentVerifiedMerge,
  type TaskGateEvidenceDecision,
} from './task-gate-evidence';

export interface RecordedTaskGateDecision extends TaskGateEvidenceDecision {
  gate?: QualityGateSnapshot;
}

function payload(action: TaskActionRow): Record<string, unknown> {
  try {
    const value = JSON.parse(action.payload);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function receiptRevision(
  actions: TaskActionRow[],
  actionType: 'task.pull_request_submitted' | 'task.pull_request_merged',
  field: 'headSha' | 'mergeSha',
): string | undefined {
  const action = actions.filter((candidate) => candidate.type === actionType).at(-1);
  if (!action) return undefined;
  const receipt = payload(action).receipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return undefined;
  const value = (receipt as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function gateDefinition(
  task: TaskRow,
  nextStatus: TaskStatus,
  actions: TaskActionRow[],
): {
  kind: QualityGateKind;
  artifactRevision: string;
  requiredFields: string[];
} | undefined {
  if (nextStatus === 'in_review') {
    return {
      kind: 'implementation_readiness',
      artifactRevision: receiptRevision(actions, 'task.pull_request_submitted', 'headSha')
        ?? `task:${task.id}:${task.revision}`,
      requiredFields: ['installResult', 'buildResult', 'testResult', 'impactEvidence'],
    };
  }
  if (nextStatus === 'done') {
    return {
      kind: 'integration',
      artifactRevision: receiptRevision(actions, 'task.pull_request_merged', 'mergeSha')
        ?? `task:${task.id}:${task.revision}`,
      requiredFields: [
        'mergedToMain',
        'mainInstallResult',
        'mainBuildResult',
        'mainTestResult',
        'mainImpactReviewResult',
      ],
    };
  }
  return undefined;
}

function evidenceIdempotencyKey(
  taskId: string,
  nextStatus: TaskStatus,
  artifactRevision: string,
  evidence: unknown,
): string {
  const digest = createHash('sha256').update(JSON.stringify(evidence ?? {})).digest('hex');
  return `task-gate:${taskId}:${nextStatus}:${artifactRevision}:${digest}`;
}

export class TaskGateService {
  evaluate(input: {
    task: TaskRow;
    nextStatus: TaskStatus;
    evidence: unknown;
    actor: QualityGateActor;
  }): RecordedTaskGateDecision {
    const actions = taskGraphRepo.listActionsForTask(input.task.id);
    const pullRequestRequired = Boolean(
      conversationRepo.getById(input.task.conversation_id)?.git_repo_root,
    );
    const decision = evaluateTaskStatusEvidenceGate({
      task: input.task,
      nextStatus: input.nextStatus,
      actorId: input.actor.id,
      evidence: input.evidence,
      pullRequestRequired,
      verifiedPullRequest: actions.some((action) => action.type === 'task.pull_request_submitted'),
      verifiedMerge: hasCurrentVerifiedMerge(actions),
    });
    if (!decision.required || !decision.gateName) return decision;

    const definition = gateDefinition(input.task, input.nextStatus, actions);
    if (!definition) return decision;
    if (
      pullRequestRequired
      && decision.gateName === 'implementation_evidence'
      && !definition.requiredFields.includes('pullRequestReceipt')
    ) {
      definition.requiredFields.push('pullRequestReceipt');
    }
    if (
      pullRequestRequired
      && decision.gateName === 'delivery_evidence'
      && !definition.requiredFields.includes('mergeReceipt')
    ) {
      definition.requiredFields.push('mergeReceipt');
    }
    const gate = qualityGateRepo.request({
      conversationId: input.task.conversation_id,
      kind: definition.kind,
      targetType: 'task',
      targetId: input.task.id,
      artifactRevision: definition.artifactRevision,
      criteria: {
        transition: input.nextStatus,
        requiredFields: definition.requiredFields,
      },
      policy: {
        deterministicEvidencePolicy: true,
        pullRequestRequired,
      },
      actor: input.actor,
    });

    if (!decision.allowed) {
      proofLogRepo.append({
        eventType: 'task_graph.gate_evidence.blocked',
        conversationId: input.task.conversation_id,
        taskId: input.task.id,
        actorId: input.actor.id,
        reasonCode: decision.reasonCode,
        metadata: {
          status: input.nextStatus,
          gateId: gate.gate.id,
          gateName: decision.gateName,
          artifactRevision: definition.artifactRevision,
          missingFields: decision.missingFields,
        },
      });
      return { ...decision, gate };
    }

    if (gate.gate.status === 'passed') return { ...decision, gate };
    if (gate.gate.status !== 'requested' && gate.gate.status !== 'evaluating') {
      return {
        allowed: false,
        required: true,
        gateName: decision.gateName,
        reasonCode: 'task_graph.gate_revision_rejected',
        message: `Gate ${gate.gate.id} is already ${gate.gate.status}; produce a new artifact revision.`,
        gate,
      };
    }
    const evidence = qualityGateRepo.submitEvidence({
      gateId: gate.gate.id,
      evidenceType: decision.gateName,
      payload: {
        nextStatus: input.nextStatus,
        evidence: input.evidence,
      },
      actor: input.actor,
      idempotencyKey: evidenceIdempotencyKey(
        input.task.id,
        input.nextStatus,
        definition.artifactRevision,
        input.evidence,
      ),
    });
    const evaluating = gate.gate.status === 'requested'
      ? qualityGateRepo.beginEvaluation({
          gateId: gate.gate.id,
          evaluator: { type: 'system', id: 'task-evidence-policy' },
          expectedRevision: gate.gate.revision,
        })
      : gate;
    const passed = qualityGateRepo.decide({
      gateId: gate.gate.id,
      decision: 'passed',
      evaluator: { type: 'system', id: 'task-evidence-policy' },
      evidenceIds: [evidence.id],
      expectedRevision: evaluating.gate.revision,
    });
    proofLogRepo.append({
      eventType: 'task_graph.gate_evidence.accepted',
      conversationId: input.task.conversation_id,
      taskId: input.task.id,
      actorId: input.actor.id,
      metadata: {
        status: input.nextStatus,
        gateId: passed.gate.id,
        gateName: decision.gateName,
        artifactRevision: definition.artifactRevision,
        evidence: input.evidence,
      },
    });
    return { ...decision, gate: passed };
  }
}

export const taskGateService = new TaskGateService();
