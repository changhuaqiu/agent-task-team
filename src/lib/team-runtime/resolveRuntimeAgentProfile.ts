import type { RuntimeAgentProfile, RuntimeCliEngine, TeamRuntime } from './types';

export type RuntimeAccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

export interface RuntimeAccountInput {
  id: string;
  provider: RuntimeAccountProvider;
  enabled: boolean;
}

const PROVIDER_TO_ENGINE: Record<RuntimeAccountProvider, RuntimeCliEngine> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
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
    .map((id) => accounts.find((account) => account.id === id && account.enabled))
    .find(Boolean);

  const engine = enabledAccount ? providerToEngine(enabledAccount.provider) : (agent.cliEngine ?? 'opencode');

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
