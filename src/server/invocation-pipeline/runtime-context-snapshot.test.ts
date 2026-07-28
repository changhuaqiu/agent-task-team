// Invocation Pipeline context snapshot tests.
import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '@/lib/agent-context/ContextManager';
import { finalizeRuntimeContextSnapshot } from './runtime-context-snapshot';

function assemblySnapshot(): ContextSnapshot {
  return {
    id: 'ctx_assembly',
    query: {
      scenario: 'execution',
      trigger: 'resume',
      conversationId: 'conv-1',
      agentId: 'coder',
      archetype: 'worker',
      budgetTokens: 4_000,
      requiredContributorIds: [],
      now: '2026-07-19T00:00:00.000Z',
      requestDigest: 'request-digest',
    },
    fragmentRefs: [],
    capabilities: [],
    constraints: [],
    missingRequired: [],
    omissions: [],
    compiledPrompt: 'assembled',
    createdAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('finalizeRuntimeContextSnapshot', () => {
  it('binds the snapshot id to transport, prompt and system channel', () => {
    const first = finalizeRuntimeContextSnapshot(assemblySnapshot(), {
      transport: 'acp',
      systemPromptChannel: 'instructions',
      prompt: 'implement task\n[system] worktree: C:/work',
      systemPrompt: 'role and policy',
    });
    const same = finalizeRuntimeContextSnapshot(assemblySnapshot(), {
      transport: 'acp',
      systemPromptChannel: 'instructions',
      prompt: 'implement task\n[system] worktree: C:/work',
      systemPrompt: 'role and policy',
    });
    const changed = finalizeRuntimeContextSnapshot(assemblySnapshot(), {
      transport: 'acp',
      systemPromptChannel: 'backend',
      prompt: 'implement task\n[system] worktree: C:/work',
      systemPrompt: 'role and policy',
    });

    expect(first.id).toBe(same.id);
    expect(first.id).not.toBe(changed.id);
    expect(first.assemblyId).toBe('ctx_assembly');
    expect(first.runtimeInput).toMatchObject({
      transport: 'acp',
      systemPromptChannel: 'instructions',
      promptDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      combinedDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
