import { describe, expect, it } from 'vitest';
import { resolvePlatformTaskTools } from '@/server/harness/platform-tool-policy';

const names = (input: Parameters<typeof resolvePlatformTaskTools>[0]) =>
  resolvePlatformTaskTools(input).map((tool) => tool.name);

describe('platform task tool policy', () => {
  it('grants a task-bound worker only list and exact status-control capabilities', () => {
    expect(names({ hasTask: true, roleCategory: 'frontend' })).toEqual([
      'task_list',
      'task_update_status',
    ]);
  });

  it('grants a task-bound reviewer the same minimum control plane without coordination expansion', () => {
    expect(names({ hasTask: true, roleCategory: 'code_reviewer' })).toEqual([
      'task_list',
      'task_update_status',
    ]);
  });

  it('grants planners task creation and assignment capabilities', () => {
    expect(names({ hasTask: false, roleCategory: 'planner' })).toEqual([
      'task_list',
      'task_create',
      'task_update_status',
      'task_assign',
    ]);
  });

  it('does not expose mutable task tools to isolated evaluations', () => {
    expect(names({ hasTask: true, roleCategory: 'planner', evaluation: true })).toEqual([]);
  });
});
