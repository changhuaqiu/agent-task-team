import type { NextApiRequest, NextApiResponse } from 'next';
import { messageRepo } from '@/server/repositories/message-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const conversationId = Array.isArray(req.query.conversationId)
    ? req.query.conversationId[0]
    : req.query.conversationId;
  if (!conversationId?.trim()) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    messages: messageRepo.getLatestByConversation(conversationId.trim(), { limit: 1000 }),
  });
}
