import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluationLab } from '@/server/evaluation/evaluation-lab';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const conversationId = String(req.query.conversationId ?? '').trim();
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
      const id = String(req.query.id ?? '').trim();
      if (id) return res.status(200).json({ dataset: evaluationLab.exportDataset(id, conversationId) });
      return res.status(200).json({ datasets: evaluationLab.listDatasets(conversationId) });
    }
    if (req.method === 'POST') {
      const body = req.body ?? {};
      if (typeof body.conversationId !== 'string' || typeof body.name !== 'string' || typeof body.description !== 'string') {
        return res.status(400).json({ error: 'conversationId, name and description are required' });
      }
      return res.status(201).json({ dataset: evaluationLab.createDataset({ ...body, createdBy: 'platform-user' }) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
}
