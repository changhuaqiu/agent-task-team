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
        description: 'Create a new task and optionally assign it to an agent',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Short task title' },
          { name: 'description', type: 'string', required: false, description: 'Detailed task description' },
          { name: 'agent_id', type: 'string', required: false, description: 'Agent ID to assign (mario, luigi, toad, peach, dk, yoshi)' },
        ],
        handler: 'api://tasks/create',
      },
      {
        name: 'task_update_status',
        description: 'Update a task status',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID to update' },
          { name: 'status', type: 'string', required: true, description: 'New status: pending, in_progress, in_review, done, blocked' },
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
