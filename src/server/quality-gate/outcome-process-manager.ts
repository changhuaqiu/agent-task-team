import type Database from 'better-sqlite3';
import type {
  AcceptanceReviewReceipt,
  AcceptanceVerificationReceipt,
} from '../autonomous-delivery/types';
import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import { validateAcceptanceVerificationReceipt } from '../autonomous-delivery/verification-receipt';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import { QualityGateInvariantError, QualityGateRepository } from './repository';
import type { QualityGateDecision, QualityGateRow } from './types';

type OutcomeDecision = Exclude<QualityGateDecision, 'cancelled'>;

interface GateOutcomePayload {
  gateId: string;
  decision: OutcomeDecision;
  reason?: string;
  evidenceType: string;
  evidence: unknown;
  receipt?: unknown;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new QualityGateInvariantError(`gate_outcome_${field}_required`);
  }
  return value.trim();
}

function parsePayload(value: string): GateOutcomePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new QualityGateInvariantError('gate_outcome_json_invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityGateInvariantError('gate_outcome_payload_invalid');
  }
  const record = parsed as Record<string, unknown>;
  if (!['passed', 'changes_requested', 'rejected'].includes(String(record.decision))) {
    throw new QualityGateInvariantError('gate_outcome_decision_invalid');
  }
  const reason = typeof record.reason === 'string' && record.reason.trim()
    ? record.reason.trim()
    : undefined;
  return {
    gateId: requiredString(record.gateId, 'gate_id'),
    decision: record.decision as OutcomeDecision,
    ...(reason ? { reason } : {}),
    evidenceType: requiredString(record.evidenceType, 'evidence_type'),
    evidence: record.evidence ?? {},
    receipt: record.receipt,
  };
}

function assertContractTarget(gate: QualityGateRow, contract: WorkContractRow): void {
  if (gate.conversation_id !== contract.project_id) {
    throw new QualityGateInvariantError('gate_outcome_project_mismatch');
  }
  if (gate.target_type === 'task' && gate.target_id !== contract.task_id) {
    throw new QualityGateInvariantError('gate_outcome_task_mismatch');
  }
  if (gate.target_type === 'delivery_run' && gate.target_id !== contract.delivery_run_id) {
    throw new QualityGateInvariantError('gate_outcome_delivery_mismatch');
  }
}

function deliveryReceipt(
  gate: QualityGateRow,
  contract: WorkContractRow,
  payload: GateOutcomePayload,
): AcceptanceReviewReceipt | AcceptanceVerificationReceipt | undefined {
  if (gate.target_type !== 'delivery_run') return undefined;
  const runId = contract.delivery_run_id;
  const snapshot = runId ? autonomousDeliveryRepo.getSnapshot(runId) : undefined;
  if (!snapshot) throw new QualityGateInvariantError('gate_outcome_delivery_missing');
  if (gate.kind === 'acceptance_verification') {
    const candidate = validateAcceptanceVerificationReceipt(payload.receipt, snapshot);
    if (!candidate.valid || !candidate.payload) {
      throw new QualityGateInvariantError(
        `gate_outcome_verification_receipt_invalid:${candidate.errors.join(',')}`,
      );
    }
    if (candidate.payload.verifierAgentId !== contract.agent_id) {
      throw new QualityGateInvariantError('gate_outcome_verifier_mismatch');
    }
    if (
      (payload.decision === 'passed') !== (candidate.payload.status === 'passed')
    ) throw new QualityGateInvariantError('gate_outcome_verification_decision_mismatch');
    return candidate.payload;
  }
  if (gate.kind === 'delivery_review') {
    const receipt = payload.receipt as Partial<AcceptanceReviewReceipt> | undefined;
    if (
      !receipt
      || receipt.schemaVersion !== 1
      || receipt.deliveryRunId !== runId
      || receipt.reviewerAgentId !== contract.agent_id
      || !Array.isArray(receipt.findings)
      || !Array.isArray(receipt.evidenceRefs)
      || !receipt.summary?.trim()
      || !['passed', 'failed'].includes(String(receipt.status))
      || ((payload.decision === 'passed') !== (receipt.status === 'passed'))
    ) throw new QualityGateInvariantError('gate_outcome_review_receipt_invalid');
    return receipt as AcceptanceReviewReceipt;
  }
  return undefined;
}

