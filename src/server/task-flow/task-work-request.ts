import {
  CollaborationKernel,
  type WorkRequestReceipt,
} from '../collaboration-kernel';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import type { TaskWakeup } from './task-wakeup';

export function scenarioForWakeup(wakeup: TaskWakeup): ContextScenario {
  if (wakeup.reasonCode === 'chain_ready_for_closure') return 'closure';
  if (
    wakeup.reasonCode === 'stale_review_gate'
    || wakeup.reasonCode === 'stale_test_gate'
    || wakeup.reasonCode === 'runnable_owned_idle'
    || wakeup.reasonCode === 'missing_implementation_evidence'
    || wakeup.reasonCode === 'missing_delivery_evidence'
  ) return 'recovery';
  if (
    wakeup.reasonCode === 'unblocked_unassigned'
    || wakeup.reasonCode === 'review_decision_ready'
  ) return 'planning';
  if (wakeup.reasonCode === 'review_requested') return 'code_review';
  if (wakeup.reasonCode === 'test_requested') return 'verification';
  if (wakeup.dispatchSource === 'review_gate') return 'code_review';
  if (wakeup.dispatchSource === 'test_gate') return 'verification';
  return 'execution';
}

export function requestTaskWakeup(
  wakeup: TaskWakeup,
  options: { collaboration?: CollaborationKernel; deliveryRunId?: string } = {},
): WorkRequestReceipt {
  const collaboration = options.collaboration ?? new CollaborationKernel();
  return collaboration.request({
    projectId: wakeup.conversationId,
    targetAgentId: wakeup.agentId,
    source: wakeup.dispatchSource,
    requestedAction: wakeup.prompt,
    idempotencyKey: wakeup.metadata.idempotencyKey,
    cause: {
      correlationId: wakeup.metadata.idempotencyKey,
      // The display message id may be regenerated after a restart; the durable
      // wakeup identity must replay byte-for-byte under the same request key.
      causationId: wakeup.metadata.idempotencyKey,
    },
    scope: {
      taskId: wakeup.taskId,
      deliveryRunId: options.deliveryRunId,
    },
    context: {
      scenario: scenarioForWakeup(wakeup),
      wakeup: {
        reasonCode: wakeup.reasonCode,
        reasonSummary: wakeup.metadata.reasonSummary,
        rootTaskId: wakeup.metadata.rootTaskId,
        subtreeSize: wakeup.metadata.subtreeSize,
        partial: wakeup.metadata.partial,
      },
    },
    replyTo: { type: 'task', id: wakeup.taskId },
  });
}
