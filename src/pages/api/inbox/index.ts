import type { NextApiRequest, NextApiResponse } from 'next';
import { workspaceInboxRepo, type WorkspaceInboxFilter } from '@/server/workspace-inbox/repository';

const FILTERS = new Set<WorkspaceInboxFilter>(['all', 'needs_action', 'agents', 'reviews']);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    workspaceInboxRepo.reconcile();
    const requested = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const filter = FILTERS.has(requested as WorkspaceInboxFilter) ? requested as WorkspaceInboxFilter : 'all';
    return res.status(200).json({
      items: workspaceInboxRepo.list(filter),
      reviewCount: workspaceInboxRepo.list('reviews')
        .filter((item) => item.actionState === 'needs_action').length,
    });
  }
  if (req.method === 'POST' && req.body?.action === 'mark_read' && typeof req.body?.conversationKey === 'string') {
    return res.status(workspaceInboxRepo.markRead(req.body.conversationKey) ? 200 : 404).json({ ok: true });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}
