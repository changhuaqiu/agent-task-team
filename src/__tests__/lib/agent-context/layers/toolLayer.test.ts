import { describe, it, expect } from 'vitest';
import { buildToolLayer } from '@/lib/agent-context/layers/toolLayer';
import type { ToolDefinition } from '@/lib/agent-context/PromptComposer';

describe('buildToolLayer', () => {
  it('returns empty string for empty tools array', () => {
    expect(buildToolLayer([])).toBe('');
  });

  it('renders a tool with its parameters', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'task_create',
        description: 'Create a new task',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Task title' },
          { name: 'agent_id', type: 'string', required: false, description: 'Assignee' },
        ],
        handler: 'api://tasks/create',
      },
    ];
    const result = buildToolLayer(tools);
    expect(result).toContain('## Available Tools');
    expect(result).toContain('### task_create');
    expect(result).toContain('`title` (string, required)');
    expect(result).toContain('`agent_id` (string, optional)');
  });

  it('renders multiple tools', () => {
    const tools: ToolDefinition[] = [
      { name: 'task_list', description: 'List tasks', parameters: [], handler: 'api://tasks/list' },
      { name: 'task_update', description: 'Update task', parameters: [], handler: 'api://tasks/update' },
    ];
    const result = buildToolLayer(tools);
    expect(result).toContain('### task_list');
    expect(result).toContain('### task_update');
  });

  it('includes JSON schema for tool_use format', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'task_create',
        description: 'Create task',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Title' },
        ],
        handler: 'api://tasks/create',
      },
    ];
    const result = buildToolLayer(tools);
    expect(result).toContain('"name": "task_create"');
    expect(result).toContain('"title"');
  });
});
