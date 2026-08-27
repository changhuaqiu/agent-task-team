import type { Server as IOServer } from 'socket.io';
import { agentDefinitionRepo, type AgentDefinition } from '../agents/agent-definition-repo';
import { conversationRepo } from '../repositories/conversation-repo';
import { messageRepo } from '../repositories/message-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskRepo } from '../repositories/task-repo';
import type { TaskRow } from '../repositories/task-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';
import {
  buildTaskNotification,
  getChangedTaskFields,
  resolveTaskNotificationRecipients,
  type TaskNotification,
  type TaskNotificationActorType,
  type TaskNotificationKind,
} from './task-notifications';
import {
  createTaskWakeupDeduper,
  resolveTaskWakeups,
  type TaskWakeup,
} from './task-wakeup';
import { requestTaskWakeup } from './task-work-request';
import { publishProjectView } from '../project-view/project-view-publisher';
import { projectAgentMembershipRepo } from '../repositories/project-agent-membership-repo';

export interface PublishTaskNotificationInput {
  io?: IOServer;
  kind: TaskNotificationKind;
  task: TaskRow;
  previousTask?: TaskRow;
  actorId?: string;
  actorType?: TaskNotificationActorType;
  recipients: string[];
  changedFields?: string[];
}

export interface PublishTaskChangeNotificationInput {
  io?: IOServer;
  kind: TaskNotificationKind;
  task: TaskRow;
  previousTask?: TaskRow;
  actorId?: string;
  actorType?: TaskNotificationActorType;
  changedFields?: string[];
}

const wakeupDeduper = createTaskWakeupDeduper();

function emitToConversation(io: IOServer | undefined, conversationId: string, notification: TaskNotification): void {
  if (!io) return;
  publishProjectView(io, conversationId, {
    type: 'task.notification',
    delivery: 'durable',
    actor: { type: notification.actorType ?? 'system', id: notification.actorId ?? 'task-owner' },
    subject: notification.taskId ? { type: 'task', id: notification.taskId } : undefined,
    eventId: notification.id,
    correlationId: notification.id ?? notification.taskId ?? conversationId,
    causationId: notification.id ?? notification.taskId ?? conversationId,
    occurredAt: notification.createdAt,
    payload: { ...notification },
  });
}

function emitWakeupToConversation(io: IOServer | undefined, conversationId: string, wakeup: TaskWakeup): void {
  if (!io) return;
  publishProjectView(io, conversationId, {
    type: 'task.wakeup',
    delivery: 'durable',
    actor: { type: 'system', id: 'task-wakeup-router' },
    subject: { type: 'task', id: wakeup.taskId },
    eventId: wakeup.id,
    correlationId: wakeup.metadata.idempotencyKey,
    causationId: wakeup.id ?? wakeup.metadata.idempotencyKey,
    occurredAt: wakeup.createdAt,
    payload: { ...wakeup },
  });
}

function emitTaskState(io: IOServer | undefined, task: TaskRow): void {
  if (!io) return;
  publishProjectView(io, task.conversation_id, {
    type: 'task.state',
    delivery: 'durable',
    actor: { type: 'system', id: 'task-authority' },
    subject: { type: 'task', id: task.id },
    eventId: `task:${task.conversation_id}:${task.id}:revision:${task.revision}`,
    correlationId: task.id,
    causationId: `task:${task.conversation_id}:${task.id}:revision:${task.revision}`,
    payload: { task },
  });
}

function isCoordinator(agent: Pick<AgentDefinition, 'id' | 'name' | 'instructions'>): boolean {
  return agent.id === 'mario'
    || agent.id === 'planner'
    || /统筹|规划|协调|coordinat|plan/i.test(`${agent.name} ${agent.instructions}`);
}

function isReviewer(agent: Pick<AgentDefinition, 'name' | 'instructions' | 'can_review'>): boolean {
  return Boolean(agent.can_review)
    || /评审|审查|架构|质量|\breview|architect|quality|\bqa\b/i.test(`${agent.name} ${agent.instructions}`);
}

function isQa(agent: Pick<AgentDefinition, 'name' | 'instructions' | 'can_review'>): boolean {
  return Boolean(agent.can_review) && /质量|测试|验证|验收|\bqa\b|test|verif/i.test(`${agent.name} ${agent.instructions}`);
}

