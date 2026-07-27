import type { CliEngine } from '../types';
import type { ContextReport, ContextRequest, ContextSnapshot } from '../../lib/agent-context/ContextManager';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import type { WorkContract } from '../work-contract/types';

export type HarnessTriggerSource = 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';

export interface HarnessTrigger {
  id: string;
  source: HarnessTriggerSource;
  conversationId: string;
  agentId: string;
  prompt: string;
  taskId?: string;
  deliveryRunId?: string;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  idempotencyKey?: string;
  /** Stable business work identity. Retries rotate the epoch under the same workId. */
  workId?: string;
  contextScenario?: ContextScenario;
  wakeup?: ContextRequest['wakeup'];
  evaluation?: {
    executionId: string;
    caseId: string;
    applicationSnapshotId: string;
    targetManifestDigest: string;
  };
}
export interface HarnessDispatchPlan {
  trigger: HarnessTrigger;
  engine: CliEngine;
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
  evaluation?: HarnessTrigger['evaluation'] & {
    applicationManifest: object;
  };
}

export type HarnessReasonCode =
  | 'agent_busy'
  | 'duplicate_trigger'
  | 'conversation_missing'
  | 'task_missing'
  | 'task_scope_mismatch'
  | 'agent_not_in_team'
  | 'runtime_profile_missing'
  | 'required_skill_not_loaded'
  | 'skill_manifest_invalid'
  | 'skill_package_missing'
  | 'skill_path_invalid'
  | 'skill_path_duplicate'
  | 'skill_revision_mismatch'
  | 'required_context_missing'
  | 'context_assembly_failed'
  | 'work_authority_conflict'
  | 'runtime_rejected'
  | 'internal_error';

export type HarnessOutcome =
  | { status: 'accepted'; envelopeId?: string }
  | { status: 'deferred'; reasonCode: 'agent_busy' }
  | {
      status: 'blocked';
      reasonCode: HarnessReasonCode;
      message?: string;
      evidence?: HarnessFailureEvidence;
    }
  | {
      status: 'failed';
      reasonCode: HarnessReasonCode;
      message?: string;
      evidence?: HarnessFailureEvidence;
    };

export interface HarnessFailureEvidence {
  traceId?: string;
  snapshotId?: string;
  missingRequired?: string[];
}

export interface HarnessPlanResult {
  ok: true;
  plan: HarnessDispatchPlan;
}

export interface HarnessPlanFailure {
  ok: false;
  outcome: Extract<HarnessOutcome, { status: 'blocked' | 'failed' }>;
}

export type HarnessPlanResolution = HarnessPlanResult | HarnessPlanFailure;

export interface HarnessPlanner {
  prepare(trigger: HarnessTrigger): Promise<HarnessPlanResolution>;
}

export interface HarnessRuntimePort {
  isBusy(agentId: string, conversationId: string): boolean;
  execute(plan: HarnessDispatchPlan): Promise<HarnessOutcome>;
}

export interface HarnessSubmission {
  disposition: 'accepted' | 'duplicate' | 'deferred';
  handled: boolean;
  completion: Promise<HarnessOutcome>;
  duplicateInFlight?: boolean;
}
