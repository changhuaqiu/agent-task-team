import type { RuntimeAgentProfile, TeamRuntime } from './types';
import { normalizeRuntimeCliEngine } from './runtimeEngine';
import {
  isAccountReadyForExecution,
  providerToExecutionEngine,
  type AccountExecutionCandidate,
} from '@/lib/account-auth';

export function resolveRuntimeAgentProfile(
  runtime: TeamRuntime,
  agentId: string,
  accounts: Array<AccountExecutionCandidate & { id: string }>,
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
      preferredModel: agent.model,
    },
    prompt: {
      skills: agent.skills,
      teamPack: runtime.teamPack,
      roster: runtime.roster,
    },
  };
}
