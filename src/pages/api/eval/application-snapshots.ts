import type { NextApiRequest, NextApiResponse } from 'next';
import type { TeamPack } from '@/types/teamPack';
import { getDb } from '@/server/db';
import {
  freezeApplicationSnapshot,
  getApplicationSnapshot,
} from '@/server/evaluation/application-snapshot';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const conversationId = String(
      req.method === 'GET' ? req.query.conversationId ?? '' : req.body?.conversationId ?? '',
    ).trim();
    if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
    if (req.method === 'GET') {
      const id = String(req.query.id ?? '').trim();
      if (id) {
        const snapshot = getApplicationSnapshot(id, conversationId);
        return snapshot
          ? res.status(200).json({ snapshot })
          : res.status(404).json({ error: 'Application snapshot not found' });
      }
      const snapshots = getDb().prepare(`SELECT id,conversation_id,name,source,code_revision,
        manifest_digest,created_by,created_at FROM eval_application_snapshot
        WHERE conversation_id=? ORDER BY created_at DESC`).all(conversationId);
      return res.status(200).json({ snapshots });
    }
    if (req.method === 'POST') {
      const body = req.body ?? {};
      if (typeof body.name !== 'string' || !['published', 'candidate'].includes(body.source)) {
        return res.status(400).json({ error: 'name and source=published|candidate are required' });
      }
      const snapshot = freezeApplicationSnapshot({
        conversationId,
        name: body.name,
        source: body.source,
        codeRevision: typeof body.codeRevision === 'string' ? body.codeRevision : undefined,
        team: body.team && typeof body.team === 'object' ? body.team as TeamPack : undefined,
        skillRevisionOverrides: body.skillRevisionOverrides && typeof body.skillRevisionOverrides === 'object'
          ? body.skillRevisionOverrides
          : undefined,
        createdBy: 'platform-user',
      });
      return res.status(201).json({ snapshot });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
