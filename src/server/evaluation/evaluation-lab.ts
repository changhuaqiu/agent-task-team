import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest, stableJson } from './defaults';
import { redactObservationPreview } from '../observability/redaction';

type Row = Record<string, unknown>;
type ExperimentPair = { caseId: string; baselineRunId: string; candidateRunId: string };

function parse(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function redactedCasePayload(input: unknown): string {
  if (input && typeof input === 'object' && !Array.isArray(input)
    && typeof (input as Record<string, unknown>).redactedText === 'string') {
    return stableJson({
      redactedText: redactObservationPreview(
        (input as Record<string, unknown>).redactedText,
        32_000,
      ) ?? '',
    });
  }
  return stableJson({ redactedText: redactObservationPreview(input, 32_000) ?? '' });
}
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))]!;
}
function seeded(seedText: string): () => number {
  let state = Number.parseInt(digest(seedText).slice(0, 8), 16) || 1;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
}
function bootstrapCi(deltas: number[], seedText: string, rounds = 1_000): [number, number] {
  if (!deltas.length) return [0, 0];
  const random = seeded(seedText);
  const means: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    let sum = 0;
    for (let index = 0; index < deltas.length; index += 1) sum += deltas[Math.floor(random() * deltas.length)]!;
    means.push(sum / deltas.length);
  }
  return [percentile(means, 0.025), percentile(means, 0.975)];
}

function summarize(deltas: number[], seedText: string): Record<string, unknown> {
  const wins = deltas.filter((delta) => delta > 0).length;
  const ties = deltas.filter((delta) => delta === 0).length;
  const losses = deltas.filter((delta) => delta < 0).length;
  const mean = deltas.length ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length : 0;
  const median = percentile(deltas, 0.5);
  const ci95 = bootstrapCi(deltas, seedText);
  return {
    sampleSize: deltas.length, wins, ties, losses,
    meanDelta: Math.round(mean * 100) / 100, medianDelta: Math.round(median * 100) / 100,
    ci95: ci95.map((value) => Math.round(value * 100) / 100),
    minimumMeaningfulImprovement: 3,
    conclusion: deltas.length < 10 ? 'insufficient_evidence'
      : ci95[0] >= 3 ? 'candidate_improves'
        : ci95[1] <= -3 ? 'candidate_regresses' : 'inconclusive',
  };
}

function stratifiedSummary(
  entries: Array<{ delta: number; metadata: Record<string, unknown> }>,
  seedText: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of ['taskType', 'difficulty', 'language', 'roleTopology']) {
    const groups = new Map<string, number[]>();
    for (const entry of entries) {
      const value = String(entry.metadata[field] ?? 'unknown');
      groups.set(value, [...(groups.get(value) ?? []), entry.delta]);
    }
    result[field] = Object.fromEntries([...groups.entries()]
      .map(([value, deltas]) => [value, summarize(deltas, `${seedText}:${field}:${value}`)]));
  }
  return result;
}

function decodeOrder(value: unknown): ['baseline' | 'candidate', 'baseline' | 'candidate'] {
  const parsed = parse(value, []) as string[];
  if (parsed.length !== 2 || !parsed.includes('baseline') || !parsed.includes('candidate')) {
    throw new Error('Pairwise round has invalid blind order');
  }
  return parsed as ['baseline' | 'candidate', 'baseline' | 'candidate'];
}

function actualChoice(
  displayedChoice: 'left' | 'right' | 'tie',
  order: ['baseline' | 'candidate', 'baseline' | 'candidate'],
): 'baseline' | 'candidate' | 'tie' {
  return displayedChoice === 'tie' ? 'tie' : order[displayedChoice === 'left' ? 0 : 1];
}

