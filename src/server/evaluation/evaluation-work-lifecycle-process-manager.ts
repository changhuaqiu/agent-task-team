import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { getDb } from '../db';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { transitionCaseExecution } from './application-snapshot';

export interface EvaluationRuntimeAdmission {
  projectId: string;
  projectAgentId: string;
  executionId: string;
  taskId?: string;
  applicationSnapshotId: string;
  targetManifestDigest: string;
  invocationId: string;
  traceId: string;
  observedManifestDigest?: string;
}

/** Idempotently projects the durable admission fact into Evaluation state. */
export function projectEvaluationRuntimeAdmission(input: EvaluationRuntimeAdmission): boolean {
  const db = getDb();
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT status FROM eval_case_execution WHERE id=? AND conversation_id=?
    `).get(input.executionId, input.projectId) as { status: string } | undefined;
    if (current?.status !== 'planning') return false;
    const proof = proofLogRepo.append({
      eventType: 'eval.execution.started',
      conversationId: input.projectId,
      taskId: input.taskId,
      agentId: input.projectAgentId,
      metadata: {
        executionId: input.executionId,
        applicationSnapshotId: input.applicationSnapshotId,
        targetManifestDigest: input.targetManifestDigest,
        observedManifestDigest: input.observedManifestDigest,
      },
    });
    transitionCaseExecution({
      id: input.executionId,
      conversationId: input.projectId,
      status: 'running',
      taskId: input.taskId,
      harnessTriggerId: input.executionId,
      invocationId: input.invocationId,
      traceId: input.traceId,
      proofEventId: proof.id,
      observedManifestDigest: input.observedManifestDigest,
    });
    return true;
  }).immediate();
}

/** Projects durable Runtime admission and final admission failure into Evaluation. */
export class EvaluationWorkLifecycleProcessManager {
  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (signal.aborted) throw signal.reason ?? new Error('evaluation_work_lifecycle_aborted');
    const payload = event.payload as {
      replyTo?: { type?: string; id?: string };
      taskId?: string;
      evaluation?: {
        executionId?: string;
        applicationSnapshotId?: string;
        targetManifestDigest?: string;
      };
      runtimeAdmission?: {
        invocationId?: string;
        traceId?: string;
        observedManifestDigest?: string;
      };
      reasonCode?: string;
    };
    if (
      payload.replyTo?.type !== 'evaluation_case'
      || !payload.replyTo.id
      || payload.evaluation?.executionId !== payload.replyTo.id
    ) return;
    if (event.type === 'agent.work.admitted') {
      if (
        !event.projectAgentId
        || !payload.evaluation.applicationSnapshotId
        || !payload.evaluation.targetManifestDigest
        || !payload.runtimeAdmission?.invocationId
        || !payload.runtimeAdmission.traceId
      ) return;
      projectEvaluationRuntimeAdmission({
        projectId: event.projectId,
        projectAgentId: event.projectAgentId,
        executionId: payload.replyTo.id,
        taskId: payload.taskId,
        applicationSnapshotId: payload.evaluation.applicationSnapshotId,
        targetManifestDigest: payload.evaluation.targetManifestDigest,
        invocationId: payload.runtimeAdmission.invocationId,
        traceId: payload.runtimeAdmission.traceId,
        observedManifestDigest: payload.runtimeAdmission.observedManifestDigest,
      });
      return;
    }
    if (event.type !== 'agent.work.expired') return;
    const current = getDb().prepare(`
      SELECT status FROM eval_case_execution WHERE id=? AND conversation_id=?
    `).get(payload.replyTo.id, event.projectId) as { status: string } | undefined;
    if (current?.status !== 'planning') return;
    transitionCaseExecution({
      id: payload.replyTo.id,
      conversationId: event.projectId,
      status: 'failed',
      errorCode: payload.reasonCode ?? 'runtime_start_failed',
    });
  };
}
