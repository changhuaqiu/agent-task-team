import type { NextApiRequest, NextApiResponse } from 'next';
import runsHandler from './index';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  return runsHandler(req, res);
}
