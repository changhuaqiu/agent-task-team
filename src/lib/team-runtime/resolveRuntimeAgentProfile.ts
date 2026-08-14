import type { RuntimeAgentProfile, TeamRuntime } from './types';
import { normalizeRuntimeCliEngine } from './runtimeEngine';
import {
  isAccountReadyForExecution,
  providerToExecutionEngine,
  type AccountAuthMode,
  type AccountProvider,
} from '@/lib/account-auth';

export type RuntimeAccountProvider = AccountProvider;

export interface RuntimeAccountInput {
  id: string;
  provider: RuntimeAccountProvider;
  authMode: AccountAuthMode;
  enabled: boolean;
  status: 'unknown' | 'valid' | 'pending' | 'error';
  baseUrl?: string;
  models: string[];
  hasApiKey: boolean;
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
      && isAccountReadyForExecution(account)
    )))
    .find(Boolean);

  const engine = enabledAccount
    ? providerToExecutionEngine(enabledAccount.provider)
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
