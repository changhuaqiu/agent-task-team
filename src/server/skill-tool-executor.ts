// Skill Tool Executor — executes skill-defined tools directly via DB queries.
// No HTTP roundtrip; same DB operations as mutation handlers.

import { assertTaskStatus, taskRepo } from './repositories/task-repo';
import type { TaskRow } from './repositories/task-repo';
import {
  stableTaskCommandKey,
  taskCommandService,
} from './repositories/task-command-service';
import { isSkillTool } from './skill-tool-router';
import { join } from 'node:path';
import { proofLogRepo } from './repositories/proof-log-repo';
import { taskStatusEvidencePolicy } from './task-flow/task-status-evidence-policy';
import { EngineeringCollaborationService } from './engineering-collaboration/service';
import { GhCliGitProviderVerifier } from './engineering-collaboration/github-cli-verifier';
import type { ImplementationEvidence, MergeEvidence, ReviewEvidence } from '@/lib/engineering-collaboration/types';
import type { Server as IOServer } from 'socket.io';
import { appendTaskToOwnedTasksMd, updateTaskInMd } from './task-file-service';
import { startArtifactLoopbackServer } from './verification/artifact-loopback-server';
import { getDb } from './db';
import {
  MEMORY_DISPOSITIONS,
  MEMORY_RELATION_KINDS,
  TEAM_MEMORY_KINDS,
  teamMemory,
  type MemoryRelationKind,
  type TeamMemoryKind,
} from './team-memory/team-memory';

// ── Types ──────────────────────────────────────

