import type { Server as IOServer } from 'socket.io';
import { PRESET_ROLE_CARD_MAP } from '@/data/presetRoleCards';
import type { RoleCard } from '@/types/roleCard';
import { listAgents } from '../db/agentQueries';
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
import { scenarioForWakeup, submitTaskWakeupToHarness } from '../harness/registry';
import { reconcileAutonomousDeliveryConversation } from '../autonomous-delivery/registry';

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
  /**
   * Trusted DeliveryRun binding from the Invocation that committed this task
   * mutation. Callers must not infer it from the latest Conversation run.
   */
  deliveryRunId?: string;
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
  const room = io.to(conversationId);
  room.emit('task.notification', notification);
}

function emitWakeupToConversation(io: IOServer | undefined, conversationId: string, wakeup: TaskWakeup): void {
  if (!io) return;
  io.to(conversationId).emit('task.wakeup', wakeup);
}

export function emitTaskState(io: IOServer | undefined, task: TaskRow): void {
  if (!io) return;
  io.to(task.conversation_id).emit('task.state', { task });
}

function isCoordinator(agentId: string, displayName: string | undefined, roleCard?: RoleCard): boolean {
  return roleCard?.category === 'planner' ||
    roleCard?.engineering?.roleType === 'coordinator' ||
    roleCard?.engineering?.roleType === 'planner' ||
    agentId === 'mario' ||
    agentId === 'planner' ||
    !!displayName?.includes('统筹') ||
    !!displayName?.includes('规划');
}

function isReviewer(roleCard?: RoleCard): boolean {
  return roleCard?.category === 'code_reviewer' ||
    roleCard?.category === 'arch_reviewer' ||
    roleCard?.engineering?.canApprovePR === true;
}

function isQa(roleCard?: RoleCard): boolean {
  return roleCard?.category === 'qa' ||
    roleCard?.capabilities?.domains?.includes('testing') === true ||
    roleCard?.capabilities?.skills?.some((skill) => /(?:^|-)testing$|test|qa/i.test(skill)) === true;
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

  if (teamPack) {
    for (const role of teamPack.roles) {
      const roleCard = role.roleCardSnapshot
        ? ({
            ...role.roleCardSnapshot,
            id: `team-role-snapshot-${role.id}`,
            isPreset: false,
            version: role.roleCardSnapshot.snapshotVersion,
            createdAt: role.roleCardSnapshot.snapshottedAt,
            updatedAt: role.roleCardSnapshot.snapshottedAt,
          } as RoleCard)
        : (role.roleCardId ? PRESET_ROLE_CARD_MAP[role.roleCardId] : undefined);
      if (isCoordinator(role.id, role.displayName, roleCard)) add(coordinatorAgentIds, role.id);
      if (isReviewer(roleCard)) add(reviewAgentIds, role.id);
      if (isQa(roleCard)) add(qaAgentIds, role.id);
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

  for (const agent of listAgents()) {
    const roleCard = PRESET_ROLE_CARD_MAP[agent.role_card_id];
    if (isCoordinator(agent.id, agent.name, roleCard)) add(coordinatorAgentIds, agent.id);
    if (isReviewer(roleCard)) add(reviewAgentIds, agent.id);
    if (isQa(roleCard)) add(qaAgentIds, agent.id);
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
    if (!input.io) continue;
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
    const submission = submitTaskWakeupToHarness(
      input.io,
      { ...wakeup, id },
      scenarioForWakeup(wakeup),
      input.deliveryRunId,
    );
    emitWakeupToConversation(input.io, wakeup.conversationId, {
      ...wakeup,
      id,
      handledByHarness: submission?.handled ?? false,
      createdAt: new Date().toISOString(),
    });
  }

  void reconcileAutonomousDeliveryConversation(input.io, input.task.conversation_id, {
    kind: 'fact_changed',
    ref: input.task.id,
  })?.catch((error) => {
    console.warn('[autonomous-delivery] task fact reconciliation failed:', error);
  });

  return notification;
}
