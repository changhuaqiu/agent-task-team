import { createHash } from 'node:crypto';
import { workContractRepo } from '../work-contract/repository';
import {
  taskGraphRepo,
  type TaskActionRow,
  type TaskActionType,
  type TaskGraphCommitResult,
} from './task-graph-repo';
import {
  taskRepo,
  type NewTask,
  type TaskPatch,
  type TaskRow,
  type TaskStatus,
} from './task-repo';

type ActorType = 'user' | 'agent' | 'system';

interface TaskCommandBase {
  conversationId: string;
  expectedGraphRevision: number;
  idempotencyKey: string;
  actor: { type: ActorType; id: string };
  correlationId?: string;
  causationId?: string;
}

interface ExistingTaskCommand extends TaskCommandBase {
  taskId: string;
  expectedTaskRevision: number;
}

export function stableTaskCommandKey(
  scope: string,
  value: unknown,
): string {
  return `${scope}:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function assertOwnedTask(input: ExistingTaskCommand): TaskRow {
  const task = taskRepo.getById(input.taskId);
  if (!task || task.conversation_id !== input.conversationId) {
    throw new Error(`Task not found in conversation: ${input.taskId}`);
  }
  if (task.revision !== input.expectedTaskRevision) {
    throw new Error(
      `stale_task_revision:${input.taskId}:${input.expectedTaskRevision}:${task.revision}`,
    );
  }
  return task;
}

function actionTypeForStatus(status: TaskStatus): TaskActionType {
  if (status === 'blocked') return 'task.blocked';
  if (status === 'cancelled') return 'task.cancelled';
  if (status === 'in_review') return 'task.review_requested';
  if (status === 'done') return 'task.review_recorded';
  return 'task.status_changed';
}

export const taskCommandService = {
  expectedGraphRevision(conversationId: string, idempotencyKey: string): number {
    const prior = taskGraphRepo.getCommitByIdempotencyKey(idempotencyKey);
    if (prior) {
      if (prior.conversation_id !== conversationId) {
        throw new Error(`task_graph_idempotency_scope_conflict:${idempotencyKey}`);
      }
      return prior.revision - 1;
    }
    return taskGraphRepo.revision(conversationId);
  },

  create(input: TaskCommandBase & {
    task: Omit<NewTask, 'conversation_id'>;
  }): TaskGraphCommitResult {
    return taskGraphRepo.commit({
      conversationId: input.conversationId,
      expectedRevision: input.expectedGraphRevision,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actor.id,
      actorType: input.actor.type,
      correlationId: input.correlationId,
      causationId: input.causationId,
      tasks: [input.task],
    });
  },

  transition(input: ExistingTaskCommand & {
    to: TaskStatus;
    reviewNote?: string;
    actionType?: TaskActionType;
    proofEventId?: string;
    actionPayload?: Record<string, unknown>;
  }): { revision: number; result: { task: TaskRow; action: TaskActionRow }; replayed: boolean } {
    return taskGraphRepo.mutate({
      conversationId: input.conversationId,
      expectedRevision: input.expectedGraphRevision,
      idempotencyKey: input.idempotencyKey,
      operation: 'transitionTask',
      request: {
        taskId: input.taskId,
        expectedTaskRevision: input.expectedTaskRevision,
        to: input.to,
        reviewNote: input.reviewNote,
        actor: input.actor,
        correlationId: input.correlationId,
        causationId: input.causationId,
      },
      execute: () => {
        const previous = assertOwnedTask(input);
        const task = taskRepo.transition(input.taskId, {
          to: input.to,
          expectedFrom: previous.status,
          reviewNote: input.reviewNote,
          correlationId: input.correlationId,
          causationId: input.causationId,
        });
        if (!task) throw new Error(`Task transition failed: ${input.taskId}`);
        const action = taskGraphRepo.appendAction({
          conversationId: input.conversationId,
          actorId: input.actor.id,
          actorType: input.actor.type,
          type: input.actionType ?? actionTypeForStatus(input.to),
          taskIds: [input.taskId],
          proofEventId: input.proofEventId,
          payload: {
            previousStatus: previous.status,
            status: input.to,
            expectedTaskRevision: input.expectedTaskRevision,
            ...input.actionPayload,
          },
        });
        return { actionId: action.id, result: { task, action } };
      },
    });
  },

  update(input: ExistingTaskCommand & {
    updates: Partial<TaskPatch>;
  }): { revision: number; result: { task: TaskRow; action: TaskActionRow }; replayed: boolean } {
    return taskGraphRepo.mutate({
      conversationId: input.conversationId,
      expectedRevision: input.expectedGraphRevision,
      idempotencyKey: input.idempotencyKey,
      operation: 'updateTask',
      request: {
        taskId: input.taskId,
        expectedTaskRevision: input.expectedTaskRevision,
        updates: input.updates,
        actor: input.actor,
        correlationId: input.correlationId,
        causationId: input.causationId,
      },
      execute: () => {
        const previous = assertOwnedTask(input);
        if (
          input.updates.agent_id
          && input.updates.agent_id !== previous.agent_id
        ) {
          const authority = workContractRepo.getAuthority(`task:${input.taskId}`);
          if (authority?.status === 'active') {
            workContractRepo.close({
              workId: authority.work_id,
              expectedEpoch: authority.current_epoch,
              correlationId: input.correlationId ?? `task:${input.taskId}`,
              causationId: input.causationId ?? input.idempotencyKey,
            });
          }
        }
        const task = taskRepo.update(input.taskId, input.updates, {
          correlationId: input.correlationId,
          causationId: input.causationId,
        });
        if (!task) throw new Error(`Task update failed: ${input.taskId}`);
        const action = taskGraphRepo.appendAction({
          conversationId: input.conversationId,
          actorId: input.actor.id,
          actorType: input.actor.type,
          type: input.updates.agent_id !== undefined ? 'task.claimed' : 'task.status_changed',
          taskIds: [input.taskId],
          payload: {
            expectedTaskRevision: input.expectedTaskRevision,
            updates: input.updates,
          },
        });
        return { actionId: action.id, result: { task, action } };
      },
    });
  },
};
