import type {
  AcceptanceReviewReceipt,
  AcceptanceVerificationReceipt,
  DeliveryRunSnapshot,
} from '../autonomous-delivery/types';
import { validateAcceptanceVerificationReceipt } from '../autonomous-delivery/verification-receipt';

type DeliveryGateKind = 'delivery_review' | 'acceptance_verification';
type GateDecision = 'passed' | 'changes_requested' | 'rejected';

export type ValidatedDeliveryGateReceipt =
  | AcceptanceReviewReceipt
  | AcceptanceVerificationReceipt;

export type DeliveryGateReceiptValidation =
  | { valid: true; receipt: ValidatedDeliveryGateReceipt }
  | { valid: false; reasonCode: string };

export function validateDeliveryGateReceipt(input: {
  kind: DeliveryGateKind;
  runId: string;
  agentId: string;
  decision: GateDecision;
  receipt: unknown;
  snapshot: DeliveryRunSnapshot;
}): DeliveryGateReceiptValidation {
  if (input.kind === 'acceptance_verification') {
    const candidate = validateAcceptanceVerificationReceipt(input.receipt, input.snapshot);
    if (!candidate.valid || !candidate.payload) {
      return {
        valid: false,
        reasonCode: `gate_outcome_verification_receipt_invalid:${candidate.errors.join(',')}`,
      };
    }
    if (candidate.payload.verifierAgentId !== input.agentId) {
      return { valid: false, reasonCode: 'gate_outcome_verifier_mismatch' };
    }
    if ((input.decision === 'passed') !== (candidate.payload.status === 'passed')) {
      return { valid: false, reasonCode: 'gate_outcome_verification_decision_mismatch' };
    }
    return { valid: true, receipt: candidate.payload };
  }

  const receipt = input.receipt as Partial<AcceptanceReviewReceipt> | undefined;
  if (
    !receipt
    || receipt.schemaVersion !== 1
    || receipt.deliveryRunId !== input.runId
    || receipt.reviewerAgentId !== input.agentId
    || !Array.isArray(receipt.findings)
    || !Array.isArray(receipt.evidenceRefs)
    || !receipt.summary?.trim()
    || !['passed', 'failed'].includes(String(receipt.status))
    || ((input.decision === 'passed') !== (receipt.status === 'passed'))
  ) return { valid: false, reasonCode: 'gate_outcome_review_receipt_invalid' };
  return { valid: true, receipt: receipt as AcceptanceReviewReceipt };
}
