import { resolveConversationRuntime } from '@/server/invocation-pipeline/conversation-runtime';

interface ResolveInitialTaskAgentInput {
  conversationId: string;
  explicitAgentId?: string | null;
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveInitialTaskAgentId(input: ResolveInitialTaskAgentInput): string | undefined {
  const explicitAgentId = present(input.explicitAgentId);
  if (explicitAgentId) return explicitAgentId;

  const runtime = resolveConversationRuntime(input.conversationId);
  if (runtime?.initialAgentId) return runtime.initialAgentId;
  const rosterAgentId = runtime?.roster[0]?.id;
  if (rosterAgentId) return rosterAgentId;

  return undefined;
}
