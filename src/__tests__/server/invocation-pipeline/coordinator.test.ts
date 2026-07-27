// Invocation Pipeline coordinator tests.
import { describe, expect, it, vi } from 'vitest';
import { InvocationCoordinator } from '@/server/invocation-pipeline/coordinator';
import type {
  AgentActivationCommand,
  AgentRuntimePort,
  InvocationDispatchPlan,
  InvocationPlannerPort,
} from '@/server/invocation-pipeline/types';

const trigger: AgentActivationCommand = {
  id: 'trigger-1',
  source: 'workflow',
  conversationId: 'conv-1',
  taskId: 'TASK-1',
  agentId: 'luigi',
  prompt: 'Implement TASK-1',
  idempotencyKey: 'conv-1:TASK-1:luigi:owner_ready',
};

function planFor(input: AgentActivationCommand): InvocationDispatchPlan {
  return {
    trigger: input,
    engine: 'mock',
    runtimeId: 'mock-runtime',
    prompt: input.prompt,
  };
}

function coordinator(input?: { busy?: boolean; planner?: InvocationPlannerPort; runtime?: AgentRuntimePort }) {
  const prepare = vi.fn(async (item: AgentActivationCommand) => ({ ok: true as const, plan: planFor(item) }));
  const execute = vi.fn(async () => ({ status: 'accepted' as const }));
  const recordProof = vi.fn();
  const instance = new InvocationCoordinator({
    planner: input?.planner ?? { prepare },
    runtime: input?.runtime ?? { isBusy: () => input?.busy ?? false, execute },
    recordProof,
  });
  return { instance, prepare, execute, recordProof };
}

describe('InvocationCoordinator', () => {
  it('prepares and executes an accepted trigger exactly once', async () => {
    const { instance, prepare, execute } = coordinator();

    const first = instance.submit(trigger);
    const duplicate = instance.submit(trigger);

    expect(first.disposition).toBe('accepted');
    expect(first.handled).toBe(true);
    expect(duplicate.disposition).toBe('duplicate');
    expect(duplicate.handled).toBe(true);
    await expect(first.completion).resolves.toEqual({ status: 'accepted' });
    await duplicate.completion;
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('defers synchronously when the runtime is busy so the Inbox can queue it', async () => {
    const { instance, prepare, execute } = coordinator({ busy: true });

    const submission = instance.submit(trigger);

    expect(submission).toMatchObject({ disposition: 'deferred', handled: false });
    await expect(submission.completion).resolves.toEqual({ status: 'deferred', reasonCode: 'agent_busy' });
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns a stable block reason without invoking the runtime', async () => {
    const planner: InvocationPlannerPort = {
      prepare: vi.fn(async () => ({
        ok: false,
        outcome: { status: 'blocked', reasonCode: 'runtime_profile_missing' },
      })),
    };
    const { instance, execute } = coordinator({ planner });

    await expect(instance.submit(trigger).completion).resolves.toEqual({
      status: 'blocked',
      reasonCode: 'runtime_profile_missing',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
