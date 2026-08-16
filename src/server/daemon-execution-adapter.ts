import type {
  AgentRuntimePort,
  InvocationDispatchOutcome,
  InvocationDispatchPlan,
} from './invocation-pipeline';
import type { DispatchGatewayRequest } from './control-plane/dispatch-gateway';
import type { AgentBindingStatus, DispatchIntent } from './repositories/control-plane-types';
import type { ExecutionEnvelopeRow } from './repositories/execution-envelope-repo';

export interface DaemonExecutionDispatchContext {
  envelopeId: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface DaemonExecutionBackend {
  isBusy(agentId: string, deliveryId: string): boolean;
  reserve(plan: InvocationDispatchPlan): boolean;
  release(plan: InvocationDispatchPlan): void;
  execute(plan: InvocationDispatchPlan, dispatch: DaemonExecutionDispatchContext): Promise<void>;
}

export interface DaemonDispatchPort {
  requestDispatch(input: DispatchGatewayRequest): ExecutionEnvelopeRow;
  markSent(envelopeId: string): void;
  acknowledge(envelopeId: string): void;
  reject(
    envelopeId: string,
    reasonCode: string,
    bindingStatus?: AgentBindingStatus,
  ): ExecutionEnvelopeRow;
}

export interface DaemonExecutionAdapterOptions {
  backend: DaemonExecutionBackend;
  dispatch: DaemonDispatchPort;
  nodeId: string;
  resolveTargetNodeId(plan: InvocationDispatchPlan): string | undefined;
}

function dispatchIntent(plan: InvocationDispatchPlan): DispatchIntent {
  if (plan.trigger.source === 'review_gate') return 'review';
  if (plan.trigger.source === 'test_gate') return 'verify';
  if (plan.trigger.source === 'a2a') return 'delegate';
  return 'implement';
}

/**
 * The daemon's sole control-plane port. It creates and acknowledges a directed
 * envelope before slow execution setup, and it will never execute work routed
 * to a different node. A deployment that owns another node instantiates the
 * same adapter with that node id.
 */
export class DaemonExecutionAdapter implements AgentRuntimePort {
  private readonly backend: DaemonExecutionBackend;
  private readonly dispatch: DaemonDispatchPort;
  private readonly nodeId: string;
  private readonly resolveTargetNodeId: DaemonExecutionAdapterOptions['resolveTargetNodeId'];

  constructor(options: DaemonExecutionAdapterOptions) {
    this.backend = options.backend;
    this.dispatch = options.dispatch;
    this.nodeId = options.nodeId;
    this.resolveTargetNodeId = options.resolveTargetNodeId;
  }

  isBusy(agentId: string, conversationId: string): boolean {
    return this.backend.isBusy(agentId, conversationId);
  }

  async execute(plan: InvocationDispatchPlan): Promise<InvocationDispatchOutcome> {
    const targetNodeId = this.resolveTargetNodeId(plan) ?? this.nodeId;
    const localReservation = targetNodeId === this.nodeId;
    if (localReservation && !this.backend.reserve(plan)) {
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

      if (!localReservation) {
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

      this.dispatch.markSent(envelope.id);
      this.dispatch.acknowledge(envelope.id);
      await this.backend.execute(plan, {
        envelopeId: envelope.id,
        sourceNodeId: this.nodeId,
        targetNodeId,
      });
      return { status: 'accepted', envelopeId: envelope.id };
    } finally {
      if (localReservation) this.backend.release(plan);
    }
  }
}
