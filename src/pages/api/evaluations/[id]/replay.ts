import type { NextApiRequest, NextApiResponse } from 'next';
import { agentEvaluation } from '@/server/evaluation/agent-evaluation';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
  if (!id || !conversationId) return res.status(400).json({ error: 'id and conversationId are required' });
  try {
    const result = agentEvaluation.replay(id, conversationId);
    setImmediate(() => void agentEvaluation.processPending(1));
    return res.status(result.duplicate ? 200 : 202).json(result);
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
