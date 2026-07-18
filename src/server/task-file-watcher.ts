import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readTasksMd, updateTaskInMd } from './task-file-service';
import { taskRepo } from './repositories/task-repo';
import { invocationRepo } from './repositories/invocation-repo';
import { conversationRepo } from './repositories/conversation-repo';
import { proofLogRepo } from './repositories/proof-log-repo';
import { publishTaskChangeNotification } from './task-flow/task-notification-publisher';
import type { Server as IOServer } from 'socket.io';

function conversationIdFromPath(projectPath: string): string {
  return basename(projectPath);
}

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function normalizeDependencyList(value: string | null | undefined): string {
  if (!value) return '[]';
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(Array.isArray(parsed) ? parsed : []);
  } catch {
    return JSON.stringify(value.split(',').map((item) => item.trim()).filter(Boolean));
  }
}

/**
 * TASKS.md IDs are project-local labels, while the compatibility table still
 * has a database-wide primary key. Preserve legacy IDs when safe and scope
 * only collisions until the table can migrate to a composite identity.
 */
export function resolveTaskStorageIds(
  conversationId: string,
  localTaskIds: string[],
): Map<string, string> {
  return new Map(localTaskIds.map((localTaskId) => {
    const existing = taskRepo.getById(localTaskId);
    if (!existing || existing.conversation_id === conversationId) {
      return [localTaskId, localTaskId];
    }
    return [localTaskId, `${conversationId}~${localTaskId}`];
  }));
}

function hasActiveTaskInvocation(conversationId: string, taskId: string, agentId: string | null): boolean {
  return invocationRepo.getByConversation(conversationId).some((invocation) => (
    invocation.task_id === taskId
    && invocation.agent_id === agentId
    && !['succeeded', 'failed', 'canceled'].includes(invocation.status)
  ));
}

function isProtectedGitProjectionTransition(conversationId: string, nextStatus: string): boolean {
  if (nextStatus !== 'in_review' && nextStatus !== 'done') return false;
  return Boolean(conversationRepo.getById(conversationId)?.git_repo_root);
}

function rejectGitProjectionTransition(input: {
  projectPath: string;
  conversationId: string;
  localTaskId: string;
  storageTaskId: string;
  attemptedStatus: string;
  authoritativeStatus: string;
  io: IOServer;
}): void {
  const reasonCode = 'task_graph.file_projection_gate_bypass';
  proofLogRepo.append({
    eventType: 'task_graph.gate_evidence.blocked',
    conversationId: input.conversationId,
    taskId: input.storageTaskId,
    actorId: 'task-file-watcher',
    reasonCode,
    metadata: {
      attemptedStatus: input.attemptedStatus,
      authoritativeStatus: input.authoritativeStatus,
      source: 'TASKS.md',
    },
  });
  input.io.to(input.conversationId).emit('task.sync_error', {
    projectPath: input.projectPath,
    conversationId: input.conversationId,
    taskId: input.storageTaskId,
    reasonCode,
    message: `Git 任务 ${input.localTaskId} 不能通过 TASKS.md 进入 ${input.attemptedStatus}；请使用结构化 PR/review/merge 回执。状态已恢复为 ${input.authoritativeStatus}。`,
  });
  updateTaskInMd(input.projectPath, input.localTaskId, { status: input.authoritativeStatus });
}

