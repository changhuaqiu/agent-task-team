import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest } from './defaults';
import { evaluationLab } from './evaluation-lab';

const now = '2026-07-19T00:00:00.000Z';

beforeEach(() => {
  setTestDb(createTestDb());
  getDb().prepare(`INSERT INTO conversation
    (id,title,status,participants,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run('conv-lab', '实验项目', 'active', '[]', now, now);
});
afterEach(() => resetDb());

function insertRun(id: string, score: number, caseId?: string, manifest?: unknown): void {
  getDb().prepare(`INSERT INTO eval_run
    (id,conversation_id,rubric_revision_id,mode,idempotency_key,status,gate_status,evidence_coverage,
     overall_score,evaluator_bundle_digest,case_id,application_manifest_digest,created_at,updated_at)
    VALUES (?,?,?,'offline',?,'completed','pass',1,?,?,?,?,?,?)`).run(
      id, 'conv-lab', DEFAULT_RUBRIC_REVISION_ID, `key-${id}`, score, digest(EVALUATOR_BUNDLE_REVISION),
      caseId ?? null, manifest ? digest(manifest) : null, now, now);
}

describe('evaluationLab', () => {
  it('versions datasets and computes paired bootstrap evidence', () => {
    const cases = Array.from({ length: 12 }, (_, index) => ({
      caseKey: `held-${index}`, split: 'held_out' as const, input: { index }, metadata: {
        taskType: index % 2 ? 'coding' : 'analysis', difficulty: 'medium', language: index % 2 ? 'zh' : 'en',
      },
    }));
    const dataset = evaluationLab.createDataset({
      conversationId: 'conv-lab', name: '发布回归集', description: '固定的 held-out 对比集', cases,
    });
    const nextRevision = evaluationLab.createDataset({
      conversationId: 'conv-lab', name: '发布回归集', description: '新增案例后的不可变新版本', cases: [],
    });
    expect(dataset.revision).toBe(1);
    expect(nextRevision.revision).toBe(2);

    const caseRows = getDb().prepare('SELECT id FROM eval_case WHERE dataset_id=? ORDER BY case_key').all(dataset.id) as Array<{ id: string }>;
    const baselineManifest = { revision: 'base' };
    const candidateManifest = { revision: 'candidate' };
    const pairs = caseRows.map((item, index) => {
      insertRun(`base-${index}`, 70, item.id, baselineManifest);
      insertRun(`candidate-${index}`, 75, item.id, candidateManifest);
      return { caseId: item.id, baselineRunId: `base-${index}`, candidateRunId: `candidate-${index}` };
    });
    const experiment = evaluationLab.createExperiment({
      conversationId: 'conv-lab', datasetId: String(dataset.id), name: '候选版本对比',
      baselineManifest, candidateManifest, pairs,
    });
    const summary = experiment.summary as Record<string, unknown>;
    const publicItems = experiment.items as Array<Record<string, unknown>>;
    expect(publicItems[0]).not.toHaveProperty('baseline_run_id');
    expect(publicItems[0]).not.toHaveProperty('candidate_run_id');
    expect(publicItems[0]).not.toHaveProperty('winner');
    expect(publicItems[0]).not.toHaveProperty('score_delta');
    expect(summary).toMatchObject({ sampleSize: 12, wins: 12, losses: 0, conclusion: 'candidate_improves' });
    expect(summary.ci95).toEqual([5, 5]);
    expect(summary.strata).toMatchObject({
      taskType: {
        coding: { sampleSize: 6, meanDelta: 5 },
        analysis: { sampleSize: 6, meanDelta: 5 },
      },
    });

    const pair = pairs[0]!;
    const first = evaluationLab.createPairwiseRound({
      conversationId: 'conv-lab', experimentId: String(experiment.id), caseId: pair.caseId,
    });
    expect(first.left).not.toHaveProperty('runId');
    expect(first.right).not.toHaveProperty('runId');
    const firstRow = getDb().prepare('SELECT blind_seed FROM eval_pairwise_round WHERE id=?')
      .get(first.id) as { blind_seed: string };
    const candidateToken = digest({ blindSeed: firstRow.blind_seed, variant: 'candidate' });
    const firstChoice = (first.left as Record<string, unknown>).subjectToken === candidateToken ? 'left' : 'right';
    const swapped = evaluationLab.submitPairwiseDecision({
      id: String(first.id), conversationId: 'conv-lab', judgeId: 'judge-a', choice: firstChoice,
    });
    expect(swapped).toMatchObject({ phase: 'swap', status: 'pending_swap' });
    const swappedChoice = (swapped.left as Record<string, unknown>).subjectToken === candidateToken ? 'left' : 'right';
    const resolved = evaluationLab.submitPairwiseDecision({
      id: String(first.id), conversationId: 'conv-lab', judgeId: 'judge-a', choice: swappedChoice,
    });
    expect(resolved).toMatchObject({ status: 'consistent', resolved_winner: 'candidate' });

    const biasedPair = pairs[1]!;
    const biasedFirst = evaluationLab.createPairwiseRound({
      conversationId: 'conv-lab', experimentId: String(experiment.id), caseId: biasedPair.caseId,
    });
    const biasedRow = getDb().prepare('SELECT blind_seed FROM eval_pairwise_round WHERE id=?')
      .get(biasedFirst.id) as { blind_seed: string };
    const biasedCandidateToken = digest({ blindSeed: biasedRow.blind_seed, variant: 'candidate' });
    const chooseCandidate = (round: Record<string, unknown>) =>
      (round.left as Record<string, unknown>).subjectToken === biasedCandidateToken ? 'left' : 'right';
    const biasedSwap = evaluationLab.submitPairwiseDecision({
      id: String(biasedFirst.id), conversationId: 'conv-lab', judgeId: 'judge-a',
      choice: chooseCandidate(biasedFirst),
    });
    const chooseBaseline = (biasedSwap.left as Record<string, unknown>).subjectToken !== biasedCandidateToken ? 'left' : 'right';
    expect(evaluationLab.submitPairwiseDecision({
      id: String(biasedFirst.id), conversationId: 'conv-lab', judgeId: 'judge-a', choice: chooseBaseline,
    })).toMatchObject({ status: 'needs_review', resolved_winner: null });
    expect(evaluationLab.listReviewQueue('conv-lab')).toEqual([
      expect.objectContaining({ reason_code: 'pairwise_order_inconsistency', status: 'pending' }),
    ]);
    const pending = evaluationLab.listReviewQueue('conv-lab')[0]!;
    evaluationLab.resolveReview({
      id: String(pending.id), conversationId: 'conv-lab', reviewerId: 'reviewer-human',
      resolution: { winner: 'candidate', rationale: 'Evidence favors the candidate.' },
    });
    expect(getDb().prepare('SELECT consistency_status,resolved_winner FROM eval_pairwise_round WHERE id=?')
      .get(biasedFirst.id)).toEqual({ consistency_status: 'human_resolved', resolved_winner: 'candidate' });
  });

  it('requires a completed non-regressing experiment before approval', () => {
    insertRun('run-gap', 40);
    getDb().prepare(`INSERT INTO eval_gap
      (id,run_id,dimension_key,severity,description,suggestion,status,evidence_refs,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'open','[]',?,?)`).run(
        'gap-1', 'run-gap', 'correctness', 'high', '结果不正确', '修正能力说明', now, now);
    const proposal = evaluationLab.createProposal({
      conversationId: 'conv-lab', gapId: 'gap-1', targetType: 'role_card',
      hypothesis: '增加验证步骤可减少错误', proposedChange: '候选 RoleCard 修订', risk: 'medium',
    });
    const submitted = evaluationLab.transitionProposal({
      id: String(proposal.id), conversationId: 'conv-lab', action: 'submit', actorId: 'owner',
    });
    expect(submitted.status).toBe('in_review');
    expect(() => evaluationLab.transitionProposal({
      id: String(proposal.id), conversationId: 'conv-lab', action: 'approve', actorId: 'reviewer',
    })).toThrow('Held-out regression experiment is required');
  });

  it('rejects a release gate when blind pairwise review favors the baseline', () => {
    const db = getDb();
    const dataset = evaluationLab.createDataset({
      conversationId: 'conv-lab', name: 'Direction gate', description: 'Pairwise direction',
      cases: [{ caseKey: 'held-direction', split: 'held_out', input: { prompt: 'test' } }],
    });
    const item = db.prepare('SELECT id FROM eval_case WHERE dataset_id=?').get(dataset.id) as { id: string };
    insertRun('direction-gap-run', 40);
    insertRun('direction-base', 70, item.id, { revision: 'base' });
    insertRun('direction-candidate', 75, item.id, { revision: 'candidate' });
    db.prepare(`INSERT INTO eval_gap
      (id,run_id,dimension_key,severity,description,suggestion,status,evidence_refs,created_at,updated_at)
      VALUES ('direction-gap','direction-gap-run','correctness','high','gap','fix','open','[]',?,?)`)
      .run(now, now);
    db.prepare(`INSERT INTO eval_experiment
      (id,conversation_id,dataset_id,dataset_revision,rubric_revision_id,evaluator_bundle_digest,name,status,
       baseline_manifest,candidate_manifest,summary,created_by,started_at,completed_at,created_at)
      VALUES ('direction-experiment','conv-lab',?,1,?,?,'Direction experiment','completed',
       '{}','{}','{"conclusion":"candidate_improves"}','test',?,?,?)`)
      .run(dataset.id, DEFAULT_RUBRIC_REVISION_ID, digest(EVALUATOR_BUNDLE_REVISION), now, now, now);
    db.prepare(`INSERT INTO eval_experiment_item
      (id,experiment_id,case_id,baseline_run_id,candidate_run_id,winner,score_delta,execution_verified,details,created_at)
      VALUES ('direction-item','direction-experiment',?,'direction-base','direction-candidate',
       'candidate',5,1,'{}',?)`).run(item.id, now);
    db.prepare(`INSERT INTO eval_pairwise_round
      (id,conversation_id,experiment_id,case_id,blind_seed,first_order,resolved_winner,
       consistency_status,created_at,updated_at)
      VALUES ('direction-round','conv-lab','direction-experiment',?,'seed',
       '["baseline","candidate"]','baseline','consistent',?,?)`).run(item.id, now, now);
    const proposal = evaluationLab.createProposal({
      conversationId: 'conv-lab', gapId: 'direction-gap', targetType: 'role_card',
      hypothesis: 'Candidate should improve quality', proposedChange: 'Candidate revision', risk: 'medium',
    });
    evaluationLab.transitionProposal({
      id: String(proposal.id), conversationId: 'conv-lab', action: 'submit', actorId: 'owner',
    });
    expect(() => evaluationLab.transitionProposal({
      id: String(proposal.id), conversationId: 'conv-lab', action: 'approve', actorId: 'reviewer',
      regressionExperimentId: 'direction-experiment',
    })).toThrow('resolved in favor of the baseline');
  });

  it('promotes an online failure only after explicit review and never directly into held-out', () => {
    const db = getDb();
    const dataset = evaluationLab.createDataset({
      conversationId: 'conv-lab', name: '线上失败集', description: '经复核后进入调参集', cases: [],
    });
    db.prepare(`INSERT INTO eval_subject_snapshot
      (id,conversation_id,mode,evidence_cutoff_at,collected_at,snapshot_hash,evidence_refs,evidence_payload,
       app_manifest,data_quality,task_type,difficulty,language)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'snapshot-promotion', 'conv-lab', 'online', now, now, 'snapshot-promotion-hash',
      '[{"kind":"proof","id":"proof-1"}]', '{}', '{"roleCards":["role-v1"]}',
      '{"coverage":1,"missing":[],"truncated":[]}', 'coding', 'hard', 'zh');
    db.prepare(`INSERT INTO eval_run
      (id,conversation_id,snapshot_id,rubric_revision_id,mode,idempotency_key,status,gate_status,
       evidence_coverage,evaluator_bundle_digest,created_at,updated_at)
      VALUES (?,?,?,?,?,'promotion-key','partial','fail',1,?,?,?)`).run(
      'run-promotion', 'conv-lab', 'snapshot-promotion', DEFAULT_RUBRIC_REVISION_ID,
      'online', digest(EVALUATOR_BUNDLE_REVISION), now, now);
    db.prepare(`INSERT INTO eval_score
      (id,run_id,dimension_key,evaluator_kind,evaluator_revision,applicability,normalized_score,label,
       rationale,evidence_refs,created_at)
      VALUES (?,?,?,?,?,'applicable',0,'fail','missing delivery','[]',?)`).run(
      'score-promotion', 'run-promotion', 'gate.delivery_evidence', 'gate', 'gate-v1', now);

    expect(() => evaluationLab.requestCasePromotion({
      conversationId: 'conv-lab', runId: 'run-promotion', datasetId: String(dataset.id),
      caseKey: 'online-failure-1', split: 'held_out' as never,
    })).toThrow('held_out is curated separately');
    const review = evaluationLab.requestCasePromotion({
      conversationId: 'conv-lab', runId: 'run-promotion', datasetId: String(dataset.id),
      caseKey: 'online-failure-1', split: 'tune',
    });
    const resolved = evaluationLab.reviewCasePromotion({
      id: String(review.id), conversationId: 'conv-lab', reviewerId: 'platform-user',
      approved: true, rationale: '证据已脱敏，适合作为回归边界案例',
    });
    expect(resolved).toMatchObject({ status: 'resolved', resolved_by: 'platform-user' });
    const promoted = db.prepare('SELECT * FROM eval_case WHERE source_ref=?').get('run-promotion') as Record<string, unknown>;
    expect(promoted).toMatchObject({
      split: 'tune', source_type: 'online_failure',
      redaction_status: 'redacted_reviewed',
    });
    expect(promoted.dataset_id).not.toBe(dataset.id);
    expect(db.prepare('SELECT status FROM eval_dataset WHERE id=?').get(dataset.id)).toEqual({ status: 'superseded' });
    expect(db.prepare('SELECT revision,status FROM eval_dataset WHERE id=?').get(promoted.dataset_id))
      .toEqual({ revision: 2, status: 'active' });
    expect(JSON.parse(String(promoted.input_payload))).toHaveProperty('evidence');
  });
});