export interface ToolInvocation {
  toolName: string;
  input: Record<string, unknown>;
  agentId: string;
  conversationId: string;
  projectId?: string;
  taskId?: string;
  taskProjectDir?: string;
  rateLimitKey?: string;
  correlationId?: string;
  causationId?: string;
  io?: IOServer;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ── Rate Limiter ───────────────────────────────
// Max 10 task operations per invocation (per agent).
// Reset when the daemon resets (process-scoped).

const MAX_OPERATIONS_PER_INVOCATION = 10;
const operationCounts = new Map<string, number>();

function checkRateLimit(rateLimitKey: string): void {
  const current = operationCounts.get(rateLimitKey) ?? 0;
  if (current >= MAX_OPERATIONS_PER_INVOCATION) {
    throw new Error(`Rate limit exceeded: max ${MAX_OPERATIONS_PER_INVOCATION} task operations per invocation`);
  }
  operationCounts.set(rateLimitKey, current + 1);
}

export function resetRateLimit(agentId: string): void {
  operationCounts.delete(agentId);
}

function resolveTaskProjectDir(invocation: ToolInvocation, conversationId = invocation.conversationId): string {
  if (invocation.taskProjectDir) return invocation.taskProjectDir;
  const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
  return join(wsRoot, conversationId || 'default');
}

function projectAuthoritativeTask(invocation: ToolInvocation, taskId: string): void {
  const task = taskRepo.getById(taskId);
  if (!task) return;
  const projected = updateTaskInMd(
    resolveTaskProjectDir(invocation, task.conversation_id),
    task.conversation_id,
    taskId,
    {
      status: task.status,
      agent: task.agent_id ?? '',
    },
  );
  if (!projected) throw new Error(`Runtime TASKS.md does not contain ${taskId}`);
}

function reconcileAuthoritativeTaskProjection(invocation: ToolInvocation, taskId: string): void {
  try {
    projectAuthoritativeTask(invocation, taskId);
  } catch (error) {
    const task = taskRepo.getById(taskId);
    console.error('[skill-tool] runtime TASKS.md reconciliation failed after committed mutation:', error);
    try {
      proofLogRepo.append({
        eventType: 'task_graph.runtime_projection.failed',
        conversationId: task?.conversation_id ?? invocation.conversationId,
        taskId,
        actorId: invocation.agentId,
        reasonCode: 'runtime_projection_failed',
        metadata: { taskProjectDir: invocation.taskProjectDir, error: error instanceof Error ? error.message : String(error) },
      });
      const projectionProjectId = task?.conversation_id ?? invocation.conversationId;
      invocation.io?.to(projectionProjectId).emit('task.sync_error', {
        projectId: projectionProjectId,
        conversationId: projectionProjectId,
        taskId,
        reasonCode: 'runtime_projection_failed',
        message: 'Task receipt was committed, but the runtime TASKS.md projection needs reconciliation.',
      });
    } catch (proofError) {
      console.error('[skill-tool] failed to persist runtime projection reconciliation proof:', proofError);
    }
  }
}

// ── Security: validate tool invocation ─────────

function validateInvocation(invocation: ToolInvocation): void {
  if (!isSkillTool(invocation.toolName)) {
    throw new Error(`Unknown skill tool: ${invocation.toolName}`);
  }

  // Self-dispatch guard: agent cannot assign a task to itself
  if (invocation.toolName === 'task_assign') {
    const targetAgentId = invocation.input.agent_id as string | undefined;
    if (targetAgentId === invocation.agentId) {
      throw new Error('Agent cannot assign tasks to itself (self-dispatch prevention)');
    }
  }
}

// ── Tool implementations (direct DB) ──────────

function executeTaskList(invocation: ToolInvocation): ToolResult {
  const status = invocation.input.status as string | undefined;
  const agentId = invocation.input.agent_id as string | undefined;

  let tasks: TaskRow[];
  tasks = taskRepo.getByConversation(invocation.conversationId);
  if (agentId) tasks = tasks.filter((task) => task.agent_id === agentId);

  if (status) {
    tasks = tasks.filter((t) => t.status === status);
  }

  return { success: true, data: tasks };
}

function executeTaskCreate(invocation: ToolInvocation): ToolResult {
  const title = invocation.input.title as string;
  if (!title) {
    return { success: false, error: 'title is required' };
  }

  const taskCount = taskRepo.list().length;
  const id = `TASK-${String(taskCount + 1).padStart(3, '0')}`;
  const agentId = (invocation.input.agent_id as string) || invocation.agentId;
  const dependencies = typeof invocation.input.dependencies === 'string'
    ? (invocation.input.dependencies as string).split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const idempotencyKey = stableTaskCommandKey(
    invocation.rateLimitKey ?? invocation.agentId,
    { toolName: invocation.toolName, input: invocation.input },
  );
  const committed = taskCommandService.create({
    conversationId: invocation.conversationId,
    expectedGraphRevision: taskCommandService.expectedGraphRevision(
      invocation.conversationId,
      idempotencyKey,
    ),
    idempotencyKey,
    actor: { type: 'agent', id: invocation.agentId },
    correlationId: invocation.correlationId,
    causationId: invocation.causationId,
    task: {
      id,
      title,
      description: (invocation.input.description as string) || '',
      agent_id: agentId,
      dependencies,
    },
  });
  const task = committed.tasks[0];

  // Also write to TASKS.md
  try {
    const projectDir = resolveTaskProjectDir(invocation);
    const role = (invocation.input.role as string) || 'worker';
    const phase = (invocation.input.phase as string) || '';
    const deliverable = (invocation.input.deliverable as string) || '';
    const projected = appendTaskToOwnedTasksMd(projectDir, invocation.conversationId, {
      id,
      title,
      phase,
      role,
      agent: agentId,
      status: 'ready',
      depends: dependencies,
      deliverable,
    });
    if (!projected) throw new Error('Runtime TASKS.md belongs to another Conversation');
  } catch (e) {
    console.error('[task_create] failed to update TASKS.md:', e);
    reconcileAuthoritativeTaskProjection(invocation, id);
  }

  return { success: true, data: task };
}

function executeTaskUpdateStatus(invocation: ToolInvocation): ToolResult {
  const taskId = invocation.input.task_id as string;
  const statusValue = invocation.input.status;

  if (!taskId || typeof statusValue !== 'string') {
    return { success: false, error: 'task_id and status are required' };
  }

  const status = assertTaskStatus(statusValue);

  const existing = taskRepo.getById(taskId);
  if (!existing) {
    return { success: false, error: `Task not found: ${taskId}` };
  }
  if (existing.conversation_id !== invocation.conversationId) {
    return { success: false, error: `Task ${taskId} does not belong to the invoking conversation` };
  }
  if (!invocation.taskId || invocation.taskId !== taskId) {
    return { success: false, error: `task_update_status is limited to the current dispatched task ${invocation.taskId ?? '(none)'}` };
  }

  const evidence = invocation.input.evidence;
  const gateDecision = taskStatusEvidencePolicy.evaluate({
    task: existing,
    nextStatus: status,
    evidence,
    actor: { type: 'agent', id: invocation.agentId },
  });
  if (!gateDecision.allowed) {
    return { success: false, error: gateDecision.message ?? 'Task gate evidence is required' };
  }

  const idempotencyKey = stableTaskCommandKey(
    invocation.rateLimitKey ?? invocation.agentId,
    { toolName: invocation.toolName, input: invocation.input },
  );
  const transitioned = taskCommandService.transition({
    conversationId: existing.conversation_id,
    taskId,
    expectedTaskRevision: taskCommandService.expectedTaskRevision(
      taskId,
      idempotencyKey,
      existing.revision,
    ),
    expectedGraphRevision: taskCommandService.expectedGraphRevision(
      existing.conversation_id,
      idempotencyKey,
    ),
    idempotencyKey,
    actor: { type: 'agent', id: invocation.agentId },
    correlationId: invocation.correlationId,
    causationId: invocation.causationId,
    to: status,
  });
  reconcileAuthoritativeTaskProjection(invocation, taskId);

  return { success: true, data: transitioned.result.task };
}

function executeTaskAssign(invocation: ToolInvocation): ToolResult {
  const taskId = invocation.input.task_id as string;
  const targetAgentId = invocation.input.agent_id as string;

  if (!taskId || !targetAgentId) {
    return { success: false, error: 'task_id and agent_id are required' };
  }

  const existing = taskRepo.getById(taskId);
  if (!existing) {
    return { success: false, error: `Task not found: ${taskId}` };
  }
  if (existing.conversation_id !== invocation.conversationId) {
    return { success: false, error: `Task ${taskId} does not belong to the invoking conversation` };
  }

  const idempotencyKey = stableTaskCommandKey(
    invocation.rateLimitKey ?? invocation.agentId,
    { toolName: invocation.toolName, input: invocation.input },
  );
  const updated = taskCommandService.update({
    conversationId: existing.conversation_id,
    taskId,
    expectedTaskRevision: taskCommandService.expectedTaskRevision(
      taskId,
      idempotencyKey,
      existing.revision,
    ),
    expectedGraphRevision: taskCommandService.expectedGraphRevision(
      existing.conversation_id,
      idempotencyKey,
    ),
    idempotencyKey,
    actor: { type: 'agent', id: invocation.agentId },
    correlationId: invocation.correlationId,
    causationId: invocation.causationId,
    updates: { agent_id: targetAgentId },
  });
  try {
    projectAuthoritativeTask(invocation, taskId);
  } catch (e) {
    console.error('[task_assign] failed to update TASKS.md:', e);
  }
  return { success: true, data: updated.result.task };
}

async function executeVerificationServeArtifact(invocation: ToolInvocation): Promise<ToolResult> {
  const artifactPath = invocation.input.artifact_path as string | undefined;
  if (!artifactPath?.trim()) {
    return { success: false, error: 'artifact_path is required' };
  }
  if (!invocation.taskId) {
    return { success: false, error: 'verification_serve_artifact requires a current dispatched task' };
  }
  const task = taskRepo.getById(invocation.taskId);
  if (!task || task.conversation_id !== invocation.conversationId) {
    return { success: false, error: 'Current dispatched task is not part of this conversation' };
  }
  if (!['in_review', 'blocked', 'done'].includes(task.status)) {
    return {
      success: false,
      error: `verification_serve_artifact is limited to quality-gate tasks; current status is ${task.status}`,
    };
  }
  const data = await startArtifactLoopbackServer({
    projectDir: resolveTaskProjectDir(invocation, task.conversation_id),
    artifactPath,
  });
  return { success: true, data };
}

function recordInput(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function implementationEvidenceInput(value: unknown): ImplementationEvidence | undefined {
  const input = recordInput(value);
  if (!input || !nonEmptyText(input.installResult) || !nonEmptyText(input.buildResult) || !nonEmptyText(input.testResult) || !nonEmptyText(input.impactEvidence)) return undefined;
  return {
    installResult: input.installResult.trim(), buildResult: input.buildResult.trim(),
    testResult: input.testResult.trim(), impactEvidence: input.impactEvidence.trim(),
    riskSummary: nonEmptyText(input.riskSummary) ? input.riskSummary.trim() : undefined,
  };
}

function reviewEvidenceInput(value: unknown): ReviewEvidence | undefined {
  const input = recordInput(value);
  if (!input || !nonEmptyText(input.testResult) || !nonEmptyText(input.summary) || !Number.isInteger(input.blockerCount) || Number(input.blockerCount) < 0) return undefined;
  if (input.qualityDecision !== 'pass' && input.qualityDecision !== 'reject' && input.qualityDecision !== 'comment') return undefined;
  return { testResult: input.testResult.trim(), summary: input.summary.trim(), blockerCount: Number(input.blockerCount), qualityDecision: input.qualityDecision };
}

function mergeEvidenceInput(value: unknown): MergeEvidence | undefined {
  const input = recordInput(value);
  if (!input || input.mergedToMain !== true || !nonEmptyText(input.mainInstallResult) || !nonEmptyText(input.mainBuildResult) || !nonEmptyText(input.mainTestResult) || !nonEmptyText(input.mainImpactReviewResult)) return undefined;
  return {
    mergedToMain: true, mainInstallResult: input.mainInstallResult.trim(), mainBuildResult: input.mainBuildResult.trim(),
    mainTestResult: input.mainTestResult.trim(), mainImpactReviewResult: input.mainImpactReviewResult.trim(),
    remainingRisk: nonEmptyText(input.remainingRisk) ? input.remainingRisk.trim() : undefined,
  };
}

function collaborationService(): EngineeringCollaborationService {
  return new EngineeringCollaborationService(new GhCliGitProviderVerifier());
}

async function executeRecordPullRequest(invocation: ToolInvocation): Promise<ToolResult> {
  const taskId = invocation.input.task_id as string;
  const pullRequestUrl = invocation.input.pull_request_url as string;
  const evidence = implementationEvidenceInput(invocation.input.evidence);
  if (!taskId || !pullRequestUrl || !evidence) return { success: false, error: 'task_id, pull_request_url and evidence are required' };
  const data = await collaborationService().recordPullRequest({
    taskId,
    expectedConversationId: invocation.conversationId,
    actorAgentId: invocation.agentId,
    pullRequestUrl,
    evidence,
    correlationId: invocation.correlationId,
    causationId: invocation.causationId,
  });
  reconcileAuthoritativeTaskProjection(invocation, taskId);
  return { success: true, data };
}

async function executeRecordReview(invocation: ToolInvocation): Promise<ToolResult> {
  const taskId = invocation.input.task_id as string;
  const pullRequestUrl = invocation.input.pull_request_url as string;
  const reviewUrl = invocation.input.review_url as string;
  const evidence = reviewEvidenceInput(invocation.input.evidence);
  if (!taskId || !pullRequestUrl || !reviewUrl || !evidence) return { success: false, error: 'task_id, pull_request_url, review_url and evidence are required' };
  const data = await collaborationService().recordReview({
    taskId,
    expectedConversationId: invocation.conversationId,
    actorAgentId: invocation.agentId,
    pullRequestUrl,
    reviewUrl,
    evidence,
    correlationId: invocation.correlationId,
    causationId: invocation.causationId,
  });
  reconcileAuthoritativeTaskProjection(invocation, taskId);
  return { success: true, data };
}

async function executeRecordMerge(invocation: ToolInvocation): Promise<ToolResult> {
  const taskId = invocation.input.task_id as string;
  const pullRequestUrl = invocation.input.pull_request_url as string;
  const evidence = mergeEvidenceInput(invocation.input.evidence);
  if (!taskId || !pullRequestUrl || !evidence) return { success: false, error: 'task_id, pull_request_url and evidence are required' };
  const data = await collaborationService().recordMerge({
    taskId,
    expectedConversationId: invocation.conversationId,
    actorAgentId: invocation.agentId,
    pullRequestUrl,
    evidence,
    correlationId: invocation.correlationId,
    causationId: invocation.causationId,
  });
  reconcileAuthoritativeTaskProjection(invocation, taskId);
  return { success: true, data };
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined;
  return value.map((item) => String(item));
}

function executeTeamMemoryRecord(invocation: ToolInvocation): ToolResult {
  const disposition = invocation.input.disposition;
  const idempotencyKey = invocation.input.idempotency_key;
  if (
    typeof disposition !== 'string'
    || !MEMORY_DISPOSITIONS.includes(disposition as (typeof MEMORY_DISPOSITIONS)[number])
    || !nonEmptyText(idempotencyKey)
  ) return { success: false, error: 'disposition and idempotency_key are required' };
  const kind = invocation.input.kind;
  if (kind !== undefined && (
    typeof kind !== 'string' || !TEAM_MEMORY_KINDS.includes(kind as TeamMemoryKind)
  )) return { success: false, error: 'kind is invalid' };
  const sourceRefs = stringArray(invocation.input.source_refs);
  if (invocation.input.source_refs !== undefined && !sourceRefs) {
    return { success: false, error: 'source_refs must be a string array' };
  }
  const relationshipInput = recordInput(invocation.input.relationship);
  let relationship: {
    subjectAgentId: string;
    objectAgentId: string;
    relationKind: MemoryRelationKind;
  } | undefined;
  if (relationshipInput) {
    const subjectAgentId = relationshipInput.subjectAgentId ?? relationshipInput.subject_agent_id;
    const objectAgentId = relationshipInput.objectAgentId ?? relationshipInput.object_agent_id;
    const relationKind = relationshipInput.relationKind ?? relationshipInput.relation_kind;
    if (
      !nonEmptyText(subjectAgentId)
      || !nonEmptyText(objectAgentId)
      || !nonEmptyText(relationKind)
      || !MEMORY_RELATION_KINDS.includes(relationKind as MemoryRelationKind)
    ) return { success: false, error: 'relationship coordinates are invalid' };
    relationship = {
      subjectAgentId: subjectAgentId.trim(),
      objectAgentId: objectAgentId.trim(),
      relationKind: relationKind as MemoryRelationKind,
    };
  }
  const result = teamMemory.record({
    conversationId: invocation.conversationId,
    taskId: invocation.taskId,
    agentId: invocation.agentId,
    idempotencyKey: idempotencyKey.trim(),
    disposition: disposition as (typeof MEMORY_DISPOSITIONS)[number],
    opportunityId: nonEmptyText(invocation.input.opportunity_id)
      ? invocation.input.opportunity_id.trim()
      : undefined,
    kind: kind as TeamMemoryKind | undefined,
    content: nonEmptyText(invocation.input.content) ? invocation.input.content.trim() : undefined,
    scope: ['project', 'task', 'agent'].includes(String(invocation.input.scope))
      ? invocation.input.scope as 'project' | 'task' | 'agent'
      : undefined,
    visibility: ['team', 'agent'].includes(String(invocation.input.visibility))
      ? invocation.input.visibility as 'team' | 'agent'
      : undefined,
    sourceRefs,
    reasonCode: nonEmptyText(invocation.input.reason_code)
      ? invocation.input.reason_code.trim()
      : undefined,
    supersedesId: nonEmptyText(invocation.input.supersedes_id)
      ? invocation.input.supersedes_id.trim()
      : undefined,
    relationship,
  });
  return { success: true, data: result };
}

function executeTeamMemoryRecall(invocation: ToolInvocation): ToolResult {
  const limit = invocation.input.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10)) {
    return { success: false, error: 'limit must be an integer between 1 and 10' };
  }
  const result = teamMemory.recall({
    conversationId: invocation.conversationId,
    taskId: invocation.taskId,
    agentId: invocation.agentId,
    query: nonEmptyText(invocation.input.query) ? invocation.input.query.trim() : undefined,
    limit: limit === undefined ? undefined : Number(limit),
  });
  return { success: true, data: result };
}

