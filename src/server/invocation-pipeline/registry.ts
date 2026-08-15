// Shared Invocation Pipeline registry.
import type { Server as IOServer } from 'socket.io';
import type { TaskWakeup } from '../task-flow/task-wakeup';
import type { InvocationCoordinator } from './coordinator';
import type { AgentActivationCommand, InvocationSubmission } from './types';
import { reduceAcceptedWakeup } from './outcome-reducer';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';

const coordinators = new WeakMap<IOServer, InvocationCoordinator>();
const INVOCATION_COORDINATOR_KEY = Symbol.for('agent-task-hub.invocation-pipeline.coordinator');

function getCoordinator(io: IOServer | undefined): InvocationCoordinator | undefined {
  if (!io) return undefined;
  return coordinators.get(io)
    ?? ((io as unknown as Record<symbol, unknown>)[INVOCATION_COORDINATOR_KEY] as InvocationCoordinator | undefined);
}

export function registerInvocationCoordinator(io: IOServer, coordinator: InvocationCoordinator): void {
  coordinators.set(io, coordinator);
  (io as unknown as Record<symbol, unknown>)[INVOCATION_COORDINATOR_KEY] = coordinator;
}

function submitAgentActivation(
  io: IOServer | undefined,
  trigger: AgentActivationCommand,
): InvocationSubmission | undefined {
  return getCoordinator(io)?.submit(trigger);
}

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

export function submitTaskWakeupToInvocationPipeline(
  io: IOServer | undefined,
  wakeup: TaskWakeup,
  contextScenario: ContextScenario = scenarioForWakeup(wakeup),
  deliveryRunId?: string,
): InvocationSubmission | undefined {
  if (!io) return undefined;
  const submission = submitAgentActivation(io, {
    id: wakeup.id ?? `wakeup:${wakeup.metadata.idempotencyKey}`,
    source: wakeup.dispatchSource,
    conversationId: wakeup.conversationId,
    taskId: wakeup.taskId,
    deliveryRunId,
    agentId: wakeup.agentId,
    prompt: wakeup.prompt,
    idempotencyKey: wakeup.metadata.idempotencyKey,
    contextScenario,
    wakeup: {
      reasonCode: wakeup.reasonCode,
      reasonSummary: wakeup.metadata.reasonSummary,
      rootTaskId: wakeup.metadata.rootTaskId,
      subtreeSize: wakeup.metadata.subtreeSize,
      partial: wakeup.metadata.partial,
    },
  });

  if (submission?.handled && submission.disposition === 'accepted') {
    void submission.completion.then((outcome) => {
      if (outcome.status === 'accepted') {
        void reduceAcceptedWakeup(io, wakeup);
        return;
      }
      if (outcome.status !== 'blocked' && outcome.status !== 'failed') return;
      io.to(wakeup.conversationId).emit('task.wakeup', {
        ...wakeup,
        id: `${wakeup.id ?? 'wakeup'}:execution-failed`,
        projectId: wakeup.conversationId,
        content: `服务端未能启动 @${wakeup.agentId}：${outcome.reasonCode}`,
        metadata: {
          ...wakeup.metadata,
          executionReasonCode: outcome.reasonCode,
        },
        createdAt: new Date().toISOString(),
      });
    });
  }
  return submission;
}
