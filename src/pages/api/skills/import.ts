import type { NextApiRequest, NextApiResponse } from 'next';
import { importFromUrl } from '@/server/skill-import';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'source URL is required' });
  }
  try {
    const result = await importFromUrl(source);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || '导入失败，请稍后重试。' });
  }
}
