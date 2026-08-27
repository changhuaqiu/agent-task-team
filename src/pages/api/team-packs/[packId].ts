import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { packId } = req.query as { packId: string };

  if (req.method === 'GET') {
    const pack = teamPackRepo.getById(packId);
    if (!pack) return res.status(404).json({ error: 'Team pack not found' });
    return res.status(200).json(pack);
  }

  if (['POST', 'PATCH', 'DELETE'].includes(req.method ?? '')) return res.status(410).json({
    error: 'direct_agent_team_write_disabled',
    reasonCode: 'use_product_command',
  });

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
  res.status(405).end();
}
