import type { NextApiRequest, NextApiResponse } from 'next';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';

const DEFAULT_MESSAGE_LIMIT = 1000;
const MAX_MESSAGE_LIMIT = 1000;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const conversationId = firstQueryValue(req.query.conversationId);
  const messageId = firstQueryValue(req.query.messageId);
  if (messageId) {
    const projectId = firstQueryValue(req.query.projectId);
    if (!conversationId && !projectId) return res.status(400).json({ error: 'message_scope_required' });
    const message = messageRepo.getById(messageId);
    if (!message || message.visibility !== 'public'
      || (conversationId && message.conversation_id !== conversationId)
      || (projectId && conversationRepo.getById(message.conversation_id)?.project_id !== projectId)) {
      return res.status(404).json({ error: 'message_not_found' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ message });
  }
  if (!conversationId?.trim()) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  const beforeCreatedAt = firstQueryValue(req.query.beforeCreatedAt);
  const beforeId = firstQueryValue(req.query.beforeId);
  if (Boolean(beforeCreatedAt) !== Boolean(beforeId)) {
    return res.status(400).json({ error: 'beforeCreatedAt and beforeId must be provided together' });
  }
  const requestedLimit = Number(firstQueryValue(req.query.limit) ?? DEFAULT_MESSAGE_LIMIT);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_MESSAGE_LIMIT)
    : DEFAULT_MESSAGE_LIMIT;

  const page = messageRepo.getLatestPageByConversation(conversationId.trim(), {
    limit: limit + 1,
    before: beforeCreatedAt && beforeId
      ? { createdAt: beforeCreatedAt, id: beforeId }
      : undefined,
  });
  const hasMore = page.length > limit;
  const messages = hasMore ? page.slice(page.length - limit) : page;
  const first = messages[0];

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    messages,
    hasMore,
    nextCursor: first
      ? { createdAt: first.created_at, id: first.id }
      : null,
  });
}
