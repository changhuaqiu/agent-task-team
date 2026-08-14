import type { NextApiRequest, NextApiResponse } from 'next';
import { readAccount, writeAccount, deleteAccount } from '../../../server/accounts-file';
import { hasCredential, writeCredential, deleteCredential } from '../../../server/credentials';
import {
  API_KEY_REQUIRED,
  BASE_URL_REQUIRED,
  canExecuteAccount,
  isAccountProvider,
  requiresBaseUrl,
  type AccountAuthMode,
  type AccountProvider,
} from '../../../lib/account-auth';

interface AccountMeta {
  id: string;
  name: string;
  authMode: AccountAuthMode;
  provider: AccountProvider;
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

  if (provider !== undefined && !isAccountProvider(provider)) {
    res.status(400).json({ error: 'Unsupported provider' });
    return;
  }
  if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey.trim())) {
    res.status(400).json({ error: 'API Key cannot be empty' });
    return;
  }
  if (
    existing.authMode === 'api_key'
    && models !== undefined
    && (!Array.isArray(models) || models.length === 0 || models.some((model) => typeof model !== 'string' || !model.trim()))
  ) {
    res.status(400).json({ error: 'At least one model is required' });
    return;
  }

  if (!canExecuteAccount(provider ?? existing.provider, existing.authMode)) {
    res.status(400).json({ error: API_KEY_REQUIRED });
    return;
  }
  if (
    existing.authMode === 'api_key'
    && requiresBaseUrl(provider ?? existing.provider)
    && !(baseUrl ?? existing.baseUrl)?.trim()
  ) {
    res.status(400).json({ error: BASE_URL_REQUIRED });
    return;
  }

  const connectionChanged = (provider !== undefined && provider !== existing.provider)
    || (baseUrl !== undefined && baseUrl !== existing.baseUrl)
    || apiKey !== undefined
    || (models !== undefined && JSON.stringify(models) !== JSON.stringify(existing.models));
  const updated: AccountMeta = {
    ...existing,
    ...(name !== undefined && { name }),
    ...(baseUrl !== undefined && { baseUrl }),
    ...(models !== undefined && { models }),
    ...(enabled !== undefined && { enabled }),
    ...(provider !== undefined && { provider }),
    ...(connectionChanged && {
      status: 'pending' as const,
      lastVerifiedAt: undefined,
      verifyError: undefined,
    }),
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
