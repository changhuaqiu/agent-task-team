import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskRepo } from '../repositories/task-repo';
import type {
  AcceptanceReviewReceipt,
  AcceptanceVerificationReceipt,
  DeliveryBundle,
  DeliveryRunSnapshot,
} from './types';

function receiptPayload<T>(
  snapshot: DeliveryRunSnapshot,
  kind: string,
  valid: (value: T) => boolean,
): T | undefined {
  return [...snapshot.receipts].reverse().flatMap((receipt) => {
    if (receipt.kind !== kind) return [];
    try {
      const value = JSON.parse(receipt.payload_json) as T;
      return valid(value) ? [value] : [];
    } catch {
      return [];
    }
  })[0];
}

function verificationReceipt(
  snapshot: DeliveryRunSnapshot,
): AcceptanceVerificationReceipt | undefined {
  return receiptPayload<AcceptanceVerificationReceipt>(
    snapshot,
    'verification.acceptance',
    (value) => value.schemaVersion === 1
      && value.deliveryRunId === snapshot.run.id
      && value.status === 'passed'
      && Array.isArray(value.acceptanceResults),
  );
}

function reviewReceipt(snapshot: DeliveryRunSnapshot): AcceptanceReviewReceipt | undefined {
  return receiptPayload<AcceptanceReviewReceipt>(
    snapshot,
    'review.acceptance',
    (value) => value.schemaVersion === 1
      && value.deliveryRunId === snapshot.run.id
      && value.status === 'passed'
      && Array.isArray(value.findings),
  );
}

function acceptedDeliveryProofIds(conversationId: string): string[] {
  return proofLogRepo.getByConversation(conversationId, { limit: 2_000 })
    .filter((proof) => {
      if (proof.event_type !== 'task_graph.gate_evidence.accepted') return false;
      try {
        const metadata = proof.metadata ? JSON.parse(proof.metadata) as Record<string, unknown> : {};
        return metadata.gateName === 'delivery_evidence';
      } catch {
        return false;
      }
    })
    .map((proof) => `proof:${proof.id}`);
}

export function buildDeliveryBundle(
  snapshot: DeliveryRunSnapshot,
  now: Date = new Date(),
): DeliveryBundle {
  const verification = verificationReceipt(snapshot);
  if (!verification) throw new Error('delivery_verification_receipt_missing');
  const review = reviewReceipt(snapshot);
  if (snapshot.contract.deliveryPolicy.requireReview && !review) {
    throw new Error('delivery_review_receipt_missing');
  }
  const tasks = taskRepo.getByConversation(snapshot.run.conversation_id);
  if (tasks.length === 0 || tasks.some((task) => task.status !== 'done')) {
    throw new Error('delivery_tasks_not_complete');
  }
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
      ...verification.acceptanceResults.flatMap((result) => result.evidenceRefs),
      ...acceptedDeliveryProofIds(snapshot.run.conversation_id),
      ...snapshot.receipts.map((receipt) => `receipt:${receipt.id}`),
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
    completedAt: now.toISOString(),
  };
}
