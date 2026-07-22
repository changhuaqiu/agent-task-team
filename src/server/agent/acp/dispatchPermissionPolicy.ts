import type { DeliveryRunStatus } from '../../autonomous-delivery/types';
import type { AcpPermissionDecision, AcpPermissionPolicy } from './permissionPolicy';

const TERMINAL_DELIVERY_STATUSES = new Set<DeliveryRunStatus>([
  'completed',
  'escalated',
  'cancelled',
]);

export interface AcpDispatchAuthorization {
  runId: string;
  conversationId: string;
  status: DeliveryRunStatus;
  allowCodeChanges: boolean;
}

/**
 * Resolve the permission boundary for one ACP Invocation.
 *
 * The operator override remains explicit. Otherwise, only a non-terminal
 * autonomous DeliveryRun whose GoalContract authorizes code changes can grant
 * one-shot native tool access. Callers must load the run for the same
 * Conversation so authorization never leaks between projects.
 */
export function resolveAcpDispatchPermissionPolicy(input: {
  operatorMode?: string;
  deliveryRunId?: string;
  conversationId?: string;
  autonomous?: AcpDispatchAuthorization;
}): AcpPermissionDecision {
  if (input.operatorMode === 'deny') return 'deny';
  if (input.operatorMode === 'allow_once') return 'allow_once';
  if (
    input.deliveryRunId
    && input.conversationId
    && input.autonomous?.runId === input.deliveryRunId
    && input.autonomous.conversationId === input.conversationId
    && input.autonomous.allowCodeChanges === true
    && !TERMINAL_DELIVERY_STATUSES.has(input.autonomous.status)
  ) {
    return 'allow_once';
  }
  return 'deny';
}

/**
 * Build a policy that re-reads the exact DeliveryRun for every permission
 * request. This prevents a backend created for an active run from retaining
 * authority after that run is cancelled or otherwise reaches a terminal state.
 */
export function createAcpDispatchPermissionPolicy(input: {
  operatorMode?: string;
  deliveryRunId?: string;
  conversationId: string;
  getAuthorization(runId: string): AcpDispatchAuthorization | undefined;
}): AcpPermissionPolicy {
  return () => resolveAcpDispatchPermissionPolicy({
    operatorMode: input.operatorMode,
    deliveryRunId: input.deliveryRunId,
    conversationId: input.conversationId,
    autonomous: input.deliveryRunId
      ? input.getAuthorization(input.deliveryRunId)
      : undefined,
  });
}
