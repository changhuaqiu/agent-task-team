import { describe, expect, it, vi } from 'vitest';
import type { Server as IOServer } from 'socket.io';
import {
  registerHarnessCoordinator,
  scenarioForWakeup,
  submitTaskWakeupToHarness,
} from '@/server/harness/registry';
import type { HarnessCoordinator } from '@/server/harness/coordinator';
import type { TaskWakeup } from '@/server/task-flow/task-wakeup';

const wakeup: TaskWakeup = {
  id: 'wakeup-1',
  conversationId: 'conv-1',
  taskId: 'TASK-1',
  agentId: 'luigi',
  reasonCode: 'owner_ready',
  dispatchSource: 'workflow',
  prompt: 'Implement TASK-1',
  content: 'System wakeup',
  metadata: {
    taskId: 'TASK-1',
    taskTitle: 'Harness',
    taskStatus: 'pending',
    ownerAgentId: 'luigi',
    reasonCode: 'owner_ready',
    idempotencyKey: 'conv-1:TASK-1:luigi:owner_ready',
    startsA2AHandoff: false,
    startsDispatch: true,
  },
};

describe('Harness registry', () => {
  it.each([
    ['chain_ready_for_closure', 'system', 'closure'],
    ['stale_review_gate', 'review_gate', 'recovery'],
    ['stale_test_gate', 'test_gate', 'recovery'],
    ['runnable_owned_idle', 'workflow', 'recovery'],
    ['missing_implementation_evidence', 'system', 'recovery'],
    ['missing_delivery_evidence', 'system', 'recovery'],
    ['unblocked_unassigned', 'workflow', 'planning'],
    ['review_decision_ready', 'review_gate', 'planning'],
    ['review_requested', 'review_gate', 'code_review'],
    ['test_requested', 'test_gate', 'verification'],
    ['owner_ready', 'workflow', 'execution'],
    ['dependency_resolved', 'workflow', 'execution'],
  ] as const)('maps %s wakeups to %s', (reasonCode, dispatchSource, scenario) => {
    expect(scenarioForWakeup({
      ...wakeup,
      reasonCode,
      dispatchSource,
      metadata: { ...wakeup.metadata, reasonCode },
    })).toBe(scenario);
  });

  it('submits wakeups without a browser and emits an explicit fallback on planning failure', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;
    const completion = Promise.resolve({ status: 'blocked', reasonCode: 'runtime_profile_missing' } as const);
    const submit = vi.fn(() => ({ disposition: 'accepted', handled: true, completion } as const));
    registerHarnessCoordinator(io, { submit } as unknown as HarnessCoordinator);

    const submission = submitTaskWakeupToHarness(io, wakeup);

    expect(submission?.handled).toBe(true);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      source: 'workflow',
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      agentId: 'luigi',
      contextScenario: 'execution',
    }));
    await completion;
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      handledByHarness: false,
      harnessFallbackReasonCode: 'runtime_profile_missing',
    }));
  });
});
