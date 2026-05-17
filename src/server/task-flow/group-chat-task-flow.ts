import { generateSortableId } from '../repositories/sortable-id';
import { taskRepo, type TaskRow } from '../repositories/task-repo';
import {
  taskGraphRepo,
  type TaskActionRow,
  type TaskEdgeRow,
  type ChatTaskBindingRow,
} from '../repositories/task-graph-repo';

type ActorType = 'user' | 'agent' | 'system';

interface FlowActorInput {
  actorId: string;
  actorType: ActorType;
}

interface CreateRootTaskInput extends FlowActorInput {
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

interface SplitTaskInput extends FlowActorInput {
  conversationId: string;
  parentTaskId: string;
  children: SplitChildInput[];
  dependencies?: SplitDependencyByTitle[];
  messageId?: string;
}

interface MergeTaskInput extends FlowActorInput {
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

interface ReopenTaskInput extends FlowActorInput {
  conversationId: string;
  sourceTaskId: string;
  title: string;
  reason: string;
  ownerAgentId: string;
  description?: string;
  messageId?: string;
}

interface BlockTaskInput extends FlowActorInput {
  conversationId: string;
  taskId: string;
  reason: string;
  messageId?: string;
}

interface ResumeTaskInput extends FlowActorInput {
  conversationId: string;
  taskId: string;
  messageId?: string;
}

interface CancelTaskInput extends FlowActorInput {
  conversationId: string;
  taskId: string;
  reason?: string;
  messageId?: string;
}

interface AssignTaskInput extends FlowActorInput {
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
}): TaskRow {
  return taskRepo.create({
    id: generateSortableId('task'),
    conversation_id: input.conversationId,
    title: input.title,
    description: input.description,
    agent_id: input.ownerAgentId,
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

function updateTaskStatus(taskId: string, status: string): TaskRow {
  taskRepo.updateStatus(taskId, status);
  const updated = taskRepo.getById(taskId);
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

export const groupChatTaskFlow = {
  createRootTask(input: CreateRootTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    const task = createTask({
      conversationId: input.conversationId,
      title: input.title,
      description: input.description,
      ownerAgentId: input.ownerAgentId,
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

    return { task, action, bindings };
  },

  splitTask(input: SplitTaskInput): {
    parent: TaskRow;
    children: TaskRow[];
    action: TaskActionRow;
    edges: TaskEdgeRow[];
    bindings: ChatTaskBindingRow[];
  } {
    const parent = taskRepo.getById(input.parentTaskId);
    if (!parent) throw new Error(`Parent task ${input.parentTaskId} not found`);
    if (parent.conversation_id !== input.conversationId) {
      throw new Error(`Parent task ${input.parentTaskId} does not belong to conversation ${input.conversationId}`);
    }

    const children = input.children.map((child) =>
      createTask({
        conversationId: input.conversationId,
        title: child.title,
        description: child.description,
        ownerAgentId: child.ownerAgentId,
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
    for (const child of children) {
      const definition = input.children.find((item) => item.title === child.title);
      for (const dependencyTaskId of definition?.dependsOnTaskIds ?? []) {
        edges.push(taskGraphRepo.addEdge({
          conversationId: input.conversationId,
          fromTaskId: dependencyTaskId,
          toTaskId: child.id,
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
      edges.push(taskGraphRepo.addEdge({
        conversationId: input.conversationId,
        fromTaskId: from.id,
        toTaskId: to.id,
        type: 'depends_on',
        createdByActionId: action.id,
      }));
    }

    const bindings = bindMessageToTasks({
      conversationId: input.conversationId,
      messageId: input.messageId,
      taskIds: allTaskIds,
      actionId: action.id,
    });

    return { parent, children, action, edges, bindings };
  },

  mergeTasks(input: MergeTaskInput): {
    sources: TaskRow[];
    target: TaskRow;
    action: TaskActionRow;
    edges: TaskEdgeRow[];
    bindings: ChatTaskBindingRow[];
  } {
    if (input.sourceTaskIds.length === 0) throw new Error('mergeTasks requires at least one source task');
    const sources = input.sourceTaskIds.map((taskId) => {
      const task = taskRepo.getById(taskId);
      if (!task) throw new Error(`Source task ${taskId} not found`);
      if (task.conversation_id !== input.conversationId) {
        throw new Error(`Source task ${taskId} does not belong to conversation ${input.conversationId}`);
      }
      return task;
    });

    const target = input.target.taskId
      ? taskRepo.getById(input.target.taskId)
      : createTask({
        conversationId: input.conversationId,
        title: input.target.title,
        description: input.target.description,
        ownerAgentId: input.target.ownerAgentId,
      });
    if (!target) throw new Error(`Target task ${input.target.taskId} not found`);
    if (target.conversation_id !== input.conversationId) {
      throw new Error(`Target task ${target.id} does not belong to conversation ${input.conversationId}`);
    }

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
    for (const source of sources) updateTaskStatus(source.id, 'merged');

    const bindings = bindMessageToTasks({
      conversationId: input.conversationId,
      messageId: input.messageId,
      taskIds: [...sources.map((source) => source.id), target.id],
      actionId: action.id,
    });

    return { sources, target, action, edges, bindings };
  },

  reopenTask(input: ReopenTaskInput): {
    sourceTask: TaskRow;
    correctiveTask: TaskRow;
    action: TaskActionRow;
    edge: TaskEdgeRow;
    bindings: ChatTaskBindingRow[];
  } {
    const sourceTask = taskRepo.getById(input.sourceTaskId);
    if (!sourceTask) throw new Error(`Source task ${input.sourceTaskId} not found`);
    if (sourceTask.conversation_id !== input.conversationId) {
      throw new Error(`Source task ${input.sourceTaskId} does not belong to conversation ${input.conversationId}`);
    }

    const correctiveTask = createTask({
      conversationId: input.conversationId,
      title: input.title,
      description: input.description ?? input.reason,
      ownerAgentId: input.ownerAgentId,
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

    return { sourceTask, correctiveTask, action, edge, bindings };
  },

  blockTask(input: BlockTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    assertFlowTask(input.taskId, input.conversationId);
    const task = updateTaskStatus(input.taskId, 'blocked');
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
    return { task, action, bindings };
  },

  resumeTask(input: ResumeTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    assertFlowTask(input.taskId, input.conversationId);
    const task = updateTaskStatus(input.taskId, 'pending');
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
    return { task, action, bindings };
  },

  assignTask(input: AssignTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    const current = assertFlowTask(input.taskId, input.conversationId);
    taskRepo.update(input.taskId, { agent_id: input.ownerAgentId });
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
    return { task, action, bindings };
  },

  cancelTask(input: CancelTaskInput): {
    task: TaskRow;
    action: TaskActionRow;
    bindings: ChatTaskBindingRow[];
  } {
    assertFlowTask(input.taskId, input.conversationId);
    const task = updateTaskStatus(input.taskId, 'cancelled');
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
    return { task, action, bindings };
  },
};