function memoryObservationSourceRefs(
  invocation: ToolInvocation,
  proofId: string,
): string[] {
  if (!invocation.taskId) return [`proof:${proofId}`];
  const actionTypesByTool: Record<string, string[]> = {
    task_update_status: ['task.review_requested', 'task.status_changed'],
    collaboration_record_pr: ['task.pull_request_submitted'],
    collaboration_record_review: ['task.provider_review_received'],
    collaboration_record_merge: ['task.pull_request_merged'],
  };
  const actionTypes = actionTypesByTool[invocation.toolName] ?? [];
  const placeholders = actionTypes.map(() => '?').join(',');
  const action = actionTypes.length > 0
    ? getDb().prepare(`
        SELECT action.id
        FROM task_action action,json_each(action.task_ids) task_ref
        WHERE task_ref.value=? AND action.type IN (${placeholders})
        ORDER BY action.created_at DESC,action.id DESC LIMIT 1
      `).get(invocation.taskId, ...actionTypes) as { id: string } | undefined
    : undefined;
  return [
    ...(action ? [`task-action:${action.id}`] : [`proof:${proofId}`]),
    `task:${invocation.taskId}`,
  ];
}

// ── Tool dispatch map ──────────────────────────

const TOOL_EXECUTORS: Record<string, (invocation: ToolInvocation) => ToolResult | Promise<ToolResult>> = {
  task_list: executeTaskList,
  task_create: executeTaskCreate,
  task_update_status: executeTaskUpdateStatus,
  task_assign: executeTaskAssign,
  verification_serve_artifact: executeVerificationServeArtifact,
  collaboration_record_pr: executeRecordPullRequest,
  collaboration_record_review: executeRecordReview,
  collaboration_record_merge: executeRecordMerge,
  team_memory_record: executeTeamMemoryRecord,
  team_memory_recall: executeTeamMemoryRecall,
};

