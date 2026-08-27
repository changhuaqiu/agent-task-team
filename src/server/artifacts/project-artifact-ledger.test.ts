import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { projectRepo } from '../repositories/project-repo';
import { taskRepo } from '../repositories/task-repo';
import type { ContextQuery } from '@/lib/agent-context/ContextManager';
import { ArtifactLedgerContextContributor } from './context-contributor';
import { projectArtifactLedger } from './project-artifact-ledger';

const PROJECT_ROOT = 'C:/projects/alpha';

beforeEach(() => setTestDb(createTestDb()));
afterEach(() => resetDb());

function appendToolPair(input: {
  conversationId: string;
  invocationId: string;
  callId: string;
  toolName: string;
  toolInput: string;
  completed?: boolean;
}) {
  const log = new PlatformEventLog();
  const base = {
    category: 'runtime_activity' as const,
    projectId: input.conversationId,
    streamKey: `invocation:${input.invocationId}`,
    aggregate: { type: 'invocation', id: input.invocationId },
    actor: { type: 'runtime' as const, id: 'codex-acp' },
    projectAgentId: 'builder',
    invocationId: input.invocationId,
    correlationId: input.invocationId,
  };
  log.append({ ...base, type: 'runtime.tool.started', payload: { callId: input.callId, toolName: input.toolName, input: input.toolInput, origin: 'runtime' } });
  if (input.completed !== false) {
    log.append({ ...base, type: 'runtime.tool.completed', payload: { callId: input.callId, toolName: input.toolName, output: 'Done' } });
  }
}

function contextQuery(conversationId: string): ContextQuery {
  return {
    scenario: 'execution',
    trigger: 'resume',
    conversationId,
    agentId: 'builder',
    archetype: 'worker',
    requestText: '继续完成项目',
    budgetTokens: 20_000,
    requiredContributorIds: [],
    now: '2026-08-27T00:00:00.000Z',
  };
}

