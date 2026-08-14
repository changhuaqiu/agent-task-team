import type { RuntimeAgentProfile, RuntimeCliEngine, TeamRuntime } from './types';
import { normalizeRuntimeCliEngine } from './runtimeEngine';
import { canExecuteAccount, type AccountAuthMode } from '@/lib/account-auth';

export type RuntimeAccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

export interface RuntimeAccountInput {
  id: string;
  provider: RuntimeAccountProvider;
  authMode: AccountAuthMode;
  enabled: boolean;
}

const PROVIDER_TO_ENGINE: Record<RuntimeAccountProvider, RuntimeCliEngine> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'opencode',
  kimi: 'opencode',
  opencode: 'opencode',
  other: 'opencode',
};

function providerToEngine(provider: RuntimeAccountProvider): RuntimeCliEngine {
  return PROVIDER_TO_ENGINE[provider];
}

export function resolveRuntimeAgentProfile(
  runtime: TeamRuntime,
  agentId: string,
  accounts: RuntimeAccountInput[],
): RuntimeAgentProfile | null {
  const agent = runtime.roster.find((item) => item.id === agentId);
  if (!agent) return null;

  const enabledAccount = agent.accountIds
    .map((id) => accounts.find((account) => (
      account.id === id
      && account.enabled
      && canExecuteAccount(account.provider, account.authMode)
    )))
    .find(Boolean);

  const engine = enabledAccount
    ? providerToEngine(enabledAccount.provider)
    : normalizeRuntimeCliEngine(agent.cliEngine);
  if (!engine) return null;

  return {
    agent,
    execution: {
      engine,
      accountId: enabledAccount?.id,
    },
    prompt: {
      roleCard: agent.roleCard,
      skills: agent.skills,
      teamPack: runtime.teamPack,
      roster: runtime.roster,
    },
  };
}
