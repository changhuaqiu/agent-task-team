import { describe, it, expect } from 'vitest';
import { getProjectStatus } from './getProjectStatus';
import type { ProjectStats } from './getProjectStatus';

describe('getProjectStatus', () => {
  const base: ProjectStats = { total: 0, blocked: 0, inProgress: 0, done: 0 };

  it('returns "empty" when there are no tasks', () => {
    expect(getProjectStatus(base)).toBe('empty');
  });

  it('returns "blocked" when any task is blocked', () => {
    expect(getProjectStatus({ total: 5, blocked: 1, inProgress: 2, done: 2 })).toBe('blocked');
  });

  it('returns "blocked" even if some tasks are in progress', () => {
    expect(getProjectStatus({ total: 3, blocked: 2, inProgress: 1, done: 0 })).toBe('blocked');
  });

  it('returns "attention" when tasks exist but none started', () => {
    expect(getProjectStatus({ total: 4, blocked: 0, inProgress: 0, done: 0 })).toBe('attention');
  });

  it('returns "healthy" when tasks are in progress', () => {
    expect(getProjectStatus({ total: 3, blocked: 0, inProgress: 2, done: 0 })).toBe('healthy');
  });

  it('returns "healthy" when tasks are done', () => {
    expect(getProjectStatus({ total: 5, blocked: 0, inProgress: 0, done: 5 })).toBe('healthy');
  });

  it('returns "healthy" when mix of in-progress and done', () => {
    expect(getProjectStatus({ total: 6, blocked: 0, inProgress: 2, done: 4 })).toBe('healthy');
  });
});
