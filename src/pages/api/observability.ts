import type { NextApiRequest, NextApiResponse } from 'next';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { projectObservationProjection } from '@/server/observability/ProjectObservationProjection';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
  if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
  const requestedLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
  if (!Number.isFinite(requestedLimit) || requestedLimit < 1) return res.status(400).json({ error: 'limit must be a positive number' });
  if (!conversationRepo.getById(conversationId)) {
    return res.status(200).json(projectObservationProjection.build(conversationId, requestedLimit));
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(projectObservationProjection.build(conversationId, requestedLimit));
}
