import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from './db';
import { WorkContractRepository } from './work-contract/repository';
import {
  clearAcpSkillMcpGrantsForTests,
  executeAcpSkillMcpTool,
  listAcpSkillToolDefinitions,
  registerAcpSkillMcpGrant,
  revokeAcpSkillMcpGrants,
  resolveAcpSkillMcpGrant,
} from './acp-skill-mcp';

afterEach(() => {
  clearAcpSkillMcpGrantsForTests();
  resetDb();
});

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
      `${grant.mcpServer.name}_task_list`,
      `mcp.${grant.mcpServer.name}.collaboration_record_pr`,
      `mcp__${grant.mcpServer.name}__collaboration_record_pr`,
      `${grant.mcpServer.name}_collaboration_record_pr`,
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

  it('submits the public Task Graph shape and returns applied only after dispatch is durable', async () => {
    const db = createTestDb();
    setTestDb(db);
    const now = new Date('2026-08-30T00:00:00.000Z');
    db.prepare(`
      INSERT INTO project (id,name,root_path,created_at,updated_at)
      VALUES ('project-mcp','MCP graph','C:/mcp-graph',?,?)
    `).run(now.toISOString(), now.toISOString());
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at,project_id,workspace_kind)
      VALUES ('project-mcp','MCP graph','active',?,?,'project-mcp','project_workspace')
    `).run(now.toISOString(), now.toISOString());
    for (const [id, name] of [['planner-mcp', 'Planner'], ['builder-mcp', 'Builder']]) {
      db.prepare(`
        INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
        VALUES (?,?,'role','default','🤖',?,?)
      `).run(id, name, now.toISOString(), now.toISOString());
      db.prepare(`
        INSERT INTO project_agent_membership (project_id,agent_id,source,added_at)
        VALUES ('project-mcp',?,'manual',?)
      `).run(id, now.toISOString());
    }
    const contract = new WorkContractRepository().issue({
      workId: 'planning:mcp', attemptId: 'inv-mcp', projectId: 'project-mcp',
      agentId: 'planner-mcp', goal: 'Plan through MCP', acceptanceCriteria: ['Dispatch the task'],
      role: {}, permissions: {}, authoritativeRefs: ['task_graph:project-mcp'],
      authoritativeRevisions: { taskGraph: 0 }, contextSnapshotRef: 'context-mcp',
      allowedOutcomeTypes: ['propose_task_graph'], correlationId: 'trace-mcp',
      causationId: 'request-mcp', now,
    });
    const grant = registerAcpSkillMcpGrant({
      agentId: 'planner-mcp', conversationId: 'project-mcp', projectId: 'project-mcp',
      permittedTools: [], workContract: contract,
    }, 'http://127.0.0.1:3000')!;
    const resolved = resolveAcpSkillMcpGrant(grant.mcpServer.headers[0].value)!;

    await expect(executeAcpSkillMcpTool(resolved, 'task_propose_graph', {
      payload: {
        tasks: [{ id: 'task-from-mcp', title: 'Build from MCP', agentId: 'builder-mcp' }],
      },
      evidence_refs: [],
      idempotency_key: 'mcp-plan-once',
    })).resolves.toMatchObject({ success: true, data: { status: 'applied' } });
    expect(getDb().prepare(`
      SELECT status,agent_id FROM task WHERE id='task-from-mcp'
    `).get()).toEqual({ status: 'ready', agent_id: 'builder-mcp' });
    expect(getDb().prepare(`
      SELECT project_agent_id,status,json_extract(command_json,'$.taskId') task_id
      FROM agent_inbox_item
    `).get()).toEqual({
      project_agent_id: 'builder-mcp', status: 'enqueued', task_id: 'task-from-mcp',
    });
    db.close();
  });
});
