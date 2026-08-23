import { describe, expect, it, vi } from 'vitest';
import { DirectedAgentRuntime, type AgentRuntimeDispatchPort } from '.';
import type { InvocationDispatchPlan } from '../invocation-pipeline';
import type { ExecutionEnvelopeRow } from '../repositories/execution-envelope-repo';

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

function dispatch(overrides: Partial<AgentRuntimeDispatchPort> = {}): AgentRuntimeDispatchPort {
  return {
    requestDispatch: vi.fn(() => envelope()),
    markSent: vi.fn(() => true),
    acknowledge: vi.fn(() => true),
    markExecutionFailed: vi.fn(),
    reject: vi.fn((_id, reasonCode) => envelope({ status: 'rejected', reason_code: reasonCode })),
    ...overrides,
  };
}

describe('DirectedAgentRuntime', () => {
  it('acknowledges only after the executor has prepared a real execution', async () => {
    const calls: string[] = [];
    const gateway = dispatch({
      requestDispatch: vi.fn(() => {
        calls.push('requested');
        return envelope();
      }),
      markSent: vi.fn(() => { calls.push('sent'); return true; }),
      acknowledge: vi.fn(() => { calls.push('acknowledged'); return true; }),
    });
    const execute = vi.fn(async (_plan, _dispatch, lifecycle: { acknowledge(): boolean }) => {
      calls.push('execution-prepared');
      lifecycle.acknowledge();
      calls.push('execute');
    });
    const adapter = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      executor: {
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
      'execution-prepared',
      'acknowledged',
      'execute',
      'released',
    ]);
    expect(execute).toHaveBeenCalledWith(
      plan,
      {
        envelopeId: 'envelope-1',
        sourceNodeId: 'daemon:local',
        targetNodeId: 'daemon:local',
      },
      expect.objectContaining({ acknowledge: expect.any(Function) }),
    );
  });

  it('never executes an envelope directed to another node', async () => {
    const gateway = dispatch();
    const execute = vi.fn();
    const adapter = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:remote',
      dispatch: gateway,
      executor: { isBusy: () => false, reserve: () => true, release: vi.fn(), execute },
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
    const adapter = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      executor: { isBusy: () => false, reserve: () => true, release: vi.fn(), execute },
    });

    await expect(adapter.execute(plan)).resolves.toMatchObject({
      status: 'blocked',
      reasonCode: 'runtime_rejected',
      message: 'runtime_unreachable',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when a prepared executor cannot acknowledge', async () => {
    const gateway = dispatch({ acknowledge: vi.fn(() => false) });
    const release = vi.fn();
    const execute = vi.fn(async (_plan, _dispatch, lifecycle: { acknowledge(): boolean }) => {
      lifecycle.acknowledge();
    });
    const runtime = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      executor: { isBusy: () => false, reserve: () => true, release, execute },
    });

    await expect(runtime.execute(plan)).resolves.toEqual({
      status: 'blocked',
      reasonCode: 'runtime_rejected',
      message: 'runtime_execution_not_acknowledged',
    });
    expect(gateway.reject).toHaveBeenCalledWith(
      'envelope-1',
      'runtime_execution_not_acknowledged',
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(plan);
  });

  it('settles the binding when execution fails after acknowledgement', async () => {
    const gateway = dispatch();
    const release = vi.fn();
    const runtime = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      executor: {
        isBusy: () => false,
        reserve: () => true,
        release,
        execute: vi.fn(async (_plan, _dispatch, lifecycle: { acknowledge(): boolean }) => {
          lifecycle.acknowledge();
          throw new Error('ACP failed after start');
        }),
      },
    });

    await expect(runtime.execute(plan)).resolves.toEqual({
      status: 'failed',
      reasonCode: 'internal_error',
      message: 'ACP failed after start',
    });
    expect(gateway.markExecutionFailed).toHaveBeenCalledWith(
      'envelope-1',
      'runtime_execution_failed',
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects a setup failure without creating a false acknowledgement', async () => {
    const gateway = dispatch();
    const runtime = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      executor: {
        isBusy: () => false,
        reserve: () => true,
        release: vi.fn(),
        execute: vi.fn().mockRejectedValue(new Error('ACP setup failed')),
      },
    });

    await expect(runtime.execute(plan)).resolves.toMatchObject({
      status: 'failed',
      message: 'ACP setup failed',
    });
    expect(gateway.acknowledge).not.toHaveBeenCalled();
    expect(gateway.reject).toHaveBeenCalledWith('envelope-1', 'runtime_start_failed');
    expect(gateway.markExecutionFailed).not.toHaveBeenCalled();
  });

  it('does not acknowledge after the durable claim loses ownership', async () => {
    const gateway = dispatch();
    const canAcknowledge = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const runtime = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      executor: {
        isBusy: () => false,
        reserve: () => true,
        release: vi.fn(),
        execute: vi.fn(async (_plan, _dispatch, lifecycle: { acknowledge(): boolean }) => {
          expect(lifecycle.acknowledge()).toBe(false);
        }),
      },
    });

    await expect(runtime.execute(plan, {
      onAcknowledged: vi.fn(),
      canAcknowledge,
    })).resolves.toMatchObject({
      status: 'blocked',
      reasonCode: 'runtime_rejected',
    });
    expect(gateway.acknowledge).not.toHaveBeenCalled();
  });

  it('defers a concurrent activation before creating or acknowledging an envelope', async () => {
    let reserved = false;
    let releaseExecution!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const execution = new Promise<void>((resolve) => { releaseExecution = resolve; });
    const gateway = dispatch();
    const execute = vi.fn(async (_plan, _dispatch, lifecycle: { acknowledge(): boolean }) => {
      lifecycle.acknowledge();
      markStarted();
      await execution;
    });
    const adapter = new DirectedAgentRuntime({
      nodeId: 'daemon:local',
      resolveTargetNodeId: () => 'daemon:local',
      dispatch: gateway,
      executor: {
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
