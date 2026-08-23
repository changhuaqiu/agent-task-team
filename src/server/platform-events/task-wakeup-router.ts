import { taskRepo } from '../repositories/task-repo';
import {
  CollaborationEventRouter,
  CollaborationKernel,
} from '../collaboration-kernel';
import type { PlatformEventHandler } from './dispatcher';

export interface TaskWakeupRouterOptions {
  collaboration?: CollaborationKernel;
}

/**
 * Converts current task facts into durable agent commands. Historical events
 * are checked against the current task row so recovery cannot revive work that
 * has already advanced or reached a terminal state.
 */
export class TaskWakeupRouter {
  private readonly collaboration: CollaborationKernel;
  private readonly router: CollaborationEventRouter;

  constructor(options: TaskWakeupRouterOptions = {}) {
    this.collaboration = options.collaboration ?? new CollaborationKernel();
    this.router = new CollaborationEventRouter({
      kernel: this.collaboration,
      resolve: (event) => {
        if (event.type !== 'task.changes_requested') return undefined;
        const payload = event.payload as {
          agentId?: string;
          reviewNote?: string;
          status?: string;
        };
        const task = taskRepo.getById(event.aggregate.id);
        if (
          !task
          || task.conversation_id !== event.projectId
          || task.status !== payload.status
          || task.agent_id !== payload.agentId
        ) return undefined;
        return {
          targetAgentId: task.agent_id,
          source: 'workflow',
          requestedAction: `Task ${task.id} requires changes. Address the review feedback: ${payload.reviewNote ?? 'Review the latest task evidence and correct the implementation.'}`,
          idempotencyKey: `task:${task.id}:changes:${event.aggregate.version ?? event.eventId}`,
          scope: { taskId: task.id },
          replyTo: { type: 'task', id: task.id },
        };
      },
    });
  }

  readonly handle: PlatformEventHandler = (event, context) => {
    if (event.category !== 'domain' || !event.type.startsWith('task.')) return;
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error('task_wakeup_router_aborted');
    }
    if (event.type === 'task.done' || event.type === 'task.cancelled') {
      this.collaboration.cancel({
        kind: 'task',
        projectId: event.projectId,
        taskId: event.aggregate.id,
      });
      return;
    }
    return this.router.handle(event, context);
  };
}
