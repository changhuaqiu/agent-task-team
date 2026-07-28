import type { TaskRow } from '../repositories/task-repo';
import type { TaskActionRow } from '../repositories/task-graph-repo';

export interface TaskGateEvidenceDecision {
  allowed: boolean;
  required: boolean;
  gateName?: 'implementation_evidence' | 'delivery_evidence';
  reasonCode?: string;
  message?: string;
  missingFields?: string[];
}

export interface EvaluateTaskStatusEvidenceInput {
  task?: TaskRow;
  nextStatus: string;
  actorId?: string;
  evidence?: unknown;
  pullRequestRequired?: boolean;
  verifiedPullRequest?: boolean;
  verifiedMerge?: boolean;
}

const EVIDENCE_REQUIRED_REASON = 'task_graph.gate_evidence_required';

function actionPayload(action: Pick<TaskActionRow, 'payload'>): Record<string, unknown> {
  try {
    const parsed = JSON.parse(action.payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function hasCurrentVerifiedMerge(actions: Array<Pick<TaskActionRow, 'id' | 'type' | 'payload'>>): boolean {
  const pullRequestAction = actions.filter((action) => action.type === 'task.pull_request_submitted').at(-1);
  const mergeAction = actions.filter((action) => action.type === 'task.pull_request_merged').at(-1);
  if (!pullRequestAction || !mergeAction) return false;
  const pullRequestReceipt = actionPayload(pullRequestAction).receipt as { headSha?: unknown } | undefined;
  const mergePayload = actionPayload(mergeAction);
  const mergeReceipt = mergePayload.receipt as { headSha?: unknown; mergeSha?: unknown } | undefined;
  return mergePayload.pullRequestActionId === pullRequestAction.id
    && typeof pullRequestReceipt?.headSha === 'string'
    && mergeReceipt?.headSha === pullRequestReceipt.headSha
    && typeof mergeReceipt.mergeSha === 'string'
    && mergeReceipt.mergeSha.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function evidenceRecord(evidence: unknown): Record<string, unknown> {
  return isRecord(evidence) ? evidence : {};
}

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== false;
}

function missing(record: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => !hasValue(record[field]));
}

export function evaluateTaskStatusEvidenceGate(input: EvaluateTaskStatusEvidenceInput): TaskGateEvidenceDecision {
  const evidence = evidenceRecord(input.evidence);

  if (input.nextStatus === 'in_review') {
    const gateName = 'implementation_evidence' as const;
    const missingFields = missing(evidence, [
      'installResult',
      'buildResult',
      'testResult',
      'impactEvidence',
    ]);
    if (input.pullRequestRequired && !input.verifiedPullRequest) missingFields.push('pullRequestReceipt');
    if (missingFields.length > 0) {
      return {
        allowed: false,
        required: true,
        gateName,
        reasonCode: EVIDENCE_REQUIRED_REASON,
        missingFields,
        message: `进入 review_gate 前缺少实现证据：${missingFields.join(', ')}。`,
      };
    }
    return { allowed: true, required: true, gateName };
  }

  if (input.nextStatus === 'done') {
    return {
      allowed: false,
      required: true,
      gateName: 'delivery_evidence',
      reasonCode: 'task_graph.quality_gate_required',
      message: 'Task 只能由匹配当前 revision 的 QualityGate passed 事件标记 done。',
    };
  }

  return { allowed: true, required: false };
}

