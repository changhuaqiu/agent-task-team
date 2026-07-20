import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluationLab } from '@/server/evaluation/evaluation-lab';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const datasetId = String(req.query.datasetId ?? '').trim();
      const conversationId = String(req.query.conversationId ?? '').trim();
      if (!datasetId || !conversationId) return res.status(400).json({ error: 'datasetId and conversationId are required' });
      return res.status(200).json(evaluationLab.agreement(datasetId, conversationId));
    }
    if (req.method === 'POST') {
      const body = req.body ?? {};
      for (const key of ['conversationId', 'caseId', 'dimensionKey', 'label', 'rationale', 'reviewerName']) {
        if (typeof body[key] !== 'string' || !body[key].trim()) return res.status(400).json({ error: `${key} is required` });
      }
      const reviewerId = `local-reviewer:${String(body.reviewerName).trim().toLocaleLowerCase()}`;
      return res.status(201).json({ annotation: evaluationLab.annotate({ ...body, reviewerId }) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
}
