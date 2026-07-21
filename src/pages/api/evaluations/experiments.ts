import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluationLab } from '@/server/evaluation/evaluation-lab';
import { createRunnerExperiment } from '@/server/evaluation/case-runner';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const id = String(req.query.id ?? '').trim();
      const conversationId = String(req.query.conversationId ?? '').trim();
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
      if (!id) return res.status(200).json({ experiments: evaluationLab.listExperiments(conversationId) });
      const experiment = evaluationLab.getExperiment(id, conversationId);
      return experiment ? res.status(200).json({ experiment }) : res.status(404).json({ error: 'Experiment not found' });
    }
    if (req.method === 'POST') {
      const body = req.body ?? {};
      if (typeof body.conversationId !== 'string' || typeof body.datasetId !== 'string' ||
        typeof body.name !== 'string') {
        return res.status(400).json({ error: 'conversationId, datasetId and name are required' });
      }
      if (typeof body.baselineSnapshotId === 'string' && typeof body.candidateSnapshotId === 'string') {
        return res.status(202).json({ experiment: createRunnerExperiment({
          conversationId: body.conversationId,
          datasetId: body.datasetId,
          name: body.name,
          baselineSnapshotId: body.baselineSnapshotId,
          candidateSnapshotId: body.candidateSnapshotId,
          createdBy: 'platform-user',
        }) });
      }
      if (!Array.isArray(body.pairs)) {
        return res.status(400).json({
          error: 'baselineSnapshotId and candidateSnapshotId are required for a runner experiment',
        });
      }
      return res.status(201).json({ experiment: evaluationLab.createExperiment({ ...body, createdBy: 'platform-user' }) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
}
