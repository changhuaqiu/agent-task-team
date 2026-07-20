import { createHash } from 'node:crypto';
import type { ContextSnapshot } from '@/lib/agent-context/ContextManager';

export interface RuntimeContextInput {
  transport: 'bridge' | 'tmux' | 'acp';
  systemPromptChannel: 'none' | 'bridge' | 'instructions' | 'backend' | 'inline';
  prompt: string;
  systemPrompt?: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * ContextManager owns semantic assembly. The daemon owns the last-mile
 * transport envelope, so only the daemon can produce an id that proves the
 * exact prompt/system channels sent to the runtime.
 */
export function finalizeRuntimeContextSnapshot(
  snapshot: ContextSnapshot,
  input: RuntimeContextInput,
): ContextSnapshot {
  const assemblyId = snapshot.assemblyId ?? snapshot.id;
  const runtimeInput: NonNullable<ContextSnapshot['runtimeInput']> = {
    transport: input.transport,
    systemPromptChannel: input.systemPrompt ? input.systemPromptChannel : 'none',
    promptDigest: sha256(input.prompt),
    ...(input.systemPrompt ? { systemPromptDigest: sha256(input.systemPrompt) } : {}),
    combinedDigest: sha256(JSON.stringify({
      transport: input.transport,
      systemPromptChannel: input.systemPrompt ? input.systemPromptChannel : 'none',
      prompt: input.prompt,
      systemPrompt: input.systemPrompt ?? '',
    })),
  };

  return {
    ...snapshot,
    assemblyId,
    id: `ctx_${sha256(JSON.stringify({ assemblyId, runtimeInput }))}`,
    runtimeInput,
    compiledPrompt: [input.systemPrompt, input.prompt].filter(Boolean).join('\n\n'),
  };
}
