import { describe, expect, it } from 'vitest';
import { TASK_STATUSES } from '@/shared/task-status';
import { TASK_STATUS_RECEIPT_SKILL } from './taskStatusReceipt';
import { TASK_MANAGEMENT_SKILL } from './taskManagement';

function statusDescriptions(skill: { config: string }) {
  const config = JSON.parse(skill.config) as {
    tools: Array<{ parameters: Array<{ name: string; description: string }> }>;
  };
  return config.tools.flatMap(({ parameters }) => (
    parameters.filter(({ name }) => name === 'status').map(({ description }) => description)
  ));
}

describe('task status receipt preset', () => {
  it('publishes the canonical managed Task status vocabulary', () => {
    const expected = TASK_STATUSES.join(', ');
    expect(statusDescriptions(TASK_STATUS_RECEIPT_SKILL)).toEqual([`New status: ${expected}`]);
    expect(statusDescriptions(TASK_MANAGEMENT_SKILL)).toEqual([
      `Filter by status: ${expected}`,
      `New status: ${expected}`,
    ]);
    expect([
      TASK_STATUS_RECEIPT_SKILL.content,
      TASK_STATUS_RECEIPT_SKILL.config,
      TASK_MANAGEMENT_SKILL.content,
      TASK_MANAGEMENT_SKILL.config,
    ].join('\n')).not.toMatch(/\b(?:pending|rejected)\b/);
  });
});
