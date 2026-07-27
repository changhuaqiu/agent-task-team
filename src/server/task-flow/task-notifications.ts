import type { TaskEdgeRow } from '../repositories/task-graph-repo';
import type { TaskRow } from '../repositories/task-repo';

export type TaskNotificationKind = 'task.status_changed' | 'task.updated' | 'task.assigned' | 'task.file_synced';
export type TaskNotificationActorType = 'user' | 'agent' | 'system';

export interface TaskNotificationInput {
  kind: TaskNotificationKind;
  task: TaskRow;
  previousTask?: TaskRow;
  actorId?: string;
  coordinatorAgentIds: string[];
  reviewAgentIds: string[];
  conversationTasks: TaskRow[];
  edges: TaskEdgeRow[];
  changedFields?: string[];
}

export interface BuildTaskNotificationInput {
  kind: TaskNotificationKind;
  task: TaskRow;
  previousTask?: TaskRow;
  actorId?: string;
  actorType?: TaskNotificationActorType;
  recipients: string[];
  changedFields?: string[];
}

export interface TaskNotification {
  id?: string;
  conversationId: string;
  taskId: string;
  kind: TaskNotificationKind;
  actorId?: string;
  actorType: TaskNotificationActorType;
  recipients: string[];
  changedFields: string[];
  content: string;
  metadata: {
    taskId: string;
    taskTitle: string;
    taskStatus: string;
    previousStatus?: string;
    previousOwnerAgentId?: string;
    ownerAgentId: string;
    startsA2AHandoff: false;
  };
  createdAt?: string;
}

function addRecipient(recipients: string[], agentId: string | null | undefined): void {
  const normalized = agentId?.trim();
  if (!normalized || recipients.includes(normalized)) return;
  recipients.push(normalized);
}

function isStatusChangeRelevantToDependencies(task: TaskRow, previousTask?: TaskRow): boolean {
  if (!previousTask || task.status === previousTask.status) return false;
  return ['in_review', 'done', 'blocked'].includes(task.status);
}

function inferChangedFields(task: TaskRow, previousTask?: TaskRow): string[] {
  if (!previousTask) return [];
  const fields: string[] = [];
  if (task.status !== previousTask.status) fields.push('status');
  if (task.agent_id !== previousTask.agent_id) fields.push('agent_id');
  if (task.title !== previousTask.title) fields.push('title');
  if ((task.description ?? '') !== (previousTask.description ?? '')) fields.push('description');
  if ((task.review_note ?? '') !== (previousTask.review_note ?? '')) fields.push('review_note');
  if ((task.dependencies ?? '') !== (previousTask.dependencies ?? '')) fields.push('dependencies');
  if ((task.artifacts ?? '') !== (previousTask.artifacts ?? '')) fields.push('artifacts');
  return fields;
}

export function getChangedTaskFields(task: TaskRow, previousTask?: TaskRow): string[] {
  return inferChangedFields(task, previousTask);
}

export function resolveTaskNotificationRecipients(input: TaskNotificationInput): string[] {
  const recipients: string[] = [];
  const changedFields = input.changedFields?.length
    ? input.changedFields
    : inferChangedFields(input.task, input.previousTask);

  addRecipient(recipients, input.task.agent_id);

  if (input.previousTask?.agent_id && input.previousTask.agent_id !== input.task.agent_id) {
    addRecipient(recipients, input.previousTask.agent_id);
  }

  const needsCoordinationNotice =
    input.kind === 'task.assigned' ||
    changedFields.includes('review_note') ||
    ['in_review', 'done', 'blocked'].includes(input.task.status);
  if (needsCoordinationNotice) {
    for (const coordinatorId of input.coordinatorAgentIds) addRecipient(recipients, coordinatorId);
  }

  if (input.task.status === 'in_review') {
    for (const reviewAgentId of input.reviewAgentIds) addRecipient(recipients, reviewAgentId);
  }

  if (isStatusChangeRelevantToDependencies(input.task, input.previousTask)) {
    const tasksById = new Map(input.conversationTasks.map((task) => [task.id, task]));
    for (const edge of input.edges) {
      if (edge.type !== 'depends_on') continue;
      if (edge.from_task_id !== input.task.id) continue;
      addRecipient(recipients, tasksById.get(edge.to_task_id)?.agent_id);
    }
  }

  return recipients.filter((agentId) => agentId !== input.actorId);
}

function summarizeChange(input: BuildTaskNotificationInput, changedFields: string[]): string {
  if (input.task.status !== input.previousTask?.status) {
    return `状态 ${input.previousTask?.status ?? 'unknown'} → ${input.task.status}`;
  }
  if (input.task.agent_id !== input.previousTask?.agent_id) {
    return `负责人 ${input.previousTask?.agent_id ?? '未分配'} → ${input.task.agent_id}`;
  }
  if (changedFields.includes('review_note')) return '评审说明已更新';
  if (changedFields.includes('description')) return '任务内容已更新';
  if (changedFields.includes('title')) return '任务标题已更新';
  return '任务已更新';
}

export function buildTaskNotification(input: BuildTaskNotificationInput): TaskNotification {
  const changedFields = input.changedFields?.length
    ? input.changedFields
    : inferChangedFields(input.task, input.previousTask);
  const mentions = input.recipients.map((agentId) => `@${agentId}`).join(' ');
  const actor = input.actorId ? `（来自 @${input.actorId}）` : '';
  const changeSummary = summarizeChange(input, changedFields);

  return {
    conversationId: input.task.conversation_id,
    taskId: input.task.id,
    kind: input.kind,
    actorId: input.actorId,
    actorType: input.actorType ?? 'system',
    recipients: input.recipients,
    changedFields,
    content: `任务通知 ${mentions}：${input.task.id}「${input.task.title}」${changeSummary}${actor}。这是任务事件通知，不会发起 A2A 交接。`,
    metadata: {
      taskId: input.task.id,
      taskTitle: input.task.title,
      taskStatus: input.task.status,
      previousStatus: input.previousTask?.status,
      previousOwnerAgentId: input.previousTask?.agent_id,
      ownerAgentId: input.task.agent_id,
      startsA2AHandoff: false,
    },
  };
}
