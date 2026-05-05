import type { NextApiRequest, NextApiResponse } from 'next';
import { importRoleCardFromUrl } from '@/server/role-card-import';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end();
  }

  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'Missing source URL' });
  }

  try {
    const result = await importRoleCardFromUrl(source);
    return res.status(200).json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return res.status(400).json({ error: message });
  }
}
