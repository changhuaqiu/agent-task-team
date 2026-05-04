// Skill Tool Executor — executes skill-defined tools directly via DB queries.
// No HTTP roundtrip; same DB operations as mutation handlers.

import { taskRepo } from './repositories/task-repo';
import type { TaskRow } from './repositories/task-repo';
import { eventRepo } from './repositories/event-repo';
import { isSkillTool } from './skill-tool-router';
import { generateSortableId } from './repositories/sortable-id';

// ── Types ──────────────────────────────────────

export interface ToolInvocation {
  toolName: string;
  input: Record<string, unknown>;
  agentId: string;
  conversationId: string;
  projectId?: string;
  taskId?: string;
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

function checkRateLimit(agentId: string): void {
  const current = operationCounts.get(agentId) ?? 0;
  if (current >= MAX_OPERATIONS_PER_INVOCATION) {
    throw new Error(`Rate limit exceeded: max ${MAX_OPERATIONS_PER_INVOCATION} task operations per invocation for agent ${agentId}`);
  }
  operationCounts.set(agentId, current + 1);
}

export function resetRateLimit(agentId: string): void {
  operationCounts.delete(agentId);
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
    const { readTasksMd, writeTasksMd } = require('./task-file-service');
    const { join } = require('path');
    const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
    const projectDir = join(wsRoot, invocation.conversationId || 'default');
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

  taskRepo.updateStatus(taskId, status);

  // Also update TASKS.md
  try {
    const { updateTaskInMd } = require('./task-file-service');
    const { join } = require('path');
    const wsRoot = process.env.ATH_WORKSPACES_ROOT || join(process.cwd(), '.ath', 'workspaces');
    const projectDir = join(wsRoot, existing.conversation_id || 'default');
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
  return { success: true, data: { id: taskId, agent_id: targetAgentId } };
}

// ── Tool dispatch map ──────────────────────────

const TOOL_EXECUTORS: Record<string, (invocation: ToolInvocation) => ToolResult> = {
  task_list: executeTaskList,
  task_create: executeTaskCreate,
  task_update_status: executeTaskUpdateStatus,
  task_assign: executeTaskAssign,
};

// ── Main entry point ───────────────────────────

export async function executeSkillTool(invocation: ToolInvocation): Promise<ToolResult> {
  try {
    validateInvocation(invocation);
    checkRateLimit(invocation.agentId);

    const executor = TOOL_EXECUTORS[invocation.toolName];
    if (!executor) {
      return { success: false, error: `No executor for tool: ${invocation.toolName}` };
    }

    const result = executor(invocation);

    // Audit log: record tool invocation as agent_event
    eventRepo.append({
      conversationId: invocation.conversationId,
      taskId: invocation.taskId,
      agentId: invocation.agentId,
      type: 'skill_tool_invocation',
      payload: {
        toolName: invocation.toolName,
        input: invocation.input,
        success: result.success,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
