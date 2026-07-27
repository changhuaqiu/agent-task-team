import type { NextApiRequest, NextApiResponse } from 'next';
import { AgentInbox } from '@/server/platform-events/agent-inbox';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawProjectId = req.query.conversationId;
  if (Array.isArray(rawProjectId) || typeof rawProjectId !== 'string' || !rawProjectId.trim()) {
    return res.status(400).json({ error: 'conversationId is required and must be a single value' });
  }
  return res.json(new AgentInbox().listPending(rawProjectId));
}
