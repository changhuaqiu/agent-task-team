import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const packs = teamPackRepo.list();
    return res.status(200).json(packs);
  }

  if (req.method === 'POST') return res.status(410).json({
    error: 'direct_agent_team_write_disabled',
    reasonCode: 'use_product_command',
  });

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
}
