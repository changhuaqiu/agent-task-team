import type { NextApiRequest, NextApiResponse } from 'next';
import { AgentInbox } from '@/server/platform-events/agent-inbox';
import {
  AgentInboxManualRetryError,
  AgentInboxManualRetryService,
} from '@/server/platform-events/agent-inbox-manual-retry';

function publicFailure(item: ReturnType<AgentInbox['listExpired']>[number]) {
  return {
    id: item.id,
    projectId: item.projectId,
    agentId: item.projectAgentId,
    source: item.command.source,
    taskId: item.command.taskId,
    workId: item.command.workId,
    attempts: item.attemptCount,
    reasonCode: item.lastError ?? 'runtime_start_failed',
    createdAt: item.createdAt,
    failedAt: item.settledAt ?? item.updatedAt,
  };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const inbox = new AgentInbox();
  if (req.method === 'GET') {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });
    return res.status(200).json({ failures: inbox.listExpired(projectId).map(publicFailure) });
  }
  if (req.method === 'POST' && req.body?.action === 'retry') {
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId.trim() : '';
    if (!itemId) return res.status(400).json({ error: 'inbox_item_id_required' });
    try {
      const result = new AgentInboxManualRetryService().retry(itemId);
      if (!result) return res.status(404).json({ error: 'inbox_failure_not_found' });
      return res.status(200).json({
        item: { id: result.item.id, status: result.item.status },
        reissued: result.reissued,
      });
    } catch (error) {
      if (error instanceof AgentInboxManualRetryError) {
        return res.status(error.httpStatus).json({ error: error.message, reasonCode: error.reasonCode });
      }
      throw error;
    }
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'method_not_allowed' });
}
