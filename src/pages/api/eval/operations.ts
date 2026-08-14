import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluationOperations } from '@/server/evaluation/operations';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const conversationId = String(req.method === 'GET' ? req.query.conversationId ?? '' : req.body?.conversationId ?? '').trim();
    if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
    if (req.method === 'GET') {
      return res.status(200).json(evaluationOperations.status(conversationId));
    }
    if (req.method === 'POST' && req.body?.action === 'enforce_retention') {
      return res.status(200).json(evaluationOperations.enforceRetention(conversationId));
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
