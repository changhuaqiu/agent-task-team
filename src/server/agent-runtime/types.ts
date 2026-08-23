import type {
  InvocationDispatchOutcome,
  InvocationDispatchPlan,
  RuntimeAdmissionContext,
} from '../invocation-pipeline/types';

export interface AgentRuntime {
  isBusy(agentId: string, projectId: string): boolean;
  execute(
    plan: InvocationDispatchPlan,
    observer?: AgentRuntimeObserver,
  ): Promise<InvocationDispatchOutcome>;
}

export interface AgentRuntimeObserver {
  onAcknowledged(envelopeId: string): void;
  signal?: AbortSignal;
  canAcknowledge?: () => boolean;
  commitRuntimeStart?: (
    envelopeId: string,
    acknowledgeEnvelope: () => boolean,
    context: RuntimeAdmissionContext,
  ) => boolean;
}
