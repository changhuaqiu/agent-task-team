import type { NextApiRequest, NextApiResponse } from 'next';
import {
  listPhasesByConversation,
  upsertPhase,
  deletePhase,
} from '@/server/db/phaseQueries';
import type { Phase } from '@/types/phase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const conversationId = req.query.conversationId as string;
      if (!conversationId) {
        return res.status(400).json({ error: 'conversationId is required' });
      }
      const phases = listPhasesByConversation(conversationId);
      return res.status(200).json(phases);
    }

    if (req.method === 'POST') {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'A complete valid phase is required' });
      }
      const phase = req.body as Partial<Phase>;
      if (
        typeof phase.id !== 'string' || !phase.id.trim()
        || typeof phase.conversationId !== 'string' || !phase.conversationId.trim()
        || typeof phase.title !== 'string' || !phase.title.trim()
        || typeof phase.description !== 'string'
        || typeof phase.order !== 'number' || !Number.isFinite(phase.order)
        || !['planned', 'active', 'done'].includes(phase.status ?? '')
        || typeof phase.createdAt !== 'string' || !phase.createdAt.trim()
        || typeof phase.updatedAt !== 'string' || !phase.updatedAt.trim()
      ) {
        return res.status(400).json({ error: 'A complete valid phase is required' });
      }
      const result = upsertPhase(phase as Phase);
      return res.status(200).json(result);
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id as string) || (req.body as { id?: string })?.id;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }
      deletePhase(id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[api/phases] Error:', error);
    return res.status(500).json({ error: (error as Error).message });
  }
}
