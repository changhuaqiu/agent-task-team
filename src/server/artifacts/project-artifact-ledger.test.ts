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
    appendToolPair({ conversationId: project.workspace_conversation_id, invocationId: 'inv-1', callId: 'dot-file', toolName: 'write_file', toolInput: JSON.stringify({ file_path: 'src/..foo.ts' }) });
    appendToolPair({ conversationId: project.workspace_conversation_id, invocationId: 'inv-1', callId: 'internal-case', toolName: 'write_file', toolInput: JSON.stringify({ file_path: '.ATH/secret.md' }) });

    expect(projectArtifactLedger.list(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: 'src/main.ts', status: 'working', kind: 'code', updatedBy: 'builder',
        workId: 'task-1', workTitle: '实现入口', operations: ['edit'],
      }),
      expect.objectContaining({ ref: 'src/..foo.ts', status: 'working' }),
    ]));
    expect(projectArtifactLedger.list(project.id).map((item) => item.ref)).not.toContain('.ATH/secret.md');

    getDb().prepare(`INSERT INTO task_action (id,conversation_id,actor_id,actor_type,type,task_ids,payload,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('action-1', project.workspace_conversation_id, 'builder', 'agent', 'task.review_requested', '["task-1"]', '{}', '2026-08-27T00:05:00.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-1', project.workspace_conversation_id, 'task-1', 'file', 'file:///C:/projects/alpha/src/main.ts#L10-L20', 'C:\\projects\\alpha\\src\\main.ts', 'action-1', '2026-08-27T00:05:00.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-internal', project.workspace_conversation_id, 'task-1', 'file', 'TASKS.md', '.ath/TASKS.md', 'action-1', '2026-08-27T00:05:01.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-legacy-board', project.workspace_conversation_id, 'task-1', 'file', 'TASKS.md', 'TASKS.md', 'action-1', '2026-08-27T00:05:02.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-combined', project.workspace_conversation_id, 'task-1', 'file', 'located main', 'src/main.ts:12-18, src/main.ts', 'action-1', '2026-08-27T00:05:03.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-proof', project.workspace_conversation_id, 'task-1', 'proof', 'test proof', 'cmd:npm test -> exit 0', 'action-1', '2026-08-27T00:05:04.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-split', project.workspace_conversation_id, 'task-1', 'file', 'two files', 'src/a.ts, src/b.ts', 'action-1', '2026-08-27T00:05:05.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-remote-test', project.workspace_conversation_id, 'task-1', 'test', 'remote test', 'file://remote-host/C:/projects/alpha/src/remote.test.ts', 'action-1', '2026-08-27T00:05:06.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-malformed-proof', project.workspace_conversation_id, 'task-1', 'proof', 'malformed proof', 'file:///C:/projects/alpha/%E0%A4%A', 'action-1', '2026-08-27T00:05:07.000Z');
    getDb().prepare(`INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('artifact-traversal-test', project.workspace_conversation_id, 'task-1', 'test', 'traversal test', 'file:///C:/projects/alpha/%2e%2e/secret.test.ts', 'action-1', '2026-08-27T00:05:08.000Z');

    const registered = projectArtifactLedger.list(project.id).find((item) => item.ref === 'src/main.ts')!;
    expect(registered).toMatchObject({
      ref: 'src/main.ts', label: 'main.ts', status: 'registered', kind: 'code', workTitle: '实现入口',
    });
    expect(registered.operations).toEqual(expect.arrayContaining(['edit', 'register']));
    expect(projectArtifactLedger.list(project.id).map((item) => item.ref)).not.toEqual(
      expect.arrayContaining(['.ath/TASKS.md', 'TASKS.md']),
    );
    expect(projectArtifactLedger.list(project.id).filter((item) => item.ref === 'src/main.ts')).toHaveLength(1);
    expect(projectArtifactLedger.list(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'cmd:npm test -> exit 0', kind: 'proof', updatedBy: 'builder' }),
    ]));
    const split = projectArtifactLedger.list(project.id).filter((item) => (
      item.ref === 'src/a.ts' || item.ref === 'src/b.ts'
    ));
    expect(split).toHaveLength(2);
    expect(new Set(split.map((item) => item.id)).size).toBe(2);
    expect(projectArtifactLedger.list(project.id).map((item) => item.ref)).not.toEqual(
      expect.arrayContaining(['src/remote.test.ts', 'secret.test.ts']),
    );

    const [fragment] = await new ArtifactLedgerContextContributor().contribute(contextQuery(project.workspace_conversation_id));
    expect(fragment.scope).toEqual({ kind: 'project', projectId: project.id });
    expect(fragment.subject).toEqual({ kind: 'project', id: project.id });
    expect(fragment.content).toContain('[已登记/code] src/main.ts');
    expect(fragment.content).toContain('evidence_refs');
    expect(fragment.evidenceRefs).toEqual(expect.arrayContaining([
      'src/main.ts', 'cmd:npm test -> exit 0',
    ]));
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

  it('canonicalizes located evidence and keeps the actual producer when a reviewer registers it', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: PROJECT_ROOT });
    taskRepo.create({
      id: 'task-build', conversation_id: project.workspace_conversation_id,
      title: '实现入口', agent_id: 'builder',
    });
    taskRepo.create({
      id: 'task-review', conversation_id: project.workspace_conversation_id,
      title: '验证入口', agent_id: 'reviewer',
    });
    getDb().prepare(`
      INSERT INTO invocation (id,conversation_id,task_id,agent_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      'inv-build', project.workspace_conversation_id, 'task-build', 'builder', 'running',
      '2026-08-27T01:00:00.000Z', '2026-08-27T01:00:00.000Z',
    );
    appendToolPair({
      conversationId: project.workspace_conversation_id,
      invocationId: 'inv-build',
      callId: 'write-main',
      toolName: 'apply_patch',
      toolInput: '*** Update File: C:\\projects\\alpha\\src\\main.ts\n@@',
    });
    const now = '2026-08-27T02:00:00.000Z';
    getDb().prepare(`
      INSERT INTO work_contract (
        id,work_id,work_epoch,attempt_id,fencing_token,project_id,task_id,agent_id,goal,
        acceptance_criteria_json,role_json,permissions_json,authoritative_refs_json,
        authoritative_revisions_json,context_snapshot_ref,allowed_outcome_types_json,
        budget_json,correlation_id,causation_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'contract-review', 'task-review-work', 1, 'attempt-review', 'token-review',
      project.workspace_conversation_id, 'task-review', 'reviewer', '验证入口', '[]', '{}',
      '{}', '[]', '{}', 'snapshot:review', '["record_gate_decision"]', '{}',
      'correlation-review', 'cause-review', now,
    );
    getDb().prepare(`
      INSERT INTO work_authority (
        work_id,project_id,current_epoch,current_contract_id,status,revision,updated_at
      ) VALUES (?,?,?,?,?,?,?)
    `).run(
      'task-review-work', project.workspace_conversation_id, 1,
      'contract-review', 'active', 0, now,
    );
    getDb().prepare(`
      INSERT INTO agent_outcome (
        id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,fencing_token,
        outcome_type,payload_json,evidence_refs_json,authoritative_revisions_json,
        correlation_id,causation_id,occurred_at,admission_status,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'outcome-review', 'outcome-review-key', 'contract-review', project.workspace_conversation_id,
      'task-review-work', 1, 'attempt-review', 'token-review', 'record_gate_decision', '{}',
      JSON.stringify([
        'file:///C:/projects/alpha/src/main.ts#L10-L20',
        'src/main.ts:12-18, src/main.ts',
        'E2E: POST /chat 200',
        'cmd:npm test -> exit 0',
        'file://remote-host/C:/projects/alpha/src/remote.ts',
        'file:///C:/projects/alpha/%E0%A4%A',
        'file:///C:/projects/alpha/%2e%2e/secret.ts',
      ]),
      '{}', 'correlation-review', 'cause-review', now, 'accepted', now,
    );

    const ledger = projectArtifactLedger.list(project.id);
    expect(ledger.filter((item) => item.ref === 'src/main.ts')).toHaveLength(1);
    expect(ledger.find((item) => item.ref === 'src/main.ts')).toMatchObject({
      kind: 'code', status: 'registered', updatedBy: 'builder',
      workId: 'task-build', workTitle: '实现入口',
    });
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'E2E: POST /chat 200', kind: 'proof', updatedBy: 'reviewer' }),
      expect.objectContaining({ ref: 'cmd:npm test -> exit 0', kind: 'proof', updatedBy: 'reviewer' }),
    ]));
    expect(ledger.map((item) => item.ref)).not.toEqual(expect.arrayContaining([
      'src/remote.ts', 'secret.ts', '%E0%A4%A',
    ]));
  });

  it('keeps pull request attribution with the implementer after review and merge receipts', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: PROJECT_ROOT });
    taskRepo.create({
      id: 'task-pr', conversation_id: project.workspace_conversation_id,
      title: '交付 PR', agent_id: 'builder',
    });
    const insertAction = getDb().prepare(`
      INSERT INTO task_action
        (id,conversation_id,actor_id,actor_type,type,task_ids,payload,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const insertArtifact = getDb().prepare(`
      INSERT INTO task_artifact_ref
        (id,conversation_id,task_id,kind,label,url,created_by_action_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    insertAction.run(
      'action-pr', project.workspace_conversation_id, 'builder', 'agent',
      'task.pull_request_submitted', '["task-pr"]', '{}', '2026-08-27T01:00:00.000Z',
    );
    insertArtifact.run(
      'artifact-pr', project.workspace_conversation_id, 'task-pr', 'pull_request',
      'alpha#12', 'https://github.com/example/alpha/pull/12', 'action-pr',
      '2026-08-27T01:00:00.000Z',
    );
    insertAction.run(
      'action-merge', project.workspace_conversation_id, 'coordinator', 'agent',
      'task.pull_request_merged', '["task-pr"]', '{}', '2026-08-27T02:00:00.000Z',
    );
    insertArtifact.run(
      'artifact-merge', project.workspace_conversation_id, 'task-pr', 'merge',
      'merged to main', 'https://github.com/example/alpha/pull/12', 'action-merge',
      '2026-08-27T02:00:00.000Z',
    );

    expect(projectArtifactLedger.list(project.id)).toEqual([
      expect.objectContaining({
        ref: 'https://github.com/example/alpha/pull/12',
        kind: 'pull_request', updatedBy: 'builder', workId: 'task-pr', workTitle: '交付 PR',
      }),
    ]);
  });

  it('does not present planning or continuation context refs as role deliverables', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: PROJECT_ROOT });
    const now = '2026-08-27T02:00:00.000Z';
    getDb().prepare(`
      INSERT INTO work_contract (
        id,work_id,work_epoch,attempt_id,fencing_token,project_id,agent_id,goal,
        acceptance_criteria_json,role_json,permissions_json,authoritative_refs_json,
        authoritative_revisions_json,context_snapshot_ref,allowed_outcome_types_json,
        budget_json,correlation_id,causation_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'contract-plan', 'plan-work', 1, 'attempt-plan', 'token-plan',
      project.workspace_conversation_id, 'coordinator', '协调下一步', '[]', '{}', '{}', '[]',
      '{}', 'snapshot:plan', '["continue_work"]', '{}', 'correlation-plan', 'cause-plan', now,
    );
    getDb().prepare(`
      INSERT INTO work_authority (
        work_id,project_id,current_epoch,current_contract_id,status,revision,updated_at
      ) VALUES (?,?,?,?,?,?,?)
    `).run('plan-work', project.workspace_conversation_id, 1, 'contract-plan', 'active', 0, now);
    getDb().prepare(`
      INSERT INTO agent_outcome (
        id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,fencing_token,
        outcome_type,payload_json,evidence_refs_json,authoritative_revisions_json,
        correlation_id,causation_id,occurred_at,admission_status,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'outcome-plan', 'outcome-plan-key', 'contract-plan', project.workspace_conversation_id,
      'plan-work', 1, 'attempt-plan', 'token-plan', 'continue_work', '{}',
      '["workspace:docs/plan.md","workspace:src/main.ts"]', '{}',
      'correlation-plan', 'cause-plan', now, 'accepted', now,
    );

    expect(projectArtifactLedger.list(project.id)).toEqual([]);
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
      '["workspace:reports/acceptance.md","test:vitest = 42 passed","workspace:.ath/team-log.md","git status --short","msg-1","proxy.mjs:173-224","proxy.mjs:325","http://127.0.0.1:4173/summary health 200 / PID 42","http://127.0.0.1:4173/summary"]',
      '{}', 'correlation-1', 'cause-1', now, 'accepted', now,
    );

    taskRepo.create({
      id: 'task-gate', conversation_id: project.workspace_conversation_id,
      title: '独立验收', agent_id: 'reviewer',
    });
    getDb().prepare(`
      INSERT INTO work_contract (
        id,work_id,work_epoch,attempt_id,fencing_token,project_id,task_id,agent_id,goal,
        acceptance_criteria_json,role_json,permissions_json,authoritative_refs_json,
        authoritative_revisions_json,context_snapshot_ref,allowed_outcome_types_json,
        budget_json,correlation_id,causation_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'contract-gate', 'gate-work', 1, 'attempt-gate', 'token-gate',
      project.workspace_conversation_id, 'task-gate', 'reviewer', '独立验收', '[]', '{}',
      '{}', '[]', '{}', 'snapshot:gate', '["record_gate_decision"]', '{}',
      'correlation-gate', 'cause-gate', '2026-08-27T03:00:00.000Z',
    );
    getDb().prepare(`INSERT INTO work_authority (work_id,project_id,current_epoch,current_contract_id,status,revision,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run('gate-work', project.workspace_conversation_id, 1, 'contract-gate', 'active', 0, '2026-08-27T03:00:00.000Z');
    getDb().prepare(`
      INSERT INTO agent_outcome (
        id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,fencing_token,
        outcome_type,payload_json,evidence_refs_json,authoritative_revisions_json,
        correlation_id,causation_id,occurred_at,admission_status,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'outcome-gate', 'outcome-key-gate', 'contract-gate', project.workspace_conversation_id,
      'gate-work', 1, 'attempt-gate', 'token-gate', 'record_gate_decision', '{}',
      '["workspace:reports/acceptance.md"]', '{}', 'correlation-gate', 'cause-gate',
      '2026-08-27T03:00:00.000Z', 'accepted', '2026-08-27T03:00:00.000Z',
    );

    expect(projectArtifactLedger.list(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: 'reports/acceptance.md', status: 'registered', kind: 'document',
        updatedBy: 'builder', workId: 'a2a-pass:1', workTitle: '完成验收报告',
      }),
      expect.objectContaining({ ref: 'test:vitest = 42 passed', status: 'registered', kind: 'proof' }),
      expect.objectContaining({ ref: 'proxy.mjs', status: 'registered', kind: 'code' }),
      expect.objectContaining({ ref: 'http://127.0.0.1:4173/summary', status: 'registered', kind: 'link' }),
    ]));
    const refs = projectArtifactLedger.list(project.id).map((item) => item.ref);
    expect(refs.filter((ref) => ref === 'proxy.mjs')).toHaveLength(1);
    expect(refs).not.toEqual(expect.arrayContaining([
      '.ath/team-log.md', 'git status --short', 'msg-1',
      'http://127.0.0.1:4173/summary health 200 / PID 42',
    ]));
  });
});
