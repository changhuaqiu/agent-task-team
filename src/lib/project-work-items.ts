import type { Conversation, WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

export interface ProjectWorkItem {
  id: string;
  projectId: string;
  conversationId: string;
  rootTask?: Task;
  tasks: Task[];
  childTasks: Task[];
  title: string;
  description: string;
  status: Task['status'];
  category: NonNullable<Task['category']>;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  legacy: boolean;
  sourceLabel?: string;
}

export interface WorkItemIdentity {
  conversationId: string;
  taskId: string;
}

export function workItemIdentityKey(identity: WorkItemIdentity): string {
  return JSON.stringify([identity.conversationId, identity.taskId]);
}

/** Resolve an exact root OR descendant, never a naked task id across scopes. */
export function resolveProjectWorkItem(items: ProjectWorkItem[], identity: WorkItemIdentity): ProjectWorkItem | undefined {
  return items.find((item) => item.conversationId === identity.conversationId
    && (item.id === identity.taskId || item.tasks.some((task) => task.id === identity.taskId)));
}

export function projectWorkSummary(items: ProjectWorkItem[]) {
  return {
    total: items.length,
    active: items.filter((item) => item.status === 'in_progress').length,
    open: items.filter((item) => !['done', 'cancelled'].includes(item.status)).length,
    review: items.filter((item) => item.status === 'in_review').length,
    done: items.filter((item) => item.status === 'done').length,
    // An execution blocker is not a terminal status of its parent goal.
    blocked: items.filter((item) => item.tasks.some((task) => task.status === 'blocked')),
  };
}

function compareTaskAge(left: Task, right: Task): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function workItem(
  project: WorkspaceProject,
  conversation: Conversation,
  scopedTasks: Task[],
  rootTask: Task,
  legacy: boolean,
): ProjectWorkItem {
  const tasks = [...scopedTasks].sort(compareTaskAge);
  return {
    id: rootTask.id,
    projectId: project.id,
    conversationId: conversation.id,
    rootTask,
    tasks,
    childTasks: tasks.filter((task) => task.id !== rootTask.id),
    title: rootTask.title,
    description: rootTask.description,
    status: rootTask.status,
    category: rootTask.category ?? 'issue',
    agentId: rootTask.agentId,
    createdAt: rootTask.createdAt,
    updatedAt: tasks.reduce(
      (latest, task) => task.updatedAt.localeCompare(latest) > 0 ? task.updatedAt : latest,
      rootTask.updatedAt,
    ),
    legacy,
    ...(conversation.title && conversation.title !== rootTask.title
      ? { sourceLabel: conversation.title }
      : {}),
  };
}

function pendingWorkItem(
  project: WorkspaceProject,
  conversation: Conversation,
): ProjectWorkItem {
  return {
    id: conversation.id,
    projectId: project.id,
    conversationId: conversation.id,
    tasks: [],
    childTasks: [],
    title: conversation.title || conversation.goal || '待规划工作',
    description: conversation.goal || '',
    status: 'proposed',
    category: 'issue',
    agentId: '',
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    legacy: conversation.workspaceKind === 'historical_workstream',
    sourceLabel: '等待任务规划',
  };
}

/**
 * Compatibility projection while Conversation remains the internal execution
 * scope. New workstreams become one WorkItem; Tasks left on the Project
 * workspace remain individually discoverable as legacy WorkItems.
 */
export function projectWorkItems(
  project: WorkspaceProject,
  conversations: Conversation[],
  tasks: Task[],
): ProjectWorkItem[] {
  const byConversation = new Map<string, Task[]>();
  for (const task of tasks) {
    const scoped = byConversation.get(task.conversationId) ?? [];
    scoped.push(task);
    byConversation.set(task.conversationId, scoped);
  }

  const items: ProjectWorkItem[] = [];
  const workspace = conversations.find((conversation) => conversation.id === project.workspaceConversationId);
  if (workspace) {
    for (const task of (byConversation.get(workspace.id) ?? []).sort(compareTaskAge)) {
      items.push(workItem(project, workspace, [task], task, true));
    }
  }

  const workstreams = conversations
    .filter((conversation) => (
      conversation.projectId === project.id
      && conversation.id !== project.workspaceConversationId
      && conversation.workspaceKind !== 'project_workspace'
    ))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

  for (const conversation of workstreams) {
    const scopedTasks = byConversation.get(conversation.id) ?? [];
    if (scopedTasks.length === 0) {
      items.push(pendingWorkItem(project, conversation));
      continue;
    }
    const rootTask = scopedTasks.find((task) => task.id === conversation.rootTaskId)
      ?? [...scopedTasks].sort(compareTaskAge)[0];
    items.push(workItem(
      project,
      conversation,
      scopedTasks,
      rootTask,
      conversation.workspaceKind === 'historical_workstream',
    ));
  }

  return items.sort((left, right) => (
    right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
  ));
}
