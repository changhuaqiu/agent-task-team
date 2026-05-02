import type { NextApiRequest, NextApiResponse } from 'next';
import { readAccount, writeAccount, deleteAccount } from '../../../server/accounts-file';
import { hasCredential, writeCredential, deleteCredential } from '../../../server/credentials';

interface AccountMeta {
  id: string;
  name: string;
  authMode: 'api_key' | 'oauth';
  provider: 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  status: 'unknown' | 'valid' | 'pending' | 'error';
  lastVerifiedAt?: string;
  verifyError?: string;
  createdAt: string;
  updatedAt: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'Missing account id' });
    return;
  }

  if (req.method === 'GET') {
    return handleGet(id, res);
  }
  if (req.method === 'PATCH') {
    return handlePatch(id, req, res);
  }
  if (req.method === 'DELETE') {
    return handleDelete(id, res);
  }
  res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(id: string, res: NextApiResponse) {
  const account = await readAccount(id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const hasApiKey = await hasCredential(id);
  res.status(200).json({ account, hasApiKey });
}

async function handlePatch(id: string, req: NextApiRequest, res: NextApiResponse) {
  const existing = await readAccount(id);
  if (!existing) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  if (req.body.authMode !== undefined) {
    res.status(400).json({ error: 'Cannot change authMode after creation' });
    return;
  }

  const { name, baseUrl, apiKey, models, enabled, provider } = req.body;

  const updated: AccountMeta = {
    ...existing,
    ...(name !== undefined && { name }),
    ...(baseUrl !== undefined && { baseUrl }),
    ...(models !== undefined && { models }),
    ...(enabled !== undefined && { enabled }),
    ...(provider !== undefined && { provider }),
    updatedAt: new Date().toISOString(),
  };

  await writeAccount(updated);

  if (apiKey) {
    await writeCredential(id, { apiKey });
  }

  res.status(200).json({ account: updated });
}

async function handleDelete(id: string, res: NextApiResponse) {
  const existing = await readAccount(id);
  if (!existing) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  await deleteAccount(id);
  await deleteCredential(id);

  res.status(200).json({ ok: true });
}
