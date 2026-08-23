import { describe, expect, it, vi } from 'vitest';
import type { InvocationDispatchPlan } from '../invocation-pipeline/types';
import { AgentProcessRegistry } from './agent-process-registry';

const plan = {
  trigger: { agentId: 'mario', conversationId: 'project-1' },
} as InvocationDispatchPlan;

describe('AgentProcessRegistry', () => {
  it('serializes setup and releases a failed reservation', () => {
    const registry = new AgentProcessRegistry();
    expect(registry.reserve(plan)).toBe(true);
    expect(registry.reserve(plan)).toBe(false);
    registry.releaseReservation(plan);
    expect(registry.reserve(plan)).toBe(true);
  });

  it('owns active-process visibility and bounded shutdown', () => {
    const registry = new AgentProcessRegistry();
    const kill = vi.fn();
    expect(registry.reserve(plan)).toBe(true);
    registry.attach('mario', 'project-1', { kill });
    expect(registry.isBusy('mario', 'project-1')).toBe(true);
    expect(registry.get('mario', 'project-1')).toEqual({ kill });

    registry.shutdown();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(registry.isBusy('mario', 'project-1')).toBe(false);
  });
});
