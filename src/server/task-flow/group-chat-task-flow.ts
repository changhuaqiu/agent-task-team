import { generateSortableId } from '../repositories/sortable-id';
import { taskRepo, type TaskRow, type TaskStatus } from '../repositories/task-repo';
import {
  taskGraphRepo,
  type TaskActionRow,
  type TaskEdgeRow,
  type ChatTaskBindingRow,
} from '../repositories/task-graph-repo';
import { workContractRepo } from '../work-contract/repository';

type ActorType = 'user' | 'agent' | 'system';

export interface FlowActorInput {
  actorId: string;
  actorType: ActorType;
  expectedRevision: number;
  idempotencyKey: string;
  correlationId?: string;
  causationId?: string;
}

export interface CreateRootTaskInput extends FlowActorInput {
  conversationId: string;
  title: string;
  description?: string;
  ownerAgentId: string;
  messageId?: string;
}

interface SplitChildInput {
  title: string;
  description?: string;
  ownerAgentId: string;
  dependsOnTaskIds?: string[];
}

interface SplitDependencyByTitle {
  fromTitle: string;
  toTitle: string;
}

export interface SplitTaskInput extends FlowActorInput {
  conversationId: string;
  parentTaskId: string;
  children: SplitChildInput[];
  dependencies?: SplitDependencyByTitle[];
  messageId?: string;
}

export interface MergeTaskInput extends FlowActorInput {
  conversationId: string;
  sourceTaskIds: string[];
  target: {
    taskId?: string;
    title: string;
    description?: string;
    ownerAgentId: string;
  };
  messageId?: string;
}

export interface ReopenTaskInput extends FlowActorInput {
  conversationId: string;
  sourceTaskId: string;
  title: string;
  reason: string;
  ownerAgentId: string;
  description?: string;
  messageId?: string;
}

export interface BlockTaskInput extends FlowActorInput {
  conversationId: string;
  taskId: string;
  reason: string;
  messageId?: string;
}

export interface ResumeTaskInput extends FlowActorInput {
  conversationId: string;
  taskId: string;
  messageId?: string;
}

export interface CancelTaskInput extends FlowActorInput {
  conversationId: string;
  taskId: string;
  reason?: string;
  messageId?: string;
}

export interface AssignTaskInput extends FlowActorInput {
  conversationId: string;
  taskId: string;
  ownerAgentId: string;
  messageId?: string;
}

function createTask(input: {
  conversationId: string;
  title: string;
  description?: string;
  ownerAgentId: string;
  correlationId?: string;
  causationId?: string;
}): TaskRow {
  return taskRepo.create({
    id: generateSortableId('task'),
    conversation_id: input.conversationId,
    title: input.title,
    description: input.description,
    agent_id: input.ownerAgentId,
    correlationId: input.correlationId,
    causationId: input.causationId,
  });
}

function bindMessageToTasks(input: {
  conversationId: string;
  messageId?: string;
  taskIds: string[];
  actionId: string;
}): ChatTaskBindingRow[] {
  if (!input.messageId) return [];
  return input.taskIds.map((taskId) =>
    taskGraphRepo.bindMessage({
      conversationId: input.conversationId,
      messageId: input.messageId!,
      taskId,
      actionId: input.actionId,
    }),
  );
}

function titleIndex(tasks: TaskRow[]): Map<string, TaskRow> {
  return new Map(tasks.map((task) => [task.title, task]));
}

function flowTrace(input: FlowActorInput) {
  return {
    correlationId: input.correlationId?.trim() || `task-graph:${input.idempotencyKey}`,
    causationId: input.causationId?.trim() || input.idempotencyKey,
  };
}

function transitionTask(
  taskId: string,
  status: TaskStatus,
  trace: ReturnType<typeof flowTrace>,
): TaskRow {
  const updated = taskRepo.transition(taskId, { to: status, ...trace });
  if (!updated) throw new Error(`Task ${taskId} not found after status update`);
  return updated;
}

function assertFlowTask(taskId: string, conversationId: string): TaskRow {
  const task = taskRepo.getById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.conversation_id !== conversationId) {
    throw new Error(`Task ${taskId} does not belong to conversation ${conversationId}`);
  }
  return task;
}

function mutateFlow<T>(
  input: FlowActorInput & { conversationId: string },
  operation: string,
  request: unknown,
  execute: () => { actionId: string; result: T },
): T {
  return taskGraphRepo.mutate({
    conversationId: input.conversationId,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    operation,
    request: {
      actorId: input.actorId,
      actorType: input.actorType,
      value: request,
    },
    execute,
  }).result;
}

