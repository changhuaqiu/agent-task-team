export type DeliveryRunStatus =
  | 'active'
  | 'waiting_gate'
  | 'waiting_human'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DeliveryStage =
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'verifying'
  | 'integrating'
  | 'delivering';

interface GitHubIssueGoalSource {
  kind: 'github_issue';
  externalId: string;
  url: string;
  title: string;
  description: string;
  repository: string;
  issueNumber: number;
  labels: string[];
  sender: string;
}

export interface GoalContract {
  idempotencyKey: string;
  correlationId?: string;
  goal: string;
  acceptanceCriteria: string[];
  source?: GitHubIssueGoalSource;
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
  gateId?: string;
  gateEvidenceId?: string;
  artifactRevision?: string;
  validationErrors?: string[];
}

export function resolveGoalCorrelationId(contract: GoalContract): string {
  return contract.correlationId?.trim()
    || `delivery-start:${contract.idempotencyKey.trim()}`;
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
  gateId?: string;
  gateEvidenceId?: string;
  artifactRevision?: string;
  validationErrors?: string[];
}

export interface DeliveryRunRow {
  id: string;
  conversation_id: string;
  start_idempotency_key: string;
  root_task_id: string | null;
  status: DeliveryRunStatus;
  current_stage: DeliveryStage;
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

export interface DeliveryReceiptRow {
  id: string;
  run_id: string;
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
  receipts: DeliveryReceiptRow[];
  bundle?: DeliveryBundle;
}

export type AdvancementCause =
  | {
      kind: 'started' | 'fact_changed' | 'periodic_reconcile';
      ref?: string;
    }
  | {
      kind: 'manual_resume';
      idempotencyKey: string;
      actor: { type: 'user'; id: string };
      correlationId?: string;
    };

export interface AdvanceResult {
  disposition: 'acted' | 'waiting' | 'waiting_human' | 'completed' | 'failed' | 'busy';
  snapshot: DeliveryRunSnapshot;
  actionId?: string;
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
