import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';

export type AccountAuthMode = 'api_key' | 'oauth';
export type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

const ACCOUNT_AUTH_MODES = ['api_key', 'oauth'] as const;
const ACCOUNT_PROVIDERS = ['anthropic', 'openai', 'google', 'kimi', 'opencode', 'other'] as const;

export const API_KEY_REQUIRED = 'This provider requires API Key authentication';
export const BASE_URL_REQUIRED = 'This provider requires a Base URL';

export const PROVIDER_TO_ENGINE: Record<AccountProvider, RuntimeCliEngine> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'opencode',
  kimi: 'opencode',
  opencode: 'opencode',
  other: 'opencode',
};

export function providerToExecutionEngine(provider: AccountProvider): RuntimeCliEngine {
  return PROVIDER_TO_ENGINE[provider];
}

export function isAccountAuthMode(value: unknown): value is AccountAuthMode {
  return ACCOUNT_AUTH_MODES.includes(value as AccountAuthMode);
}

export function isAccountProvider(value: unknown): value is AccountProvider {
  return ACCOUNT_PROVIDERS.includes(value as AccountProvider);
}

export function isOpenCodeRoutedProvider(provider: AccountProvider): boolean {
  return providerToExecutionEngine(provider) === 'opencode';
}

export function requiresBaseUrl(provider: AccountProvider): boolean {
  return isOpenCodeRoutedProvider(provider) && provider !== 'google';
}

export function canExecuteAccount(
  provider: unknown,
  authMode: unknown,
): boolean {
  if (!isAccountProvider(provider) || !isAccountAuthMode(authMode)) return false;
  return authMode === 'api_key' || provider === 'anthropic' || provider === 'openai';
}

export interface AccountExecutionCandidate {
  provider: AccountProvider;
  authMode: AccountAuthMode;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  status: 'unknown' | 'valid' | 'pending' | 'error';
  hasApiKey: boolean;
}

export function isAccountReadyForExecution(account: AccountExecutionCandidate): boolean {
  if (!isAccountProvider(account.provider) || !isAccountAuthMode(account.authMode)) return false;
  if (!account.enabled || account.status !== 'valid') return false;
  if (!canExecuteAccount(account.provider, account.authMode)) return false;
  if (account.authMode === 'oauth') return true;
  return account.hasApiKey
    && account.models.some((model) => typeof model === 'string' && Boolean(model.trim()))
    && (!requiresBaseUrl(account.provider) || Boolean(account.baseUrl?.trim()));
}
