import type { NextApiRequest, NextApiResponse } from 'next';
import { agentEvaluation } from '@/server/evaluation/agent-evaluation';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const conversationId = Array.isArray(req.query.conversationId) ? req.query.conversationId[0] : req.query.conversationId;
  if (!id || !conversationId) return res.status(400).json({ error: 'id and conversationId are required' });
  const report = agentEvaluation.getReport(id, conversationId);
  return report ? res.status(200).json(report) : res.status(404).json({ error: 'Evaluation not found' });
}
