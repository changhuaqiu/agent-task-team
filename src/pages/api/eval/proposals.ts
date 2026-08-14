import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluationLab } from '@/server/evaluation/evaluation-lab';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const conversationId = String(req.query.conversationId ?? '').trim();
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
      return res.status(200).json({ proposals: evaluationLab.listProposals(conversationId) });
    }
    if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body ?? {};
    if (req.method === 'POST') {
      for (const key of ['conversationId', 'gapId', 'targetType', 'hypothesis', 'proposedChange', 'risk']) {
        if (typeof body[key] !== 'string' || !body[key].trim()) return res.status(400).json({ error: `${key} is required` });
      }
      return res.status(201).json({ proposal: evaluationLab.createProposal({ ...body, ownerId: 'platform-user' }) });
    }
    for (const key of ['id', 'conversationId', 'action']) {
      if (typeof body[key] !== 'string' || !body[key].trim()) return res.status(400).json({ error: `${key} is required` });
    }
    if (!['submit', 'approve', 'apply', 'revert'].includes(body.action)) {
      return res.status(400).json({ error: 'invalid proposal action' });
    }
    if ((body.action === 'approve' || body.action === 'apply') && body.operatorConfirmed !== true) {
      return res.status(400).json({ error: 'single platform operator confirmation is required' });
    }
    return res.status(200).json({
      proposal: evaluationLab.transitionProposal({ ...body, actorId: 'platform-operator' }),
    });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
}
