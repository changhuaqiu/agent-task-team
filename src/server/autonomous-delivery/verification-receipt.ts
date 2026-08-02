import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ProofEventRow } from '../repositories/proof-log-repo';
import type {
  AcceptanceVerificationReceipt,
  DeliveryRunSnapshot,
} from './types';

export interface VerificationReceiptCandidate {
  present: boolean;
  valid: boolean;
  payload?: AcceptanceVerificationReceipt;
  errors: string[];
}

export interface VerificationProofPolicy {
  authorizedVerifierIds: string[];
  validateLocalArtifacts: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function nonEmptyStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length === value.length ? strings : undefined;
}

function normalizedOutcome(value: unknown): 'passed' | 'failed' | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase()) {
    case 'pass':
    case 'passed':
      return 'passed';
    case 'fail':
    case 'failed':
      return 'failed';
    default:
      return undefined;
  }
}

function normalizedCriterion(
  value: unknown,
  index: number,
  rawResultCount: number,
  expectedCriteria: string[],
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const acMatch = value.trim().match(/^AC(\d+)\b/i);
  if (
    acMatch
    && Number(acMatch[1]) === index + 1
    && rawResultCount === expectedCriteria.length
  ) {
    return expectedCriteria[index];
  }
  return value;
}

function counts(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftCounts = counts(left);
  const rightCounts = counts(right);
  if (leftCounts.size !== rightCounts.size) return false;
  return [...leftCounts].every(([key, count]) => rightCounts.get(key) === count);
}

export function validateAcceptanceVerificationReceipt(
  value: unknown,
  snapshot: DeliveryRunSnapshot,
): VerificationReceiptCandidate {
  if (!isRecord(value)) return { present: false, valid: false, errors: [] };

  const errors: string[] = [];
  const receiptStatus = normalizedOutcome(value.status);
  if (value.schemaVersion !== 1) errors.push('schema_version_invalid');
  if (value.deliveryRunId !== snapshot.run.id) errors.push('delivery_run_mismatch');
  if (!receiptStatus) errors.push('status_invalid');
  if (!['web_ui_e2e', 'automated_test', 'manual_review'].includes(String(value.method))) {
    errors.push('method_invalid');
  }
  if (typeof value.verifierAgentId !== 'string' || !value.verifierAgentId.trim()) {
    errors.push('verifier_missing');
  }
  if (typeof value.tool !== 'string' || !value.tool.trim()) errors.push('tool_missing');
  if (typeof value.reportRef !== 'string' || !value.reportRef.trim()) errors.push('report_ref_missing');
  const specRefs = nonEmptyStrings(value.specRefs);
  if (!specRefs) errors.push('spec_refs_invalid');
  const receiptEvidenceRefs = nonEmptyStrings(value.evidenceRefs);

  const rawResults = Array.isArray(value.acceptanceResults) ? value.acceptanceResults : [];
  const acceptanceResults = rawResults.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const evidenceRefs = nonEmptyStrings(item.evidenceRefs) ?? receiptEvidenceRefs;
    const status = normalizedOutcome(item.status) ?? normalizedOutcome(item.result);
    const criterion = normalizedCriterion(
      item.criterion,
      index,
      rawResults.length,
      snapshot.contract.acceptanceCriteria,
    );
    if (
      !criterion
      || !status
      || !evidenceRefs
    ) return [];
    return [{
      criterion,
      status,
      evidenceRefs,
    }];
  });
  if (acceptanceResults.length !== rawResults.length) errors.push('acceptance_result_invalid');
  if (!sameMultiset(
    acceptanceResults.map(item => item.criterion),
    snapshot.contract.acceptanceCriteria,
  )) {
    errors.push('acceptance_criteria_mismatch');
  }
  if (
    receiptStatus === 'passed'
    && acceptanceResults.some(item => item.status !== 'passed' || item.evidenceRefs.length === 0)
  ) {
    errors.push('passed_criterion_missing_evidence');
  }
  if (
    receiptStatus === 'failed'
    && acceptanceResults.length > 0
    && acceptanceResults.every(item => item.status === 'passed')
  ) {
    errors.push('failed_receipt_without_failed_criterion');
  }
  if (snapshot.contract.deliveryPolicy.requireWebE2E) {
    if (value.method !== 'web_ui_e2e') errors.push('web_e2e_method_required');
    if (!/(browser|playwright)/i.test(String(value.tool))) {
      errors.push('web_e2e_tool_required');
    }
    if (!specRefs || specRefs.length === 0) errors.push('web_e2e_spec_ref_required');
  }

  const payload: AcceptanceVerificationReceipt = {
    schemaVersion: 1,
    deliveryRunId: typeof value.deliveryRunId === 'string' ? value.deliveryRunId : snapshot.run.id,
    status: receiptStatus === 'passed' ? 'passed' : 'failed',
    method: value.method === 'web_ui_e2e' || value.method === 'manual_review'
      ? value.method
      : 'automated_test',
    verifierAgentId: typeof value.verifierAgentId === 'string'
      ? value.verifierAgentId.trim()
      : '',
    tool: typeof value.tool === 'string' ? value.tool : 'unknown',
    reportRef: typeof value.reportRef === 'string' ? value.reportRef : '',
    specRefs: specRefs ?? [],
    ...(typeof value.codeRevision === 'string' && value.codeRevision
      ? { codeRevision: value.codeRevision }
      : {}),
    acceptanceResults,
    ...(errors.length > 0 ? { validationErrors: errors } : {}),
  };
  return { present: true, valid: errors.length === 0, payload, errors };
}

