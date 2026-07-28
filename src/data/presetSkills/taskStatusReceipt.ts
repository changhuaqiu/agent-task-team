import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const TASK_STATUS_RECEIPT_SKILL: CreateSkillInput = {
  name: 'task-status-receipt',
  description: 'Narrow task status and evidence receipt publishing for the current dispatched task',
  content: `# Task Status Receipt

Use the platform task_update_status tool only for the exact task in the current dispatch.

- Update implementation progress and submit the evidence required by the current gate.
- A review wakeup may submit reviewReceipt for the current task.
- A verification wakeup may submit verificationReceipt for the current task.
- Do not create, assign, list, rename, or modify unrelated tasks.
- TASKS.md is a projection; use task_update_status when this tool is exposed.`,
  config: JSON.stringify({
    tools: [
      {
        name: 'task_update_status',
        description: 'Update the current dispatched task status and submit structured gate evidence',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Current dispatched task ID' },
          { name: 'status', type: 'string', required: true, description: 'New status: pending, in_progress, in_review, done, blocked, rejected' },
          { name: 'evidence', type: 'object', required: false, description: 'Structured evidence required by implementation, review, or verification gates' },
        ],
        handler: 'api://tasks/update',
      },
    ],
  }),
  isPreset: true,
};
