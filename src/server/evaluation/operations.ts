import { getDb } from '../db';
import { EVALUATION_RUN_SLO_MS } from './defaults';

type Row = Record<string, unknown>;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * p)] ?? null;
}

export const evaluationOperations = {
  status(conversationId: string): Record<string, unknown> {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const runCounts = db.prepare(`SELECT status,COUNT(*) count FROM eval_run
      WHERE conversation_id=? GROUP BY status`).all(conversationId) as Row[];
    const jobs = db.prepare(`SELECT j.status,COUNT(*) count,MAX(j.attempt_count) max_attempts
      FROM eval_job j JOIN eval_run r ON r.id=j.run_id WHERE r.conversation_id=? GROUP BY j.status`)
      .all(conversationId) as Row[];
    const judge = db.prepare(`SELECT COUNT(*) attempts,
      COALESCE(SUM(COALESCE(a.prompt_tokens,0)+COALESCE(a.completion_tokens,0)),0) tokens,
      COALESCE(AVG(a.latency_ms),0) average_latency_ms,
      SUM(CASE WHEN a.parse_status IN ('failed','invalid') THEN 1 ELSE 0 END) parse_failures
      FROM eval_judge_attempt a JOIN eval_run r ON r.id=a.run_id WHERE r.conversation_id=?`)
      .get(conversationId) as Row;
    const review = db.prepare(`SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) resolved,
      SUM(CASE WHEN reason_code IN ('judge_disagreement','pairwise_order_inconsistency') THEN 1 ELSE 0 END) disagreements
      FROM eval_review_queue WHERE conversation_id=?`).get(conversationId) as Row;
    const executionRows = db.prepare(`SELECT status,COUNT(*) count,MIN(created_at) oldest
      FROM eval_case_execution WHERE conversation_id=? GROUP BY status`).all(conversationId) as Row[];
    const experimentRows = db.prepare(`SELECT status,COUNT(*) count FROM eval_experiment
      WHERE conversation_id=? GROUP BY status`).all(conversationId) as Row[];
    const runDurations = (db.prepare(`SELECT
      (julianday(completed_at)-julianday(created_at))*86400000 duration_ms
      FROM eval_run WHERE conversation_id=? AND completed_at IS NOT NULL`)
      .all(conversationId) as Array<{ duration_ms: number }>).map((row) => Number(row.duration_ms));
    const judgeLatencies = (db.prepare(`SELECT a.latency_ms FROM eval_judge_attempt a
      JOIN eval_run r ON r.id=a.run_id WHERE r.conversation_id=? AND a.latency_ms IS NOT NULL`)
      .all(conversationId) as Array<{ latency_ms: number }>).map((row) => Number(row.latency_ms));
    const policy = db.prepare(`SELECT daily_token_budget,max_concurrency FROM eval_policy
      WHERE conversation_id=?`).get(conversationId) as Row | undefined;
    const activeJobs = db.prepare(`SELECT COUNT(*) count FROM eval_job j
      JOIN eval_run r ON r.id=j.run_id
      WHERE r.conversation_id=? AND j.status='running' AND j.lease_until>?`)
      .get(conversationId, nowIso) as { count: number };
    const dailyUsage = db.prepare(`SELECT
      COUNT(*) attempts,
      COALESCE(SUM(COALESCE(a.prompt_tokens,0)+COALESCE(a.completion_tokens,0)),0) tokens
      FROM eval_judge_attempt a JOIN eval_run r ON r.id=a.run_id
      WHERE r.conversation_id=? AND a.created_at>=?`)
      .get(conversationId, dayStart.toISOString()) as { attempts: number; tokens: number };
    const reservation = db.prepare(`SELECT
      COUNT(*) reservations,COALESCE(SUM(reserved_tokens),0) tokens
      FROM eval_budget_reservation WHERE conversation_id=? AND expires_at>?`)
      .get(conversationId, nowIso) as { reservations: number; tokens: number };
    const dailyTokenBudget = Number(policy?.daily_token_budget ?? 50_000);
    const maxConcurrency = Number(policy?.max_concurrency ?? 2);
    const usedTokens = Number(dailyUsage.tokens ?? 0);
    const reservedTokens = Number(reservation.tokens ?? 0);
    const remainingTokens = Math.max(0, dailyTokenBudget - usedTokens - reservedTokens);
    const runP95 = percentile(runDurations, 0.95);
    const runSloStatus = runP95 === null ? 'no_data' : runP95 < EVALUATION_RUN_SLO_MS ? 'pass' : 'fail';
    const executionCounts = Object.fromEntries(
      executionRows.map((row) => [String(row.status), Number(row.count)]),
    );
    const alerts = [
      Number(executionCounts.failed ?? 0) > 0 ? 'case_execution_failed' : undefined,
      Number(executionCounts.queued ?? 0) > 20 ? 'case_execution_backlog' : undefined,
      Number(judge.parse_failures ?? 0) > 0 ? 'judge_parse_failures' : undefined,
      Number(review.pending ?? 0) > 10 ? 'review_backlog' : undefined,
      runSloStatus === 'fail' ? 'evaluation_p95_slo_breached' : undefined,
      Number(activeJobs.count) >= maxConcurrency ? 'evaluation_concurrency_saturated' : undefined,
      remainingTokens === 0 ? 'judge_daily_budget_exhausted' : undefined,
    ].filter(Boolean);
    return { runs: Object.fromEntries(runCounts.map((row) => [String(row.status), Number(row.count)])),
      jobs,
      judge: {
        ...judge,
        p95_latency_ms: percentile(judgeLatencies, 0.95),
      },
      review,
      executions: {
        counts: executionCounts,
        oldestQueuedAt: executionRows.find((row) => row.status === 'queued')?.oldest ?? null,
      },
      experiments: Object.fromEntries(experimentRows.map((row) => [String(row.status), Number(row.count)])),
      performance: {
        run_p95_ms: runP95,
        target_ms: EVALUATION_RUN_SLO_MS,
        status: runSloStatus,
        sample_size: runDurations.length,
      },
      policy: {
        dailyTokenBudget,
        maxConcurrency,
      },
      capacity: {
        activeJobs: Number(activeJobs.count),
        maxConcurrency,
        saturation: maxConcurrency > 0 ? Number(activeJobs.count) / maxConcurrency : 1,
      },
      budget: {
        dailyTokenBudget,
        usedTokens,
        reservedTokens,
        remainingTokens,
        attemptsToday: Number(dailyUsage.attempts ?? 0),
        activeReservations: Number(reservation.reservations ?? 0),
      },
      alerts,
      generatedAt: nowIso };
  },

  enforceRetention(conversationId: string): { deletedRuns: number; deletedSnapshots: number; cutoff: string } {
    const db = getDb();
    const policy = db.prepare('SELECT retention_days FROM eval_policy WHERE conversation_id=?')
      .get(conversationId) as { retention_days: number } | undefined;
    const days = Math.max(1, policy?.retention_days ?? 180);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return db.transaction(() => {
      const deletedRuns = db.prepare(`DELETE FROM eval_run
        WHERE conversation_id=? AND created_at<?
          AND id NOT IN (SELECT baseline_run_id FROM eval_experiment_item WHERE baseline_run_id IS NOT NULL)
          AND id NOT IN (SELECT candidate_run_id FROM eval_experiment_item WHERE candidate_run_id IS NOT NULL)
          AND id NOT IN (SELECT run_id FROM eval_annotation WHERE run_id IS NOT NULL)
          AND id NOT IN (SELECT source_ref FROM eval_case WHERE source_type='online_failure' AND source_ref IS NOT NULL)
          AND id NOT IN (SELECT g.run_id FROM eval_gap g
            JOIN eval_change_proposal p ON p.gap_id=g.id)`)
        .run(conversationId, cutoff).changes;
      const deletedSnapshots = db.prepare(`DELETE FROM eval_subject_snapshot
        WHERE conversation_id=? AND collected_at<? AND id NOT IN
        (SELECT snapshot_id FROM eval_run WHERE snapshot_id IS NOT NULL)`).run(conversationId, cutoff).changes;
      return { deletedRuns, deletedSnapshots, cutoff };
    })();
  },
};
