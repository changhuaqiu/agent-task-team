import { randomUUID } from 'node:crypto';
import type { InvocationCoordinator, InvocationSubmission } from '../invocation-pipeline';
import { getDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { taskCommandService } from '../repositories/task-command-service';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest, stableJson } from './defaults';
import {
  createCaseExecution,
  getApplicationSnapshot,
  transitionCaseExecution,
} from './application-snapshot';
import { evaluationLab } from './evaluation-lab';

type Row = Record<string, unknown>;

function parse(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function casePrompt(row: Row): string {
  const payload = parse(row.input_payload, {}) as Record<string, unknown>;
  if (typeof payload.redactedText === 'string') return payload.redactedText;
  return stableJson(payload);
}

export function createRunnerExperiment(input: {
  conversationId: string;
  datasetId: string;
  name: string;
  baselineSnapshotId: string;
  candidateSnapshotId: string;
  createdBy?: string;
}): Row {
  const db = getDb();
  const dataset = db.prepare(`SELECT * FROM eval_dataset
    WHERE id=? AND (conversation_id=? OR conversation_id IS NULL)`)
    .get(input.datasetId, input.conversationId) as Row | undefined;
  if (!dataset) throw new Error('Dataset not found in project');
  const baseline = getApplicationSnapshot(input.baselineSnapshotId, input.conversationId);
  const candidate = getApplicationSnapshot(input.candidateSnapshotId, input.conversationId);
  if (!baseline || !candidate) throw new Error('Baseline and candidate snapshots must belong to the project');
  const cases = db.prepare(
    "SELECT * FROM eval_case WHERE dataset_id=? AND split='held_out' ORDER BY created_at,id",
  ).all(input.datasetId) as Row[];
  if (!cases.length) throw new Error('Runner experiment requires at least one held-out case');
  const id = `experiment-${randomUUID()}`;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO eval_experiment
      (id,conversation_id,dataset_id,dataset_revision,rubric_revision_id,evaluator_bundle_digest,
       name,status,baseline_manifest,candidate_manifest,baseline_snapshot_id,candidate_snapshot_id,
       created_by,started_at,created_at)
      VALUES (?,?,?,?,?,?,?,'running',?,?,?,?,?,?,?)`).run(
      id,
      input.conversationId,
      input.datasetId,
      dataset.revision,
      DEFAULT_RUBRIC_REVISION_ID,
      digest(EVALUATOR_BUNDLE_REVISION),
      input.name,
      stableJson(baseline.manifest),
      stableJson(candidate.manifest),
      baseline.id,
      candidate.id,
      input.createdBy ?? 'platform-user',
      now,
      now,
    );
    const insertItem = db.prepare(`INSERT INTO eval_experiment_item
      (id,experiment_id,case_id,execution_verified,details,created_at)
      VALUES (?,?,?,0,'{}',?)`);
    for (const item of cases) {
      const metadata = parse(item.metadata, {}) as Record<string, unknown>;
      const requestedAgentId = typeof metadata.agentId === 'string' ? metadata.agentId : undefined;
      const baselineAgentId = requestedAgentId ?? baseline.manifest.agents[0]?.agentId;
      const candidateAgentId = requestedAgentId ?? candidate.manifest.agents[0]?.agentId;
      if (!baselineAgentId || !candidateAgentId) throw new Error('Experiment case has no configured execution Agent');
      insertItem.run(`experiment-item-${randomUUID()}`, id, item.id, now);
      createCaseExecution({
        conversationId: input.conversationId,
        experimentId: id,
        caseId: String(item.id),
        applicationSnapshotId: String(baseline.id),
        variant: 'baseline',
        agentId: baselineAgentId,
      });
      createCaseExecution({
        conversationId: input.conversationId,
        experimentId: id,
        caseId: String(item.id),
        applicationSnapshotId: String(candidate.id),
        variant: 'candidate',
        agentId: candidateAgentId,
      });
    }
  })();
  return evaluationLab.getExperiment(id, input.conversationId)!;
}

export class EvaluationCaseRunner {
  constructor(private readonly coordinator: Pick<InvocationCoordinator, 'submit'>) {}

  pump(limit = 2): number {
    this.reconcileEvaluations();
    let submitted = 0;
    for (; submitted < limit; submitted += 1) {
      const execution = getDb().prepare(`SELECT x.*,c.case_key,c.input_payload,c.metadata
        FROM eval_case_execution x JOIN eval_case c ON c.id=x.case_id
        JOIN eval_experiment e ON e.id=x.experiment_id
        LEFT JOIN eval_policy p ON p.conversation_id=x.conversation_id
        WHERE x.status='queued' AND e.status='running'
          AND (SELECT COUNT(*) FROM eval_case_execution active
            WHERE active.conversation_id=x.conversation_id
              AND active.status IN ('planning','running'))
            < COALESCE(p.max_concurrency,2)
          AND NOT EXISTS (SELECT 1 FROM eval_case_execution occupied
            WHERE occupied.conversation_id=x.conversation_id
              AND occupied.agent_id=x.agent_id
              AND occupied.status IN ('planning','running'))
        ORDER BY x.created_at,x.id LIMIT 1`).get() as Row | undefined;
      if (!execution) break;
      this.dispatch(execution);
    }
    this.reconcileExperiments();
    return submitted;
  }

  private dispatch(execution: Row): void {
    const snapshot = getApplicationSnapshot(
      String(execution.application_snapshot_id),
      String(execution.conversation_id),
    );
    if (!snapshot) {
      transitionCaseExecution({
        id: String(execution.id),
        conversationId: String(execution.conversation_id),
        status: 'failed',
        errorCode: 'application_snapshot_missing',
      });
      return;
    }
    const agentId = typeof execution.agent_id === 'string'
      ? execution.agent_id
      : snapshot.manifest.agents[0]?.agentId;
    if (!agentId || !snapshot.manifest.agents.some((agent) => agent.agentId === agentId)) {
      transitionCaseExecution({
        id: String(execution.id),
        conversationId: String(execution.conversation_id),
        status: 'failed',
        errorCode: 'evaluation_agent_missing',
      });
      return;
    }
    const taskId = `eval-task-${String(execution.id)}`;
    if (!taskRepo.getById(taskId)) {
      const conversationId = String(execution.conversation_id);
      const idempotencyKey = `evaluation-task:create:${String(execution.id)}`;
      taskCommandService.create({
        conversationId,
        expectedGraphRevision: taskCommandService.expectedGraphRevision(
          conversationId,
          idempotencyKey,
        ),
        idempotencyKey,
        actor: { type: 'system', id: 'evaluation-runner' },
        correlationId: String(execution.id),
        causationId: String(execution.case_id),
        task: {
          id: taskId,
          title: `[评估] ${String(execution.case_key)} / ${String(execution.variant)}`,
          description: casePrompt(execution),
          agent_id: agentId,
          artifacts: {
            evaluationExecutionId: execution.id,
            caseId: execution.case_id,
            variant: execution.variant,
          },
        },
      });
    }
    transitionCaseExecution({
      id: String(execution.id),
      conversationId: String(execution.conversation_id),
      status: 'planning',
      taskId,
      harnessTriggerId: String(execution.id),
    });
    let submission: InvocationSubmission;
    try {
      submission = this.coordinator.submit({
        id: String(execution.id),
        idempotencyKey: String(execution.id),
        source: 'test_gate',
        conversationId: String(execution.conversation_id),
        taskId,
        agentId,
        prompt: casePrompt(execution),
        evaluation: {
          executionId: String(execution.id),
          caseId: String(execution.case_id),
          applicationSnapshotId: String(execution.application_snapshot_id),
          targetManifestDigest: String(execution.target_manifest_digest),
        },
      });
    } catch (error) {
      transitionCaseExecution({
        id: String(execution.id),
        conversationId: String(execution.conversation_id),
        status: 'failed',
        errorCode: 'harness_submit_failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    void submission.completion.then((outcome) => {
      if (outcome.status === 'accepted') return;
      const current = getDb().prepare('SELECT status FROM eval_case_execution WHERE id=?')
        .get(execution.id) as { status: string } | undefined;
      if (current?.status !== 'planning') return;
      if (outcome.status === 'deferred') {
        transitionCaseExecution({
          id: String(execution.id),
          conversationId: String(execution.conversation_id),
          status: 'queued',
        });
        return;
      }
      transitionCaseExecution({
        id: String(execution.id),
        conversationId: String(execution.conversation_id),
        status: 'failed',
        errorCode: 'reasonCode' in outcome ? outcome.reasonCode : 'harness_dispatch_failed',
        errorMessage: 'message' in outcome ? outcome.message : undefined,
      });
    });
  }

  private reconcileEvaluations(): void {
    const rows = getDb().prepare(`SELECT x.*,r.status run_status,r.error_code run_error_code
      FROM eval_case_execution x JOIN eval_run r ON r.id=x.eval_run_id
      WHERE x.status='evaluating' AND r.status IN ('completed','partial','failed','cancelled')`).all() as Row[];
    for (const execution of rows) {
      if (execution.run_status === 'completed') {
        const proof = proofLogRepo.append({
          eventType: 'eval.execution.completed',
          conversationId: String(execution.conversation_id),
          taskId: execution.task_id ? String(execution.task_id) : undefined,
          metadata: {
            executionId: execution.id,
            evalRunId: execution.eval_run_id,
            targetManifestDigest: execution.target_manifest_digest,
            observedManifestDigest: execution.observed_manifest_digest,
          },
        });
        transitionCaseExecution({
          id: String(execution.id),
          conversationId: String(execution.conversation_id),
          status: 'completed',
          invocationId: String(execution.invocation_id),
          traceId: String(execution.trace_id),
          evalRunId: String(execution.eval_run_id),
          proofEventId: proof.id,
          observedManifestDigest: String(execution.observed_manifest_digest),
        });
      } else {
        transitionCaseExecution({
          id: String(execution.id),
          conversationId: String(execution.conversation_id),
          status: 'failed',
          errorCode: String(execution.run_error_code ?? `evaluation_${String(execution.run_status)}`),
        });
      }
    }
  }

  private reconcileExperiments(): void {
    const experiments = getDb().prepare(`SELECT e.id,e.conversation_id,
      COUNT(x.id) execution_count,
      SUM(CASE WHEN x.status='completed' AND x.execution_verified=1 THEN 1 ELSE 0 END) completed_count,
      SUM(CASE WHEN x.status='failed' THEN 1 ELSE 0 END) failed_count
      FROM eval_experiment e JOIN eval_case_execution x ON x.experiment_id=e.id
      WHERE e.status='running' GROUP BY e.id`).all() as Row[];
    for (const experiment of experiments) {
      if (Number(experiment.failed_count) > 0) {
        getDb().prepare(`UPDATE eval_experiment SET status='failed',error_code='case_execution_failed',
          completed_at=? WHERE id=?`).run(new Date().toISOString(), experiment.id);
        const queued = getDb().prepare(
          "SELECT id,conversation_id FROM eval_case_execution WHERE experiment_id=? AND status='queued'",
        ).all(experiment.id) as Array<{ id: string; conversation_id: string }>;
        for (const execution of queued) {
          transitionCaseExecution({
            id: execution.id,
            conversationId: execution.conversation_id,
            status: 'cancelled',
            errorCode: 'experiment_failed',
          });
        }
      } else if (Number(experiment.execution_count) === Number(experiment.completed_count)) {
        evaluationLab.completeVerifiedExperiment(String(experiment.id), String(experiment.conversation_id));
      }
    }
  }
}
