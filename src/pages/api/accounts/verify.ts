import type { NextApiRequest, NextApiResponse } from 'next';
import { readAccount, writeAccount } from '../../../server/accounts-file';
import { readCredential } from '../../../server/credentials';
import { tryCliProbe, buildProbeEnv } from '../../../server/cli-probe';
import {
  API_KEY_REQUIRED,
  BASE_URL_REQUIRED,
  canExecuteAccount,
  isAccountAuthMode,
  isAccountProvider,
  isOpenCodeRoutedProvider,
  providerToExecutionEngine,
  requiresBaseUrl,
  type AccountProvider,
} from '../../../lib/account-auth';
import {
  cleanupRuntimeConfig,
  generateRuntimeConfig,
  makeInvocationId,
} from '../../../server/opencode-config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accountId } = req.body ?? {};
  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ error: 'accountId is required' });
  }

  const account = await readAccount(accountId);
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  if (!isAccountProvider(account.provider) || !isAccountAuthMode(account.authMode)) {
    const now = new Date().toISOString();
    const error = 'Unsupported provider or authMode';
    await writeAccount({ ...account, status: 'error', lastVerifiedAt: now, updatedAt: now, verifyError: error });
    return res.status(200).json({ ok: false, error });
  }
  const provider: AccountProvider = account.provider;
  if (!canExecuteAccount(provider, account.authMode)) {
    const now = new Date().toISOString();
    const error = API_KEY_REQUIRED;
    await writeAccount({
      ...account,
      status: 'error',
      lastVerifiedAt: now,
      updatedAt: now,
      verifyError: error,
    });
    return res.status(200).json({ ok: false, error });
  }
  const credential = await readCredential(accountId);

  if (requiresBaseUrl(provider) && !account.baseUrl?.trim()) {
    const now = new Date().toISOString();
    const error = BASE_URL_REQUIRED;
    await writeAccount({
      ...account,
      status: 'error',
      lastVerifiedAt: now,
      updatedAt: now,
      verifyError: error,
    });
    return res.status(200).json({ ok: false, error });
  }

  if (account.authMode === 'api_key' && !credential?.apiKey) {
    await writeAccount({
      ...account,
      status: 'error',
      lastVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      verifyError: '该账号未配置 API Key',
    });
    return res.status(200).json({ ok: false, error: '该账号未配置 API Key' });
  }

  if (
    account.authMode === 'api_key'
    && (!Array.isArray(account.models) || account.models.length === 0 || account.models.some((model) => typeof model !== 'string' || !model.trim()))
  ) {
    const now = new Date().toISOString();
    const error = 'At least one model is required';
    await writeAccount({ ...account, status: 'error', lastVerifiedAt: now, updatedAt: now, verifyError: error });
    return res.status(200).json({ ok: false, error });
  }

  const apiKey = credential?.apiKey ?? '';
  const env = apiKey ? buildProbeEnv(provider, apiKey, account.baseUrl) : {};
  const model = account.models?.[0];
  let result: Awaited<ReturnType<typeof tryCliProbe>>;
  if (isOpenCodeRoutedProvider(provider)) {
    const config = generateRuntimeConfig(makeInvocationId(`verify-${account.id}`), {
      provider,
      apiKey,
      baseUrl: account.baseUrl,
      models: account.models,
      defaultModel: model,
    });
    try {
      result = await tryCliProbe('opencode', { env: { ...env, ...config.env } });
    } finally {
      if (config.configDir) cleanupRuntimeConfig(config.configDir);
    }
  } else {
    result = await tryCliProbe(providerToExecutionEngine(provider), { model, env });
  }
  const now = new Date().toISOString();
  const updated = {
    ...account,
    status: result.ok ? 'valid' as const : 'error' as const,
    lastVerifiedAt: now,
    updatedAt: now,
    ...(result.ok ? { verifyError: undefined } : { verifyError: result.error }),
  };

  await writeAccount(updated);

  return res.status(200).json({
    ok: result.ok,
    error: result.error,
    output: result.output,
    account: updated,
  });
}
