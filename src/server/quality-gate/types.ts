export type QualityGateKind =
  | 'implementation_readiness'
  | 'code_review'
  | 'delivery_review'
  | 'acceptance_verification'
  | 'integration';

export type QualityGateTargetType = 'task' | 'delivery_run';

export type QualityGateStatus =
  | 'requested'
  | 'evaluating'
  | 'passed'
  | 'changes_requested'
  | 'rejected'
  | 'cancelled';

export type QualityGateDecision = Extract<
  QualityGateStatus,
  'passed' | 'changes_requested' | 'rejected' | 'cancelled'
>;

export interface QualityGateActor {
  type: 'user' | 'agent' | 'system';
  id: string;
}

export interface QualityGateRow {
  id: string;
  conversation_id: string;
  kind: QualityGateKind;
  target_type: QualityGateTargetType;
  target_id: string;
  artifact_revision: string;
  status: QualityGateStatus;
  criteria_json: string;
  policy_json: string;
  requested_by_type: QualityGateActor['type'];
  requested_by: string;
  evaluator_type: QualityGateActor['type'] | null;
  evaluator_id: string | null;
  decision_reason: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

export interface QualityGateEvidenceRow {
  id: string;
  gate_id: string;
  evidence_type: string;
  payload_json: string;
  source_ref: string | null;
  submitted_by_type: QualityGateActor['type'];
  submitted_by: string;
  idempotency_key: string;
  created_at: string;
}

export interface QualityGateDecisionRow {
  id: string;
  gate_id: string;
  decision: QualityGateDecision;
  evaluator_type: QualityGateActor['type'];
  evaluator_id: string;
  reason: string | null;
  evidence_ids_json: string;
  created_at: string;
}

export interface QualityGateSnapshot {
  gate: QualityGateRow;
  criteria: unknown;
  policy: unknown;
  evidence: QualityGateEvidenceRow[];
  decision?: QualityGateDecisionRow;
}
