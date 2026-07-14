import { describe, expect, it, vi } from 'vitest';
import type { Server as IOServer } from 'socket.io';
import { registerHarnessCoordinator, submitTaskWakeupToHarness } from '@/server/harness/registry';
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
    }));
    await completion;
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      handledByHarness: false,
      harnessFallbackReasonCode: 'runtime_profile_missing',
    }));
  });
});