describe('projectArtifactLedger', () => {
  it('projects successful file mutations, rejects unfinished/read/outside operations, and upgrades submitted evidence', async () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: PROJECT_ROOT });
    taskRepo.create({ id: 'task-1', conversation_id: project.workspace_conversation_id, title: '实现入口', agent_id: 'builder' });
    getDb().prepare(`INSERT INTO invocation (id,conversation_id,task_id,agent_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run('inv-1', project.workspace_conversation_id, 'task-1', 'builder', 'running', '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z');

    appendToolPair({ conversationId: project.workspace_conversation_id, invocationId: 'inv-1', callId: 'write-1', toolName: 'apply_patch', toolInput: '*** Update File: C:\\projects\\alpha\\src\\main.ts\n@@' });
    appendToolPair({ conversationId: project.workspace_conversation_id, invocationId: 'inv-1', callId: 'pending-1', toolName: 'write_file', toolInput: JSON.stringify({ file_path: 'src/pending.ts' }), completed: false });
    appendToolPair({ conversationId: project.workspace_conversation_id, invocationId: 'inv-1', callId: 'read-1', toolName: 'read_file', toolInput: JSON.stringify({ file_path: 'src/read.ts' }) });
    appendToolPair({ conversationId: project.workspace_conversation_id, invocationId: 'inv-1', callId: 'outside-1', toolName: 'write_file', toolInput: JSON.stringify({ file_path: 'C:/outside/secret.ts' }) });

    expect(projectArtifactLedger.list(project.id)).toEqual([
      expect.objectContaining({
        ref: 'src/main.ts', status: 'working', kind: 'code', updatedBy: 'builder',
        workId: 'task-1', workTitle: '实现入口', operations: ['edit'],
      }),
    ]);

    getDb().prepare(`INSERT INTO task_action (id,conversation_id,actor_id,actor_type,type,task_ids,payload,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('action-1', project.workspace_conversation_id, 'builder', 'agent', 'task.result_submitted', '["task-1"]', '{}', '2026-08-27T00:05:00.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-1', project.workspace_conversation_id, 'task-1', 'file', 'main.ts', 'C:\\projects\\alpha\\src\\main.ts', 'action-1', '2026-08-27T00:05:00.000Z');

    const [registered] = projectArtifactLedger.list(project.id);
    expect(registered).toMatchObject({
      ref: 'src/main.ts', status: 'registered', kind: 'code', workTitle: '实现入口',
    });
    expect(registered.operations).toEqual(expect.arrayContaining(['edit', 'register']));

    const [fragment] = await new ArtifactLedgerContextContributor().contribute(contextQuery(project.workspace_conversation_id));
    expect(fragment.scope).toEqual({ kind: 'project', projectId: project.id });
    expect(fragment.subject).toEqual({ kind: 'project', id: project.id });
    expect(fragment.content).toContain('[已登记/code] src/main.ts');
    expect(fragment.content).toContain('evidence_refs');
    expect(fragment.evidenceRefs).toEqual(['src/main.ts']);
  });

  it('keeps artifacts isolated by project', () => {
    const alpha = projectRepo.create({ name: 'Alpha', rootPath: PROJECT_ROOT });
    const beta = projectRepo.create({ name: 'Beta', rootPath: 'C:/projects/beta' });
    getDb().prepare(`INSERT INTO invocation (id,conversation_id,agent_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run('inv-beta', beta.workspace_conversation_id, 'builder', 'running', '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z');
    appendToolPair({ conversationId: beta.workspace_conversation_id, invocationId: 'inv-beta', callId: 'write-beta', toolName: 'write_file', toolInput: JSON.stringify({ file_path: 'src/beta.ts' }) });

    expect(projectArtifactLedger.list(alpha.id)).toEqual([]);
    expect(projectArtifactLedger.list(beta.id)[0]).toMatchObject({ ref: 'src/beta.ts' });
  });

  it('registers accepted WorkContract evidence even when the work is not a traditional Task', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: PROJECT_ROOT });
    const now = '2026-08-27T02:00:00.000Z';
    getDb().prepare(`
      INSERT INTO work_contract (
        id,work_id,work_epoch,attempt_id,fencing_token,project_id,task_id,agent_id,goal,
        acceptance_criteria_json,role_json,permissions_json,authoritative_refs_json,
        authoritative_revisions_json,context_snapshot_ref,allowed_outcome_types_json,
        budget_json,correlation_id,causation_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'contract-a2a', 'a2a-pass:1', 1, 'attempt-1', 'token-1', project.workspace_conversation_id,
      null, 'builder', '完成验收报告', '[]', '{}', '{}', '[]', '{}', 'snapshot:1',
      '["submit_task_result"]', '{}', 'correlation-1', 'cause-1', now,
    );
    getDb().prepare(`INSERT INTO work_authority (work_id,project_id,current_epoch,current_contract_id,status,revision,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run('a2a-pass:1', project.workspace_conversation_id, 1, 'contract-a2a', 'active', 0, now);
    getDb().prepare(`
      INSERT INTO agent_outcome (
        id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,fencing_token,
        outcome_type,payload_json,evidence_refs_json,authoritative_revisions_json,
        correlation_id,causation_id,occurred_at,admission_status,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'outcome-1', 'outcome-key-1', 'contract-a2a', project.workspace_conversation_id,
      'a2a-pass:1', 1, 'attempt-1', 'token-1', 'submit_task_result', '{}',
      '["workspace:reports/acceptance.md","test:vitest = 42 passed","workspace:.ath/team-log.md","git status --short","msg-1"]',
      '{}', 'correlation-1', 'cause-1', now, 'accepted', now,
    );

    expect(projectArtifactLedger.list(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'reports/acceptance.md', status: 'registered', kind: 'document', updatedBy: 'builder', workTitle: '完成验收报告' }),
      expect.objectContaining({ ref: 'test:vitest = 42 passed', status: 'registered', kind: 'proof' }),
    ]));
    expect(projectArtifactLedger.list(project.id).map((item) => item.ref)).not.toEqual(expect.arrayContaining(['.ath/team-log.md', 'git status --short', 'msg-1']));
  });
});
