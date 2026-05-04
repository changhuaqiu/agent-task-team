import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/server/db/index';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const agents = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'];
  const all: Array<{ id: string; agent_id: string; task_id: string | null; prompt: string | null; dispatch_status: string | null; created_at: string }> = [];

  const db = getDb();
  for (const agentId of agents) {
    const rows = db.prepare(`
      SELECT id, agent_id, task_id, prompt, dispatch_status, created_at
      FROM invocation
      WHERE agent_id = ? AND (dispatch_status = 'queued' OR dispatch_status IS NULL)
      ORDER BY created_at ASC
    `).all(agentId) as any[];
    all.push(...rows);
  }

  return res.json(all);
}
