import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import { taskCommandService } from './task-command-service';
import { taskRepo, type TaskRow } from './task-repo';
import { conversationRepo } from './conversation-repo';
import { taskGraphRepo } from './task-graph-repo';
import { EngineeringCollaborationService } from '../engineering-collaboration/service';
import { GhCliGitProviderVerifier } from '../engineering-collaboration/github-cli-verifier';
import type { ImplementationEvidence } from '@/lib/engineering-collaboration/types';

type TaskOutcomeType =
  | 'submit_task_result'
  | 'request_review'
  | 'report_blocked'
  | 'request_human_decision';

function outcomeSummary(outcome: AgentOutcomeRow): string | undefined {
  try {
    const payload = JSON.parse(outcome.payload_json) as Record<string, unknown>;
    for (const candidate of [payload.summary, payload.reason, payload.message]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  } catch {
    // Contract admission preserves the raw payload; summary is optional.
  }
  return undefined;
}

function outcomePayload(outcome: AgentOutcomeRow): Record<string, unknown> {
  try {
    const payload = JSON.parse(outcome.payload_json) as unknown;
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function requiredEvidenceText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`task_outcome_implementation_evidence_${field}_required`);
  }
  return value.trim();
}

function implementationEvidence(payload: Record<string, unknown>): ImplementationEvidence {
  const raw = payload.implementationEvidence ?? payload.evidence;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('task_outcome_implementation_evidence_required');
  }
  const record = raw as Record<string, unknown>;
  return {
    installResult: requiredEvidenceText(record.installResult, 'install_result'),
    buildResult: requiredEvidenceText(record.buildResult, 'build_result'),
    testResult: requiredEvidenceText(record.testResult, 'test_result'),
    impactEvidence: requiredEvidenceText(record.impactEvidence, 'impact_evidence'),
    ...(typeof record.riskSummary === 'string' && record.riskSummary.trim()
      ? { riskSummary: record.riskSummary.trim() }
      : {}),
  };
}

function pullRequestUrl(outcome: AgentOutcomeRow, payload: Record<string, unknown>): string {
  const direct = typeof payload.pullRequestUrl === 'string' ? payload.pullRequestUrl.trim() : '';
  if (direct) return direct;
  const refs = JSON.parse(outcome.evidence_refs_json) as string[];
  return refs.find((reference) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/i.test(reference))
    ?? '';
}

function alreadyRecordedPullRequest(taskId: string, outcomeId: string): boolean {
  return taskGraphRepo.listActionsForTask(taskId).some((action) => {
    if (action.type !== 'task.pull_request_submitted') return false;
    try {
      return (JSON.parse(action.payload) as { outcomeId?: unknown }).outcomeId === outcomeId;
    } catch {
      return false;
    }
  });
}

function frozenTaskRevision(contract: WorkContractRow): number {
  const revisions = JSON.parse(contract.authoritative_revisions_json) as Record<string, unknown>;
  if (!Number.isSafeInteger(revisions.task) || Number(revisions.task) < 0) {
    throw new Error('task_outcome_contract_revision_missing');
  }
  return Number(revisions.task);
}

function acceptedTaskOutcome(
  db: Database.Database,
  outcomeId: string,
): { outcome: AgentOutcomeRow; contract: WorkContractRow; task: TaskRow } | undefined {
  const outcome = db.prepare(`
    SELECT * FROM agent_outcome
    WHERE id=? AND admission_status='accepted'
      AND outcome_type IN (
        'submit_task_result','request_review','report_blocked','request_human_decision'
      )
  `).get(outcomeId) as AgentOutcomeRow | undefined;
  if (!outcome) return undefined;
  const contract = db.prepare('SELECT * FROM work_contract WHERE id=?')
    .get(outcome.contract_id) as WorkContractRow | undefined;
  if (!contract?.task_id) throw new Error('task_outcome_contract_task_missing');
  const task = taskRepo.getById(contract.task_id);
  if (!task || task.conversation_id !== contract.project_id) {
    throw new Error('task_outcome_task_scope_mismatch');
  }
  return { outcome, contract, task };
}

export class TaskOutcomeProcessManager {
  constructor(private readonly collaboration = new EngineeringCollaborationService(
    new GhCliGitProviderVerifier(),
  )) {}

  readonly handle: PlatformEventHandler = async (event, { signal }) => {
    if (event.type !== 'agent.outcome.accepted') return;
    if (signal.aborted) throw signal.reason ?? new Error('task_outcome_processing_aborted');
    const db = getDb();
    const accepted = acceptedTaskOutcome(db, event.aggregate.id);
    if (!accepted) return;
    const { outcome, contract, task } = accepted;
    const requestsReview = outcome.outcome_type === 'submit_task_result'
      || outcome.outcome_type === 'request_review';
    const gitRepoRoot = conversationRepo.getById(task.conversation_id)?.git_repo_root?.trim();
    if (requestsReview && gitRepoRoot) {
      if (alreadyRecordedPullRequest(task.id, outcome.id)) return;
      const expectedTaskRevision = frozenTaskRevision(contract);
      if (task.revision !== expectedTaskRevision) {
        throw new Error(
          `task_outcome_task_revision_stale:expected=${expectedTaskRevision}:actual=${task.revision}`,
        );
      }
      const payload = outcomePayload(outcome);
      const url = pullRequestUrl(outcome, payload);
      if (!url) throw new Error('task_outcome_pull_request_url_required');
      await this.collaboration.recordPullRequest({
        taskId: task.id,
        expectedConversationId: task.conversation_id,
        actorAgentId: contract.agent_id,
        pullRequestUrl: url,
        evidence: implementationEvidence(payload),
        correlationId: event.correlationId,
        causationId: event.eventId,
        outcomeId: outcome.id,
        expectedTaskRevision,
      });
      return;
    }
    const idempotencyKey = `task-outcome:${event.eventId}`;
    taskCommandService.applyOutcome({
      conversationId: task.conversation_id,
      taskId: task.id,
      expectedTaskRevision: frozenTaskRevision(contract),
      expectedGraphRevision: taskCommandService.expectedGraphRevision(
        task.conversation_id,
        idempotencyKey,
      ),
      idempotencyKey,
      actor: { type: 'agent', id: contract.agent_id },
      correlationId: event.correlationId,
      causationId: event.eventId,
      outcomeId: outcome.id,
      outcomeType: outcome.outcome_type as TaskOutcomeType,
      agentId: contract.agent_id,
      evidenceRefs: JSON.parse(outcome.evidence_refs_json) as string[],
      proofEventId: event.eventId,
      summary: outcomeSummary(outcome),
    });
  };
}
