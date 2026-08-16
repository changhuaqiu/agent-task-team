import { describe, expect, it, vi } from 'vitest';
import { DaemonExecutionAdapter, type DaemonDispatchPort } from './daemon-execution-adapter';
import type { InvocationDispatchPlan } from './invocation-pipeline';
import type { ExecutionEnvelopeRow } from './repositories/execution-envelope-repo';

const plan = {
  trigger: {
    id: 'activation-1',
    source: 'workflow',
    conversationId: 'delivery-1',
    agentId: 'mario',
    prompt: 'Implement the task',
  },
  runtimeId: 'claude-acp',
  prompt: 'Implement the task',
} as InvocationDispatchPlan;

function envelope(overrides: Partial<ExecutionEnvelopeRow> = {}): ExecutionEnvelopeRow {
  return {
    id: 'envelope-1',
    status: 'routed',
    reason_code: null,
    ...overrides,
  } as ExecutionEnvelopeRow;
}

function dispatch(overrides: Partial<DaemonDispatchPort> = {}): DaemonDispatchPort {
  return {
    requestDispatch: vi.fn(() => envelope()),
    markSent: vi.fn(),
    acknowledge: vi.fn(),
    reject: vi.fn((_id, reasonCode) => envelope({ status: 'rejected', reason_code: reasonCode })),
    ...overrides,
  };
}

describe('DaemonExecutionAdapter', () => {
  it('acknowledges a local directed envelope before starting execution', async () => {
    const calls: string[] = [];
    const gateway = dispatch({
      requestDispatch: vi.fn(() => {
        calls.push('requested');
        return envelope();
      }),
      markSent: vi.fn(() => calls.push('sent')),
      acknowledge: vi.fn(() => calls.push('acknowledged')),
    });
    const execute = vi.fn(async () => { calls.push('execute'); });
    const adapter = new DaemonExecutionAdapter({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      backend: {
        isBusy: (agentId, deliveryId) => agentId === 'mario' && deliveryId === 'delivery-1',
        reserve: () => { calls.push('reserved'); return true; },
        release: () => { calls.push('released'); },
        execute,
      },
    });

    expect(adapter.isBusy('mario', 'delivery-1')).toBe(true);
    await expect(adapter.execute(plan)).resolves.toEqual({
      status: 'accepted',
      envelopeId: 'envelope-1',
    });
    expect(calls).toEqual([
      'reserved',
      'requested',
      'sent',
      'acknowledged',
      'execute',
      'released',
    ]);
    expect(execute).toHaveBeenCalledWith(plan, {
      envelopeId: 'envelope-1',
      sourceNodeId: 'daemon:local',
      targetNodeId: 'daemon:local',
    });
  });

  it('never executes an envelope directed to another node', async () => {
    const gateway = dispatch();
    const execute = vi.fn();
    const adapter = new DaemonExecutionAdapter({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:remote',
      dispatch: gateway,
      backend: { isBusy: () => false, reserve: () => true, release: vi.fn(), execute },
    });

    await expect(adapter.execute(plan)).resolves.toMatchObject({
      status: 'blocked',
      reasonCode: 'runtime_rejected',
      message: 'runtime_executor_not_connected',
    });
    expect(gateway.reject).toHaveBeenCalledWith(
      'envelope-1',
      'runtime_executor_not_connected',
      'unreachable',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not launch execution when routing rejects the target', async () => {
    const gateway = dispatch({
      requestDispatch: vi.fn(() => envelope({
        status: 'rejected',
        reason_code: 'runtime_unreachable',
      })),
    });
    const execute = vi.fn();
    const adapter = new DaemonExecutionAdapter({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      backend: { isBusy: () => false, reserve: () => true, release: vi.fn(), execute },
    });

    await expect(adapter.execute(plan)).resolves.toMatchObject({
      status: 'blocked',
      reasonCode: 'runtime_rejected',
      message: 'runtime_unreachable',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets execution failures return to the coordinator outcome boundary', async () => {
    const adapter = new DaemonExecutionAdapter({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: dispatch(),
      backend: {
        isBusy: () => false,
        reserve: () => true,
        release: vi.fn(),
        execute: vi.fn().mockRejectedValue(new Error('ACP start failed')),
      },
    });

    await expect(adapter.execute(plan)).rejects.toThrow('ACP start failed');
  });

  it('defers a concurrent activation before creating or acknowledging an envelope', async () => {
    let reserved = false;
    let releaseExecution!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const execution = new Promise<void>((resolve) => { releaseExecution = resolve; });
    const gateway = dispatch();
    const execute = vi.fn(async () => {
      markStarted();
      await execution;
    });
    const adapter = new DaemonExecutionAdapter({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      backend: {
        isBusy: () => false,
        reserve: () => {
          if (reserved) return false;
          reserved = true;
          return true;
        },
        release: () => { reserved = false; },
        execute,
      },
    });

    const first = adapter.execute(plan);
    await started;
    const concurrentPlan = {
      ...plan,
      trigger: {
        ...plan.trigger,
        id: 'activation-2',
        idempotencyKey: 'activation-2',
      },
    } as InvocationDispatchPlan;
    await expect(adapter.execute(concurrentPlan)).resolves.toEqual({
      status: 'deferred',
      reasonCode: 'agent_busy',
    });
    expect(gateway.requestDispatch).toHaveBeenCalledTimes(1);
    expect(gateway.acknowledge).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    releaseExecution();
    await expect(first).resolves.toMatchObject({ status: 'accepted' });
  });
});
