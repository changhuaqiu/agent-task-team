import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAcpSkillMcpGrantsForTests,
  executeAcpSkillMcpTool,
  listAcpSkillToolDefinitions,
  registerAcpSkillMcpGrant,
  revokeAcpSkillMcpGrants,
  resolveAcpSkillMcpGrant,
} from './acp-skill-mcp';

afterEach(() => clearAcpSkillMcpGrantsForTests());

describe('ACP skill MCP grants', () => {
  it('publishes the scoped artifact verification tool schema', () => {
    expect(listAcpSkillToolDefinitions(['verification_serve_artifact'])).toEqual([
      expect.objectContaining({
        name: 'verification_serve_artifact',
        inputSchema: expect.objectContaining({
          required: ['artifact_path'],
          properties: {
            artifact_path: expect.objectContaining({ type: 'string' }),
          },
        }),
      }),
    ]);
  });

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
      `mcp__${grant.mcpServer.name}__task_list`,
      `mcp.${grant.mcpServer.name}.collaboration_record_pr`,
      `mcp__${grant.mcpServer.name}__collaboration_record_pr`,
    ]);
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

  it('revokes only grants owned by the runtime generation scope', () => {
    const first = registerAcpSkillMcpGrant({
      agentId: 'mario', conversationId: 'project-a', projectId: 'project-a', permittedTools: ['task_list'],
    }, 'http://127.0.0.1:3000')!;
    const second = registerAcpSkillMcpGrant({
      agentId: 'mario', conversationId: 'project-b', projectId: 'project-b', permittedTools: ['task_list'],
    }, 'http://127.0.0.1:3000')!;
    expect(revokeAcpSkillMcpGrants('mario', 'project-a')).toBe(1);
    expect(resolveAcpSkillMcpGrant(first.mcpServer.headers[0].value)).toBeUndefined();
    expect(resolveAcpSkillMcpGrant(second.mcpServer.headers[0].value)).toBeDefined();
  });

  it('fences older generation grants without revoking the current Invocation grant', () => {
    const oldGrant = registerAcpSkillMcpGrant({
      agentId: 'mario', conversationId: 'project-a', projectId: 'project-a', permittedTools: ['task_list'],
    }, 'http://127.0.0.1:3000')!;
    const currentGrant = registerAcpSkillMcpGrant({
      agentId: 'mario', conversationId: 'project-a', projectId: 'project-a', permittedTools: ['task_list'],
    }, 'http://127.0.0.1:3000')!;

    expect(revokeAcpSkillMcpGrants('mario', 'project-a', currentGrant.grantToken)).toBe(1);
    expect(resolveAcpSkillMcpGrant(oldGrant.mcpServer.headers[0].value)).toBeUndefined();
    expect(resolveAcpSkillMcpGrant(currentGrant.mcpServer.headers[0].value)).toBeDefined();
  });
});
