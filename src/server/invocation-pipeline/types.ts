// Invocation Pipeline contracts.
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import type { ContextReport, ContextRequest, ContextSnapshot } from '../../lib/agent-context/ContextManager';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import type { WorkContract } from '../work-contract/types';

export type AgentActivationSource = 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';
export type AgentExecutionMode = 'standard' | 'outcome_recovery';

export interface AgentActivationCommand {
  id: string;
  source: AgentActivationSource;
  conversationId: string;
  agentId: string;
  prompt: string;
  correlationId?: string;
  causationId?: string;
  taskId?: string;
  deliveryRunId?: string;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  possessionId?: string;
  possessionRevision?: number;
  a2aHandoff?: ContextRequest['a2aHandoff'];
  idempotencyKey?: string;
  /** Stable business work identity. Retries rotate the epoch under the same workId. */
  workId?: string;
  executionMode?: AgentExecutionMode;
  contextScenario?: ContextScenario;
  legacyProposal?: boolean;
  wakeup?: ContextRequest['wakeup'];
  evaluation?: {
    executionId: string;
    caseId: string;
    applicationSnapshotId: string;
    targetManifestDigest: string;
  };
}
export interface InvocationDispatchPlan {
  trigger: AgentActivationCommand;
  engine: RuntimeCliEngine;
  accountId?: string;
  runtimeId: string;
  systemPrompt?: string;
  prompt: string;
  projectPath?: string;
  useWorktree?: boolean;
  contextScenario: ContextScenario;
  teamLogUpToEntryId?: string;
  traceId: string;
  contextReport: ContextReport;
  contextSnapshot?: ContextSnapshot;
  workContract: WorkContract;
  evaluation?: AgentActivationCommand['evaluation'] & {
    applicationManifest: object;
  };
}

export type InvocationReasonCode =
  | 'agent_busy'
  | 'duplicate_trigger'
  | 'conversation_missing'
  | 'task_missing'
  | 'task_scope_mismatch'
  | 'agent_not_in_team'
  | 'autonomous_delivery_owns_planning'
  | 'runtime_profile_missing'
  | 'required_skill_not_loaded'
  | 'skill_manifest_invalid'
  | 'skill_package_missing'
  | 'skill_path_invalid'
  | 'skill_path_duplicate'
  | 'skill_revision_mismatch'
  | 'required_context_missing'
  | 'context_assembly_failed'
  | 'a2a_possession_stale'
  | 'work_authority_conflict'
  | 'runtime_rejected'
  | 'internal_error';

export type InvocationDispatchOutcome =
  | { status: 'accepted'; envelopeId?: string }
  | { status: 'deferred'; reasonCode: 'agent_busy' }
  | {
      status: 'blocked';
      reasonCode: InvocationReasonCode;
      message?: string;
      evidence?: InvocationFailureEvidence;
    }
  | {
      status: 'failed';
      reasonCode: InvocationReasonCode;
      message?: string;
      evidence?: InvocationFailureEvidence;
    };

export interface InvocationFailureEvidence {
  traceId?: string;
  snapshotId?: string;
  missingRequired?: string[];
}

export interface InvocationPlanResult {
  ok: true;
  plan: InvocationDispatchPlan;
}

export interface InvocationPlanFailure {
  ok: false;
  outcome: Extract<InvocationDispatchOutcome, { status: 'blocked' | 'failed' }>;
}

export type InvocationPlanResolution = InvocationPlanResult | InvocationPlanFailure;

export interface InvocationPlannerPort {
  prepare(trigger: AgentActivationCommand): Promise<InvocationPlanResolution>;
}

export interface AgentRuntimePort {
  isBusy(agentId: string, conversationId: string): boolean;
  execute(plan: InvocationDispatchPlan): Promise<InvocationDispatchOutcome>;
}

export interface InvocationSubmission {
  disposition: 'accepted' | 'duplicate' | 'deferred';
  handled: boolean;
  completion: Promise<InvocationDispatchOutcome>;
  duplicateInFlight?: boolean;
}