export const groupChatTaskFlow = {
  createRootTask(input: CreateRootTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    return mutateFlow(input, 'createRootTask', {
      title: input.title,
      description: input.description,
      ownerAgentId: input.ownerAgentId,
      messageId: input.messageId,
    }, () => {
      const task = createTask({
        conversationId: input.conversationId,
        title: input.title,
        description: input.description,
        ownerAgentId: input.ownerAgentId,
        ...flowTrace(input),
      });
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.created',
        taskIds: [task.id],
        messageId: input.messageId,
        payload: {
          title: input.title,
          description: input.description,
          ownerAgentId: input.ownerAgentId,
        },
      });
      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: [task.id],
        actionId: action.id,
      });

      return { actionId: action.id, result: { task, action, bindings } };
    });
  },

  splitTask(input: SplitTaskInput): {
    parent: TaskRow;
    children: TaskRow[];
    action: TaskActionRow;
    edges: TaskEdgeRow[];
    bindings: ChatTaskBindingRow[];
  } {
    return mutateFlow(input, 'splitTask', {
      parentTaskId: input.parentTaskId,
      children: input.children,
      dependencies: input.dependencies,
      messageId: input.messageId,
    }, () => {
      const parent = assertFlowTask(input.parentTaskId, input.conversationId);
      let children = input.children.map((child) =>
        createTask({
          conversationId: input.conversationId,
          title: child.title,
          description: child.description,
          ownerAgentId: child.ownerAgentId,
          ...flowTrace(input),
        }),
      );
      const allTaskIds = [parent.id, ...children.map((child) => child.id)];
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.split',
        taskIds: allTaskIds,
        messageId: input.messageId,
        payload: {
          parentTaskId: parent.id,
          children: children.map((child) => ({
            id: child.id,
            title: child.title,
            ownerAgentId: child.agent_id,
          })),
        },
      });

      const edges: TaskEdgeRow[] = children.map((child) =>
        taskGraphRepo.addEdge({
          conversationId: input.conversationId,
          fromTaskId: child.id,
          toTaskId: parent.id,
          type: 'subtask_of',
          createdByActionId: action.id,
        }),
      );

      const byTitle = titleIndex(children);
      const dependencyIdsByChild = new Map<string, Set<string>>();
      for (const child of children) {
        const definition = input.children.find((item) => item.title === child.title);
        for (const dependencyTaskId of definition?.dependsOnTaskIds ?? []) {
          const dependencyIds = dependencyIdsByChild.get(child.id) ?? new Set<string>();
          dependencyIds.add(dependencyTaskId);
          dependencyIdsByChild.set(child.id, dependencyIds);
          edges.push(taskGraphRepo.addEdge({
            conversationId: input.conversationId,
            fromTaskId: child.id,
            toTaskId: dependencyTaskId,
            type: 'depends_on',
            createdByActionId: action.id,
          }));
        }
      }

      for (const dependency of input.dependencies ?? []) {
        const from = byTitle.get(dependency.fromTitle);
        const to = byTitle.get(dependency.toTitle);
        if (!from || !to) {
          throw new Error(`Split dependency references unknown child title: ${dependency.fromTitle} -> ${dependency.toTitle}`);
        }
        const dependencyIds = dependencyIdsByChild.get(from.id) ?? new Set<string>();
        dependencyIds.add(to.id);
        dependencyIdsByChild.set(from.id, dependencyIds);
        edges.push(taskGraphRepo.addEdge({
          conversationId: input.conversationId,
          fromTaskId: from.id,
          toTaskId: to.id,
          type: 'depends_on',
          createdByActionId: action.id,
        }));
      }
      for (const child of children) {
        const dependencies = [...(dependencyIdsByChild.get(child.id) ?? [])].sort();
        if (dependencies.length > 0) {
          taskRepo.update(child.id, { dependencies: JSON.stringify(dependencies) }, flowTrace(input));
        }
      }
      children = children.map((child) => taskRepo.getById(child.id)!);

      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: allTaskIds,
        actionId: action.id,
      });

      return { actionId: action.id, result: { parent, children, action, edges, bindings } };
    });
  },

  mergeTasks(input: MergeTaskInput): {
    sources: TaskRow[];
    target: TaskRow;
    action: TaskActionRow;
    edges: TaskEdgeRow[];
    bindings: ChatTaskBindingRow[];
  } {
    if (input.sourceTaskIds.length === 0) throw new Error('mergeTasks requires at least one source task');
    return mutateFlow(input, 'mergeTasks', {
      sourceTaskIds: input.sourceTaskIds,
      target: input.target,
      messageId: input.messageId,
    }, () => {
      const sources = input.sourceTaskIds.map((taskId) =>
        assertFlowTask(taskId, input.conversationId),
      );
      const target = input.target.taskId
        ? assertFlowTask(input.target.taskId, input.conversationId)
        : createTask({
          conversationId: input.conversationId,
          title: input.target.title,
          description: input.target.description,
          ownerAgentId: input.target.ownerAgentId,
          ...flowTrace(input),
        });

      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.merged',
        taskIds: [...sources.map((source) => source.id), target.id],
        messageId: input.messageId,
        payload: {
          sourceTaskIds: sources.map((source) => source.id),
          targetTaskId: target.id,
        },
      });
      const edges = sources.map((source) =>
        taskGraphRepo.addEdge({
          conversationId: input.conversationId,
          fromTaskId: source.id,
          toTaskId: target.id,
          type: 'merged_into',
          createdByActionId: action.id,
        }),
      );
      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: [...sources.map((source) => source.id), target.id],
        actionId: action.id,
      });

      return { actionId: action.id, result: { sources, target, action, edges, bindings } };
    });
  },

  reopenTask(input: ReopenTaskInput): {
    sourceTask: TaskRow;
    correctiveTask: TaskRow;
    action: TaskActionRow;
    edge: TaskEdgeRow;
    bindings: ChatTaskBindingRow[];
  } {
    return mutateFlow(input, 'reopenTask', {
      sourceTaskId: input.sourceTaskId,
      title: input.title,
      reason: input.reason,
      ownerAgentId: input.ownerAgentId,
      description: input.description,
      messageId: input.messageId,
    }, () => {
      const sourceTask = assertFlowTask(input.sourceTaskId, input.conversationId);
      const correctiveTask = createTask({
        conversationId: input.conversationId,
        title: input.title,
        description: input.description ?? input.reason,
        ownerAgentId: input.ownerAgentId,
        ...flowTrace(input),
      });
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.reopened',
        taskIds: [sourceTask.id, correctiveTask.id],
        messageId: input.messageId,
        payload: {
          sourceTaskId: sourceTask.id,
          correctiveTaskId: correctiveTask.id,
          reason: input.reason,
        },
      });
      const edge = taskGraphRepo.addEdge({
        conversationId: input.conversationId,
        fromTaskId: correctiveTask.id,
        toTaskId: sourceTask.id,
        type: 'reopens',
        createdByActionId: action.id,
      });
      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: [sourceTask.id, correctiveTask.id],
        actionId: action.id,
      });

      return { actionId: action.id, result: { sourceTask, correctiveTask, action, edge, bindings } };
    });
  },

  blockTask(input: BlockTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    return mutateFlow(input, 'blockTask', {
      taskId: input.taskId,
      reason: input.reason,
      messageId: input.messageId,
    }, () => {
      assertFlowTask(input.taskId, input.conversationId);
      const task = transitionTask(input.taskId, 'blocked', flowTrace(input));
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.blocked',
        taskIds: [input.taskId],
        messageId: input.messageId,
        payload: { reason: input.reason },
      });
      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: [input.taskId],
        actionId: action.id,
      });
      return { actionId: action.id, result: { task, action, bindings } };
    });
  },

  resumeTask(input: ResumeTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    return mutateFlow(input, 'resumeTask', {
      taskId: input.taskId,
      messageId: input.messageId,
    }, () => {
      assertFlowTask(input.taskId, input.conversationId);
      const task = transitionTask(input.taskId, 'ready', flowTrace(input));
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.resumed',
        taskIds: [input.taskId],
        messageId: input.messageId,
        payload: {},
      });
      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: [input.taskId],
        actionId: action.id,
      });
      return { actionId: action.id, result: { task, action, bindings } };
    });
  },

  assignTask(input: AssignTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    return mutateFlow(input, 'assignTask', {
      taskId: input.taskId,
      ownerAgentId: input.ownerAgentId,
      messageId: input.messageId,
    }, () => {
      const current = assertFlowTask(input.taskId, input.conversationId);
      const authority = workContractRepo.getAuthority(`task:${input.taskId}`);
      if (authority?.status === 'active' && current.agent_id !== input.ownerAgentId) {
        workContractRepo.close({
          workId: authority.work_id,
          expectedEpoch: authority.current_epoch,
          correlationId: input.correlationId ?? `task:${input.taskId}`,
          causationId: input.causationId ?? input.idempotencyKey,
        });
      }
      taskRepo.update(input.taskId, { agent_id: input.ownerAgentId }, flowTrace(input));
      const task = taskRepo.getById(input.taskId);
      if (!task) throw new Error(`Task ${input.taskId} not found after assignment`);
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.claimed',
        taskIds: [input.taskId],
        messageId: input.messageId,
        payload: {
          previousOwnerAgentId: current.agent_id,
          ownerAgentId: input.ownerAgentId,
        },
      });
      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: [input.taskId],
        actionId: action.id,
      });
      return { actionId: action.id, result: { task, action, bindings } };
    });
  },

  cancelTask(input: CancelTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    return mutateFlow(input, 'cancelTask', {
      taskId: input.taskId,
      reason: input.reason,
      messageId: input.messageId,
    }, () => {
      assertFlowTask(input.taskId, input.conversationId);
      const task = transitionTask(input.taskId, 'cancelled', flowTrace(input));
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: 'task.cancelled',
        taskIds: [input.taskId],
        messageId: input.messageId,
        payload: { reason: input.reason },
      });
      const bindings = bindMessageToTasks({
        conversationId: input.conversationId,
        messageId: input.messageId,
        taskIds: [input.taskId],
        actionId: action.id,
      });
      return { actionId: action.id, result: { task, action, bindings } };
    });
  },
};
