import { describe, expect, it } from 'vitest';
import { extractTaskReference } from './taskReference';

describe('extractTaskReference', () => {
  it('preserves legacy TASK-000 references', () => {
    expect(extractTaskReference('请处理 #task-007 @Peach')).toBe('TASK-007');
  });

  it('keeps the full generated task id instead of truncating it to TASK-000', () => {
    expect(extractTaskReference(
      '#task-0001785261548390-000430-3b1c1d9c @Peach 请评审',
    )).toBe('task-0001785261548390-000430-3b1c1d9c');
  });

  it('returns undefined when no task reference exists', () => {
    expect(extractTaskReference('@Peach 请评审当前任务')).toBeUndefined();
  });
});
