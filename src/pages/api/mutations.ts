import type { NextApiRequest, NextApiResponse } from 'next';

type MutationType =
  | 'conversation.create'
  | 'conversation.update'
  | 'conversation.delete'
  | 'task.create'
  | 'task.updateStatus'
  | 'task.update'
  | 'task.delete'
  | 'message.append'
  | 'session.create'
  | 'session.updateCliSessionId'
  | 'session.seal'
  | 'session.sealByTask'
  | 'invocation.create'
  | 'invocation.updateStatus'
  | 'event.append';

interface MutationRequest {
  type: MutationType;
  payload: Record<string, unknown>;
}

interface MutationResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<MutationResponse>) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { type, payload } = req.body as MutationRequest;

  try {
    let result: unknown;

    switch (type) {
      case 'conversation.create': {
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        result = conversationRepo.create(payload as any);
        break;
      }
      case 'conversation.update': {
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        const { id, ...updates } = payload as any;
        conversationRepo.update(id, updates);
        result = { id };
        break;
      }
      case 'conversation.delete': {
        const { conversationRepo } = await import('@/server/repositories/conversation-repo');
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const tasks = taskRepo.getByConversation(payload.id as string);
        for (const t of tasks) taskRepo.delete(t.id);
        conversationRepo.delete(payload.id as string);
        result = { id: payload.id };
        break;
      }
      case 'task.create': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        result = taskRepo.create(payload as any);
        break;
      }
      case 'task.updateStatus': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { id, status, reviewNote } = payload as any;
        taskRepo.updateStatus(id, status, reviewNote);
        result = { id, status };
        break;
      }
      case 'task.update': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        const { id, ...updates } = payload as any;
        taskRepo.update(id, updates);
        result = { id };
        break;
      }
      case 'task.delete': {
        const { taskRepo } = await import('@/server/repositories/task-repo');
        taskRepo.delete(payload.id as string);
        result = { id: payload.id };
        break;
      }
      case 'message.append': {
        const { messageRepo } = await import('@/server/repositories/message-repo');
        const id = messageRepo.append(payload as any);
        result = { id };
        break;
      }
      case 'session.create': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        result = sessionRepo.create(payload as any);
        break;
      }
      case 'session.updateCliSessionId': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        const { id, cliSessionId } = payload as any;
        sessionRepo.updateCliSessionId(id, cliSessionId);
        result = { id };
        break;
      }
      case 'session.seal': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        const { id, reason } = payload as any;
        sessionRepo.seal(id, reason);
        result = { id };
        break;
      }
      case 'session.sealByTask': {
        const { sessionRepo } = await import('@/server/repositories/session-repo');
        const { agentId, taskId, reason } = payload as any;
        sessionRepo.sealByTask(agentId, taskId, reason);
        result = { agentId, taskId };
        break;
      }
      case 'invocation.create': {
        const { invocationRepo } = await import('@/server/repositories/invocation-repo');
        result = invocationRepo.create(payload as any);
        break;
      }
      case 'invocation.updateStatus': {
        const { invocationRepo } = await import('@/server/repositories/invocation-repo');
        const { id, status, ...updates } = payload as any;
        invocationRepo.updateStatus(id, status, updates);
        result = { id, status };
        break;
      }
      case 'event.append': {
        const { eventRepo } = await import('@/server/repositories/event-repo');
        const id = eventRepo.append(payload as any);
        result = { id };
        break;
      }
      default:
        return res.status(400).json({ ok: false, error: `Unknown mutation type: ${type}` });
    }

    res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error(`[api/mutations] Error in ${type}:`, error);
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
