import type { ProofEventRow } from '../repositories/proof-log-repo';
import type {
  AcceptanceReviewReceipt,
  DeliveryRunSnapshot,
} from './types';

interface ReviewReceiptCandidate {
  present: boolean;
  valid: boolean;
  errors: string[];
  payload?: AcceptanceReviewReceipt;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function reviewReceiptFromProof(
  proof: ProofEventRow,
  snapshot: DeliveryRunSnapshot,
  authorizedReviewerIds: string[],
): ReviewReceiptCandidate {
  let metadata: Record<string, unknown> | undefined;
  try {
    metadata = proof.metadata ? record(JSON.parse(proof.metadata)) : undefined;
  } catch {
    return {
      present: true,
      valid: false,
      errors: ['proof_metadata_invalid'],
    };
  }
  const evidence = record(metadata?.evidence);
  const raw = record(evidence?.reviewReceipt);
  if (!raw) return { present: false, valid: false, errors: [] };

  const errors: string[] = [];
  if (proof.event_type !== 'task_graph.gate_evidence.accepted') errors.push('proof_not_accepted');
  if (metadata?.gateName !== 'delivery_evidence') errors.push('delivery_gate_required');
  if (proof.created_at < snapshot.run.created_at) errors.push('proof_predates_run');
  if (raw.schemaVersion !== 1) errors.push('schema_version_invalid');
  if (raw.deliveryRunId !== snapshot.run.id) errors.push('delivery_run_mismatch');
  if (raw.status !== 'passed' && raw.status !== 'failed') errors.push('status_invalid');

  const reviewerAgentId = typeof raw.reviewerAgentId === 'string'
    ? raw.reviewerAgentId.trim()
    : '';
  if (!reviewerAgentId) errors.push('reviewer_missing');
  if (proof.actor_id !== reviewerAgentId) errors.push('reviewer_actor_mismatch');
  if (!authorizedReviewerIds.includes(reviewerAgentId)) errors.push('reviewer_not_authorized');

  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  const evidenceRefs = strings(raw.evidenceRefs);
  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  const findings = rawFindings.flatMap((item) => {
    const finding = record(item);
    if (
      !finding
      || !['blocking', 'important', 'advisory'].includes(String(finding.severity))
      || !['open', 'resolved'].includes(String(finding.status))
      || typeof finding.description !== 'string'
      || !finding.description.trim()
    ) return [];
    return [{
      severity: finding.severity as 'blocking' | 'important' | 'advisory',
      status: finding.status as 'open' | 'resolved',
      description: finding.description.trim(),
      evidenceRefs: strings(finding.evidenceRefs),
    }];
  });
  if (findings.length !== rawFindings.length) errors.push('finding_invalid');

  if (raw.status === 'passed') {
    if (!summary) errors.push('review_summary_required');
    if (evidenceRefs.length === 0) errors.push('review_evidence_required');
    if (findings.some(finding =>
      finding.status === 'open'
      && (finding.severity === 'blocking' || finding.severity === 'important')
    )) errors.push('unresolved_material_finding');
  }

  return {
    present: true,
    valid: errors.length === 0,
    errors,
    payload: {
      schemaVersion: 1,
      deliveryRunId: typeof raw.deliveryRunId === 'string' ? raw.deliveryRunId : '',
      status: raw.status === 'passed' ? 'passed' : 'failed',
      reviewerAgentId,
      summary,
      evidenceRefs,
      codeRevision: typeof raw.codeRevision === 'string' ? raw.codeRevision : undefined,
      findings,
    },
  };
}

export function failedReviewReceipt(
  snapshot: DeliveryRunSnapshot,
  proof: ProofEventRow,
  errors: string[],
): AcceptanceReviewReceipt {
  return {
    schemaVersion: 1,
    deliveryRunId: snapshot.run.id,
    status: 'failed',
    reviewerAgentId: proof.actor_id ?? 'unknown',
    summary: '评审回执未通过结构校验',
    evidenceRefs: [`proof:${proof.id}`],
    findings: [{
      severity: 'blocking',
      status: 'open',
      description: errors.join(', ') || 'review_receipt_invalid',
      evidenceRefs: [`proof:${proof.id}`],
    }],
    validationErrors: errors,
  };
}