export function resolveTaskNotificationAudience(conversationId: string): {
  coordinatorAgentIds: string[];
  reviewAgentIds: string[];
  reviewGateAgentIds: string[];
  qaAgentIds: string[];
} {
  const coordinatorAgentIds: string[] = [];
  const reviewAgentIds: string[] = [];
  const qaAgentIds: string[] = [];
  const add = (list: string[], id: string | undefined) => {
    if (!id || list.includes(id)) return;
    list.push(id);
  };

  const conversation = conversationRepo.getById(conversationId);
  const teamPack = conversation?.team_pack_id ? teamPackRepo.getById(conversation.team_pack_id) : undefined;
  const definitions = new Map(agentDefinitionRepo.list().map((agent) => [agent.id, agent]));
  const projectAgentIds = projectAgentMembershipRepo.listAgentIdsByConversation(conversationId);
  const effectiveAgentIds = conversation?.project_id ? projectAgentIds : [...definitions.keys()];

  if (teamPack) {
    for (const agentId of effectiveAgentIds) {
      const agent = definitions.get(agentId);
      if (!agent) continue;
      if (isCoordinator(agent)) add(coordinatorAgentIds, agentId);
      if (isReviewer(agent)) add(reviewAgentIds, agentId);
      if (isQa(agent)) add(qaAgentIds, agentId);
    }
    const workflowGateRoleIds = teamPack.workflow.states
      ?.filter((state) => /(?:quality|review)[_-]?gate|review/i.test(`${state.name} ${state.description}`))
      .map((state) => state.role)
      .filter((roleId) => reviewAgentIds.includes(roleId)) ?? [];
    const linearGateRoleIds = workflowGateRoleIds.length === 0
      ? (teamPack.workflow.steps
        ?.filter((step) => /quality|review|评审|质量/i.test(`${step.action} ${step.output}`))
        .map((step) => step.role)
        .filter((roleId) => reviewAgentIds.includes(roleId)) ?? [])
      : [];
    const configuredGateRoleIds = [...new Set([...workflowGateRoleIds, ...linearGateRoleIds])];
    return {
      coordinatorAgentIds,
      reviewAgentIds,
      reviewGateAgentIds: configuredGateRoleIds.length > 0 ? configuredGateRoleIds : reviewAgentIds,
      qaAgentIds,
    };
  }

  for (const agentId of effectiveAgentIds) {
    const agent = definitions.get(agentId);
    if (!agent) continue;
    if (isCoordinator(agent)) add(coordinatorAgentIds, agent.id);
    if (isReviewer(agent)) add(reviewAgentIds, agent.id);
    if (isQa(agent)) add(qaAgentIds, agent.id);
  }

  return { coordinatorAgentIds, reviewAgentIds, reviewGateAgentIds: reviewAgentIds, qaAgentIds };
}

export function publishTaskNotification(input: PublishTaskNotificationInput): TaskNotification | null {
  const recipients = Array.from(new Set(input.recipients.map((item) => item.trim()).filter(Boolean)));
  if (recipients.length === 0) return null;

  const notification = buildTaskNotification({
    kind: input.kind,
    task: input.task,
    previousTask: input.previousTask,
    actorId: input.actorId,
    actorType: input.actorType,
    recipients,
    changedFields: input.changedFields,
  });

  const id = messageRepo.append({
    conversationId: notification.conversationId,
    taskId: notification.taskId,
    senderType: 'system',
    senderId: 'task-notifier',
    content: notification.content,
    mentions: notification.recipients,
    intent: 'task_status',
    metadata: {
      ...notification.metadata,
      kind: notification.kind,
      actorId: notification.actorId,
      actorType: notification.actorType,
      recipients: notification.recipients,
      changedFields: notification.changedFields,
    },
  });

  const published = {
    ...notification,
    id,
    createdAt: new Date().toISOString(),
  };
  emitToConversation(input.io, notification.conversationId, published);
  return published;
}

export function publishTaskChangeNotification(input: PublishTaskChangeNotificationInput): TaskNotification | null {
  emitTaskState(input.io, input.task);
  const changedFields = input.changedFields?.length
    ? input.changedFields
    : getChangedTaskFields(input.task, input.previousTask);
  if (input.previousTask && changedFields.length === 0) return null;

  const audience = resolveTaskNotificationAudience(input.task.conversation_id);
  const recipients = resolveTaskNotificationRecipients({
    kind: input.kind,
    task: input.task,
    previousTask: input.previousTask,
    actorId: input.actorId,
    coordinatorAgentIds: audience.coordinatorAgentIds,
    reviewAgentIds: audience.reviewAgentIds,
    conversationTasks: taskRepo.getByConversation(input.task.conversation_id),
    edges: taskGraphRepo.listEdges(input.task.conversation_id),
    changedFields,
  });

  const notification = publishTaskNotification({
    io: input.io,
    kind: input.kind,
    task: input.task,
    previousTask: input.previousTask,
    actorId: input.actorId,
    actorType: input.actorType,
    recipients,
    changedFields,
  });

  const wakeups = resolveTaskWakeups({
    task: input.task,
    previousTask: input.previousTask,
    actorId: input.actorId,
    changedFields,
    coordinatorAgentIds: audience.coordinatorAgentIds,
    reviewAgentIds: audience.reviewGateAgentIds,
    qaAgentIds: audience.qaAgentIds,
    conversationTasks: taskRepo.getByConversation(input.task.conversation_id),
    edges: taskGraphRepo.listEdges(input.task.conversation_id),
  });

  for (const wakeup of wakeups) {
    if (!wakeupDeduper.shouldPublish(wakeup)) continue;
    const id = messageRepo.append({
      conversationId: wakeup.conversationId,
      taskId: wakeup.taskId,
      senderType: 'system',
      senderId: 'task-wakeup',
      content: wakeup.content,
      mentions: [wakeup.agentId],
      intent: 'task_status',
      metadata: {
        ...wakeup.metadata,
        dispatchSource: wakeup.dispatchSource,
        prompt: wakeup.prompt,
      },
    });
    // Rejected-task execution is owned by the durable task Wakeup Router.
    // This publisher emits the display projection but never starts a second
    // Invocation Pipeline execution.
    const routedByPlatformEvent = wakeup.metadata.reasonCode === 'review_changes_requested';
    if (!routedByPlatformEvent) {
      requestTaskWakeup({ ...wakeup, id });
    }
    emitWakeupToConversation(input.io, wakeup.conversationId, {
      ...wakeup,
      id,
      createdAt: new Date().toISOString(),
    });
  }

  return notification;
}
