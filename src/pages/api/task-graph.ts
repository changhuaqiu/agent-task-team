import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as IOServer } from 'socket.io';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import {
  StaleTaskGraphRevisionError,
  TaskGraphIdempotencyConflictError,
  taskGraphRepo,
} from '@/server/repositories/task-graph-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import {
  groupChatTaskFlow,
  type AssignTaskInput,
  type BlockTaskInput,
  type CancelTaskInput,
  type CreateRootTaskInput,
  type MergeTaskInput,
  type ReopenTaskInput,
  type ResumeTaskInput,
  type SplitTaskInput,
} from '@/server/task-flow/group-chat-task-flow';
import { evaluateTaskGraphAction } from '@/server/task-flow/task-graph-policy';
import { publishTaskChangeNotification } from '@/server/task-flow/task-notification-publisher';

function emptyGraph(conversationId: string) {
  return {
    conversationId,
    revision: 0,
    tasks: [],
    edges: [],
    actions: [],
    artifacts: [],
    bindings: [],
    proofEvents: [],
  };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const conversationId = req.method === 'GET'
    ? (typeof req.query.conversationId === 'string' ? req.query.conversationId : '')
    : (typeof body.conversationId === 'string' ? body.conversationId : '');
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  const conversation = conversationRepo.getById(conversationId);
  if (!conversation) {
    if (req.method === 'GET') return res.status(200).json(emptyGraph(conversationId));
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ...taskGraphRepo.getGraph(conversationId),
      proofEvents: proofLogRepo.getByConversation(conversationId),
    });
  }

  try {
    if (
      typeof body.expectedRevision !== 'number'
      || !Number.isSafeInteger(body.expectedRevision)
      || body.expectedRevision < 0
    ) {
      return res.status(400).json({ error: 'expectedRevision must be a non-negative safe integer' });
    }
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.trim().length === 0) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }
    const targetTask = typeof body.taskId === 'string' ? taskRepo.getById(body.taskId) : undefined;
    const decision = evaluateTaskGraphAction({
      action: typeof body.action === 'string' ? body.action : '',
      actorId: typeof body.actorId === 'string' ? body.actorId : undefined,
      confirmed: body.confirmed === true,
      taskStatus: targetTask?.status,
      currentOwnerAgentId: targetTask?.agent_id,
      nextOwnerAgentId: typeof body.ownerAgentId === 'string' ? body.ownerAgentId : undefined,
    });
    if (!decision.allowed) {
      proofLogRepo.append({
        eventType: 'task_graph.policy.blocked',
        conversationId,
        taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
        actorId: typeof body.actorId === 'string' ? body.actorId : undefined,
        reasonCode: decision.reasonCode,
        metadata: {
          action: body.action,
          requiresConfirmation: decision.requiresConfirmation,
        },
      });
      return res.status(decision.requiresConfirmation ? 409 : 403).json({
        error: decision.message ?? 'Task graph action blocked',
        requiresConfirmation: decision.requiresConfirmation,
        reasonCode: decision.reasonCode,
      });
    }

    let result: unknown;
    switch (body.action) {
      case 'createRootTask':
        result = groupChatTaskFlow.createRootTask(body as unknown as CreateRootTaskInput);
        break;
      case 'splitTask':
        result = groupChatTaskFlow.splitTask(body as unknown as SplitTaskInput);
        break;
      case 'mergeTasks':
        result = groupChatTaskFlow.mergeTasks(body as unknown as MergeTaskInput);
        break;
      case 'reopenTask':
        result = groupChatTaskFlow.reopenTask(body as unknown as ReopenTaskInput);
        break;
      case 'blockTask':
        result = groupChatTaskFlow.blockTask(body as unknown as BlockTaskInput);
        break;
      case 'resumeTask':
        result = groupChatTaskFlow.resumeTask(body as unknown as ResumeTaskInput);
        break;
      case 'assignTask':
        result = groupChatTaskFlow.assignTask(body as unknown as AssignTaskInput);
        break;
      case 'cancelTask':
        result = groupChatTaskFlow.cancelTask(body as unknown as CancelTaskInput);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported task graph action' });
    }

    const updatedTargetTask = typeof body.taskId === 'string' ? taskRepo.getById(body.taskId) : undefined;
    if (targetTask && updatedTargetTask) {
      const kind = body.action === 'assignTask'
        ? 'task.assigned'
        : ['blockTask', 'resumeTask', 'cancelTask'].includes(body.action)
          ? 'task.status_changed'
          : 'task.updated';
      const io = (res.socket as unknown as { server?: { io?: IOServer } } | null)
        ?.server?.io;
      publishTaskChangeNotification({
        io,
        kind,
        task: updatedTargetTask,
        previousTask: targetTask,
        actorId: typeof body.actorId === 'string' ? body.actorId : undefined,
        actorType: body.actorType === 'user' || body.actorType === 'agent' || body.actorType === 'system'
          ? body.actorType
          : undefined,
      });
    }

    return res.status(200).json({
      ok: true,
      result,
      graph: {
        ...taskGraphRepo.getGraph(conversationId),
        proofEvents: proofLogRepo.getByConversation(conversationId),
      },
    });
  } catch (error) {
    if (error instanceof StaleTaskGraphRevisionError) {
      return res.status(409).json({
        error: error.message,
        reasonCode: error.reasonCode,
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision,
      });
    }
    if (error instanceof TaskGraphIdempotencyConflictError) {
      return res.status(409).json({
        error: error.message,
        reasonCode: error.reasonCode,
      });
    }
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