export const evaluationLab = {
  createDataset(input: {
    conversationId: string; name: string; description: string; createdBy?: string;
    cases?: Array<{ caseKey: string; split: 'train' | 'tune' | 'held_out'; input: unknown; expected?: unknown; metadata?: unknown }>;
  }): Row {
    const db = getDb();
    if (!db.prepare('SELECT id FROM conversation WHERE id=?').get(input.conversationId)) throw new Error('Conversation not found');
    const latest = db.prepare('SELECT MAX(revision) revision FROM eval_dataset WHERE conversation_id=? AND name=?')
      .get(input.conversationId, input.name) as { revision: number | null };
    const revision = (latest.revision ?? 0) + 1;
    const id = `dataset-${randomUUID()}`;
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`INSERT INTO eval_dataset
        (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,'active',?,?,?)`).run(id, input.conversationId, input.name, input.description,
          revision, input.createdBy ?? 'project-admin', now, now);
      const insert = db.prepare(`INSERT INTO eval_case
        (id,dataset_id,case_key,split,source_type,source_ref,input_payload,expected_labels,metadata,
         content_hash,redaction_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of input.cases ?? []) {
        if (!['train', 'tune', 'held_out'].includes(item.split)) throw new Error('Invalid dataset split');
        const payload = redactedCasePayload(item.input);
        insert.run(`case-${randomUUID()}`, id, item.caseKey, item.split, 'manual', null, payload,
          stableJson(item.expected ?? {}), stableJson(item.metadata ?? {}), digest(payload), 'redacted', now);
      }
    })();
    return db.prepare('SELECT * FROM eval_dataset WHERE id=?').get(id) as Row;
  },

  listDatasets(conversationId: string): Row[] {
    return getDb().prepare(`SELECT d.*,COUNT(c.id) case_count FROM eval_dataset d
      LEFT JOIN eval_case c ON c.dataset_id=d.id
      WHERE d.conversation_id=? OR d.conversation_id IS NULL GROUP BY d.id ORDER BY d.updated_at DESC`)
      .all(conversationId) as Row[];
  },

  exportDataset(datasetId: string, conversationId: string): Record<string, unknown> {
    const db = getDb();
    const dataset = db.prepare(`SELECT * FROM eval_dataset
      WHERE id=? AND (conversation_id=? OR conversation_id IS NULL)`)
      .get(datasetId, conversationId) as Row | undefined;
    if (!dataset) throw new Error('Dataset not found in project');
    const cases = db.prepare('SELECT * FROM eval_case WHERE dataset_id=? ORDER BY created_at,id')
      .all(datasetId) as Row[];
    return {
      schemaVersion: 'agent-eval-dataset/1',
      name: dataset.name,
      description: dataset.description,
      revision: dataset.revision,
      cases: cases.map((item) => ({
        caseKey: item.case_key,
        split: item.split,
        sourceType: item.source_type,
        sourceRef: item.source_ref,
        input: parse(item.input_payload, {}),
        expected: parse(item.expected_labels, {}),
        metadata: parse(item.metadata, {}),
        contentHash: item.content_hash,
        redactionStatus: item.redaction_status,
      })),
    };
  },

  createExperiment(input: {
    conversationId: string; datasetId: string; name: string; baselineManifest: unknown;
    candidateManifest: unknown; pairs: ExperimentPair[]; createdBy?: string;
  }): Row {
    const db = getDb();
    const dataset = db.prepare('SELECT * FROM eval_dataset WHERE id=? AND (conversation_id=? OR conversation_id IS NULL)')
      .get(input.datasetId, input.conversationId) as Row | undefined;
    if (!dataset) throw new Error('Dataset not found in project');
    const id = `experiment-${randomUUID()}`;
    const now = new Date().toISOString();
    const deltas: number[] = [];
    const stratifiedEntries: Array<{ delta: number; metadata: Record<string, unknown> }> = [];
    const baselineDigest = digest(input.baselineManifest);
    const candidateDigest = digest(input.candidateManifest);
    db.transaction(() => {
      db.prepare(`INSERT INTO eval_experiment
        (id,conversation_id,dataset_id,dataset_revision,rubric_revision_id,evaluator_bundle_digest,name,status,
         baseline_manifest,candidate_manifest,created_by,started_at,created_at)
        VALUES (?,?,?,?,?,?,?,'running',?,?,?,?,?)`).run(id, input.conversationId, input.datasetId,
          dataset.revision, DEFAULT_RUBRIC_REVISION_ID, digest(EVALUATOR_BUNDLE_REVISION), input.name,
          stableJson(input.baselineManifest), stableJson(input.candidateManifest), input.createdBy ?? 'project-admin', now, now);
      const insert = db.prepare(`INSERT INTO eval_experiment_item
        (id,experiment_id,case_id,baseline_run_id,candidate_run_id,winner,score_delta,details,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const pair of input.pairs) {
        const caseRow = db.prepare('SELECT * FROM eval_case WHERE id=? AND dataset_id=?').get(pair.caseId, input.datasetId) as Row | undefined;
        if (!caseRow) throw new Error('Experiment case does not belong to dataset');
        if (caseRow.split !== 'held_out') throw new Error('Release experiments require held_out cases');
        const baseline = db.prepare('SELECT * FROM eval_run WHERE id=? AND conversation_id=?').get(pair.baselineRunId, input.conversationId) as Row | undefined;
        const candidate = db.prepare('SELECT * FROM eval_run WHERE id=? AND conversation_id=?').get(pair.candidateRunId, input.conversationId) as Row | undefined;
        if (!baseline || !candidate || baseline.rubric_revision_id !== candidate.rubric_revision_id ||
          baseline.evaluator_bundle_digest !== candidate.evaluator_bundle_digest) {
          throw new Error('Experiment runs must share project, rubric, and evaluator bundle');
        }
        if (baseline.status !== 'completed' || candidate.status !== 'completed' ||
          baseline.overall_score === null || baseline.overall_score === undefined ||
          candidate.overall_score === null || candidate.overall_score === undefined) {
          throw new Error('Experiment runs must be completed with comparable scores');
        }
        if (baseline.case_id !== pair.caseId || candidate.case_id !== pair.caseId ||
          baseline.application_manifest_digest !== baselineDigest ||
          candidate.application_manifest_digest !== candidateDigest) {
          throw new Error('Experiment run provenance does not match case or application manifest');
        }
        const delta = Number(candidate.overall_score) - Number(baseline.overall_score);
        deltas.push(delta);
        const metadata = parse(caseRow.metadata, {}) as Record<string, unknown>;
        stratifiedEntries.push({ delta, metadata });
        insert.run(`experiment-item-${randomUUID()}`, id, pair.caseId, pair.baselineRunId, pair.candidateRunId,
          delta > 0 ? 'candidate' : delta < 0 ? 'baseline' : 'tie', delta,
          stableJson({ split: caseRow.split, metadata }), now);
      }
      const summary = {
        ...summarize(deltas, id),
        strata: stratifiedSummary(stratifiedEntries, id),
        executionVerified: false,
        releaseGateEligible: false,
      };
      db.prepare(`UPDATE eval_experiment SET status='completed',summary=?,completed_at=? WHERE id=?`)
        .run(stableJson(summary), now, id);
    })();
    return this.getExperiment(id, input.conversationId)!;
  },

  completeVerifiedExperiment(experimentId: string, conversationId: string): Row {
    const db = getDb();
    const experiment = db.prepare(
      "SELECT * FROM eval_experiment WHERE id=? AND conversation_id=? AND status='running'",
    ).get(experimentId, conversationId) as Row | undefined;
    if (!experiment) throw new Error('Running experiment not found in project');
    const cases = db.prepare(`SELECT c.id,c.metadata FROM eval_case c
      WHERE c.dataset_id=? AND c.split='held_out' ORDER BY c.id`)
      .all(experiment.dataset_id) as Row[];
    const executions = db.prepare(`SELECT x.*,r.overall_score,r.status run_status
      FROM eval_case_execution x JOIN eval_run r ON r.id=x.eval_run_id
      WHERE x.experiment_id=? ORDER BY x.case_id,x.variant`).all(experimentId) as Row[];
    if (executions.length !== cases.length * 2 || executions.some((item) =>
      item.status !== 'completed' || Number(item.execution_verified) !== 1
      || item.run_status !== 'completed' || item.overall_score === null)) {
      throw new Error('Experiment executions are not all verified and comparable');
    }
    const byCase = new Map<string, Row[]>();
    for (const execution of executions) {
      const caseId = String(execution.case_id);
      byCase.set(caseId, [...(byCase.get(caseId) ?? []), execution]);
    }
    const deltas: number[] = [];
    const stratifiedEntries: Array<{ delta: number; metadata: Record<string, unknown> }> = [];
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const item of cases) {
        const pair = byCase.get(String(item.id)) ?? [];
        const baseline = pair.find((execution) => execution.variant === 'baseline');
        const candidate = pair.find((execution) => execution.variant === 'candidate');
        if (!baseline || !candidate) throw new Error(`Experiment case is missing a variant: ${String(item.id)}`);
        const delta = Number(candidate.overall_score) - Number(baseline.overall_score);
        deltas.push(delta);
        const metadata = parse(item.metadata, {}) as Record<string, unknown>;
        stratifiedEntries.push({ delta, metadata });
        db.prepare(`UPDATE eval_experiment_item SET baseline_run_id=?,candidate_run_id=?,winner=?,
          score_delta=?,execution_verified=1,details=? WHERE experiment_id=? AND case_id=?`).run(
          baseline.eval_run_id,
          candidate.eval_run_id,
          delta > 0 ? 'candidate' : delta < 0 ? 'baseline' : 'tie',
          delta,
          stableJson({ split: 'held_out', metadata }),
          experimentId,
          item.id,
        );
      }
      const summary = {
        ...summarize(deltas, experimentId),
        strata: stratifiedSummary(stratifiedEntries, experimentId),
        executionVerified: true,
        statisticalGateEligible: true,
        releaseGateEligible: false,
        releaseGateReason: 'blind_pairwise_review_required',
      };
      db.prepare(`UPDATE eval_experiment SET status='completed',summary=?,completed_at=? WHERE id=?`)
        .run(stableJson(summary), now, experimentId);
    })();
    return this.getExperiment(experimentId, conversationId)!;
  },

  getExperiment(id: string, conversationId: string): Row | undefined {
    const db = getDb();
    const experiment = db.prepare('SELECT * FROM eval_experiment WHERE id=? AND conversation_id=?')
      .get(id, conversationId) as Row | undefined;
    if (!experiment) return undefined;
    return {
      ...experiment, summary: parse(experiment.summary, {}),
      items: (db.prepare('SELECT * FROM eval_experiment_item WHERE experiment_id=? ORDER BY created_at').all(id) as Row[])
        .map((item) => ({
          id: item.id,
          case_id: item.case_id,
          execution_verified: item.execution_verified,
          details: parse(item.details, {}),
          created_at: item.created_at,
        })),
      executions: (db.prepare(`SELECT id,case_id,variant,status,execution_verified,error_code,
        created_at,started_at,completed_at FROM eval_case_execution
        WHERE experiment_id=? ORDER BY created_at,id`).all(id) as Row[]),
    };
  },

  listExperiments(conversationId: string): Row[] {
    const db = getDb();
    return (db.prepare(`SELECT * FROM eval_experiment WHERE conversation_id=?
      ORDER BY created_at DESC`).all(conversationId) as Row[])
      .map((experiment) => {
        const progress = db.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
          FROM eval_case_execution WHERE experiment_id=?`).get(experiment.id) as {
            total: number; completed: number | null; failed: number | null;
          };
        return {
          ...experiment,
          summary: parse(experiment.summary, {}),
          executionProgress: {
            total: Number(progress.total),
            completed: Number(progress.completed ?? 0),
            failed: Number(progress.failed ?? 0),
          },
        };
      });
  },

  createPairwiseRound(input: { conversationId: string; experimentId: string; caseId: string }): Row {
    const db = getDb();
    const item = db.prepare(`SELECT i.*,e.conversation_id FROM eval_experiment_item i
      JOIN eval_experiment e ON e.id=i.experiment_id
      WHERE i.experiment_id=? AND i.case_id=? AND e.conversation_id=?`)
      .get(input.experimentId, input.caseId, input.conversationId) as Row | undefined;
    if (!item) throw new Error('Experiment case not found in project');
    const existing = db.prepare('SELECT * FROM eval_pairwise_round WHERE experiment_id=? AND case_id=?')
      .get(input.experimentId, input.caseId) as Row | undefined;
    if (existing) return existing;
    const id = `pairwise-${randomUUID()}`;
    const blindSeed = digest({ experimentId: input.experimentId, caseId: input.caseId, nonce: randomUUID() });
    const order = Number.parseInt(blindSeed.slice(0, 2), 16) % 2 === 0
      ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO eval_pairwise_round
      (id,conversation_id,experiment_id,case_id,blind_seed,first_order,consistency_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'pending_first',?,?)`).run(
      id, input.conversationId, input.experimentId, input.caseId, blindSeed, stableJson(order), now, now);
    return this.getPairwiseRound(id, input.conversationId)!;
  },

  getPairwiseRound(id: string, conversationId: string): Row | undefined {
    const db = getDb();
    const round = db.prepare(`SELECT p.*,i.baseline_run_id,i.candidate_run_id
      FROM eval_pairwise_round p JOIN eval_experiment_item i
        ON i.experiment_id=p.experiment_id AND i.case_id=p.case_id
      WHERE p.id=? AND p.conversation_id=?`).get(id, conversationId) as Row | undefined;
    if (!round) return undefined;
    const firstOrder = decodeOrder(round.first_order);
    const activeOrder = round.consistency_status === 'pending_swap'
      ? [firstOrder[1], firstOrder[0]] as typeof firstOrder : firstOrder;
    const tokenFor = (variant: 'baseline' | 'candidate') =>
      digest({ blindSeed: round.blind_seed, variant });
    return {
      id: round.id, experiment_id: round.experiment_id, case_id: round.case_id,
      phase: round.consistency_status === 'pending_swap' ? 'swap' : 'first',
      status: round.consistency_status, resolved_winner: round.resolved_winner,
      left: { blindLabel: 'A', subjectToken: tokenFor(activeOrder[0]) },
      right: { blindLabel: 'B', subjectToken: tokenFor(activeOrder[1]) },
    };
  },

  getPairwiseSubject(id: string, conversationId: string, subjectToken: string): Row | undefined {
    const db = getDb();
    const round = db.prepare(`SELECT p.blind_seed,i.baseline_run_id,i.candidate_run_id
      FROM eval_pairwise_round p JOIN eval_experiment_item i
        ON i.experiment_id=p.experiment_id AND i.case_id=p.case_id
      WHERE p.id=? AND p.conversation_id=?`).get(id, conversationId) as Row | undefined;
    if (!round) return undefined;
    const variant = (['baseline', 'candidate'] as const).find((candidate) =>
      digest({ blindSeed: round.blind_seed, variant: candidate }) === subjectToken);
    if (!variant) return undefined;
    const runId = String(variant === 'baseline' ? round.baseline_run_id : round.candidate_run_id);
    const report = db.prepare(`SELECT r.gate_status,r.evidence_coverage,r.overall_score,
      s.evidence_payload,s.data_quality,s.task_type,s.difficulty,s.language
      FROM eval_run r JOIN eval_subject_snapshot s ON s.id=r.snapshot_id
      WHERE r.id=? AND r.conversation_id=?`).get(runId, conversationId) as Row | undefined;
    if (!report) return undefined;
    return {
      gateStatus: report.gate_status,
      evidenceCoverage: report.evidence_coverage,
      overallScore: report.overall_score,
      evidence: parse(report.evidence_payload, {}),
      dataQuality: parse(report.data_quality, {}),
      taskType: report.task_type,
      difficulty: report.difficulty,
      language: report.language,
    };
  },

  submitPairwiseDecision(input: {
    id: string; conversationId: string; judgeId: string; choice: 'left' | 'right' | 'tie';
  }): Row {
    if (!['left', 'right', 'tie'].includes(input.choice)) throw new Error('Invalid pairwise choice');
    const db = getDb();
    const round = db.prepare('SELECT * FROM eval_pairwise_round WHERE id=? AND conversation_id=?')
      .get(input.id, input.conversationId) as Row | undefined;
    if (!round) throw new Error('Pairwise round not found');
    const order = decodeOrder(round.first_order);
    const now = new Date().toISOString();
    if (round.consistency_status === 'pending_first') {
      db.prepare(`UPDATE eval_pairwise_round SET first_choice=?,first_judge_id=?,
        consistency_status='pending_swap',updated_at=? WHERE id=?`).run(input.choice, input.judgeId, now, input.id);
      return this.getPairwiseRound(input.id, input.conversationId)!;
    }
    if (round.consistency_status !== 'pending_swap') throw new Error('Pairwise round is already resolved');
    const firstWinner = actualChoice(String(round.first_choice) as typeof input.choice, order);
    const swappedWinner = actualChoice(input.choice, [order[1], order[0]]);
    const consistent = firstWinner === swappedWinner;
    const reviewId = consistent ? null : `review-${randomUUID()}`;
    db.transaction(() => {
      if (reviewId) {
        db.prepare(`INSERT INTO eval_review_queue
          (id,conversation_id,run_id,experiment_id,case_id,dimension_key,reason_code,primary_label,secondary_label,
           status,created_at,updated_at)
          VALUES (?,?,NULL,?,?,NULL,'pairwise_order_inconsistency',?,?,'pending',?,?)`).run(
          reviewId, input.conversationId, round.experiment_id, round.case_id, firstWinner, swappedWinner, now, now);
      }
      db.prepare(`UPDATE eval_pairwise_round SET swapped_choice=?,swapped_judge_id=?,resolved_winner=?,
        consistency_status=?,review_queue_id=?,updated_at=? WHERE id=?`).run(
        input.choice, input.judgeId, consistent ? firstWinner : null,
        consistent ? 'consistent' : 'needs_review', reviewId, now, input.id);
    })();
    return this.getPairwiseRound(input.id, input.conversationId)!;
  },

  listReviewQueue(conversationId: string, status = 'pending'): Row[] {
    return (getDb().prepare(`SELECT q.*,r.overall_score,r.gate_status,e.name experiment_name,c.case_key
      FROM eval_review_queue q
      LEFT JOIN eval_run r ON r.id=q.run_id
      LEFT JOIN eval_experiment e ON e.id=q.experiment_id
      LEFT JOIN eval_case c ON c.id=q.case_id
      WHERE q.conversation_id=? AND (?='all' OR q.status=?)
      ORDER BY q.created_at DESC`).all(conversationId, status, status) as Row[])
      .map((item) => ({
        ...item,
        request_payload: parse(item.request_payload, {}),
        resolution: parse(item.resolution, null),
      }));
  },

  requestCasePromotion(input: {
    conversationId: string; runId: string; datasetId: string; caseKey: string;
    split: 'train' | 'tune';
  }): Row {
    if (!['train', 'tune'].includes(input.split)) {
      throw new Error('Online cases may only enter train or tune; held_out is curated separately');
    }
    const db = getDb();
    const run = db.prepare(`SELECT r.id FROM eval_run r
      WHERE r.id=? AND r.conversation_id=? AND r.mode='online'
        AND (r.status IN ('partial','failed') OR r.gate_status='fail')`)
      .get(input.runId, input.conversationId);
    if (!run) throw new Error('Eligible online failure run not found in project');
    const dataset = db.prepare(`SELECT id FROM eval_dataset
      WHERE id=? AND conversation_id=? AND status='active'`).get(input.datasetId, input.conversationId);
    if (!dataset) throw new Error('Active target dataset not found in project');
    const existing = db.prepare(`SELECT * FROM eval_review_queue
      WHERE conversation_id=? AND run_id=? AND reason_code='case_promotion' AND status='pending'
      ORDER BY created_at DESC LIMIT 1`).get(input.conversationId, input.runId) as Row | undefined;
    if (existing) return existing;
    const id = `review-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO eval_review_queue
      (id,conversation_id,run_id,experiment_id,case_id,dimension_key,reason_code,status,request_payload,created_at,updated_at)
      VALUES (?,?,?,NULL,NULL,NULL,'case_promotion','pending',?,?,?)`).run(
      id, input.conversationId, input.runId,
      stableJson({ datasetId: input.datasetId, caseKey: input.caseKey, split: input.split }), now, now);
    return db.prepare('SELECT * FROM eval_review_queue WHERE id=?').get(id) as Row;
  },

  reviewCasePromotion(input: {
    id: string; conversationId: string; reviewerId: string; approved: boolean; rationale: string;
  }): Row {
    const db = getDb();
    const review = db.prepare(`SELECT * FROM eval_review_queue
      WHERE id=? AND conversation_id=? AND reason_code='case_promotion' AND status='pending'`)
      .get(input.id, input.conversationId) as Row | undefined;
    if (!review) throw new Error('Pending case-promotion review not found');
    const request = parse(review.request_payload, {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    let promotedCaseId: string | undefined;
    db.transaction(() => {
      if (input.approved) {
        const source = db.prepare(`SELECT r.id run_id,r.snapshot_id,s.evidence_refs,s.evidence_payload,
          s.task_type,s.difficulty,s.language,s.app_manifest,s.data_quality FROM eval_run r
          JOIN eval_subject_snapshot s ON s.id=r.snapshot_id
          WHERE r.id=? AND r.conversation_id=? AND r.mode='online'
            AND (r.status IN ('partial','failed') OR r.gate_status='fail')`)
          .get(review.run_id, input.conversationId) as Row | undefined;
        if (!source) throw new Error('Source run is no longer eligible for promotion');
        const sourceDatasetId = String(request.datasetId ?? '');
        const sourceDataset = db.prepare(`SELECT * FROM eval_dataset
          WHERE id=? AND conversation_id=? AND status='active'`)
          .get(sourceDatasetId, input.conversationId) as Row | undefined;
        if (!sourceDataset) throw new Error('Target dataset is no longer active');
        const split = String(request.split);
        if (!['train', 'tune'].includes(split)) throw new Error('Invalid promotion split');
        const datasetId = `dataset-${randomUUID()}`;
        const revision = Number(sourceDataset.revision) + 1;
        db.prepare(`INSERT INTO eval_dataset
          (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,'active',?,?,?)`).run(
          datasetId, input.conversationId, sourceDataset.name, sourceDataset.description,
          revision, input.reviewerId, now, now);
        const sourceCases = db.prepare('SELECT * FROM eval_case WHERE dataset_id=? ORDER BY created_at')
          .all(sourceDatasetId) as Row[];
        const copyCase = db.prepare(`INSERT INTO eval_case
          (id,dataset_id,case_key,split,source_type,source_ref,input_payload,expected_labels,metadata,
           content_hash,redaction_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const item of sourceCases) {
          copyCase.run(`case-${randomUUID()}`, datasetId, item.case_key, item.split, item.source_type,
            item.source_ref ?? null, item.input_payload, item.expected_labels, item.metadata,
            item.content_hash, item.redaction_status, item.created_at);
        }
        db.prepare(`UPDATE eval_dataset SET status='superseded',updated_at=? WHERE id=?`).run(now, sourceDatasetId);
        promotedCaseId = `case-${randomUUID()}`;
        const evidenceRefs = parse(source.evidence_refs, []);
        const payload = stableJson({
          sourceRunId: source.run_id,
          snapshotId: source.snapshot_id,
          evidenceRefs,
          evidence: parse(source.evidence_payload, {}),
          dataQuality: parse(source.data_quality, {}),
        });
        const labels = Object.fromEntries((db.prepare(`SELECT dimension_key,label,normalized_score
          FROM eval_score WHERE run_id=?`).all(review.run_id) as Row[])
          .map((score) => [String(score.dimension_key), {
            label: score.label, normalizedScore: score.normalized_score,
          }]));
        db.prepare(`INSERT INTO eval_case
          (id,dataset_id,case_key,split,source_type,source_ref,input_payload,expected_labels,metadata,
           content_hash,redaction_status,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          promotedCaseId, datasetId, String(request.caseKey), split, 'online_failure', review.run_id,
          payload, stableJson(labels), stableJson({
            taskType: source.task_type, difficulty: source.difficulty, language: source.language,
            applicationManifest: parse(source.app_manifest, {}), promotionReviewId: review.id,
          }), digest(payload), 'redacted_reviewed', now);
      }
      db.prepare(`UPDATE eval_review_queue SET status='resolved',resolution=?,resolved_by=?,resolved_at=?,updated_at=?
        WHERE id=? AND status='pending'`).run(stableJson({
          approved: input.approved, rationale: input.rationale, promotedCaseId,
        }), input.reviewerId, now, now, input.id);
    })();
    return db.prepare('SELECT * FROM eval_review_queue WHERE id=?').get(input.id) as Row;
  },

  resolveReview(input: { id: string; conversationId: string; reviewerId: string; resolution: unknown }): Row {
    const db = getDb();
    const current = db.prepare('SELECT * FROM eval_review_queue WHERE id=? AND conversation_id=?')
      .get(input.id, input.conversationId) as Row | undefined;
    if (!current) throw new Error('Review item not found');
    if (current.status !== 'pending') throw new Error('Review item is already resolved');
    const resolution = input.resolution as Record<string, unknown> | null;
    const now = new Date().toISOString();
    db.transaction(() => {
      if (current.reason_code === 'pairwise_order_inconsistency') {
        const winner = String(resolution?.winner ?? '');
        if (!['baseline', 'candidate', 'tie'].includes(winner)) {
          throw new Error('Pairwise review resolution requires winner=baseline, candidate, or tie');
        }
        db.prepare(`UPDATE eval_pairwise_round SET resolved_winner=?,consistency_status='human_resolved',
          updated_at=? WHERE review_queue_id=?`).run(winner, now, current.id);
      }
      if (current.reason_code === 'judge_disagreement' || current.reason_code === 'secondary_judge_unavailable') {
        if (!resolution || !['pass', 'partial', 'fail', 'unknown'].includes(String(resolution.label)) ||
          typeof resolution.rationale !== 'string' || !resolution.rationale.trim()) {
          throw new Error('Judge review resolution requires label and rationale');
        }
      }
      db.prepare(`UPDATE eval_review_queue SET status='resolved',resolution=?,resolved_by=?,resolved_at=?,updated_at=?
        WHERE id=? AND status='pending'`).run(stableJson(input.resolution), input.reviewerId, now, now, input.id);
    })();
    return db.prepare('SELECT * FROM eval_review_queue WHERE id=?').get(input.id) as Row;
  },

  createProposal(input: {
    conversationId: string; gapId: string; targetType: string; targetRef?: string;
    hypothesis: string; proposedChange: string; risk: string; ownerId?: string;
  }): Row {
    const db = getDb();
    const gap = db.prepare(`SELECT g.id FROM eval_gap g JOIN eval_run r ON r.id=g.run_id
      WHERE g.id=? AND r.conversation_id=?`).get(input.gapId, input.conversationId);
    if (!gap) throw new Error('Gap not found in project');
    const id = `proposal-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO eval_change_proposal
      (id,conversation_id,gap_id,target_type,target_ref,hypothesis,proposed_change,risk,owner_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(id, input.conversationId, input.gapId, input.targetType,
        input.targetRef ?? null, input.hypothesis, input.proposedChange, input.risk, input.ownerId ?? 'project-admin', now, now);
    return db.prepare('SELECT * FROM eval_change_proposal WHERE id=?').get(id) as Row;
  },

  listProposals(conversationId: string): Row[] {
    return (getDb().prepare(`SELECT p.*,g.dimension_key,g.severity FROM eval_change_proposal p
      LEFT JOIN eval_gap g ON g.id=p.gap_id
      WHERE p.conversation_id=? ORDER BY p.updated_at DESC`).all(conversationId) as Row[])
      .map((proposal) => ({
        ...proposal,
        apply_evidence: parse(proposal.apply_evidence, null),
        revert_evidence: parse(proposal.revert_evidence, null),
      }));
  },

  transitionProposal(input: {
    id: string; conversationId: string; action: 'submit' | 'approve' | 'apply' | 'revert';
    actorId: string; regressionExperimentId?: string; evidence?: unknown;
  }): Row {
    const db = getDb();
    const current = db.prepare('SELECT * FROM eval_change_proposal WHERE id=? AND conversation_id=?')
      .get(input.id, input.conversationId) as Row | undefined;
    if (!current) throw new Error('Proposal not found');
    const transitions: Record<string, Record<string, string>> = {
      draft: { submit: 'in_review' }, in_review: { approve: 'approved' },
      approved: { apply: 'applied' }, applied: { revert: 'reverted' },
    };
    const next = transitions[String(current.status)]?.[input.action];
    if (!next) throw new Error('Invalid proposal transition');
    if ((input.action === 'approve' || input.action === 'apply') && !input.regressionExperimentId && !current.regression_experiment_id) {
      throw new Error('Held-out regression experiment is required');
    }
    if (input.regressionExperimentId) {
      const experiment = db.prepare(`SELECT summary FROM eval_experiment WHERE id=? AND conversation_id=? AND status='completed'`)
        .get(input.regressionExperimentId, input.conversationId) as Row | undefined;
      if (!experiment) throw new Error('Completed regression experiment not found');
      const summary = parse(experiment.summary, {}) as Record<string, unknown>;
      if (summary.conclusion !== 'candidate_improves') {
        throw new Error(`Regression gate requires candidate_improves, received ${String(summary.conclusion)}`);
      }
    }
    const experimentId = input.regressionExperimentId ?? (current.regression_experiment_id as string | undefined);
    if ((input.action === 'approve' || input.action === 'apply') && experimentId) {
      const experiment = db.prepare(`SELECT summary FROM eval_experiment
        WHERE id=? AND conversation_id=? AND status='completed'`)
        .get(experimentId, input.conversationId) as Row | undefined;
      const summary = parse(experiment?.summary, {}) as Record<string, unknown>;
      if (!experiment || summary.conclusion !== 'candidate_improves') {
        throw new Error('Regression gate requires a completed candidate_improves experiment');
      }
      const integrity = db.prepare(`SELECT
          COUNT(*) item_count,
          SUM(CASE WHEN i.execution_verified=1 THEN 1 ELSE 0 END) verified_count,
          SUM(CASE WHEN p.consistency_status IN ('consistent','human_resolved') THEN 1 ELSE 0 END) resolved_count,
          SUM(CASE WHEN p.consistency_status IN ('consistent','human_resolved')
            AND p.resolved_winner IN ('candidate','tie') THEN 1 ELSE 0 END) acceptable_count
        FROM eval_experiment_item i
        LEFT JOIN eval_pairwise_round p ON p.experiment_id=i.experiment_id AND p.case_id=i.case_id
        WHERE i.experiment_id=?`).get(experimentId) as {
          item_count: number; verified_count: number; resolved_count: number; acceptable_count: number;
        };
      const itemCount = Number(integrity.item_count);
      if (!itemCount || Number(integrity.verified_count) !== itemCount) {
        throw new Error('Regression experiment is diagnostic-only until case execution provenance is verified');
      }
      if (Number(integrity.resolved_count) !== itemCount) {
        throw new Error('Every regression case requires a consistent or human-resolved blind pairwise decision');
      }
      if (Number(integrity.acceptable_count) !== itemCount) {
        throw new Error('Regression gate rejects any blind pairwise case resolved in favor of the baseline');
      }
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE eval_change_proposal SET status=?,approval_by=CASE WHEN ?='approved' THEN ? ELSE approval_by END,
      approved_at=CASE WHEN ?='approved' THEN ? ELSE approved_at END,
      regression_experiment_id=COALESCE(?,regression_experiment_id),
      apply_evidence=CASE WHEN ?='applied' THEN ? ELSE apply_evidence END,
      revert_evidence=CASE WHEN ?='reverted' THEN ? ELSE revert_evidence END,updated_at=? WHERE id=?`).run(
      next, next, input.actorId, next, now, input.regressionExperimentId ?? null,
      next, input.evidence ? stableJson(input.evidence) : null,
      next, input.evidence ? stableJson(input.evidence) : null, now, input.id);
    return db.prepare('SELECT * FROM eval_change_proposal WHERE id=?').get(input.id) as Row;
  },
};
