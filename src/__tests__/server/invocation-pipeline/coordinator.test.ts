// Invocation Pipeline coordinator tests.
import { describe, expect, it, vi } from 'vitest';
import { InvocationCoordinator } from '@/server/invocation-pipeline/coordinator';
import type {
  AgentActivationCommand,
  InvocationDispatchPlan,
  InvocationPlannerPort,
} from '@/server/invocation-pipeline/types';
import type { AgentRuntime } from '@/server/agent-runtime';

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
    engine: 'opencode',
    runtimeId: 'opencode-local',
    prompt: input.prompt,
  };
}

function coordinator(input?: { busy?: boolean; planner?: InvocationPlannerPort; runtime?: AgentRuntime }) {
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
  it('releases the start lease at Runtime acknowledgement without waiting for completion', async () => {
    let acknowledge!: (envelopeId: string) => void;
    let complete!: (outcome: { status: 'accepted' }) => void;
    const runtime: AgentRuntime = {
      isBusy: () => false,
      execute: (_plan, observer) => new Promise((resolve) => {
        acknowledge = (envelopeId) => observer?.onAcknowledged(envelopeId);
        complete = resolve;
      }),
    };
    const { instance } = coordinator({ runtime });

    const submission = instance.submit(trigger);
    await Promise.resolve();
    acknowledge('envelope-1');

    await expect(submission.started).resolves.toEqual({ status: 'accepted', envelopeId: 'envelope-1' });
    complete({ status: 'accepted' });
    await expect(submission.completion).resolves.toEqual({ status: 'accepted' });
  });

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

  it('scopes caller idempotency by project and Agent', async () => {
    const { instance, prepare, execute } = coordinator();
    const sameKey = 'shared-caller-key';

    await Promise.all([
      instance.submit({ ...trigger, idempotencyKey: sameKey }).completion,
      instance.submit({
        ...trigger,
        id: 'trigger-2',
        conversationId: 'conv-2',
        idempotencyKey: sameKey,
      }).completion,
      instance.submit({
        ...trigger,
        id: 'trigger-3',
        agentId: 'reviewer',
        idempotencyKey: sameKey,
      }).completion,
    ]);

    expect(prepare).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('forwards claim fencing to Runtime acknowledgement', async () => {
    const canAcknowledge = vi.fn(() => false);
    const signal = new AbortController().signal;
    const runtime: AgentRuntime = {
      isBusy: () => false,
      execute: vi.fn(async (_plan, observer) => {
        expect(observer).toMatchObject({ signal, canAcknowledge });
        return { status: 'failed', reasonCode: 'runtime_start_failed' };
      }),
    };
    const { instance } = coordinator({ runtime });

    await expect(instance.submit(trigger, { signal, canAcknowledge }).completion)
      .resolves.toMatchObject({ status: 'failed', reasonCode: 'runtime_start_failed' });
  });

  it('does not cache a Runtime startup failure as a completed activation', async () => {
    const runtime: AgentRuntime = {
      isBusy: () => false,
      execute: vi.fn(async () => ({ status: 'failed', reasonCode: 'runtime_start_failed' })),
    } as AgentRuntime;
    const { instance } = coordinator({ runtime });

    await instance.submit(trigger).completion;
    await instance.submit(trigger).completion;

    expect(runtime.execute).toHaveBeenCalledTimes(2);
  });

  it('does not cache an asynchronous reservation race as completed work', async () => {
    let attempts = 0;
    const runtime: AgentRuntime = {
      isBusy: () => false,
      execute: vi.fn(async () => {
        attempts += 1;
        return attempts === 1
          ? { status: 'deferred', reasonCode: 'agent_busy' }
          : { status: 'accepted' };
      }),
    } as AgentRuntime;
    const { instance } = coordinator({ runtime });

    await expect(instance.submit(trigger).completion)
      .resolves.toEqual({ status: 'deferred', reasonCode: 'agent_busy' });
    await expect(instance.submit(trigger).completion)
      .resolves.toEqual({ status: 'accepted' });
    expect(runtime.execute).toHaveBeenCalledTimes(2);
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
