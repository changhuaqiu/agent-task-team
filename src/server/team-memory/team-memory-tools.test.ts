import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { taskRepo } from '../repositories/task-repo';
import { executeSkillTool } from '../skill-tool-executor';
import { listAcpSkillToolDefinitions } from '../acp-skill-mcp';

describe('Team Memory Agent tools', () => {
  beforeEach(() => {
    setTestDb(createTestDb());
    conversationRepo.create({ id: 'project-tools', title: 'Tools' });
    taskRepo.create({ id: 'TASK-M', conversation_id: 'project-tools', title: 'Memory', agent_id: 'builder' });
    getDb().prepare(`
      INSERT INTO control_proof_event (
        id,event_type,conversation_id,task_id,agent_id,metadata,created_at
      ) VALUES (?,?,?,?,?,?,?)
    `).run('proof-tools', 'test.evidence', 'project-tools', 'TASK-M', 'builder', '{}', new Date().toISOString());
  });

  afterEach(() => resetDb());

  it('exposes both MCP definitions and executes record plus pull recall through the real tool seam', async () => {
    expect(listAcpSkillToolDefinitions(['team_memory_record', 'team_memory_recall']).map((tool) => tool.name))
      .toEqual(['team_memory_record', 'team_memory_recall']);

    const recorded = await executeSkillTool({
      toolName: 'team_memory_record',
      input: {
        disposition: 'propose',
        idempotency_key: 'tool-memory-1',
        kind: 'lesson',
        content: 'Keep the memory store behind the ContextContributor seam.',
        scope: 'project',
        source_refs: ['proof:proof-tools'],
      },
      agentId: 'builder',
      conversationId: 'project-tools',
      taskId: 'TASK-M',
      rateLimitKey: 'memory-tool-test',
    });
    expect(recorded).toMatchObject({ success: true, data: { memory: { status: 'accepted' } } });

    const recalled = await executeSkillTool({
      toolName: 'team_memory_recall',
      input: { query: 'ContextContributor', limit: 3 },
      agentId: 'reviewer',
      conversationId: 'project-tools',
      taskId: 'TASK-M',
      rateLimitKey: 'memory-tool-test',
    });
    expect(recalled).toMatchObject({ success: true });
    expect((recalled.data as { items: Array<{ content: string }> }).items[0].content)
      .toContain('ContextContributor');
    expect(getDb().prepare(`
      SELECT COUNT(*) AS count FROM control_proof_event
      WHERE event_type='skill.tool.invoked'
    `).get()).toEqual({ count: 2 });
  });

  it('creates one content-free deferred opportunity at a task boundary even when the tool result is replayed', async () => {
    taskRepo.transition('TASK-M', { to: 'in_progress' });
    const invocation = {
      toolName: 'task_update_status',
      input: {
        task_id: 'TASK-M',
        status: 'in_review',
        evidence: {
          installResult: 'passed',
          buildResult: 'passed',
          testResult: 'passed',
          impactEvidence: 'reviewed',
        },
      },
      agentId: 'builder',
      conversationId: 'project-tools',
      taskId: 'TASK-M',
      rateLimitKey: 'memory-boundary-replay',
    };

    const first = await executeSkillTool(invocation);
    expect(first.success).toBe(true);
    expect(first).not.toHaveProperty('internalBoundary');
    expect((await executeSkillTool(invocation)).success).toBe(true);

    const opportunities = getDb().prepare(`
      SELECT * FROM team_memory_opportunity
      WHERE conversation_id='project-tools' AND agent_id='builder'
    `).all() as Array<Record<string, unknown>>;
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      disposition: 'deferred',
      reason_code: 'tool_boundary:task_update_status',
    });
    expect(opportunities[0]).not.toHaveProperty('content');
    const action = getDb().prepare(`
      SELECT id FROM task_action
      WHERE conversation_id='project-tools' AND type IN ('task.review_requested','task.status_changed')
      ORDER BY created_at DESC,id DESC LIMIT 1
    `).get() as { id: string };
    expect(JSON.parse(String(opportunities[0].source_refs_json)))
      .toEqual([`task-action:${action.id}`, 'task:TASK-M']);
  });
});
