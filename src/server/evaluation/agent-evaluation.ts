import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import {
  DEFAULT_RUBRIC,
  DEFAULT_RUBRIC_REVISION_ID,
  EVALUATION_JOB_MAX_ATTEMPTS,
  EVALUATION_RETRY_BACKOFF_MS,
  EVALUATOR_BUNDLE_REVISION,
  digest,
  stableJson,
} from './defaults';
import { evaluateDeterministically } from './deterministic-evaluator';
import { AccountJudgeAdapter, type JudgePort, type JudgeResult } from './judge';
import { assertOfflineEvaluationProvenance, buildSubjectSnapshot } from './snapshot-builder';
import type { EvaluationReport, EvaluationRequest, EvaluationScore, SubjectSnapshot } from './types';
import { proofLogRepo } from '../repositories/proof-log-repo';

type Row = Record<string, unknown>;
const WEIGHTS = new Map<string, number>(DEFAULT_RUBRIC.dimensions.map((dimension) => [dimension.key, dimension.weight]));

function json(value: unknown): string { return stableJson(value); }
function parse(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function hydrate(row: Row): Row {
  const result = { ...row };
  for (const key of ['definition', 'evidence_refs', 'evidence_payload', 'app_manifest', 'data_quality',
    'request_params', 'response_payload', 'summary', 'details']) {
    if (key in result) result[key] = parse(result[key], key.endsWith('refs') ? [] : {});
  }
  return result;
}

function appendEvaluationProof(input: {
  eventType: string; conversationId: string; runId: string; rootTaskId?: string; chainId?: string;
  reasonCode?: string; metadata?: Record<string, unknown>;
}): void {
  try {
    proofLogRepo.append({
      eventType: input.eventType,
      conversationId: input.conversationId,
      taskId: input.rootTaskId,
      chainId: input.chainId,
      reasonCode: input.reasonCode,
      metadata: { runId: input.runId, ...(input.metadata ?? {}) },
    });
  } catch (error) {
    console.warn(`[evaluation] proof append failed for ${input.runId}:`, error);
  }
}

function persistSnapshot(snapshot: SubjectSnapshot): string {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM eval_subject_snapshot WHERE snapshot_hash=?').get(snapshot.snapshotHash) as { id: string } | undefined;
  if (existing) return existing.id;
  db.prepare(`INSERT INTO eval_subject_snapshot
    (id,conversation_id,root_task_id,chain_id,mode,evidence_cutoff_at,collected_at,snapshot_hash,
     evidence_refs,evidence_payload,app_manifest,data_quality,task_type,difficulty,language)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    snapshot.id, snapshot.conversationId, snapshot.rootTaskId ?? null, snapshot.chainId ?? null, snapshot.mode,
    snapshot.evidenceCutoffAt, snapshot.collectedAt, snapshot.snapshotHash, json(snapshot.evidenceRefs),
    json(snapshot.evidence), json(snapshot.appManifest), json(snapshot.dataQuality), snapshot.taskType,
    snapshot.difficulty, snapshot.language,
  );
  return snapshot.id;
}

function loadSnapshot(snapshotId: string, conversationId: string): SubjectSnapshot {
  const row = getDb().prepare('SELECT * FROM eval_subject_snapshot WHERE id=? AND conversation_id=?')
    .get(snapshotId, conversationId) as Row | undefined;
  if (!row) throw new Error('Frozen evaluation snapshot not found');
  return {
    id: String(row.id), conversationId: String(row.conversation_id),
    rootTaskId: row.root_task_id ? String(row.root_task_id) : undefined,
    chainId: row.chain_id ? String(row.chain_id) : undefined,
    mode: String(row.mode) as SubjectSnapshot['mode'],
    evidenceCutoffAt: String(row.evidence_cutoff_at), collectedAt: String(row.collected_at),
    snapshotHash: String(row.snapshot_hash),
    evidenceRefs: parse(row.evidence_refs, []) as SubjectSnapshot['evidenceRefs'],
    evidence: parse(row.evidence_payload, {}) as Record<string, unknown>,
    appManifest: parse(row.app_manifest, {}) as Record<string, unknown>,
    dataQuality: parse(row.data_quality, { coverage: 0, missing: [], truncated: [] }) as SubjectSnapshot['dataQuality'],
    taskType: String(row.task_type), difficulty: String(row.difficulty), language: String(row.language),
  };
}

function findReusableSnapshot(request: EvaluationRequest): SubjectSnapshot | undefined {
  if (!request.evidenceCutoffAt) return undefined;
  const candidates = getDb().prepare(`SELECT id,app_manifest FROM eval_subject_snapshot
    WHERE conversation_id=? AND root_task_id IS ? AND chain_id IS ? AND mode=?
      AND evidence_cutoff_at=? AND task_type=? AND difficulty=? AND language=?
    ORDER BY collected_at ASC`).all(
    request.conversationId, request.rootTaskId ?? null, request.chainId ?? null, request.mode ?? 'online',
    request.evidenceCutoffAt, request.taskType ?? 'unknown', request.difficulty ?? 'unknown',
    request.language ?? 'unknown',
  ) as Array<{ id: string; app_manifest: string }>;
  const expectedVariant = digest(request.applicationManifest ?? null);
  const match = candidates.find((candidate) => {
    const manifest = parse(candidate.app_manifest, {}) as Record<string, unknown>;
    return String(manifest.evaluationCaseId ?? '') === String(request.caseId ?? '') &&
      digest(manifest.applicationVariant ?? null) === expectedVariant &&
      manifest.rubricRevisionId === DEFAULT_RUBRIC_REVISION_ID &&
      manifest.evaluatorBundleDigest === digest(EVALUATOR_BUNDLE_REVISION);
  });
  return match ? loadSnapshot(match.id, request.conversationId) : undefined;
}

function persistScores(runId: string, scores: EvaluationScore[]): void {
  const insert = getDb().prepare(`INSERT INTO eval_score
    (id,run_id,dimension_key,evaluator_kind,evaluator_revision,applicability,raw_score,
     normalized_score,label,rationale,evidence_refs,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  for (const item of scores) {
    insert.run(`score-${runId}-${item.evaluatorKind}-${item.dimensionKey}`, runId, item.dimensionKey,
      item.evaluatorKind, item.evaluatorRevision, item.applicability, item.normalizedScore ?? null,
      item.normalizedScore ?? null, item.label, item.rationale, json(item.evidenceRefs), now);
  }
}

function total(scores: EvaluationScore[]): { overall?: number; gateStatus: string } {
  const gates = scores.filter((item) => item.evaluatorKind === 'gate' && item.applicability !== 'not_applicable');
  const gateStatus = gates.some((item) => item.label === 'fail') ? 'fail'
    : gates.some((item) => item.label === 'unknown') ? 'unknown'
      : gates.some((item) => item.label === 'partial') ? 'partial' : 'pass';
  const dimensions = scores.filter((item) => WEIGHTS.has(item.dimensionKey) &&
    item.applicability === 'applicable' && item.normalizedScore !== undefined);
  const denominator = dimensions.reduce((sum, item) => sum + (WEIGHTS.get(item.dimensionKey) ?? 0), 0);
  if (denominator === 0) return { gateStatus };
  let overall = dimensions.reduce((sum, item) =>
    sum + (item.normalizedScore ?? 0) * (WEIGHTS.get(item.dimensionKey) ?? 0), 0) / denominator;
  if (gateStatus === 'fail') overall = Math.min(overall, DEFAULT_RUBRIC.rules.failedGateCapsScoreAt);
  return { overall: Math.round(overall * 10) / 10, gateStatus };
}

function createGaps(runId: string, scores: EvaluationScore[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO eval_gap
    (id,run_id,dimension_key,severity,description,suggestion,target_type,target_ref,status,evidence_refs,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const item of scores.filter((score) => score.label === 'fail' || score.label === 'partial')) {
    insert.run(`gap-${runId}-${item.dimensionKey}`, runId, item.dimensionKey,
      item.label === 'fail' ? 'high' : 'medium', item.rationale,
      item.evaluatorKind === 'gate' ? '先补齐硬门禁证据，再比较总分。' : '将该维度加入固定数据集并验证改动。',
      item.dimensionKey.includes('handoff') ? 'workflow' : 'agent', null, 'open', json(item.evidenceRefs), now, now);
  }
}

function needsSecondJudge(score: EvaluationScore): boolean {
  return score.evaluatorKind === 'judge' &&
    (score.label === 'partial' || score.label === 'unknown' ||
      score.normalizedScore === 100 / 3 || score.normalizedScore === 200 / 3);
}

type JudgeDisagreement = {
  dimensionKey: string;
  reasonCode: 'judge_disagreement' | 'secondary_judge_unavailable';
  primaryLabel: string;
  secondaryLabel?: string;
};

function reconcileJudgeScores(
  primary: EvaluationScore[],
  secondary: EvaluationScore[],
  secondaryAvailable: boolean,
): { scores: EvaluationScore[]; disagreements: JudgeDisagreement[] } {
  const secondaryByDimension = new Map(secondary.map((score) => [score.dimensionKey, score]));
  const disagreements: JudgeDisagreement[] = [];
  const scores = primary.map((score): EvaluationScore => {
    if (!needsSecondJudge(score)) return score;
    const other = secondaryByDimension.get(score.dimensionKey);
    const agrees = other && other.label === score.label &&
      other.applicability === score.applicability &&
      other.normalizedScore === score.normalizedScore;
    if (agrees) {
      return {
        ...score,
        evaluatorRevision: 'judge-v1-dual-consensus',
        rationale: `${score.rationale} Secondary Judge independently agreed.`,
        evidenceRefs: [...new Map([...score.evidenceRefs, ...other.evidenceRefs]
          .map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()],
      };
    }
    disagreements.push({
      dimensionKey: score.dimensionKey,
      reasonCode: secondaryAvailable ? 'judge_disagreement' : 'secondary_judge_unavailable',
      primaryLabel: score.label,
      secondaryLabel: other?.label,
    });
    return {
      ...score,
      evaluatorRevision: 'judge-v1-review-required',
      applicability: 'unknown',
      normalizedScore: undefined,
      label: 'unknown',
      rationale: secondaryAvailable
        ? `Judge disagreement requires human review. Primary: ${score.label}; secondary: ${other?.label ?? 'missing'}.`
        : `Boundary judgment requires a configured secondary Judge. Primary: ${score.label}.`,
      evidenceRefs: [...new Map([...score.evidenceRefs, ...(other?.evidenceRefs ?? [])]
        .map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()],
    };
  });
  return { scores, disagreements };
}

function persistJudgeAttempt(runId: string, judged: JudgeResult, now: string): void {
  getDb().prepare(`INSERT INTO eval_judge_attempt
    (id,run_id,score_id,dimension_key,judge_account_id,provider,model,prompt_digest,request_params,
     response_payload,parse_status,prompt_tokens,completion_tokens,latency_ms,error_code,error_message,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `judge-${randomUUID()}`, runId, null, 'judge_bundle', judged.attempt.accountId ?? null,
    judged.attempt.provider ?? null, judged.attempt.model ?? null, judged.attempt.promptDigest,
    json(judged.attempt.requestParams), judged.attempt.responsePayload ? json(judged.attempt.responsePayload) : null,
    judged.attempt.parseStatus, judged.attempt.promptTokens ?? null, judged.attempt.completionTokens ?? null,
    judged.attempt.latencyMs, judged.attempt.errorCode ?? null, judged.attempt.errorMessage ?? null, now);
}

function persistReviewQueue(
  conversationId: string,
  runId: string,
  disagreements: JudgeDisagreement[],
  now: string,
): void {
  const insert = getDb().prepare(`INSERT OR IGNORE INTO eval_review_queue
    (id,conversation_id,run_id,experiment_id,case_id,dimension_key,reason_code,primary_label,secondary_label,
     status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`);
  for (const item of disagreements) {
    insert.run(`review-${randomUUID()}`, conversationId, runId, null, null, item.dimensionKey,
      item.reasonCode, item.primaryLabel, item.secondaryLabel ?? null, now, now);
  }
}

export class AgentEvaluation {
  constructor(private readonly judge: JudgePort = new AccountJudgeAdapter()) {}

  shouldEvaluateClosure(conversationId: string, triggerId: string): { allowed: boolean; reason?: string } {
    const policy = getDb().prepare('SELECT enabled,sampling_rate FROM eval_policy WHERE conversation_id=?')
      .get(conversationId) as { enabled: number; sampling_rate: number } | undefined;
    if (policy?.enabled === 0) return { allowed: false, reason: 'evaluation_disabled' };
    const samplingRate = Math.max(0, Math.min(1, policy?.sampling_rate ?? 1));
    const bucket = Number.parseInt(digest(triggerId).slice(0, 8), 16) / 0xffffffff;
    return bucket <= samplingRate ? { allowed: true } : { allowed: false, reason: 'sampling_skipped' };
  }

  submit(request: EvaluationRequest): { runId: string; status: string; duplicate: boolean } {
    const db = getDb();
    const conversation = db.prepare('SELECT id FROM conversation WHERE id=?').get(request.conversationId);
    if (!conversation) throw new Error('Conversation not found');
    if (request.caseId && !db.prepare(`SELECT c.id FROM eval_case c JOIN eval_dataset d ON d.id=c.dataset_id
      WHERE c.id=? AND (d.conversation_id=? OR d.conversation_id IS NULL)`).get(request.caseId, request.conversationId)) {
      throw new Error('Evaluation case not found in project');
    }
    const mode = request.mode ?? 'online';
    if (mode === 'online' && !request.rootTaskId?.trim()) {
      throw new Error('evaluation_root_task_required');
    }
    if (mode === 'replay' && !request.sourceSnapshotId?.trim()) {
      throw new Error('evaluation_replay_source_required');
    }
    const requestedCutoff = request.evidenceCutoffAt;
    const cutoff = requestedCutoff ?? new Date().toISOString();
    const normalized = { ...request, mode, evidenceCutoffAt: cutoff };
    // Validate before idempotency lookup or snapshot reuse so an offline call
    // can never inherit a legacy snapshot without verified execution evidence.
    assertOfflineEvaluationProvenance(normalized);
    const key = digest({ conversationId: request.conversationId, rootTaskId: request.rootTaskId ?? null,
      chainId: request.chainId ?? null, triggerId: request.triggerId ?? requestedCutoff ?? cutoff, mode,
      caseId: request.caseId ?? null,
      applicationManifestDigest: request.applicationManifest ? digest(request.applicationManifest) : null,
      rubric: DEFAULT_RUBRIC_REVISION_ID, bundle: EVALUATOR_BUNDLE_REVISION });
    const existing = db.prepare('SELECT id,status FROM eval_run WHERE idempotency_key=?').get(key) as { id: string; status: string } | undefined;
    if (existing) return { runId: existing.id, status: existing.status, duplicate: true };
    const now = new Date().toISOString();
    const runId = `eval-${randomUUID()}`;
    const transaction = db.transaction(() => {
      const frozen = request.sourceSnapshotId
        ? loadSnapshot(request.sourceSnapshotId, request.conversationId)
        : findReusableSnapshot(normalized) ?? buildSubjectSnapshot(normalized);
      const snapshotId = persistSnapshot(frozen);
      db.prepare(`INSERT INTO eval_run
        (id,conversation_id,snapshot_id,rubric_revision_id,mode,idempotency_key,status,evaluator_bundle_digest,
         case_id,application_manifest_digest,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId, request.conversationId, snapshotId, DEFAULT_RUBRIC_REVISION_ID,
          mode, key, 'queued', digest(EVALUATOR_BUNDLE_REVISION), request.caseId ?? null,
          request.applicationManifest ? digest(request.applicationManifest) : null, now, now);
      db.prepare(`INSERT INTO eval_job
        (id,run_id,request_payload,status,attempt_count,max_attempts,next_attempt_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          `job-${randomUUID()}`,
          runId,
          json(normalized),
          'queued',
          0,
          EVALUATION_JOB_MAX_ATTEMPTS,
          now,
          now,
          now,
        );
    });
    try {
      transaction();
    } catch (error) {
      const raced = db.prepare('SELECT id,status FROM eval_run WHERE idempotency_key=?').get(key) as { id: string; status: string } | undefined;
      if (raced) return { runId: raced.id, status: raced.status, duplicate: true };
      throw error;
    }
    appendEvaluationProof({
      eventType: 'eval.queued', conversationId: request.conversationId, runId,
      rootTaskId: request.rootTaskId, chainId: request.chainId,
      metadata: { mode, idempotencyKey: key },
    });
    return { runId, status: 'queued', duplicate: false };
  }

  async processPending(limit = 5): Promise<number> {
    let processed = 0;
    for (; processed < limit; processed += 1) {
      const job = this.claimJob();
      if (!job) break;
      await this.processJob(job);
    }
    return processed;
  }

  private claimJob(): Row | undefined {
    const db = getDb();
    const now = new Date().toISOString();
    const lease = new Date(Date.now() + 180_000).toISOString();
    const leaseToken = randomUUID();
    const claimed: Row | undefined = db.transaction((): Row | undefined => {
      const job = db.prepare(`SELECT j.* FROM eval_job j
        JOIN eval_run r ON r.id=j.run_id
        LEFT JOIN eval_policy p ON p.conversation_id=r.conversation_id
        WHERE ((j.status='queued' AND j.next_attempt_at<=?) OR (j.status='running' AND j.lease_until<?))
        AND j.attempt_count<j.max_attempts
        AND (SELECT COUNT(*) FROM eval_job active_job
          JOIN eval_run active_run ON active_run.id=active_job.run_id
          WHERE active_run.conversation_id=r.conversation_id
            AND active_job.status='running' AND active_job.lease_until>?)
          < COALESCE(p.max_concurrency,2)
        ORDER BY j.created_at LIMIT 1`).get(now, now, now) as Row | undefined;
      if (!job) return undefined;
      const changed = db.prepare(`UPDATE eval_job SET status='running',attempt_count=attempt_count+1,
        lease_until=?,lease_token=?,updated_at=? WHERE id=? AND
        ((status='queued' AND next_attempt_at<=?) OR (status='running' AND lease_until<?))`)
        .run(lease, leaseToken, now, job.id, now, now).changes;
      if (changed !== 1) return undefined;
      db.prepare(`UPDATE eval_run SET status='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?`)
        .run(now, now, job.run_id);
      return { ...job, attempt_count: Number(job.attempt_count) + 1, lease_token: leaseToken };
    })();
    if (claimed) {
      const request = parse(claimed.request_payload, {}) as EvaluationRequest;
      appendEvaluationProof({
        eventType: 'eval.started', conversationId: request.conversationId, runId: String(claimed.run_id),
        rootTaskId: request.rootTaskId, chainId: request.chainId,
      });
    }
    return claimed;
  }

  private async processJob(job: Row): Promise<void> {
    const db = getDb();
    const request = parse(job.request_payload, {}) as EvaluationRequest;
    const reservationIds: string[] = [];
    try {
      const run = db.prepare('SELECT snapshot_id FROM eval_run WHERE id=? AND conversation_id=?')
        .get(job.run_id, request.conversationId) as { snapshot_id: string } | undefined;
      if (!run?.snapshot_id) throw new Error('Evaluation run has no frozen snapshot');
      const snapshot = loadSnapshot(run.snapshot_id, request.conversationId);
      const snapshotId = run.snapshot_id;
      const policy = db.prepare('SELECT * FROM eval_policy WHERE conversation_id=?').get(request.conversationId) as Row | undefined;
      const allowed = parse(policy?.allowed_providers, ['openai', 'anthropic']) as string[];
      const deterministic = evaluateDeterministically(snapshot);
      const usedToday = db.prepare(`SELECT COALESCE(SUM(COALESCE(a.prompt_tokens,0)+COALESCE(a.completion_tokens,0)),0) used
        FROM eval_judge_attempt a JOIN eval_run r ON r.id=a.run_id
        WHERE r.conversation_id=? AND a.created_at>=?`).get(
        request.conversationId, new Date(new Date().setHours(0, 0, 0, 0)).toISOString()) as { used: number };
      const budget = Number(policy?.daily_token_budget ?? 50_000);
      const estimatedTokens = Math.max(
        4_000,
        Math.min(24_000, stableJson(snapshot.evidence).length) + 2_500,
      );
      const primaryReservation = Number(policy?.enabled ?? 1) === 0
        ? undefined
        : this.reserveJudgeBudget(
          request.conversationId, String(job.run_id), 'primary', budget, estimatedTokens,
        );
      if (primaryReservation) reservationIds.push(primaryReservation);
      const judged = Number(policy?.enabled ?? 1) === 0
        ? { scores: [], attempt: { promptDigest: digest('policy-disabled'), requestParams: {}, parseStatus: 'skipped',
            latencyMs: 0, errorCode: 'evaluation_disabled', errorMessage: '项目已关闭模型评估。' } }
        : !primaryReservation
          ? { scores: [], attempt: { promptDigest: digest('budget-exhausted'), requestParams: { budget, used: usedToday.used },
              parseStatus: 'skipped', latencyMs: 0, errorCode: 'budget_exhausted',
              errorMessage: '今日模型评估预算已用尽，保留确定性结果。' } }
          : await (async () => {
            this.renewLease(job);
            return this.judge.evaluate(snapshot, policy?.judge_account_id as string | undefined, allowed);
          })();
      const boundary = judged.scores.some(needsSecondJudge);
      const secondaryAccountId = policy?.secondary_judge_account_id as string | undefined;
      const secondaryReservation = boundary && secondaryAccountId && secondaryAccountId !== judged.attempt.accountId
        ? this.reserveJudgeBudget(
          request.conversationId, String(job.run_id), 'secondary', budget, estimatedTokens,
        )
        : undefined;
      if (secondaryReservation) reservationIds.push(secondaryReservation);
      const secondary = secondaryReservation
        ? await (async () => {
            this.renewLease(job);
            return this.judge.evaluate(snapshot, secondaryAccountId, allowed);
          })()
        : undefined;
      const reconciled = reconcileJudgeScores(judged.scores, secondary?.scores ?? [], Boolean(secondary?.scores.length));
      const judgeScores = boundary ? reconciled.scores : judged.scores;
      const judgeAttempts = secondary ? [judged, secondary] : [judged];
      const scores = [...deterministic, ...judgeScores];
      const aggregate = total(scores);
      const status = judgeScores.length === 0 || reconciled.disagreements.length > 0 || snapshot.dataQuality.coverage < 1 ||
        aggregate.gateStatus === 'unknown' ||
        judgeScores.some((item) => item.applicability === 'unknown') ? 'partial' : 'completed';
      const now = new Date().toISOString();
      const completion = db.transaction(() => {
        const ownsLease = db.prepare(`SELECT id FROM eval_job
          WHERE id=? AND status='running' AND lease_token=?`).get(job.id, job.lease_token);
        if (!ownsLease) return 'stale';
        for (const attempt of judgeAttempts) persistJudgeAttempt(String(job.run_id), attempt, now);
        this.releaseBudgetReservations(reservationIds);
        if (judged.attempt.errorCode === 'judge_request_failed' &&
          Number(job.attempt_count) < Number(job.max_attempts)) {
          db.prepare(`UPDATE eval_job SET status='queued',lease_until=NULL,lease_token=NULL,next_attempt_at=?,
            last_error=?,updated_at=? WHERE id=? AND lease_token=?`).run(
            new Date(Date.now() + Number(job.attempt_count) * EVALUATION_RETRY_BACKOFF_MS).toISOString(),
            judged.attempt.errorMessage ?? 'Judge request failed', now, job.id, job.lease_token);
          db.prepare(`UPDATE eval_run SET status='queued',error_code='judge_request_failed',
            error_message=?,updated_at=? WHERE id=?`).run(judged.attempt.errorMessage ?? 'Judge request failed', now, job.run_id);
          return 'retry';
        }
        persistScores(String(job.run_id), scores);
        createGaps(String(job.run_id), scores);
        persistReviewQueue(request.conversationId, String(job.run_id), reconciled.disagreements, now);
        const errorCode = reconciled.disagreements.length
          ? 'human_review_required'
          : judgeScores.length ? null : judged.attempt.errorCode ?? 'judge_unavailable';
        const errorMessage = reconciled.disagreements.length
          ? 'Judge disagreement or missing secondary Judge requires human review.'
          : judgeScores.length ? null : judged.attempt.errorMessage ?? 'Judge unavailable; deterministic results were retained.';
        db.prepare(`UPDATE eval_run SET snapshot_id=?,status=?,gate_status=?,evidence_coverage=?,
          overall_score=?,completed_at=?,updated_at=?,error_code=?,error_message=? WHERE id=?`).run(
          snapshotId, status, aggregate.gateStatus, snapshot.dataQuality.coverage, aggregate.overall ?? null,
          now, now, errorCode, errorMessage, job.run_id);
        const changed = db.prepare(`UPDATE eval_job SET status='completed',lease_until=NULL,lease_token=NULL,
          last_error=NULL,updated_at=? WHERE id=? AND lease_token=?`).run(now, job.id, job.lease_token).changes;
        if (changed !== 1) throw new Error('Evaluation job lease was lost during finalization');
        return 'completed';
      })();
      if (completion !== 'completed') return;
      appendEvaluationProof({
        eventType: status === 'completed' ? 'eval.completed' : 'eval.partial',
        conversationId: request.conversationId, runId: String(job.run_id),
        rootTaskId: request.rootTaskId, chainId: request.chainId,
        reasonCode: status === 'partial'
          ? String(reconciled.disagreements[0]?.reasonCode ?? judged.attempt.errorCode ?? 'insufficient_evidence')
          : undefined,
        metadata: { gateStatus: aggregate.gateStatus, overallScore: aggregate.overall, evidenceCoverage: snapshot.dataQuality.coverage },
      });
    } catch (error) {
      const attempts = Number(job.attempt_count);
      const max = Number(job.max_attempts);
      const terminal = attempts >= max;
      const now = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.releaseBudgetReservations(reservationIds);
      const changed = db.transaction(() => {
        const jobChange = db.prepare(`UPDATE eval_job SET status=?,lease_until=NULL,lease_token=NULL,
          next_attempt_at=?,last_error=?,updated_at=? WHERE id=? AND lease_token=?`).run(
          terminal ? 'failed' : 'queued',
          new Date(Date.now() + attempts * EVALUATION_RETRY_BACKOFF_MS).toISOString(),
          message, now, job.id, job.lease_token).changes;
        if (jobChange === 1) db.prepare(`UPDATE eval_run SET status=?,error_code='evaluation_failed',
          error_message=?,updated_at=? WHERE id=?`).run(terminal ? 'failed' : 'queued', message, now, job.run_id);
        return jobChange;
      })();
      if (terminal && changed === 1) appendEvaluationProof({
        eventType: 'eval.failed', conversationId: request.conversationId, runId: String(job.run_id),
        rootTaskId: request.rootTaskId, chainId: request.chainId,
        reasonCode: 'evaluation_failed', metadata: { message },
      });
    }
  }

  private renewLease(job: Row): void {
    const changed = getDb().prepare(`UPDATE eval_job SET lease_until=?,updated_at=?
      WHERE id=? AND status='running' AND lease_token=?`).run(
      new Date(Date.now() + 180_000).toISOString(), new Date().toISOString(), job.id, job.lease_token).changes;
    if (changed !== 1) throw new Error('Evaluation job lease was lost before Judge execution');
  }

  private reserveJudgeBudget(
    conversationId: string,
    runId: string,
    role: 'primary' | 'secondary',
    budget: number,
    reservedTokens: number,
  ): string | undefined {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const id = `budget-${randomUUID()}`;
    const reservationKey = `${runId}:${role}`;
    return db.transaction((): string | undefined => {
      db.prepare('DELETE FROM eval_budget_reservation WHERE expires_at<=?').run(nowIso);
      const existing = db.prepare('SELECT id FROM eval_budget_reservation WHERE reservation_key=?')
        .get(reservationKey) as { id: string } | undefined;
      if (existing) return existing.id;
      const spent = db.prepare(`SELECT
          COALESCE((SELECT SUM(COALESCE(a.prompt_tokens,0)+COALESCE(a.completion_tokens,0))
            FROM eval_judge_attempt a JOIN eval_run r ON r.id=a.run_id
            WHERE r.conversation_id=? AND a.created_at>=?),0)
          + COALESCE((SELECT SUM(reserved_tokens) FROM eval_budget_reservation
            WHERE conversation_id=? AND expires_at>?),0) used`)
        .get(conversationId, dayStart.toISOString(), conversationId, nowIso) as { used: number };
      if (Number(spent.used) + reservedTokens > budget) return undefined;
      db.prepare(`INSERT INTO eval_budget_reservation
        (id,conversation_id,run_id,reservation_key,reserved_tokens,expires_at,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        id, conversationId, runId, reservationKey, reservedTokens,
        new Date(now.getTime() + 10 * 60_000).toISOString(), nowIso);
      return id;
    })();
  }

  private releaseBudgetReservations(ids: string[]): void {
    if (!ids.length) return;
    const remove = getDb().prepare('DELETE FROM eval_budget_reservation WHERE id=?');
    for (const id of ids) remove.run(id);
  }

  getReport(runId: string, conversationId?: string): EvaluationReport | undefined {
    const db = getDb();
    const run = db.prepare(`SELECT * FROM eval_run WHERE id=?${conversationId ? ' AND conversation_id=?' : ''}`)
      .get(...(conversationId ? [runId, conversationId] : [runId])) as Row | undefined;
    if (!run) return undefined;
    const snapshot = run.snapshot_id
      ? db.prepare('SELECT * FROM eval_subject_snapshot WHERE id=?').get(run.snapshot_id) as Row | undefined
      : undefined;
    return {
      run: hydrate(run),
      snapshot: snapshot ? hydrate(snapshot) : undefined,
      scores: (db.prepare('SELECT * FROM eval_score WHERE run_id=? ORDER BY evaluator_kind,dimension_key').all(runId) as Row[]).map(hydrate),
      gaps: (db.prepare('SELECT * FROM eval_gap WHERE run_id=? ORDER BY severity DESC,dimension_key').all(runId) as Row[]).map(hydrate),
      judgeAttempts: (db.prepare('SELECT * FROM eval_judge_attempt WHERE run_id=? ORDER BY created_at').all(runId) as Row[]).map(hydrate),
      reviewQueue: (db.prepare('SELECT * FROM eval_review_queue WHERE run_id=? ORDER BY created_at').all(runId) as Row[]).map(hydrate),
    };
  }

  listRuns(conversationId: string, options: {
    limit?: number; status?: string; rootTaskId?: string; chainId?: string; cursor?: string;
  } = {}): { runs: Row[]; nextCursor?: string } {
    const limit = Math.max(1, Math.min(100, options.limit ?? 30));
    const [cursorCreatedAt, cursorId] = options.cursor?.split('::') ?? [];
    const rows = getDb().prepare(`SELECT r.* FROM eval_run r
      LEFT JOIN eval_subject_snapshot s ON s.id=r.snapshot_id
      WHERE r.conversation_id=?
        AND (? IS NULL OR r.status=?)
        AND (? IS NULL OR s.root_task_id=?)
        AND (? IS NULL OR s.chain_id=?)
        AND (? IS NULL OR r.created_at<? OR (r.created_at=? AND r.id<?))
      ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).all(
      conversationId, options.status ?? null, options.status ?? null,
      options.rootTaskId ?? null, options.rootTaskId ?? null,
      options.chainId ?? null, options.chainId ?? null,
      cursorCreatedAt ?? null, cursorCreatedAt ?? null, cursorCreatedAt ?? null, cursorId ?? null,
      limit + 1,
    ) as Row[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(hydrate);
    const last = page.at(-1);
    return { runs: page, nextCursor: hasMore && last ? `${String(last.created_at)}::${String(last.id)}` : undefined };
  }

  replay(runId: string, conversationId: string): { runId: string; status: string; duplicate: boolean } {
    const report = this.getReport(runId, conversationId);
    if (!report?.snapshot) throw new Error('Completed source run not found');
    const snapshot = report.snapshot;
    const replay = this.submit({
      conversationId: String(snapshot.conversation_id), rootTaskId: snapshot.root_task_id ? String(snapshot.root_task_id) : undefined,
      chainId: snapshot.chain_id ? String(snapshot.chain_id) : undefined,
      evidenceCutoffAt: String(snapshot.evidence_cutoff_at), mode: 'replay',
      triggerId: `replay:${runId}:${randomUUID()}`,
      sourceSnapshotId: String(snapshot.id),
      taskType: String(snapshot.task_type), difficulty: String(snapshot.difficulty), language: String(snapshot.language),
      caseId: report.run.case_id ? String(report.run.case_id) : undefined,
      applicationManifest: ((snapshot.app_manifest as Record<string, unknown>)?.applicationVariant as Record<string, unknown> | undefined),
    });
    appendEvaluationProof({
      eventType: 'eval.replayed', conversationId: String(snapshot.conversation_id), runId: replay.runId,
      rootTaskId: snapshot.root_task_id ? String(snapshot.root_task_id) : undefined,
      chainId: snapshot.chain_id ? String(snapshot.chain_id) : undefined,
      metadata: { sourceRunId: runId },
    });
    return replay;
  }
}

export const agentEvaluation = new AgentEvaluation();

let workerTimer: ReturnType<typeof setInterval> | undefined;
export function startEvaluationWorker(intervalMs = 2_000): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => void agentEvaluation.processPending().catch((error) =>
    console.error('[evaluation] worker error:', error)), intervalMs);
  workerTimer.unref();
}
