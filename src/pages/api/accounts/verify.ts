import type { NextApiRequest, NextApiResponse } from 'next';
import { readAccount, writeAccount } from '../../../server/accounts-file';
import { readCredential } from '../../../server/credentials';
import { tryCliProbe, buildProbeEnv } from '../../../server/cli-probe';
import { canExecuteAccount, GOOGLE_API_KEY_REQUIRED } from '../../../lib/account-auth';

type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

const PROVIDER_CLI: Record<AccountProvider, string> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
  kimi: 'kimi',
  opencode: 'opencode',
  other: 'other',
};

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

  const provider = account.provider as AccountProvider;
  if (!canExecuteAccount(provider, account.authMode)) {
    const now = new Date().toISOString();
    const error = GOOGLE_API_KEY_REQUIRED;
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

  const apiKey = credential?.apiKey ?? '';
  const env = buildProbeEnv(provider, apiKey, account.baseUrl);
  const cliName = PROVIDER_CLI[provider] ?? 'other';
  const model = account.models?.[0];

  const result = await tryCliProbe(cliName, { model, env });

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
