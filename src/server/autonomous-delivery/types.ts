export type DeliveryRunStatus =
  | 'submitted'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'verifying'
  | 'integrating'
  | 'delivering'
  | 'recovering'
  | 'completed'
  | 'escalated'
  | 'cancelled';

export type DeliveryStage = Exclude<DeliveryRunStatus, 'submitted' | 'recovering' | 'completed' | 'escalated' | 'cancelled'>;

export type DeliveryActionKind =
  | 'plan_goal'
  | 'advance_tasks'
  | 'request_review'
  | 'repair_review'
  | 'run_verification'
  | 'repair_verification'
  | 'integrate_change'
  | 'publish_delivery';

export type DeliveryActionStatus =
  | 'ready'
  | 'claimed'
  | 'running'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type DeliveryAttemptStatus = 'claimed' | 'running' | 'succeeded' | 'failed' | 'abandoned';

export interface GoalContract {
  goal: string;
  acceptanceCriteria: string[];
  scope: {
    conversationId: string;
    projectPath?: string;
    repository?: string;
  };
  authorization: {
    allowCodeChanges: boolean;
    allowPush: boolean;
    allowPullRequest: boolean;
    allowAutoMerge: boolean;
    allowedBranches?: string[];
  };
  recoveryPolicy: {
    maxAttemptsPerAction: number;
    maxRepairCycles: number;
    stallTimeoutMs: number;
  };
  deliveryPolicy: {
    requireReview: boolean;
    requireWebE2E: boolean;
    requireMerge: boolean;
  };
}

export interface DeliveryBundle {
  summary: string;
  acceptanceResults: Array<{
    criterion: string;
    status: 'passed' | 'failed';
    evidenceRefs: string[];
  }>;
  changeRefs: string[];
  verificationRefs: string[];
  verification?: {
    method: AcceptanceVerificationReceipt['method'];
    verifierAgentId: string;
    tool: string;
    reportRef: string;
    specRefs: string[];
    codeRevision?: string;
  };
  review?: {
    reviewerAgentId: string;
    summary: string;
    evidenceRefs: string[];
    codeRevision?: string;
  };
  providerRefs: string[];
  knownLimitations: string[];
  completedAt: string;
}

export interface AcceptanceVerificationReceipt {
  schemaVersion: 1;
  deliveryRunId: string;
  status: 'passed' | 'failed';
  method: 'web_ui_e2e' | 'automated_test' | 'manual_review';
  verifierAgentId: string;
  tool: string;
  reportRef: string;
  specRefs: string[];
  codeRevision?: string;
  acceptanceResults: DeliveryBundle['acceptanceResults'];
  validationErrors?: string[];
}

export interface AcceptanceReviewReceipt {
  schemaVersion: 1;
  deliveryRunId: string;
  status: 'passed' | 'failed';
  reviewerAgentId: string;
  summary: string;
  evidenceRefs: string[];
  codeRevision?: string;
  findings: Array<{
    severity: 'blocking' | 'important' | 'advisory';
    status: 'open' | 'resolved';
    description: string;
    evidenceRefs: string[];
  }>;
  validationErrors?: string[];
}

export interface DeliveryRunRow {
  id: string;
  conversation_id: string;
  root_task_id: string | null;
  status: DeliveryRunStatus;
  current_stage: string;
  goal_contract_json: string;
  repair_cycle: number;
  revision: number;
  escalation_code: string | null;
  escalation_detail: string | null;
  delivery_bundle_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DeliveryActionRow {
  id: string;
  run_id: string;
  kind: DeliveryActionKind;
  subject_type: string | null;
  subject_id: string | null;
  idempotency_key: string;
  status: DeliveryActionStatus;
  not_before: string;
  attempt_count: number;
  max_attempts: number;
  last_failure_code: string | null;
  last_failure_detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttemptRow {
  id: string;
  action_id: string;
  attempt_no: number;
  status: DeliveryAttemptStatus;
  lease_owner: string;
  lease_expires_at: string;
  heartbeat_at: string;
  workdir_ref: string | null;
  session_generation: number | null;
  execution_envelope_id: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface DeliveryReceiptRow {
  id: string;
  run_id: string;
  action_id: string | null;
  attempt_id: string | null;
  kind: string;
  external_id: string | null;
  status: string;
  payload_json: string;
  idempotency_key: string;
  observed_at: string;
}

export interface DeliveryRunSnapshot {
  run: DeliveryRunRow;
  contract: GoalContract;
  actions: DeliveryActionRow[];
  attempts: DeliveryAttemptRow[];
  receipts: DeliveryReceiptRow[];
  bundle?: DeliveryBundle;
}

export interface ClaimedDeliveryAction {
  action: DeliveryActionRow;
  attempt: DeliveryAttemptRow;
}

export interface DeliveryActionReceipt {
  kind: string;
  status: string;
  payload?: Record<string, unknown>;
  externalId?: string;
  idempotencyKey?: string;
}

export type DeliveryFailureCode =
  | 'transient_runtime'
  | 'transient_provider'
  | 'poisoned_session'
  | 'verification_failed'
  | 'policy_denied'
  | 'missing_authorization'
  | 'permanent_configuration'
  | 'unknown';
