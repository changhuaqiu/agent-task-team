'use client';

export const AGENT_OBSERVABILITY_OPEN_EVENT = 'observability:open';

export type AgentObservabilityTarget = {
  conversationId: string;
  invocationId?: string;
  traceId?: string;
  agentId?: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
  timestamp?: string;
};

export function openAgentObservabilityDrawer(target: AgentObservabilityTarget) {
  window.dispatchEvent(new CustomEvent<AgentObservabilityTarget>(
    AGENT_OBSERVABILITY_OPEN_EVENT,
    { detail: target },
  ));
}
