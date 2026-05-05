import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { packId } = req.query as { packId: string };

  if (req.method === 'GET') {
    const pack = teamPackRepo.getById(packId);
    if (!pack) return res.status(404).json({ error: 'Team pack not found' });
    return res.status(200).json(pack);
  }

  if (req.method === 'PATCH') {
    teamPackRepo.update(packId, req.body);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    teamPackRepo.delete(packId);
    return res.status(204).end();
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
  res.status(405).end();
}
