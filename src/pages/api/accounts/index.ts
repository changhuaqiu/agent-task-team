import type { NextApiRequest, NextApiResponse } from 'next';
import { listAccounts, writeAccount, hasAccount } from '../../../server/accounts-file';
import { hasCredential, writeCredential } from '../../../server/credentials';
import {
  API_KEY_REQUIRED,
  BASE_URL_REQUIRED,
  canExecuteAccount,
  isAccountAuthMode,
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

function generateId(): string {
  return `acct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleList(req, res);
  }
  if (req.method === 'POST') {
    return handleCreate(req, res);
  }
  res.status(405).json({ error: 'Method not allowed' });
}

async function handleList(_req: NextApiRequest, res: NextApiResponse) {
  const accounts = await listAccounts();
  const enriched = await Promise.all(
    accounts.map(async (a: AccountMeta) => ({
      ...a,
      hasApiKey: await hasCredential(a.id),
    })),
  );
  res.status(200).json({ accounts: enriched });
}

async function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  const { name, authMode, provider, baseUrl, apiKey, models, enabled } = req.body;

  if (!name || !provider || !authMode) {
    res.status(400).json({ error: 'Missing required fields: name, provider, authMode' });
    return;
  }

  if (!canExecuteAccount(provider, authMode)) {
    res.status(400).json({ error: API_KEY_REQUIRED });
    return;
  }

  if (!isAccountProvider(provider) || !isAccountAuthMode(authMode)) {
    res.status(400).json({ error: 'Unsupported provider or authMode' });
    return;
  }
  if (authMode === 'api_key' && requiresBaseUrl(provider) && !baseUrl?.trim()) {
    res.status(400).json({ error: BASE_URL_REQUIRED });
    return;
  }
  if (authMode === 'api_key' && !apiKey?.trim()) {
    res.status(400).json({ error: 'API Key is required' });
    return;
  }
  if (
    authMode === 'api_key'
    && (!Array.isArray(models) || models.length === 0 || models.some((model) => typeof model !== 'string' || !model.trim()))
  ) {
    res.status(400).json({ error: 'At least one model is required' });
    return;
  }

  const existing = await hasAccount(name);
  if (existing) {
    res.status(409).json({ error: 'Account with this name already exists' });
    return;
  }

  const id = generateId();
  const now = new Date().toISOString();

  let status: AccountMeta['status'] = 'unknown';
  if (authMode === 'api_key') {
    status = apiKey ? 'pending' : 'error';
  }

  const account: AccountMeta = {
    id,
    name,
    authMode,
    provider,
    baseUrl: baseUrl ?? undefined,
    models: models ?? [],
    enabled: enabled ?? true,
    status,
    createdAt: now,
    updatedAt: now,
  };

  await writeAccount(account);

  if (apiKey) {
    await writeCredential(id, { apiKey });
  }

  res.status(201).json({ account });
}
