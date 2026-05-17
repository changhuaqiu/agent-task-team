import { describe, expect, it } from 'vitest';
import { evaluateTaskGraphAction } from '@/server/task-flow/task-graph-policy';

describe('evaluateTaskGraphAction', () => {
  it('allows low-impact graph actions without confirmation', () => {
    const decision = evaluateTaskGraphAction({ action: 'splitTask', actorId: 'planner' });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it('requires confirmation for high-impact merge and cancel actions', () => {
    expect(evaluateTaskGraphAction({ action: 'mergeTasks', actorId: 'planner' })).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reasonCode: 'task_graph.confirmation_required',
    });
    expect(evaluateTaskGraphAction({ action: 'cancelTask', actorId: 'planner' })).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reasonCode: 'task_graph.confirmation_required',
    });
  });

  it('allows high-impact actions after explicit confirmation', () => {
    const decision = evaluateTaskGraphAction({ action: 'cancelTask', actorId: 'user', confirmed: true });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it('blocks unsafe ownership steals from running tasks without confirmation', () => {
    const decision = evaluateTaskGraphAction({
      action: 'assignTask',
      actorId: 'reviewer',
      taskStatus: 'in_progress',
      currentOwnerAgentId: 'frontend',
      nextOwnerAgentId: 'reviewer',
    });

    expect(decision).toMatchObject({
      allowed: false,
      requiresConfirmation: true,
      reasonCode: 'task_graph.ownership_confirmation_required',
    });
  });

  it('allows the current owner to keep or release their own task assignment', () => {
    const decision = evaluateTaskGraphAction({
      action: 'assignTask',
      actorId: 'frontend',
      taskStatus: 'in_progress',
      currentOwnerAgentId: 'frontend',
      nextOwnerAgentId: 'reviewer',
    });

    expect(decision.allowed).toBe(true);
  });
});
