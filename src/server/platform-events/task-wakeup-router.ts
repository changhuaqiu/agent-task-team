import { taskRepo } from '../repositories/task-repo';
import { AgentInbox } from './agent-inbox';
import { AgentInboxRouter } from './agent-inbox-router';
import type { PlatformEventHandler } from './dispatcher';

export interface TaskWakeupRouterOptions {
  inbox?: AgentInbox;
}

/**
 * Converts current task facts into durable agent commands. Historical events
 * are checked against the current task row so recovery cannot revive work that
 * has already advanced or reached a terminal state.
 */
export class TaskWakeupRouter {
  private readonly inbox: AgentInbox;
  private readonly router: AgentInboxRouter;

  constructor(options: TaskWakeupRouterOptions = {}) {
    this.inbox = options.inbox ?? new AgentInbox();
    this.router = new AgentInboxRouter({
      inbox: this.inbox,
      resolve: (event) => {
        if (event.type !== 'task.changes_requested' && event.type !== 'task.blocked') return undefined;
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
          projectAgentId: task.agent_id,
          command: {
            source: 'workflow',
            taskId: task.id,
            prompt: event.type === 'task.changes_requested'
              ? `Task ${task.id} requires changes. Address the review feedback: ${payload.reviewNote ?? 'Review the latest task evidence and correct the implementation.'}`
              : `Task ${task.id} is blocked. Inspect the latest task evidence and resolve the blocker.`,
          },
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
      this.inbox.cancelPendingForTask(event.projectId, event.aggregate.id);
      return;
    }
    return this.router.handle(event, context);
  };
}
