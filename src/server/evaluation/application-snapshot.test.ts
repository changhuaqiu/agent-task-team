import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import {
  createCaseExecution,
  freezeApplicationSnapshot,
  resolveApplicationSnapshotRuntime,
  transitionCaseExecution,
} from './application-snapshot';
import { createRunnerExperiment, EvaluationCaseRunner } from './case-runner';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest } from './defaults';
import { buildSubjectSnapshot } from './snapshot-builder';
import { taskRepo } from '../repositories/task-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { AgentInbox } from '../platform-events/agent-inbox';
import { CollaborationKernel } from '../collaboration-kernel';

const now = '2026-07-19T00:00:00.000Z';

const accountState = vi.hoisted(() => ({
  account: {
    id: 'account-ref',
    provider: 'openai' as const,
    authMode: 'api_key' as const,
    enabled: true,
    status: 'valid' as const | 'error' | 'pending',
    models: ['gpt-5.4'],
  },
  hasCredential: true,
}));

vi.mock('../accounts-file', () => ({
  listAccounts: () => [accountState.account],
}));

vi.mock('../credentials', () => ({
  hasCredential: () => accountState.hasCredential,
}));

beforeEach(() => {
  accountState.account.status = 'valid';
  accountState.hasCredential = true;
  setTestDb(createTestDb());
  getDb().prepare(`INSERT INTO team_pack
    (id,name,display_name,description,version,category,team_mode,workflow,communication_matrix,is_preset,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'team-runner', 'runner', 'Runner', 'Runner team', '1', 'test', 'pipeline', '{}', '{}', 0, now, now,
  );
  getDb().prepare(`INSERT INTO conversation
    (id,title,status,participants,project_path,team_pack_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    'conv-runner', 'Runner', 'active', '[]', process.cwd(), 'team-runner', now, now,
  );
  getDb().prepare(`INSERT INTO team_pack_role
    (id,pack_id,role_id,display_name,soul,required,role_card_snapshot,account_ids,skill_ids,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'role-runner', 'team-runner', 'agent-runner', 'Runner Agent', 'execute', 1,
    JSON.stringify({ snapshotVersion: 1, snapshottedAt: now, displayName: 'Runner Agent' }),
    '["account-ref"]', '[]', now,
  );
});

afterEach(() => resetDb());

function seedHeldOutCase(): string {
  getDb().prepare(`INSERT INTO eval_dataset
    (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
    VALUES ('dataset-runner','conv-runner','held','held',1,'active','test',?,?)`).run(now, now);
  getDb().prepare(`INSERT INTO eval_case
    (id,dataset_id,case_key,split,source_type,input_payload,expected_labels,metadata,content_hash,redaction_status,created_at)
    VALUES ('case-runner','dataset-runner','case','held_out','manual','{}','{}','{}','hash','redacted',?)`).run(now);
  return 'case-runner';
}

function bindRunningExecution(executionId: string, manifestDigest: string, observed = true): string {
  const taskId = `eval-task-${executionId}`;
  const sessionId = `session-${executionId}`;
  const invocationId = `invocation-${executionId}`;
  taskRepo.create({
    id: taskId,
    conversation_id: 'conv-runner',
    title: 'Held-out evaluation task',
    agent_id: 'agent-runner',
  });
  getDb().prepare(`INSERT INTO agent_session
    (id,conversation_id,agent_id,isolation_key,task_id,seq,status,created_at)
    VALUES (?,?,?,'evaluation:test',?,0,'active',?)`)
    .run(sessionId, 'conv-runner', 'agent-runner', taskId, now);
  invocationRepo.create({
    id: invocationId,
    conversation_id: 'conv-runner',
    task_id: taskId,
    agent_id: 'agent-runner',
    session_id: sessionId,
  });
  invocationRepo.transition(invocationId, { to: 'starting' });
  invocationRepo.transition(invocationId, { to: 'running' });
  getDb().prepare(`UPDATE eval_case_execution SET
      task_id=?,harness_trigger_id=?,invocation_id=?,trace_id=?,observed_manifest_digest=?,status='running'
    WHERE id=?`).run(
    taskId,
    executionId,
    invocationId,
    `trace-${executionId}`,
    observed ? manifestDigest : null,
    executionId,
  );
  return taskId;
}

describe('application snapshot and case execution', () => {
  it('freezes one immutable manifest per content digest', () => {
    const codeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const first = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'baseline', source: 'published', codeRevision,
    });
    const duplicate = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'same content', source: 'candidate', codeRevision,
    });
    expect(duplicate.id).toBe(first.id);
    expect(first.manifest).toMatchObject({ schemaVersion: 1, codeRevision });
    expect(() => getDb().prepare('UPDATE eval_application_snapshot SET name=? WHERE id=?')
      .run('changed', first.id)).toThrow(/immutable/);
  });

  it.each(['error', 'pending'] as const)(
    'does not restore a snapshot through a currently %s account',
    (status) => {
      const snapshot = freezeApplicationSnapshot({
        conversationId: 'conv-runner', name: 'baseline', source: 'published',
      });
      accountState.account.status = status;
      expect(() => resolveApplicationSnapshotRuntime(
        snapshot.id, 'conv-runner', 'agent-runner',
      )).toThrow(/not ready/);
    },
  );

  it('does not restore a snapshot after its API key is removed', () => {
    const snapshot = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'baseline', source: 'published',
    });
    accountState.hasCredential = false;
    expect(() => resolveApplicationSnapshotRuntime(
      snapshot.id, 'conv-runner', 'agent-runner',
    )).toThrow(/not ready/);
  });

  it('normalizes a historical Gemini runtime without rewriting its immutable snapshot', () => {
    const snapshot = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'baseline', source: 'published',
    });
    const legacyAgents = snapshot.manifest.agents.map((agent) => ({
      ...agent,
      engine: 'gemini',
      runtimeId: 'gemini-cli',
    }));
    getDb().prepare(`INSERT INTO eval_application_snapshot
      (id,conversation_id,name,source,project_path,code_revision,team_manifest,agent_manifest,
       manifest_digest,created_by,created_at)
      SELECT 'legacy-gemini',conversation_id,'legacy','published',project_path,code_revision,
       team_manifest,?,'legacy-gemini-digest',created_by,created_at
      FROM eval_application_snapshot WHERE id=?`).run(JSON.stringify(legacyAgents), snapshot.id);

    const resolved = resolveApplicationSnapshotRuntime(
      'legacy-gemini',
      'conv-runner',
      'agent-runner',
    );

    expect(resolved?.profile.execution).toMatchObject({
      engine: 'opencode',
      runtimeId: 'opencode-local',
    });
    const persisted = getDb().prepare(
      'SELECT agent_manifest FROM eval_application_snapshot WHERE id=?',
    ).get('legacy-gemini') as { agent_manifest: string };
    expect(persisted.agent_manifest).toContain('gemini-cli');
  });

  it('only verifies a completed execution with matching observed provenance', () => {
    const snapshot = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'baseline', source: 'published',
    });
    const execution = createCaseExecution({
      conversationId: 'conv-runner',
      caseId: seedHeldOutCase(),
      applicationSnapshotId: String(snapshot.id),
      variant: 'baseline',
    });
    transitionCaseExecution({ id: String(execution.id), conversationId: 'conv-runner', status: 'planning' });
    transitionCaseExecution({
      id: String(execution.id), conversationId: 'conv-runner', status: 'running',
      harnessTriggerId: 'trigger-eval',
    });
    transitionCaseExecution({ id: String(execution.id), conversationId: 'conv-runner', status: 'evaluating' });
    expect(() => transitionCaseExecution({
      id: String(execution.id), conversationId: 'conv-runner', status: 'completed',
      invocationId: 'inv-eval', traceId: 'trace-eval', evalRunId: 'run-eval',
      observedManifestDigest: 'wrong',
    })).toThrow(/matching observed manifest/);
    getDb().prepare(`INSERT INTO agent_session
      (id,conversation_id,agent_id,isolation_key,task_id,seq,status,created_at)
      VALUES ('session-eval','conv-runner','agent-runner','evaluation:test','',0,'sealed',?)`).run(now);
    invocationRepo.create({
      id: 'inv-eval',
      conversation_id: 'conv-runner',
      agent_id: 'agent-runner',
      session_id: 'session-eval',
    });
    invocationRepo.transition('inv-eval', { to: 'terminated', outcome: 'completed' });
    getDb().prepare(`INSERT INTO eval_run
      (id,conversation_id,rubric_revision_id,mode,idempotency_key,status,gate_status,evidence_coverage,
       evaluator_bundle_digest,created_at,updated_at)
      VALUES ('run-eval','conv-runner',?,'offline','runner-positive','completed','pass',1,?,?,?)`).run(
      DEFAULT_RUBRIC_REVISION_ID, digest(EVALUATOR_BUNDLE_REVISION), now, now,
    );
    const completed = transitionCaseExecution({
      id: String(execution.id), conversationId: 'conv-runner', status: 'completed',
      invocationId: 'inv-eval', traceId: 'trace-eval', evalRunId: 'run-eval',
      observedManifestDigest: String(snapshot.manifest_digest),
    });
    expect(completed.execution_verified).toBe(1);
  });

  it('builds offline provenance from the frozen application manifest instead of mutable project state', () => {
    const snapshot = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'baseline', source: 'published',
    });
    const execution = createCaseExecution({
      conversationId: 'conv-runner',
      caseId: seedHeldOutCase(),
      applicationSnapshotId: String(snapshot.id),
      variant: 'baseline',
    });
    const taskId = bindRunningExecution(String(execution.id), String(snapshot.manifest_digest));
    getDb().prepare(`UPDATE team_pack_role
      SET role_card_snapshot=?,skill_ids='["mutable-skill"]' WHERE pack_id='team-runner'`)
      .run(JSON.stringify({ snapshotVersion: 99, snapshottedAt: '2099-01-01', displayName: 'Mutated' }));
    getDb().prepare("UPDATE conversation SET project_path='C:/mutable/current/head' WHERE id='conv-runner'").run();

    const subject = buildSubjectSnapshot({
      conversationId: 'conv-runner',
      triggerId: String(execution.id),
      caseId: 'case-runner',
      rootTaskId: taskId,
      mode: 'offline',
      applicationManifest: snapshot.manifest,
    });

    expect(subject.appManifest).toMatchObject({
      gitRevision: snapshot.manifest.codeRevision,
      teamPackId: snapshot.manifest.team.id,
      applicationSnapshotId: snapshot.id,
      targetManifestDigest: snapshot.manifest_digest,
      observedManifestDigest: snapshot.manifest_digest,
      applicationVariant: snapshot.manifest,
    });
    expect(subject.appManifest.roleCardSnapshots).toEqual([
      expect.objectContaining({
        roleId: 'agent-runner',
        snapshotDigest: digest(snapshot.manifest.team.roles[0]?.roleCardSnapshot),
      }),
    ]);
    expect(JSON.stringify(subject.appManifest)).not.toContain('mutable-skill');
    expect(JSON.stringify(subject.appManifest)).not.toContain('C:/mutable/current/head');
  });

  it('fails closed when offline evaluation provenance is missing or unobserved', () => {
    expect(() => buildSubjectSnapshot({
      conversationId: 'conv-runner',
      mode: 'offline',
    })).toThrow(/valid frozen application manifest/);

    const snapshot = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'baseline', source: 'published',
    });
    expect(() => buildSubjectSnapshot({
      conversationId: 'conv-runner',
      mode: 'offline',
      applicationManifest: snapshot.manifest,
    })).toThrow(/bound case execution/);

    const execution = createCaseExecution({
      conversationId: 'conv-runner',
      caseId: seedHeldOutCase(),
      applicationSnapshotId: String(snapshot.id),
      variant: 'baseline',
    });
    const taskId = bindRunningExecution(String(execution.id), String(snapshot.manifest_digest), false);
    expect(() => buildSubjectSnapshot({
      conversationId: 'conv-runner',
      triggerId: String(execution.id),
      rootTaskId: taskId,
      mode: 'offline',
      applicationManifest: snapshot.manifest,
    })).toThrow(/bound case and root task/);
    expect(() => buildSubjectSnapshot({
      conversationId: 'conv-runner',
      triggerId: String(execution.id),
      caseId: 'another-case',
      rootTaskId: taskId,
      mode: 'offline',
      applicationManifest: snapshot.manifest,
    })).toThrow(/case does not match/);
    expect(() => buildSubjectSnapshot({
      conversationId: 'conv-runner',
      triggerId: String(execution.id),
      caseId: 'case-runner',
      rootTaskId: 'another-task',
      mode: 'offline',
      applicationManifest: snapshot.manifest,
    })).toThrow(/root task does not match/);
    expect(() => buildSubjectSnapshot({
      conversationId: 'conv-runner',
      triggerId: String(execution.id),
      caseId: 'case-runner',
      rootTaskId: taskId,
      mode: 'offline',
      applicationManifest: snapshot.manifest,
    })).toThrow(/observed application manifest digest/);
  });

  it('creates both isolated variants and routes evaluation work through the Collaboration Kernel', () => {
    const baseline = freezeApplicationSnapshot({
      conversationId: 'conv-runner', name: 'baseline', source: 'published',
    });
    const candidate = freezeApplicationSnapshot({
      conversationId: 'conv-runner',
      name: 'candidate',
      source: 'candidate',
      team: { ...baseline.manifest.team, version: '2' },
    });
    const experiment = createRunnerExperiment({
      conversationId: 'conv-runner',
      datasetId: (() => { seedHeldOutCase(); return 'dataset-runner'; })(),
      name: 'real runner',
      baselineSnapshotId: String(baseline.id),
      candidateSnapshotId: String(candidate.id),
    });
    const executions = getDb().prepare(
      'SELECT variant,status FROM eval_case_execution WHERE experiment_id=? ORDER BY variant',
    ).all(experiment.id) as Array<{ variant: string; status: string }>;
    expect(executions).toEqual([
      { variant: 'baseline', status: 'queued' },
      { variant: 'candidate', status: 'queued' },
    ]);
    const inbox = new AgentInbox();
    const kernel = new CollaborationKernel({ inbox });
    const request = vi.spyOn(kernel, 'request');
    const runner = new EvaluationCaseRunner(kernel);
    expect(runner.pump(2)).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'conv-runner',
      source: 'test_gate',
      replyTo: expect.objectContaining({ type: 'evaluation_case' }),
      context: expect.objectContaining({
        scenario: 'verification',
        evaluation: expect.objectContaining({ caseId: 'case-runner' }),
      }),
    }));
    const planning = getDb().prepare(
      "SELECT status FROM eval_case_execution WHERE experiment_id=? AND status='planning'",
    ).get(experiment.id) as { status: string };
    expect(planning.status).toBe('planning');
    expect(inbox.listPending('conv-runner')).toEqual([
      expect.objectContaining({
        projectId: 'conv-runner',
        command: expect.objectContaining({
          source: 'test_gate',
          replyTo: expect.objectContaining({ type: 'evaluation_case' }),
          evaluation: expect.objectContaining({ caseId: 'case-runner' }),
        }),
      }),
    ]);
  });
});
