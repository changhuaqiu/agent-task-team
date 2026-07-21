import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import {
  createCaseExecution,
  freezeApplicationSnapshot,
  transitionCaseExecution,
} from './application-snapshot';
import { createRunnerExperiment, EvaluationCaseRunner } from './case-runner';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest } from './defaults';
import { buildSubjectSnapshot } from './snapshot-builder';

const now = '2026-07-19T00:00:00.000Z';

vi.mock('../accounts-file', () => ({
  listAccounts: () => [{
    id: 'account-ref',
    provider: 'openai',
    enabled: true,
  }],
}));

beforeEach(() => {
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
    getDb().prepare(`INSERT INTO invocation
      (id,conversation_id,task_id,agent_id,session_id,status,created_at,updated_at)
      VALUES ('inv-eval','conv-runner',NULL,'agent-runner','session-eval','succeeded',?,?)`).run(now, now);
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
    getDb().prepare(`UPDATE eval_case_execution
      SET observed_manifest_digest=?,status='running' WHERE id=?`)
      .run(snapshot.manifest_digest, execution.id);
    getDb().prepare(`UPDATE team_pack_role
      SET role_card_snapshot=?,skill_ids='["mutable-skill"]' WHERE pack_id='team-runner'`)
      .run(JSON.stringify({ snapshotVersion: 99, snapshottedAt: '2099-01-01', displayName: 'Mutated' }));
    getDb().prepare("UPDATE conversation SET project_path='C:/mutable/current/head' WHERE id='conv-runner'").run();

    const subject = buildSubjectSnapshot({
      conversationId: 'conv-runner',
      triggerId: String(execution.id),
      caseId: 'case-runner',
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

  it('creates both isolated variants and records a blocked Harness dispatch', async () => {
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
    const submit = vi.fn(() => ({
        disposition: 'accepted',
        handled: true,
        completion: Promise.resolve({ status: 'blocked', reasonCode: 'runtime_profile_missing' }),
      } as const));
    const runner = new EvaluationCaseRunner({ submit });
    expect(runner.pump(2)).toBe(1);
    expect(submit).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    const failed = getDb().prepare(
      "SELECT status,error_code FROM eval_case_execution WHERE experiment_id=? AND status='failed'",
    ).get(experiment.id) as { status: string; error_code: string };
    expect(failed).toEqual({ status: 'failed', error_code: 'runtime_profile_missing' });
  });
});
