import type { NextApiRequest, NextApiResponse } from 'next';
import { agentEvaluation } from '@/server/evaluation/agent-evaluation';

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const conversationId = one(req.query.conversationId)?.trim();
    if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
    return res.status(200).json(agentEvaluation.listRuns(conversationId, {
      limit: Number(one(req.query.limit) ?? 30),
      status: one(req.query.status),
      rootTaskId: one(req.query.rootTaskId),
      chainId: one(req.query.chainId),
      cursor: one(req.query.cursor),
    }));
  }
  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
    try {
      const result = agentEvaluation.submit({
        conversationId,
        triggerId: typeof body.triggerId === 'string' ? body.triggerId : undefined,
        rootTaskId: typeof body.rootTaskId === 'string' ? body.rootTaskId : undefined,
        chainId: typeof body.chainId === 'string' ? body.chainId : undefined,
        evidenceCutoffAt: typeof body.evidenceCutoffAt === 'string' ? body.evidenceCutoffAt : undefined,
        mode: body.mode === 'offline' || body.mode === 'replay' ? body.mode : 'online',
        taskType: typeof body.taskType === 'string' ? body.taskType : undefined,
        difficulty: typeof body.difficulty === 'string' ? body.difficulty : undefined,
        language: typeof body.language === 'string' ? body.language : undefined,
        caseId: typeof body.caseId === 'string' ? body.caseId : undefined,
        applicationManifest: body.applicationManifest && typeof body.applicationManifest === 'object' &&
          !Array.isArray(body.applicationManifest) ? body.applicationManifest as Record<string, unknown> : undefined,
      });
      setImmediate(() => void agentEvaluation.processPending(1));
      return res.status(result.duplicate ? 200 : 202).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(message === 'Conversation not found' ? 404 : 400).json({ error: message });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