// ── Main entry point ───────────────────────────

export async function executeSkillTool(invocation: ToolInvocation): Promise<ToolResult> {
  try {
    validateInvocation(invocation);
    checkRateLimit(invocation.rateLimitKey ?? invocation.agentId);

    const executor = TOOL_EXECUTORS[invocation.toolName];
    if (!executor) {
      return { success: false, error: `No executor for tool: ${invocation.toolName}` };
    }

    const result = await executor(invocation);

    const proof = proofLogRepo.append({
      eventType: 'skill.tool.invoked',
      conversationId: invocation.conversationId,
      taskId: invocation.taskId,
      agentId: invocation.agentId,
      metadata: {
        toolName: invocation.toolName,
        success: result.success,
      },
    });

    const requestedStatus = invocation.toolName === 'task_update_status'
      ? String(invocation.input.status ?? '')
      : '';
    const createsMemoryOpportunity = result.success && (
      ['collaboration_record_pr', 'collaboration_record_review', 'collaboration_record_merge']
        .includes(invocation.toolName)
      || (invocation.toolName === 'task_update_status' && ['in_review', 'done'].includes(requestedStatus))
    );
    if (createsMemoryOpportunity) {
      try {
        teamMemory.observe({
          conversationId: invocation.conversationId,
          taskId: invocation.taskId,
          agentId: invocation.agentId,
          idempotencyKey: stableTaskCommandKey('team-memory-observe', {
            rateLimitKey: invocation.rateLimitKey ?? invocation.agentId,
            toolName: invocation.toolName,
            input: invocation.input,
          }),
          sourceRefs: memoryObservationSourceRefs(invocation, proof.id),
          reasonCode: `tool_boundary:${invocation.toolName}`,
          kindHint: invocation.toolName === 'collaboration_record_review' ? 'lesson' : 'decision',
        });
      } catch (memoryError) {
        console.error('[skill-tool] failed to persist memory opportunity:', memoryError);
        try {
          proofLogRepo.append({
            eventType: 'team_memory.observe.failed',
            conversationId: invocation.conversationId,
            taskId: invocation.taskId,
            agentId: invocation.agentId,
            reasonCode: 'memory_observation_failed',
            metadata: {
              sourceProofId: proof.id,
              toolName: invocation.toolName,
              error: memoryError instanceof Error ? memoryError.message : String(memoryError),
            },
          });
        } catch {
          // Memory observation is non-authoritative and cannot replace the tool result.
        }
      }
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
