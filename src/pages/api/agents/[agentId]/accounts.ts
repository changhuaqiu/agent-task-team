import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getAgentById,
  parseAgentAccountIds,
  updateAgentAccountIds,
} from '@/server/db/agentQueries';
import { hasAccount } from '@/server/accounts-file';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { agentId } = req.query as { agentId: string };
  const existing = getAgentById(agentId);
  if (!existing) return res.status(404).json({ error: `Agent not found: ${agentId}` });

  if (req.method === 'GET') {
    return res.status(200).json({ accountIds: parseAgentAccountIds(existing) });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accountIds = req.body?.accountIds;
  if (!Array.isArray(accountIds) || !accountIds.every((item) => typeof item === 'string')) {
    return res.status(400).json({ error: 'accountIds must be a string array' });
  }
  const normalized = [...new Set(accountIds.map((accountId) => accountId.trim()).filter(Boolean))];
  const unknown = normalized.filter((accountId) => !hasAccount(accountId));
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Unknown accounts: ${unknown.join(', ')}` });
  }
  const updated = updateAgentAccountIds(agentId, normalized);
  return res.status(200).json({ accountIds: updated ? parseAgentAccountIds(updated) : [] });
}
