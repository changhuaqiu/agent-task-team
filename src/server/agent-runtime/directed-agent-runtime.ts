import type { DispatchGatewayRequest } from '../control-plane/dispatch-gateway';
import type {
  InvocationDispatchOutcome,
  InvocationDispatchPlan,
  RuntimeAdmissionContext,
} from '../invocation-pipeline/types';
import type { AgentBindingStatus, DispatchIntent } from '../repositories/control-plane-types';
import type { ExecutionEnvelopeRow } from '../repositories/execution-envelope-repo';
import type { AgentRuntime, AgentRuntimeObserver } from './types';

export interface AgentRuntimeDispatchContext {
  envelopeId: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface AgentRuntimeExecutor {
  isBusy(agentId: string, projectId: string): boolean;
  reserve(plan: InvocationDispatchPlan): boolean;
  release(plan: InvocationDispatchPlan): void;
  execute(
    plan: InvocationDispatchPlan,
    dispatch: AgentRuntimeDispatchContext,
    lifecycle: {
      acknowledge(context: RuntimeAdmissionContext): boolean;
      signal?: AbortSignal;
    },
  ): Promise<void>;
}

export interface AgentRuntimeDispatchPort {
  requestDispatch(input: DispatchGatewayRequest): ExecutionEnvelopeRow;
  markSent(envelopeId: string): boolean;
  acknowledge(envelopeId: string): boolean;
  markExecutionFailed(envelopeId: string, reasonCode: string): void;
  reject(
    envelopeId: string,
    reasonCode: string,
    bindingStatus?: AgentBindingStatus,
  ): ExecutionEnvelopeRow;
}

export interface DirectedAgentRuntimeOptions {
  executor: AgentRuntimeExecutor;
  dispatch: AgentRuntimeDispatchPort;
  nodeId: string;
  /** Upper bound for Runtime preparation before an unacknowledged envelope expires. */
  startTtlMs?: number;
  resolveTargetNodeId(plan: InvocationDispatchPlan): string | undefined;
}

const DEFAULT_RUNTIME_START_TTL_MS = 10 * 60 * 1000;

function dispatchIntent(plan: InvocationDispatchPlan): DispatchIntent {
  if (plan.trigger.source === 'review_gate') return 'review';
  if (plan.trigger.source === 'test_gate') return 'verify';
  if (plan.trigger.source === 'a2a') return 'delegate';
  return 'implement';
}

/**
 * Deep execution-plane module. Callers submit an adjudicated Invocation plan;
 * this boundary owns directed routing, reservation, envelope acknowledgement,
 * execution admission and release.
 */
export class DirectedAgentRuntime implements AgentRuntime {
  private readonly executor: AgentRuntimeExecutor;
  private readonly dispatch: AgentRuntimeDispatchPort;
  private readonly nodeId: string;
  private readonly startTtlMs: number;
  private readonly resolveTargetNodeId: DirectedAgentRuntimeOptions['resolveTargetNodeId'];

  constructor(options: DirectedAgentRuntimeOptions) {
    this.executor = options.executor;
    this.dispatch = options.dispatch;
    this.nodeId = options.nodeId;
    this.startTtlMs = options.startTtlMs ?? DEFAULT_RUNTIME_START_TTL_MS;
    this.resolveTargetNodeId = options.resolveTargetNodeId;
  }

  isBusy(agentId: string, projectId: string): boolean {
    return this.executor.isBusy(agentId, projectId);
  }

  async execute(
    plan: InvocationDispatchPlan,
    observer?: AgentRuntimeObserver,
  ): Promise<InvocationDispatchOutcome> {
    if (observer?.signal?.aborted || observer?.canAcknowledge?.() === false) {
      return { status: 'failed', reasonCode: 'runtime_start_failed', message: 'runtime_start_cancelled' };
    }
    const targetNodeId = this.resolveTargetNodeId(plan) ?? this.nodeId;
    const isLocal = targetNodeId === this.nodeId;
    if (isLocal && !this.executor.reserve(plan)) {
      return { status: 'deferred', reasonCode: 'agent_busy' };
    }

    try {
      const envelope = this.dispatch.requestDispatch({
        source: plan.trigger.source,
        intent: dispatchIntent(plan),
        conversationId: plan.trigger.conversationId,
        taskId: plan.trigger.taskId,
        chainId: plan.trigger.chainId,
        passId: plan.trigger.passId,
        fromNodeId: this.nodeId,
        fromAgentId: plan.trigger.fromAgentId,
        toNodeId: targetNodeId,
        toAgentId: plan.trigger.agentId,
        runtimeId: plan.runtimeId,
        ttlMs: this.startTtlMs,
        payload: {
          prompt: plan.prompt,
          contextRefs: [
            ...(plan.trigger.taskId ? [`task:${plan.trigger.taskId}`] : []),
            ...(plan.trigger.chainId ? [`chain:${plan.trigger.chainId}`] : []),
            ...(plan.trigger.passId ? [`pass:${plan.trigger.passId}`] : []),
          ],
        },
      });

      if (envelope.status === 'rejected') {
        return {
          status: 'blocked',
          reasonCode: 'runtime_rejected',
          message: envelope.reason_code ?? 'runtime rejected the dispatch',
        };
      }

      if (!isLocal) {
        const rejected = this.dispatch.reject(
          envelope.id,
          'runtime_executor_not_connected',
          'unreachable',
        );
        return {
          status: 'blocked',
          reasonCode: 'runtime_rejected',
          message: rejected.reason_code ?? 'target runtime executor is not connected',
        };
      }

      if (!this.dispatch.markSent(envelope.id)) {
        this.dispatch.reject(envelope.id, 'runtime_dispatch_not_sent');
        return {
          status: 'blocked',
          reasonCode: 'runtime_rejected',
          message: 'runtime_dispatch_not_sent',
        };
      }
      let acknowledged = false;
      try {
        await this.executor.execute(plan, {
          envelopeId: envelope.id,
          sourceNodeId: this.nodeId,
          targetNodeId,
        }, {
          signal: observer?.signal,
          acknowledge: (context) => {
            if (acknowledged) return true;
            if (observer?.signal?.aborted || observer?.canAcknowledge?.() === false) return false;
            acknowledged = observer?.commitRuntimeStart
                ? observer.commitRuntimeStart(
                  envelope.id,
                  () => this.dispatch.acknowledge(envelope.id),
                  context,
                )
              : this.dispatch.acknowledge(envelope.id);
            if (acknowledged) observer?.onAcknowledged(envelope.id);
            return acknowledged;
          },
        });
      } catch (error) {
        if (acknowledged) {
          this.dispatch.markExecutionFailed(envelope.id, 'runtime_execution_failed');
        } else {
          this.dispatch.reject(envelope.id, 'runtime_start_failed');
        }
        return {
          status: 'failed',
          reasonCode: acknowledged ? 'internal_error' : 'runtime_start_failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (!acknowledged) {
        this.dispatch.reject(envelope.id, 'runtime_execution_not_acknowledged');
        return {
          status: 'blocked',
          reasonCode: 'runtime_rejected',
          message: 'runtime_execution_not_acknowledged',
        };
      }
      return { status: 'accepted', envelopeId: envelope.id };
    } finally {
      if (isLocal) this.executor.release(plan);
    }
  }
}
