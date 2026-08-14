import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluationLab } from '@/server/evaluation/evaluation-lab';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const conversationId = String(req.query.conversationId ?? '').trim();
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
      return res.status(200).json({
        reviews: evaluationLab.listReviewQueue(conversationId, String(req.query.status ?? 'pending')),
      });
    }
    if (req.method === 'POST') {
      const body = req.body ?? {};
      if (body.action !== 'request_case_promotion') {
        return res.status(400).json({ error: 'Unsupported review action' });
      }
      for (const key of ['conversationId', 'runId', 'datasetId', 'caseKey', 'split']) {
        if (typeof body[key] !== 'string' || !body[key].trim()) {
          return res.status(400).json({ error: `${key} is required` });
        }
      }
      return res.status(201).json({ review: evaluationLab.requestCasePromotion(body) });
    }
    if (req.method === 'PATCH') {
      const body = req.body ?? {};
      for (const key of ['id', 'conversationId']) {
        if (typeof body[key] !== 'string' || !body[key].trim()) {
          return res.status(400).json({ error: `${key} is required` });
        }
      }
      if (body.action === 'review_case_promotion') {
        if (typeof body.approved !== 'boolean' || typeof body.rationale !== 'string' || !body.rationale.trim()) {
          return res.status(400).json({ error: 'approved and rationale are required' });
        }
        return res.status(200).json({
          review: evaluationLab.reviewCasePromotion({ ...body, reviewerId: 'platform-user' }),
        });
      }
      if (body.resolution === undefined) return res.status(400).json({ error: 'resolution is required' });
      return res.status(200).json({ review: evaluationLab.resolveReview({ ...body, reviewerId: 'platform-user' }) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