export function startTaskWatcher(projectPath: string, io: IOServer): void {
  if (watchers.has(projectPath)) return;

  const tasksFile = `${projectPath}/.ath/TASKS.md`;
  const watcher = watch(tasksFile, {
    persistent: true,
    // Existing files must be reprojected after daemon restart; creation after
    // startup is handled by the same `add` path.
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  const scheduleSync = () => {
    if (debounceTimers.has(projectPath)) clearTimeout(debounceTimers.get(projectPath)!);
    debounceTimers.set(projectPath, setTimeout(() => {
      debounceTimers.delete(projectPath);
      syncTasksToDb(projectPath, io);
    }, 500));
  };

  // Both a pre-existing file and the normal first-run creation are `add`.
  watcher.on('add', scheduleSync);
  watcher.on('change', scheduleSync);

  watchers.set(projectPath, watcher);
}

export function stopTaskWatcher(projectPath: string): void {
  const watcher = watchers.get(projectPath);
  if (watcher) {
    watcher.close();
    watchers.delete(projectPath);
  }
  const timer = debounceTimers.get(projectPath);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(projectPath);
  }
}

export function syncTasksToDb(projectPath: string, io: IOServer): void {
  const tasksFile = join(projectPath, '.ath', 'TASKS.md');

  const { tasks: parsed, blockers } = readTasksMd(projectPath);

  // Alert when file exists and has content but parser returned 0 tasks
  if (parsed.length === 0) {
    if (existsSync(tasksFile)) {
      const raw = readFileSync(tasksFile, 'utf-8');
      const nonEmptyLines = raw.split('\n').filter((l: string) => l.trim().length > 0);
      if (nonEmptyLines.length > 2) {
        console.warn(`[task-watcher] TASKS.md has ${nonEmptyLines.length} lines but parsed 0 tasks — possible format issue at ${tasksFile}`);
        const conversationId = conversationIdFromPath(projectPath);
        io.to(conversationId).emit('task.sync_error', {
          projectPath,
          conversationId,
          message: `TASKS.md 解析失败：文件有 ${nonEmptyLines.length} 行内容但未识别到任何任务。请检查表格格式。`,
          lineCount: nonEmptyLines.length,
        });
      }
    }
    if (blockers.length === 0) return;
  }

  const conversationId = conversationIdFromPath(projectPath);
  const storageIds = resolveTaskStorageIds(conversationId, parsed.map((task) => task.id));

  for (const t of parsed) {
    const storageId = storageIds.get(t.id)!;
    const storageDependencies = t.depends.map((dependencyId) => (
      storageIds.get(dependencyId) ?? dependencyId
    ));
    const existing = taskRepo.getById(storageId);
    if (!existing) {
      try {
        const created = taskRepo.create({
          id: storageId,
          conversation_id: conversationId,
          title: t.title,
          description: t.deliverable || '',
          agent_id: t.agent || '',
          dependencies: storageDependencies,
        });
        if (created.status !== t.status && isProtectedGitProjectionTransition(conversationId, t.status)) {
          rejectGitProjectionTransition({
            projectPath,
            conversationId,
            localTaskId: t.id,
            storageTaskId: storageId,
            attemptedStatus: t.status,
            authoritativeStatus: created.status,
            io,
          });
        } else if (created.status !== t.status) {
          taskRepo.updateStatus(storageId, t.status);
          const updated = taskRepo.getById(storageId);
          if (updated) {
            publishTaskChangeNotification({
              io,
              kind: 'task.status_changed',
              task: updated,
              previousTask: created,
              actorId: 'system',
              actorType: 'system',
              changedFields: ['status'],
            });
          }
        }
      } catch (e) {
        console.error(`[watcher] failed to create task ${storageId}:`, e);
      }
      continue;
    }

    const updates: Record<string, unknown> = {};
    const changedFields: string[] = [];

    const stalePendingDuringActiveInvocation = existing.status === 'in_progress'
      && t.status === 'pending'
      && hasActiveTaskInvocation(conversationId, storageId, existing.agent_id);
    const protectedGitTransition = existing.status !== t.status
      && isProtectedGitProjectionTransition(conversationId, t.status);
    if (protectedGitTransition) {
      rejectGitProjectionTransition({
        projectPath,
        conversationId,
        localTaskId: t.id,
        storageTaskId: storageId,
        attemptedStatus: t.status,
        authoritativeStatus: existing.status,
        io,
      });
    } else if (existing.status !== t.status && !stalePendingDuringActiveInvocation) {
      updates.status = t.status;
      changedFields.push('status');
    }
    if (t.agent && existing.agent_id !== t.agent) {
      updates.agent_id = t.agent;
      changedFields.push('agent_id');
    }
    if (existing.title !== t.title) {
      updates.title = t.title;
      changedFields.push('title');
    }
    const nextDescription = t.deliverable || '';
    if ((existing.description ?? '') !== nextDescription) {
      updates.description = nextDescription;
      changedFields.push('description');
    }
    const nextDependencies = JSON.stringify(storageDependencies);
    if (normalizeDependencyList(existing.dependencies) !== nextDependencies) {
      updates.dependencies = nextDependencies;
      changedFields.push('dependencies');
    }

    if (changedFields.length > 0) {
      taskRepo.update(storageId, updates);
      const updated = taskRepo.getById(storageId);
      if (updated) {
        publishTaskChangeNotification({
          io,
          kind: changedFields.includes('agent_id')
            ? 'task.assigned'
            : changedFields.includes('status')
              ? 'task.status_changed'
              : 'task.file_synced',
          task: updated,
          previousTask: existing,
          actorId: 'system',
          actorType: 'system',
          changedFields,
        });
      }
    }
  }

  io.to(conversationId).emit('task.sync', { projectPath, conversationId, tasks: parsed, blockers });
}
