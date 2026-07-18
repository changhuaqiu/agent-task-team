import type { TaskRow } from '../repositories/task-repo';

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
    const gateName = 'delivery_evidence' as const;
    const missingFields = missing(evidence, [
      'mergedToMain',
      'mainInstallResult',
      'mainBuildResult',
      'mainTestResult',
      'mainImpactReviewResult',
    ]);
    if (input.pullRequestRequired && !input.verifiedMerge) missingFields.push('mergeReceipt');
    if (missingFields.length > 0) {
      return {
        allowed: false,
        required: true,
        gateName,
        reasonCode: EVIDENCE_REQUIRED_REASON,
        missingFields,
        message: `标记 done 前缺少主分支交付证据：${missingFields.join(', ')}。`,
      };
    }
    return { allowed: true, required: true, gateName };
  }

  return { allowed: true, required: false };
}

