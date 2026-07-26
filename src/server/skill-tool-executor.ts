// Skill Tool Executor — executes skill-defined tools directly via DB queries.
// No HTTP roundtrip; same DB operations as mutation handlers.

import { taskRepo } from './repositories/task-repo';
import type { TaskRow } from './repositories/task-repo';
import { isSkillTool } from './skill-tool-router';
import { join } from 'node:path';
import { proofLogRepo } from './repositories/proof-log-repo';
import { evaluateTaskStatusEvidenceGate, hasCurrentVerifiedMerge } from './task-flow/task-gate-evidence';
import { conversationRepo } from './repositories/conversation-repo';
import { taskGraphRepo } from './repositories/task-graph-repo';
import { EngineeringCollaborationService } from './engineering-collaboration/service';
import { GhCliGitProviderVerifier } from './engineering-collaboration/github-cli-verifier';
import type { ImplementationEvidence, MergeEvidence, ReviewEvidence } from '@/lib/engineering-collaboration/types';
import type { Server as IOServer } from 'socket.io';
import { readTasksMd, updateTaskInMd, writeTasksMd } from './task-file-service';

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
  const projected = updateTaskInMd(resolveTaskProjectDir(invocation, task.conversation_id), taskId, {
    status: task.status,
    agent: task.agent_id ?? '',
  });
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
  if (agentId) {
    tasks = taskRepo.getByAgent(agentId);
  } else if (invocation.conversationId) {
    tasks = taskRepo.getByConversation(invocation.conversationId);
  } else {
    tasks = taskRepo.list();
  }

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

  const task = taskRepo.create({
    id,
    conversation_id: invocation.conversationId,
    title,
    description: (invocation.input.description as string) || '',
    agent_id: agentId,
    dependencies,
  });

  // Also write to TASKS.md
  try {
    const projectDir = resolveTaskProjectDir(invocation);
    const role = (invocation.input.role as string) || 'worker';
    const phase = (invocation.input.phase as string) || '';
    const deliverable = (invocation.input.deliverable as string) || '';
    const { tasks: existingTasks, blockers } = readTasksMd(projectDir);
    existingTasks.push({ id, title, phase, role, agent: agentId, status: 'pending', depends: dependencies, deliverable });
    writeTasksMd(projectDir, existingTasks, blockers);
  } catch (e) {
    console.error('[task_create] failed to update TASKS.md:', e);
  }

  return { success: true, data: task };
}

