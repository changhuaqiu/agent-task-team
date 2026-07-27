import { describe, expect, it } from 'vitest';
import { detectWaitForDeadlock } from './wait-for-graph';

describe('detectWaitForDeadlock', () => {
  it('returns a stable multi-Work-Cell cycle with its reasons', () => {
    expect(detectWaitForDeadlock([
      { waiter: 'work-c', blocker: 'work-a', reasonCode: 'a2a_join' },
      { waiter: 'work-a', blocker: 'work-b', reasonCode: 'task_dependency' },
      { waiter: 'work-b', blocker: 'work-c', reasonCode: 'gate_dependency' },
    ])).toEqual({
      cycle: ['work-a', 'work-b', 'work-c', 'work-a'],
      edges: [
        { waiter: 'work-a', blocker: 'work-b', reasonCode: 'task_dependency' },
        { waiter: 'work-b', blocker: 'work-c', reasonCode: 'gate_dependency' },
        { waiter: 'work-c', blocker: 'work-a', reasonCode: 'a2a_join' },
      ],
    });
  });

  it('does not mistake a converging acyclic graph for a deadlock', () => {
    expect(detectWaitForDeadlock([
      { waiter: 'work-a', blocker: 'work-c', reasonCode: 'dependency' },
      { waiter: 'work-b', blocker: 'work-c', reasonCode: 'dependency' },
    ])).toBeUndefined();
  });
});
