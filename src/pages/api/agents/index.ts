import type { NextApiRequest, NextApiResponse } from 'next';
import { listAgents, upsertAgent, deleteAgent } from '@/server/db/agentQueries';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const agents = listAgents();
      return res.status(200).json({ agents });
    }

    if (req.method === 'POST') {
      const { id, name, roleCardId, theme, emoji, isPreset } = req.body;
      if (!id || !name || !roleCardId || !theme || !emoji) {
        return res.status(400).json({ error: 'id, name, roleCardId, theme, and emoji are required' });
      }
      const result = upsertAgent({ id, name, roleCardId, theme, emoji, isPreset });
      return res.status(200).json({ agent: result });
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id as string) || (req.body as { id?: string })?.id;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }
      deleteAgent(id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const msg = (error as Error).message;
    if (msg === 'Cannot delete preset agent') {
      return res.status(403).json({ error: msg });
    }
    console.error('[api/agents] Error:', error);
    return res.status(500).json({ error: msg });
  }
}
