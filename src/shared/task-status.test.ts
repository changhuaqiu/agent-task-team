import { describe, expect, it } from 'vitest';
import {
  assertTaskStatus,
  canTransitionTask,
  nextDirectTaskStatuses,
  TASK_STATUSES,
} from './task-status';

describe('shared TaskStatus contract', () => {
  it('exposes the managed Task Authority vocabulary only', () => {
    expect(TASK_STATUSES).toEqual([
      'proposed', 'ready', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled',
    ]);
    expect(() => assertTaskStatus('pending')).toThrow('Unsupported task status: pending');
    expect(() => assertTaskStatus('rejected')).toThrow('Unsupported task status: rejected');
  });

  it('shares the repository transition graph with browser callers', () => {
    const next = (from: (typeof TASK_STATUSES)[number]) => TASK_STATUSES.filter(
      (status) => status !== from && canTransitionTask(from, status),
    );
    expect(next('in_review')).toEqual(['in_progress', 'blocked', 'done', 'cancelled']);
    expect(next('cancelled')).toEqual([]);
  });

  it('does not expose evidence-gated review or completion as direct browser actions', () => {
    expect(nextDirectTaskStatuses('in_progress')).toEqual(['blocked', 'cancelled']);
    expect(nextDirectTaskStatuses('in_review')).toEqual(['in_progress', 'blocked', 'cancelled']);
    expect(nextDirectTaskStatuses('in_progress')).not.toContain('in_review');
    expect(nextDirectTaskStatuses('in_review')).not.toContain('done');
  });
});
