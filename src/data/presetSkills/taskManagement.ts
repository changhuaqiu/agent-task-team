import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const TASK_MANAGEMENT_SKILL: CreateSkillInput = {
  name: 'task-management',
  description: 'Task creation, assignment, and status management tools for coordinating team work',
  content: `# Task Management

You can create, assign, and update tasks for your team. Use the provided tools to coordinate work.

## Guidelines

- Create tasks with clear, specific titles and descriptions
- Assign tasks to the most appropriate teammate based on their capabilities
- Update task status as work progresses
- Status changes into in_review or done require gate evidence. Do not mark in_review without installResult, buildResult, and gitnexusEvidence. Do not mark done without mergedToMain, mainInstallResult, mainBuildResult, mainTestResult, and gitnexusDetectChangesResult.
- Text scheduling is not execution. Do not claim a task lane is started unless a real dispatch receipt, A2A pass offer, task wakeup dispatch, or execution-start acknowledgement exists for the target agent and task.
- For parallel dispatch, verify every target separately and report n/n dispatched. If only part of the fan-out starts, retry or escalate instead of saying all lanes started.
- Each turn must close by updating task state with evidence, creating a real dispatch, creating/escalating a blocker, or naming an external wait condition with a recovery owner.
- Do not assign tasks to yourself
- Limit task creation to 10 operations per dispatch`,
  config: JSON.stringify({
    tools: [
      {
        name: 'task_list',
        description: 'List tasks in the current project, optionally filtered by status or assigned agent',
        parameters: [
          { name: 'status', type: 'string', required: false, description: 'Filter by status: pending, in_progress, in_review, done, blocked' },
          { name: 'agent_id', type: 'string', required: false, description: 'Filter by assignee agent ID' },
        ],
        handler: 'api://tasks/list',
      },
      {
        name: 'task_create',
        description: 'Create a new task with full details and optionally assign it to an agent',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Short task title' },
          { name: 'description', type: 'string', required: false, description: 'Detailed task description' },
          { name: 'agent_id', type: 'string', required: false, description: 'Agent ID to assign (mario, luigi, toad, peach, dk, yoshi)' },
          { name: 'role', type: 'string', required: false, description: 'Task role: planner, backend, frontend, testing, security, devops' },
          { name: 'phase', type: 'string', required: false, description: 'Phase ID (e.g. P1, P2)' },
          { name: 'dependencies', type: 'string', required: false, description: 'Comma-separated task IDs this task depends on' },
          { name: 'deliverable', type: 'string', required: false, description: 'Expected output file or artifact' },
        ],
        handler: 'api://tasks/create',
      },
      {
        name: 'task_update_status',
        description: 'Update a task status',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID to update' },
          { name: 'status', type: 'string', required: true, description: 'New status: pending, in_progress, in_review, done, blocked' },
          { name: 'evidence', type: 'object', required: false, description: 'Required for in_review: installResult, buildResult, gitnexusEvidence. Required for done: mergedToMain, mainInstallResult, mainBuildResult, mainTestResult, gitnexusDetectChangesResult.' },
        ],
        handler: 'api://tasks/update',
      },
      {
        name: 'task_assign',
        description: 'Assign or reassign a task to a different agent',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID' },
          { name: 'agent_id', type: 'string', required: true, description: 'New assignee agent ID' },
        ],
        handler: 'api://tasks/assign',
      },
    ],
  }),
  isPreset: true,
};
