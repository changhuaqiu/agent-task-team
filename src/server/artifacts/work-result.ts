import { getDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
import { conversationRepo } from '../repositories/conversation-repo';
import { taskRepo } from '../repositories/task-repo';
import { projectReviewRepo } from '../repositories/project-review-repo';
import { qualityGateRepo } from '../quality-gate/repository';
import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import { redactObservationPreview } from '../observability/redaction';
import type { WorkResult, WorkResultGate } from '@/shared/work-result';

function object(value: string): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}
function array(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}

/** Preserve DTO shape; never parse a truncated redacted JSON string. */
export function redactResultStrings<T>(value: T): T {
  if (typeof value === 'string') return (redactObservationPreview(value, 32_000) ?? '') as T;
  if (Array.isArray(value)) return value.map(redactResultStrings) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, redactResultStrings(field)]),
  ) as T;
  return value;
}

export function readWorkResult(projectId: string, conversationId: string, workId: string): WorkResult {
  const project = projectRepo.getById(projectId);
  const conversation = conversationRepo.getById(conversationId);
  const work = taskRepo.getById(workId);
  if (!project || !conversation || conversation.project_id !== projectId || work?.conversation_id !== conversationId) {
    throw new Error('work_result_not_found');
  }
  const tasks = conversationId === project.workspace_conversation_id ? [work] : taskRepo.getByConversation(conversationId);
  const taskIds = new Set(tasks.map((task) => task.id));
  const gates: WorkResultGate[] = tasks.flatMap((task) =>
    qualityGateRepo.listForTarget('task', task.id)
      .filter((gate) => gate.conversation_id === conversationId)
      .map((gate) => {
        const snapshot = qualityGateRepo.getSnapshot(gate.id)!;
        const acceptedIds = new Set(snapshot.decision ? array(snapshot.decision.evidence_ids_json) : []);
        return {
          id: gate.id, taskId: task.id, taskTitle: task.title, kind: gate.kind, status: gate.status,
          artifactRevision: gate.artifact_revision,
          ...(gate.evaluator_id ? { evaluatorId: gate.evaluator_id } : {}),
          ...(gate.decided_at ? { decidedAt: gate.decided_at } : {}),
          ...(gate.decision_reason ? { reason: redactObservationPreview(gate.decision_reason) } : {}),
          criteria: redactObservationPreview(snapshot.criteria, 16_000) ?? '{}',
          evidence: snapshot.evidence.filter((evidence) => acceptedIds.has(evidence.id)).map((evidence) => {
            const payload = object(evidence.payload_json);
            const refs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [];
            return {
              id: evidence.id, type: evidence.evidence_type,
              ...(evidence.source_ref ? { sourceRef: redactObservationPreview(evidence.source_ref) } : {}),
              content: redactObservationPreview(payload, 32_000) ?? '{}',
              refs: refs.map((ref) => redactObservationPreview(ref, 2_000) ?? ''),
              recordedAt: evidence.created_at,
            };
          }),
        };
      }));
  const runs = getDb().prepare('SELECT id,root_task_id FROM autonomous_delivery_run WHERE conversation_id=? AND status=?')
    .all(conversationId, 'completed') as Array<{ id: string; root_task_id: string | null }>;
  const bundles = runs.filter((run) => run.root_task_id && taskIds.has(run.root_task_id)).flatMap((run) => {
    const snapshot = autonomousDeliveryRepo.getSnapshot(run.id);
    return snapshot?.bundle ? [{ runId: run.id, bundle: redactResultStrings(snapshot.bundle) }] : [];
  });
  return {
    projectId, conversationId, workId, title: work.title, status: work.status, gates, bundles,
    projectReviewCount: projectReviewRepo.list(projectId).length,
    limitations: [
      ...(gates.length === 0 && bundles.length === 0 ? ['未找到本工作项的结构化验收记录；历史“已完成”状态不等于这里已核验通过。'] : []),
      ...(bundles.length === 0 ? ['尚无逐条目标验收汇总；下方任务质量门只证明各自标明的范围与版本。'] : []),
      '项目分支评审尚未关联到工作项，不计入本工作项的验收结论。',
      '文件预览读取当前磁盘内容，不代表验收时冻结的文件版本。',
    ],
  };
}
