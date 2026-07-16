import type { CliEngine } from '../types';
import type { ContextReport, ContextRequest } from '../../lib/agent-context/ContextManager';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';

export type HarnessTriggerSource = 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';

export interface HarnessTrigger {
  id: string;
  source: HarnessTriggerSource;
  conversationId: string;
  agentId: string;
  prompt: string;
  taskId?: string;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  idempotencyKey?: string;
  wakeup?: ContextRequest['wakeup'];
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
}

export type HarnessReasonCode =
  | 'agent_busy'
  | 'duplicate_trigger'
  | 'conversation_missing'
  | 'task_missing'
  | 'agent_not_in_team'
  | 'runtime_profile_missing'
  | 'context_assembly_failed'
  | 'runtime_rejected'
  | 'internal_error';

export type HarnessOutcome =
  | { status: 'accepted'; envelopeId?: string }
  | { status: 'deferred'; reasonCode: 'agent_busy' }
  | { status: 'blocked'; reasonCode: HarnessReasonCode; message?: string }
  | { status: 'failed'; reasonCode: HarnessReasonCode; message?: string };

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
}
