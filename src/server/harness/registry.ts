import type { Server as IOServer } from 'socket.io';
import type { TaskWakeup } from '../task-flow/task-wakeup';
import type { HarnessCoordinator } from './coordinator';
import type { HarnessSubmission, HarnessTrigger } from './types';
import { reduceAcceptedWakeup } from './outcome-reducer';

const coordinators = new WeakMap<IOServer, HarnessCoordinator>();

export function registerHarnessCoordinator(io: IOServer, coordinator: HarnessCoordinator): void {
  coordinators.set(io, coordinator);
}

export function submitHarnessTrigger(io: IOServer | undefined, trigger: HarnessTrigger): HarnessSubmission | undefined {
  if (!io) return undefined;
  return coordinators.get(io)?.submit(trigger);
}

export function submitTaskWakeupToHarness(io: IOServer | undefined, wakeup: TaskWakeup): HarnessSubmission | undefined {
  if (!io) return undefined;
  const submission = submitHarnessTrigger(io, {
    id: wakeup.id ?? `wakeup:${wakeup.metadata.idempotencyKey}`,
    source: wakeup.dispatchSource,
    conversationId: wakeup.conversationId,
    taskId: wakeup.taskId,
    agentId: wakeup.agentId,
    prompt: wakeup.prompt,
    idempotencyKey: wakeup.metadata.idempotencyKey,
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
        id: `${wakeup.id ?? 'wakeup'}:fallback`,
        content: undefined,
        handledByHarness: false,
        harnessFallbackReasonCode: outcome.reasonCode,
        createdAt: new Date().toISOString(),
      });
    });
  }
  return submission;
}
