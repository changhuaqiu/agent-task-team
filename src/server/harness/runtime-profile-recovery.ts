import {
  resolveRuntimeAgentProfile,
  type RuntimeAccountInput,
  type RuntimeAgentProfile,
  type TeamRuntime,
} from '@/lib/team-runtime';
import type { InvocationRow } from '../repositories/invocation-repo';

function isRuntimeExecution(invocation: InvocationRow): boolean {
  return Boolean(invocation.runtime_id && invocation.account_id);
}

function isCompleted(invocation: InvocationRow): boolean {
  return isRuntimeExecution(invocation)
    && (
      invocation.status === 'succeeded'
      || (invocation.status === 'terminated' && invocation.outcome === 'completed')
    );
}

function isEmptyCompletionFailure(invocation: InvocationRow): boolean {
  return isRuntimeExecution(invocation)
    && invocation.reason_code === 'acp_empty_completion'
    && (
      invocation.status === 'failed'
      || (invocation.status === 'terminated' && invocation.outcome === 'failed')
    );
}

export function resolveFailureAwareRuntimeProfile(input: {
  runtime: TeamRuntime;
  agentId: string;
  accounts: RuntimeAccountInput[];
  invocations: InvocationRow[];
  taskId?: string;
  activeSessionId?: string;
}): RuntimeAgentProfile | null {
  const agent = input.runtime.roster.find((item) => item.id === input.agentId);
  if (!agent) return null;
  if (agent.accountIds.length === 0) {
    return resolveRuntimeAgentProfile(input.runtime, input.agentId, input.accounts);
  }

  const enabledConfiguredIds = agent.accountIds.filter((accountId) =>
    input.accounts.some((account) => account.id === accountId && account.enabled));
  if (enabledConfiguredIds.length === 0) return null;

  const agentHistory = input.invocations.filter((invocation) =>
    invocation.agent_id === input.agentId);
  const history = agentHistory.filter(isRuntimeExecution);
  let latestCompletedIndex = -1;
  history.forEach((invocation, index) => {
    if (isCompleted(invocation)) latestCompletedIndex = index;
  });
  const failedAccountIds = new Set(
    history
      .slice(latestCompletedIndex + 1)
      .filter(isEmptyCompletionFailure)
      .map((invocation) => invocation.account_id)
      .filter((accountId): accountId is string => Boolean(accountId)),
  );

  const availableIds = enabledConfiguredIds.filter((accountId) => !failedAccountIds.has(accountId));
  if (availableIds.length === 0) return null;

  const latestCompletedInActiveSession = [...agentHistory]
    .reverse()
    .find((invocation) =>
      isCompleted(invocation)
      && invocation.session_id === input.activeSessionId
      && invocation.account_id
      && availableIds.includes(invocation.account_id));
  const stickyAccountId = latestCompletedInActiveSession?.account_id;
  const orderedIds = stickyAccountId
    ? [stickyAccountId, ...availableIds.filter((accountId) => accountId !== stickyAccountId)]
    : availableIds;
  const runtime = {
    ...input.runtime,
    roster: input.runtime.roster.map((item) =>
      item.id === input.agentId ? { ...item, accountIds: orderedIds } : item),
  };
  return resolveRuntimeAgentProfile(runtime, input.agentId, input.accounts);
}

export function executionProfileChanged(
  latestInvocation: InvocationRow | undefined,
  requested: RuntimeAgentProfile['execution'],
): boolean {
  if (!latestInvocation) return false;
  return latestInvocation.engine !== requested.engine
    || (latestInvocation.runtime_id ?? undefined) !== requested.runtimeId
    || (latestInvocation.account_id ?? undefined) !== requested.accountId;
}
