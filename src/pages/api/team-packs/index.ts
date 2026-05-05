import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const packs = teamPackRepo.list();
    return res.status(200).json(packs);
  }

  if (req.method === 'POST') {
    try {
      const pack = teamPackRepo.create(req.body);
      return res.status(201).json(pack);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
}
