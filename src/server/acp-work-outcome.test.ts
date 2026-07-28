import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from './db';
import {
  AGENT_SUBMIT_OUTCOME_TOOL,
  clearAcpSkillMcpGrantsForTests,
  executeAcpSkillMcpTool,
  listAcpSkillToolDefinitions,
  registerAcpSkillMcpGrant,
  resolveAcpSkillMcpGrant,
} from './acp-skill-mcp';
import { WorkContractRepository } from './work-contract/repository';

describe('ACP WorkContract outcome channel', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = '2026-07-28T08:00:00.000Z';
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-acp-outcome', 'ACP Outcome', 'active', now, now);
  });

  afterEach(() => {
    clearAcpSkillMcpGrantsForTests();
    resetDb();
  });

  it('always grants the platform outcome tool and binds its private fencing envelope', async () => {
    const contract = new WorkContractRepository().issue({
      workId: 'work-acp',
      attemptId: 'attempt-acp',
      projectId: 'project-acp-outcome',
      agentId: 'builder',
      goal: 'Build',
      acceptanceCriteria: ['done'],
      role: {},
      permissions: {},
      authoritativeRefs: ['context:ctx-acp'],
      authoritativeRevisions: { context: 'ctx-acp' },
      contextSnapshotRef: 'ctx-acp',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-acp',
      causationId: 'trigger-acp',
    });
    const grant = registerAcpSkillMcpGrant({
      agentId: contract.agentId,
      conversationId: contract.projectId,
      permittedTools: [],
      workContract: contract,
    }, 'http://127.0.0.1:3000')!;
    const stored = resolveAcpSkillMcpGrant(grant.mcpServer.headers[0].value)!;

    expect(stored.permittedTools).toEqual([AGENT_SUBMIT_OUTCOME_TOOL]);
    expect(listAcpSkillToolDefinitions(stored.permittedTools).map((tool) => tool.name))
      .toEqual([AGENT_SUBMIT_OUTCOME_TOOL]);
    await expect(executeAcpSkillMcpTool(stored, AGENT_SUBMIT_OUTCOME_TOOL, {
      outcome_type: 'submit_task_result',
      payload: { summary: 'done' },
      evidence_refs: ['artifact:sha'],
      idempotency_key: 'acp-outcome-key',
    })).resolves.toMatchObject({
      success: true,
      data: { status: 'accepted' },
    });
  });

  it('rejects a formerly valid grant after a newer epoch supersedes it', async () => {
    const repository = new WorkContractRepository();
    const first = repository.issue({
      workId: 'work-acp-stale',
      attemptId: 'attempt-acp-1',
      projectId: 'project-acp-outcome',
      agentId: 'builder',
      goal: 'Build',
      acceptanceCriteria: ['done'],
      role: {},
      permissions: {},
      authoritativeRefs: ['context:ctx-1'],
      authoritativeRevisions: { context: 'ctx-1' },
      contextSnapshotRef: 'ctx-1',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-acp',
      causationId: 'trigger-1',
    });
    const grant = registerAcpSkillMcpGrant({
      agentId: first.agentId,
      conversationId: first.projectId,
      permittedTools: [],
      workContract: first,
    }, 'http://127.0.0.1:3000')!;
    repository.issue({
      workId: first.workId,
      attemptId: 'attempt-acp-2',
      projectId: first.projectId,
      agentId: first.agentId,
      goal: first.goal,
      acceptanceCriteria: first.acceptanceCriteria,
      role: first.role,
      permissions: first.permissions,
      authoritativeRefs: first.authoritativeRefs,
      authoritativeRevisions: { context: 'ctx-2' },
      contextSnapshotRef: 'ctx-2',
      allowedOutcomeTypes: first.allowedOutcomeTypes,
      correlationId: first.correlationId,
      causationId: 'trigger-2',
      expectedCurrentEpoch: first.workEpoch,
    });
    const stored = resolveAcpSkillMcpGrant(grant.mcpServer.headers[0].value)!;
    await expect(executeAcpSkillMcpTool(stored, AGENT_SUBMIT_OUTCOME_TOOL, {
      outcome_type: 'submit_task_result',
      payload: { summary: 'late' },
      evidence_refs: [],
      idempotency_key: 'late-outcome-key',
    })).resolves.toMatchObject({
      success: false,
      error: 'work_authority_stale',
      data: { status: 'rejected' },
    });
  });
});
