import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAcpSkillMcpGrantsForTests,
  buildAcpSkillMcpTurnInstruction,
  executeAcpSkillMcpTool,
  listAcpSkillToolDefinitions,
  registerAcpSkillMcpGrant,
  resolveAcpSkillMcpGrant,
} from './acp-skill-mcp';

afterEach(() => clearAcpSkillMcpGrantsForTests());

describe('ACP skill MCP grants', () => {
  it('publishes only permitted platform tools and revokes the invocation token', async () => {
    const grant = registerAcpSkillMcpGrant({
      agentId: 'luigi',
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      permittedTools: ['task_list', 'collaboration_record_pr', 'unknown_tool'],
    }, 'http://127.0.0.1:3000')!;

    expect(grant.mcpServer).toMatchObject({
      type: 'http',
      name: expect.stringMatching(/^agent-task-team-[a-f0-9]{16}$/),
      url: 'http://127.0.0.1:3000/api/acp-tools',
      headers: [{ name: 'Authorization', value: expect.stringMatching(/^Bearer /) }],
    });
    expect(grant.autoApproveToolNames).toEqual([
      `mcp.${grant.mcpServer.name}.task_list`,
      `mcp.${grant.mcpServer.name}.collaboration_record_pr`,
    ]);
    expect(grant.promptInstruction).toContain(`server name: ${grant.mcpServer.name}`);
    expect(grant.promptInstruction).toContain('task_list, collaboration_record_pr');
    expect(grant.promptInstruction).toContain('其他 agent-task-team-* server/tool 名称均已撤销');
    expect(grant.promptInstruction).not.toContain('unknown_tool');
    expect(grant.promptInstruction).not.toContain(grant.mcpServer.headers[0].value);
    const authorization = grant.mcpServer.headers[0].value;
    const resolved = resolveAcpSkillMcpGrant(authorization)!;
    expect(resolved).toMatchObject({
      agentId: 'luigi',
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      permittedTools: ['task_list', 'collaboration_record_pr'],
    });
    expect(listAcpSkillToolDefinitions(resolved.permittedTools).map((tool) => tool.name))
      .toEqual(['task_list', 'collaboration_record_pr']);
    await expect(executeAcpSkillMcpTool(resolved, 'task_create', {})).resolves.toEqual({
      success: false,
      error: 'Tool is not permitted for this invocation: task_create',
    });

    grant.revoke();
    expect(resolveAcpSkillMcpGrant(authorization)).toBeUndefined();
  });

  it('describes only the current invocation server without carrying an old random name', () => {
    const instruction = buildAcpSkillMcpTurnInstruction(
      'agent-task-team-current123456',
      ['task_list', 'task_update_status', 'not_a_platform_tool'],
    );

    expect(instruction).toContain('agent-task-team-current123456_task_list');
    expect(instruction).toContain('mcp__agent-task-team-current123456__<tool>');
    expect(instruction).toContain('task_list, task_update_status');
    expect(instruction).not.toContain('not_a_platform_tool');
    expect(instruction).not.toContain('agent-task-team-previous');
    expect(instruction).not.toMatch(/Bearer\s+/);
  });

  it('rejects expired tokens', () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const grant = registerAcpSkillMcpGrant({
      agentId: 'mario',
      conversationId: 'conv-1',
      permittedTools: ['task_list'],
    }, 'http://127.0.0.1:3000', 1)!;
    const authorization = grant.mcpServer.headers[0].value;
    clock.mockReturnValue(now + 2);
    expect(resolveAcpSkillMcpGrant(authorization)).toBeUndefined();
    clock.mockRestore();
  });
});
