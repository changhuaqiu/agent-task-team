import type { DeliveryRunStatus } from '../../autonomous-delivery/types';
import type { AcpPermissionDecision } from './permissionPolicy';

const TERMINAL_DELIVERY_STATUSES = new Set<DeliveryRunStatus>([
  'completed',
  'escalated',
  'cancelled',
]);

export interface AcpDispatchAuthorization {
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
  autonomous?: AcpDispatchAuthorization;
}): AcpPermissionDecision {
  if (input.operatorMode === 'deny') return 'deny';
  if (input.operatorMode === 'allow_once') return 'allow_once';
  if (
    input.autonomous?.allowCodeChanges === true
    && !TERMINAL_DELIVERY_STATUSES.has(input.autonomous.status)
  ) {
    return 'allow_once';
  }
  return 'deny';
}
