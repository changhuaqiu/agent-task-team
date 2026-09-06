import type { NextApiRequest, NextApiResponse } from 'next';
import { readWorkResult } from '@/server/artifacts/work-result';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const { projectId, conversationId, workId } = req.query;
  if (typeof projectId !== 'string' || typeof conversationId !== 'string' || typeof workId !== 'string') return res.status(400).json({ error: 'work_result_scope_required' });
  try { return res.status(200).json(readWorkResult(projectId, conversationId, workId)); }
  catch (error) { return res.status(error instanceof Error && error.message === 'work_result_not_found' ? 404 : 500).json({ error: 'work_result_unavailable' }); }
}