export interface GateOutcomeProcessManagerOptions {
  db?: Database.Database;
  gates?: QualityGateRepository;
}

export class GateOutcomeProcessManager {
  private readonly database?: Database.Database;
  private readonly gates: QualityGateRepository;

  constructor(options: GateOutcomeProcessManagerOptions = {}) {
    this.database = options.db;
    this.gates = options.gates ?? new QualityGateRepository();
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.type !== 'agent.outcome.accepted') return;
    if (signal.aborted) throw signal.reason ?? new Error('gate_outcome_processing_aborted');
    const db = this.database ?? getDb();
    const outcome = db.prepare(`
      SELECT * FROM agent_outcome
      WHERE id=? AND admission_status='accepted' AND outcome_type='record_gate_decision'
    `).get(event.aggregate.id) as AgentOutcomeRow | undefined;
    if (!outcome) return;
    const contract = db.prepare('SELECT * FROM work_contract WHERE id=?')
      .get(outcome.contract_id) as WorkContractRow | undefined;
    if (!contract) throw new QualityGateInvariantError('gate_outcome_contract_missing');
    const payload = parsePayload(outcome.payload_json);
    const gate = this.gates.get(payload.gateId);
    if (!gate) throw new QualityGateInvariantError('gate_outcome_gate_missing');
    assertContractTarget(gate, contract);
    const receipt = deliveryReceipt(gate, contract, payload);
    const evidenceKey = `agent-outcome:${outcome.id}`;
    const current = this.gates.getSnapshot(gate.id)!;
    const existingEvidence = current.evidence.find((item) =>
      item.idempotency_key === evidenceKey
    );
    if (current.decision) {
      if (
        current.decision.decision !== payload.decision
        || current.decision.evaluator_id !== contract.agent_id
        || !existingEvidence
      ) throw new QualityGateInvariantError('gate_outcome_terminal_conflict');
      this.recordDeliveryReceipt(gate, outcome, receipt);
      return;
    }
    const evidence = existingEvidence ?? this.gates.submitEvidence({
      gateId: gate.id,
      evidenceType: payload.evidenceType,
      payload: {
        evidence: payload.evidence,
        evidenceRefs: JSON.parse(outcome.evidence_refs_json) as unknown,
        outcomeId: outcome.id,
      },
      sourceRef: `agent-outcome:${outcome.id}`,
      actor: { type: 'agent', id: contract.agent_id },
      idempotencyKey: evidenceKey,
    });
    const evaluating = current.gate.status === 'requested'
      ? this.gates.beginEvaluation({
          gateId: gate.id,
          evaluator: { type: 'agent', id: contract.agent_id },
          expectedRevision: current.gate.revision,
        })
      : this.gates.getSnapshot(gate.id)!;
    this.gates.decide({
      gateId: gate.id,
      decision: payload.decision,
      evaluator: { type: 'agent', id: contract.agent_id },
      evidenceIds: [evidence.id],
      reason: payload.reason,
      expectedRevision: evaluating.gate.revision,
    });
    this.recordDeliveryReceipt(gate, outcome, receipt);
  };

  private recordDeliveryReceipt(
    gate: QualityGateRow,
    outcome: AgentOutcomeRow,
    receipt: AcceptanceReviewReceipt | AcceptanceVerificationReceipt | undefined,
  ): void {
    if (!receipt || gate.target_type !== 'delivery_run') return;
    autonomousDeliveryRepo.recordReceipt({
      runId: gate.target_id,
      receipt: {
        kind: gate.kind === 'delivery_review'
          ? 'review.acceptance'
          : 'verification.acceptance',
        status: receipt.status,
        externalId: gate.id,
        payload: { ...receipt, gateId: gate.id },
        idempotencyKey: `${gate.target_id}:${gate.kind}:outcome:${outcome.id}`,
      },
    });
  }
}
