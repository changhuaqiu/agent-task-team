export const AGENT_OUTCOME_TYPES = [
  'continue_work',
  'propose_task_graph',
  'submit_task_result',
  'request_review',
  'record_gate_decision',
  'handoff_to_agent',
  'report_blocked',
  'request_human_decision',
] as const;

export type AgentOutcomeType = (typeof AGENT_OUTCOME_TYPES)[number];

export interface WorkContractRow {
  id: string;
  work_id: string;
  work_epoch: number;
  attempt_id: string;
  fencing_token: string;
  project_id: string;
  task_id: string | null;
  delivery_run_id: string | null;
  agent_id: string;
  goal: string;
  acceptance_criteria_json: string;
  role_json: string;
  permissions_json: string;
  authoritative_refs_json: string;
  authoritative_revisions_json: string;
  context_snapshot_ref: string;
  allowed_outcome_types_json: string;
  deadline_at: string | null;
  budget_json: string;
  correlation_id: string;
  causation_id: string;
  created_at: string;
}

export interface WorkAuthorityRow {
  work_id: string;
  project_id: string;
  current_epoch: number;
  current_contract_id: string;
  status: 'active' | 'closed';
  revision: number;
  updated_at: string;
  closed_at: string | null;
}

export interface AgentOutcomeRow {
  id: string;
  idempotency_key: string;
  contract_id: string;
  project_id: string;
  work_id: string;
  work_epoch: number;
  attempt_id: string;
  fencing_token: string;
  outcome_type: AgentOutcomeType;
  payload_json: string;
  evidence_refs_json: string;
  authoritative_revisions_json: string;
  correlation_id: string;
  causation_id: string;
  occurred_at: string;
  admission_status: 'accepted' | 'rejected';
  rejection_reason: string | null;
  recorded_at: string;
}

export interface WorkContract {
  contractId: string;
  workId: string;
  workEpoch: number;
  attemptId: string;
  fencingToken: string;
  projectId: string;
  taskId?: string;
  deliveryRunId?: string;
  agentId: string;
  goal: string;
  acceptanceCriteria: string[];
  role: unknown;
  permissions: unknown;
  authoritativeRefs: string[];
  authoritativeRevisions: Record<string, string | number>;
  contextSnapshotRef: string;
  allowedOutcomeTypes: AgentOutcomeType[];
  deadlineAt?: string;
  budget: unknown;
  correlationId: string;
  causationId: string;
  createdAt: string;
}

export interface AgentOutcome {
  outcomeId: string;
  idempotencyKey: string;
  contractId: string;
  outcomeType: AgentOutcomeType;
  payload: unknown;
  evidenceRefs: string[];
  projectId: string;
  workId: string;
  workEpoch: number;
  attemptId: string;
  fencingToken: string;
  authoritativeRevisions: Record<string, string | number>;
  correlationId: string;
  causationId: string;
  occurredAt: string;
}
