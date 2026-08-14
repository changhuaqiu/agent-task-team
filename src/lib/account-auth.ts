export type AccountAuthMode = 'api_key' | 'oauth';
export type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

export const GOOGLE_API_KEY_REQUIRED = 'Google/Gemini accounts require API Key authentication';

export function canExecuteAccount(
  provider: AccountProvider,
  authMode: AccountAuthMode,
): boolean {
  return provider !== 'google' || authMode === 'api_key';
}