function executeTaskUpdateStatus(invocation: ToolInvocation): ToolResult {
  const taskId = invocation.input.task_id as string;
  const status = invocation.input.status as string;

  if (!taskId || !status) {
    return { success: false, error: 'task_id and status are required' };
  }

  const allowedStatuses = ['pending', 'in_progress', 'in_review', 'done', 'blocked', 'rejected'];
  if (!allowedStatuses.includes(status)) {
    return { success: false, error: `Invalid status: ${status}. Allowed: ${allowedStatuses.join(', ')}` };
  }

  const existing = taskRepo.getById(taskId);
  if (!existing) {
    return { success: false, error: `Task not found: ${taskId}` };
  }

  const evidence = invocation.input.evidence;
  const gateDecision = evaluateTaskStatusEvidenceGate({
    task: existing,
    nextStatus: status,
    actorId: invocation.agentId,
    evidence,
    pullRequestRequired: Boolean(conversationRepo.getById(existing.conversation_id)?.git_repo_root),
    verifiedPullRequest: taskGraphRepo.listActionsForTask(taskId).some((action) => action.type === 'task.pull_request_submitted'),
    verifiedMerge: hasCurrentVerifiedMerge(taskGraphRepo.listActionsForTask(taskId)),
  });
  if (!gateDecision.allowed) {
    proofLogRepo.append({
      eventType: 'task_graph.gate_evidence.blocked',
      conversationId: existing.conversation_id,
      taskId,
      actorId: invocation.agentId,
      reasonCode: gateDecision.reasonCode,
      metadata: {
        status,
        gateName: gateDecision.gateName,
        missingFields: gateDecision.missingFields,
      },
    });
    return { success: false, error: gateDecision.message ?? 'Task gate evidence is required' };
  }

  taskRepo.updateStatus(taskId, status);
  if (gateDecision.required) {
    proofLogRepo.append({
      eventType: 'task_graph.gate_evidence.accepted',
      conversationId: existing.conversation_id,
      taskId,
      actorId: invocation.agentId,
      metadata: {
        status,
        gateName: gateDecision.gateName,
        evidence,
      },
    });
  }

  // Also update TASKS.md
  try {
    const projectDir = resolveTaskProjectDir(invocation, existing.conversation_id);
    const STATUS_FILE: Record<string, string> = {
      pending: 'todo', in_progress: 'doing', in_review: 'review', done: 'done', blocked: 'blocked', rejected: 'rejected',
    };
    updateTaskInMd(projectDir, taskId, { status: STATUS_FILE[status] || status });
  } catch (e) {
    console.error('[task_update_status] failed to update TASKS.md:', e);
  }

  return { success: true, data: { id: taskId, status } };
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

  taskRepo.update(taskId, { agent_id: targetAgentId });
  try {
    projectAuthoritativeTask(invocation, taskId);
  } catch (e) {
    console.error('[task_assign] failed to update TASKS.md:', e);
  }
  return { success: true, data: { id: taskId, agent_id: targetAgentId } };
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

function collaborationService(io?: IOServer): EngineeringCollaborationService {
  return new EngineeringCollaborationService(new GhCliGitProviderVerifier(), io);
}

async function executeRecordPullRequest(invocation: ToolInvocation): Promise<ToolResult> {
  const taskId = invocation.input.task_id as string;
  const pullRequestUrl = invocation.input.pull_request_url as string;
  const evidence = implementationEvidenceInput(invocation.input.evidence);
  if (!taskId || !pullRequestUrl || !evidence) return { success: false, error: 'task_id, pull_request_url and evidence are required' };
  const data = await collaborationService(invocation.io).recordPullRequest({ taskId, expectedConversationId: invocation.conversationId, actorAgentId: invocation.agentId, pullRequestUrl, evidence });
  reconcileAuthoritativeTaskProjection(invocation, taskId);
  return { success: true, data };
}

async function executeRecordReview(invocation: ToolInvocation): Promise<ToolResult> {
  const taskId = invocation.input.task_id as string;
  const pullRequestUrl = invocation.input.pull_request_url as string;
  const reviewUrl = invocation.input.review_url as string;
  const evidence = reviewEvidenceInput(invocation.input.evidence);
  if (!taskId || !pullRequestUrl || !reviewUrl || !evidence) return { success: false, error: 'task_id, pull_request_url, review_url and evidence are required' };
  const data = await collaborationService(invocation.io).recordReview({ taskId, expectedConversationId: invocation.conversationId, actorAgentId: invocation.agentId, pullRequestUrl, reviewUrl, evidence });
  reconcileAuthoritativeTaskProjection(invocation, taskId);
  return { success: true, data };
}

async function executeRecordMerge(invocation: ToolInvocation): Promise<ToolResult> {
  const taskId = invocation.input.task_id as string;
  const pullRequestUrl = invocation.input.pull_request_url as string;
  const evidence = mergeEvidenceInput(invocation.input.evidence);
  if (!taskId || !pullRequestUrl || !evidence) return { success: false, error: 'task_id, pull_request_url and evidence are required' };
  const data = await collaborationService(invocation.io).recordMerge({ taskId, expectedConversationId: invocation.conversationId, actorAgentId: invocation.agentId, pullRequestUrl, evidence });
  reconcileAuthoritativeTaskProjection(invocation, taskId);
  return { success: true, data };
}

// ── Tool dispatch map ──────────────────────────

const TOOL_EXECUTORS: Record<string, (invocation: ToolInvocation) => ToolResult | Promise<ToolResult>> = {
  task_list: executeTaskList,
  task_create: executeTaskCreate,
  task_update_status: executeTaskUpdateStatus,
  task_assign: executeTaskAssign,
  collaboration_record_pr: executeRecordPullRequest,
  collaboration_record_review: executeRecordReview,
  collaboration_record_merge: executeRecordMerge,
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

    proofLogRepo.append({
      eventType: 'skill.tool.invoked',
      conversationId: invocation.conversationId,
      taskId: invocation.taskId,
      agentId: invocation.agentId,
      metadata: {
        toolName: invocation.toolName,
        success: result.success,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
