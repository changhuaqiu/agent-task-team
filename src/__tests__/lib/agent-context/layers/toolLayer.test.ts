import { describe, it, expect } from 'vitest';
import { buildToolLayer } from '@/lib/agent-context/layers/toolLayer';
import { filterRegisteredTools } from '@/lib/agent-context/ContextManager';
import { buildCollaborationLayer } from '@/lib/agent-context/layers/collaborationLayer';
import { TASK_MANAGEMENT_SKILL } from '@/data/presetSkills/taskManagement';
import type { ToolDefinition } from '@/lib/agent-context/types';

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

describe('runtime tool registration boundary', () => {
  const declared: ToolDefinition[] = [
    { name: 'task_create', description: 'Create task', parameters: [], handler: 'api://tasks/create' },
    { name: 'task_list', description: 'List tasks', parameters: [], handler: 'api://tasks/list' },
  ];

  it('does not advertise prompt-only schemas as available tools', () => {
    expect(filterRegisteredTools(declared, undefined)).toEqual([]);
  });

  it('advertises only exact names registered by the runtime transport', () => {
    expect(filterRegisteredTools(declared, ['task_list']).map(tool => tool.name)).toEqual(['task_list']);
  });

  it('allows runtime-native subagents without treating them as platform substitutes', () => {
    const prompt = buildCollaborationLayer();
    expect(prompt).toContain('Task、Agent、SendMessage、TodoWrite/TodoRead 不属于平台');
    expect(prompt).toContain('可以使用 runtime-native Task / Agent');
    expect(prompt).toContain('平台会等待这些子代理在本轮内收敛');
    expect(prompt).toContain('不要调用 SendMessage');
    expect(prompt).toContain('PASS 时附评审证据并改为 done');
    expect(prompt).toContain('交接后立即结束本轮');
    expect(prompt).toContain('更新为 review/in_review 后立即正常结束本轮');
    expect(prompt).toContain('不要再手工 @ 默认 reviewer');
    expect(prompt).not.toContain('禁止用这些 CLI 原生协作工具创建子 agent');
  });

  it('keeps the task-management skill compatible with invocation-local subagents', () => {
    expect(TASK_MANAGEMENT_SKILL.content).toContain('Runtime-native Task or Agent may be used');
    expect(TASK_MANAGEMENT_SKILL.content).toContain('do not create or update platform Task Graph nodes');
    expect(TASK_MANAGEMENT_SKILL.content).not.toContain('Never substitute runtime-native Task');
    expect(TASK_MANAGEMENT_SKILL.content).not.toContain('wait for a runtime-native child agent');
  });
});
