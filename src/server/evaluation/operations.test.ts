import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest } from './defaults';
import { evaluationOperations } from './operations';

const old = '2020-01-01T00:00:00.000Z';

beforeEach(() => {
  setTestDb(createTestDb());
  const db = getDb();
  db.prepare(`INSERT INTO conversation
    (id,title,status,participants,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run('conv-ops', '运营测试', 'active', '[]', old, old);
  db.prepare(`INSERT INTO eval_subject_snapshot
    (id,conversation_id,mode,evidence_cutoff_at,collected_at,snapshot_hash,evidence_refs,evidence_payload,
     app_manifest,data_quality,task_type,difficulty,language)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'snapshot-old', 'conv-ops', 'online', old, old, 'snapshot-old-hash',
    '[]', '{}', '{}', '{"coverage":1,"missing":[],"truncated":[]}', 'coding', 'medium', 'zh');
  db.prepare(`INSERT INTO eval_run
    (id,conversation_id,snapshot_id,rubric_revision_id,mode,idempotency_key,status,gate_status,
     evidence_coverage,evaluator_bundle_digest,created_at,updated_at)
    VALUES (?,?,?,?,?,'old-run-key','partial','unknown',1,?,?,?)`).run(
    'run-old', 'conv-ops', 'snapshot-old', DEFAULT_RUBRIC_REVISION_ID,
    'online', digest(EVALUATOR_BUNDLE_REVISION), old, old);
  db.prepare(`INSERT INTO eval_job
    (id,run_id,request_payload,status,attempt_count,max_attempts,next_attempt_at,created_at,updated_at)
    VALUES ('job-old','run-old','{}','completed',1,3,?,?,?)`).run(old, old, old);
  db.prepare(`INSERT INTO eval_score
    (id,run_id,dimension_key,evaluator_kind,evaluator_revision,applicability,label,rationale,evidence_refs,created_at)
    VALUES ('score-old','run-old','correctness','judge','judge-v1','unknown','unknown','no evidence','[]',?)`).run(old);
  db.prepare(`INSERT INTO eval_review_queue
    (id,conversation_id,run_id,reason_code,primary_label,secondary_label,status,request_payload,created_at,updated_at)
    VALUES ('review-old','conv-ops','run-old','judge_disagreement','partial','fail','pending','{}',?,?)`).run(old, old);
});

afterEach(() => resetDb());

describe('evaluationOperations', () => {
  it('reports queue/review health and retention cascades derived run data', () => {
    const now = new Date();
    const startedAt = new Date(now.getTime() - 1_000).toISOString();
    const completedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const db = getDb();
    db.prepare(`UPDATE eval_run SET created_at=?,started_at=?,completed_at=? WHERE id='run-old'`)
      .run(startedAt, startedAt, completedAt);
    db.prepare(`INSERT INTO eval_policy
      (conversation_id,enabled,sampling_rate,daily_token_budget,max_concurrency,allowed_providers,
       retention_days,fail_strategy,updated_by,updated_at)
      VALUES ('conv-ops',1,1,1000,2,'["openai"]',180,'partial','test',?)`).run(completedAt);
    db.prepare(`INSERT INTO eval_judge_attempt
      (id,run_id,dimension_key,prompt_digest,request_params,parse_status,prompt_tokens,
       completion_tokens,latency_ms,created_at)
      VALUES ('attempt-ops','run-old','correctness','digest','{}','parsed',100,50,25,?)`)
      .run(completedAt);
    db.prepare(`INSERT INTO eval_budget_reservation
      (id,conversation_id,run_id,reservation_key,reserved_tokens,expires_at,created_at)
      VALUES ('reservation-ops','conv-ops','run-old','ops',200,?,?)`)
      .run(expiresAt, completedAt);

    const status = evaluationOperations.status('conv-ops');
    expect(status.review).toMatchObject({
      pending: 1, resolved: 0, disagreements: 1,
    });
    expect(status.performance).toMatchObject({
      run_p95_ms: expect.any(Number), target_ms: 120_000, status: 'pass', sample_size: 1,
    });
    expect(status.capacity).toMatchObject({ activeJobs: 0, maxConcurrency: 2, saturation: 0 });
    expect(status.budget).toMatchObject({
      dailyTokenBudget: 1000,
      usedTokens: 150,
      reservedTokens: 200,
      remainingTokens: 650,
      attemptsToday: 1,
      activeReservations: 1,
    });
    db.prepare(`UPDATE eval_run SET created_at=? WHERE id='run-old'`).run(old);
    expect(evaluationOperations.enforceRetention('conv-ops')).toMatchObject({
      deletedRuns: 1, deletedSnapshots: 1,
    });
    for (const table of ['eval_run', 'eval_job', 'eval_score', 'eval_review_queue', 'eval_subject_snapshot']) {
      expect((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count).toBe(0);
    }
  });

  it('keeps a historical run referenced by a retained annotation row', () => {
    const db = getDb();
    db.prepare(`INSERT INTO eval_dataset
      (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
      VALUES ('dataset-history','conv-ops','Historical','Retained legacy data',1,'active','system',?,?)`)
      .run(old, old);
    db.prepare(`INSERT INTO eval_case
      (id,dataset_id,case_key,split,source_type,input_payload,expected_labels,metadata,content_hash,
       redaction_status,created_at)
      VALUES ('case-history','dataset-history','history-1','tune','manual','{}','{}','{}','history-hash','redacted',?)`)
      .run(old);
    db.prepare(`INSERT INTO eval_annotation
      (id,conversation_id,case_id,run_id,rubric_revision_id,reviewer_id,dimension_key,label,rationale,status,created_at)
      VALUES ('annotation-history','conv-ops','case-history','run-old',?,'legacy-reviewer','correctness','partial',
        'Historical row','submitted',?)`)
      .run(DEFAULT_RUBRIC_REVISION_ID, old);

    expect(evaluationOperations.enforceRetention('conv-ops')).toMatchObject({
      deletedRuns: 0,
      deletedSnapshots: 0,
    });
    expect(db.prepare("SELECT id FROM eval_run WHERE id='run-old'").get()).toEqual({ id: 'run-old' });
  });
});