export function verificationReceiptFromProof(
  proof: ProofEventRow,
  snapshot: DeliveryRunSnapshot,
  policy?: VerificationProofPolicy,
): VerificationReceiptCandidate {
  if (
    proof.event_type !== 'task_graph.gate_evidence.accepted'
    || proof.created_at < snapshot.run.created_at
  ) {
    return { present: false, valid: false, errors: [] };
  }
  const metadata = parseJsonRecord(proof.metadata);
  if (metadata.gateName !== 'delivery_evidence') {
    return { present: false, valid: false, errors: [] };
  }
  const evidence = isRecord(metadata.evidence) ? metadata.evidence : {};
  const candidate = validateAcceptanceVerificationReceipt(evidence.verificationReceipt, snapshot);
  if (!candidate.present || !candidate.payload || !policy) return candidate;

  const errors = [...candidate.errors];
  if (proof.actor_id !== candidate.payload.verifierAgentId) {
    errors.push('verifier_actor_mismatch');
  }
  if (!policy.authorizedVerifierIds.includes(candidate.payload.verifierAgentId)) {
    errors.push('verifier_not_authorized');
  }
  if (policy.validateLocalArtifacts) {
    const projectPath = snapshot.contract.scope.projectPath;
    if (!projectPath) {
      errors.push('project_path_required_for_artifacts');
    } else {
      const root = resolve(projectPath);
      let canonicalRoot: string | undefined;
      try {
        canonicalRoot = realpathSync(root);
      } catch {
        errors.push('project_path_unreadable');
      }
      for (const [kind, ref] of [
        ['report', candidate.payload.reportRef],
        ...candidate.payload.specRefs.map(ref => ['spec', ref]),
      ] as Array<[string, string]>) {
        if (/^https?:\/\//i.test(ref)) continue;
        try {
          const target = resolve(root, ref);
          if (!existsSync(target)) {
            errors.push(`${kind}_ref_missing`);
            continue;
          }
          const canonicalTarget = realpathSync(target);
          const rel = canonicalRoot ? relative(canonicalRoot, canonicalTarget) : '..';
          if (
            isAbsolute(rel)
            || rel === '..'
            || rel.startsWith(`..\\`)
            || rel.startsWith('../')
          ) {
            errors.push(`${kind}_ref_outside_project`);
            continue;
          }
          if (!statSync(canonicalTarget).isFile()) {
            errors.push(`${kind}_ref_missing`);
          }
        } catch {
          errors.push(`${kind}_ref_unreadable`);
        }
      }
    }
  }
  return {
    ...candidate,
    valid: errors.length === 0,
    errors,
    payload: {
      ...candidate.payload,
      ...(errors.length > 0 ? { validationErrors: errors } : {}),
    },
  };
}

export function failedVerificationReceipt(
  snapshot: DeliveryRunSnapshot,
  proof: ProofEventRow,
  errors: string[],
): AcceptanceVerificationReceipt {
  return {
    schemaVersion: 1,
    deliveryRunId: snapshot.run.id,
    status: 'failed',
    method: snapshot.contract.deliveryPolicy.requireWebE2E ? 'web_ui_e2e' : 'automated_test',
    verifierAgentId: proof.actor_id ?? 'unknown',
    tool: 'verification-contract',
    reportRef: `proof:${proof.id}`,
    specRefs: [],
    acceptanceResults: snapshot.contract.acceptanceCriteria.map(criterion => ({
      criterion,
      status: 'failed',
      evidenceRefs: [`proof:${proof.id}`],
    })),
    validationErrors: errors,
  };
}
