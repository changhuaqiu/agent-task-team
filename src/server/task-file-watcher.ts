import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readTasksMd, updateTaskInMd } from './task-file-service';
import { canTransitionTask, taskRepo } from './repositories/task-repo';
import type { TaskPatch, TaskStatus } from './repositories/task-repo';
import {
  stableTaskCommandKey,
  taskCommandService,
} from './repositories/task-command-service';
import { invocationRepo } from './repositories/invocation-repo';
import { conversationRepo } from './repositories/conversation-repo';
import { proofLogRepo } from './repositories/proof-log-repo';
import { taskGraphRepo } from './repositories/task-graph-repo';
import { hasCurrentVerifiedMerge } from './task-flow/task-gate-evidence';
import { publishTaskChangeNotification } from './task-flow/task-notification-publisher';
import type { Server as IOServer } from 'socket.io';

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function watcherKey(projectPath: string, conversationId: string): string {
  return `${conversationId}\0${resolve(projectPath)}`;
}

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
    && invocation.status !== 'terminated'
  ));
}

function isProtectedProjectionTransition(conversationId: string, nextStatus: string): boolean {
  if (nextStatus === 'done') return true;
  if (nextStatus !== 'in_review') return false;
  return Boolean(conversationRepo.getById(conversationId)?.git_repo_root);
}

function isProtectedGitReceiptRollback(conversationId: string, taskId: string, authoritativeStatus: string): boolean {
  if (!conversationRepo.getById(conversationId)?.git_repo_root) return false;
  const actions = taskGraphRepo.listActionsForTask(taskId);
  if (authoritativeStatus === 'in_review') {
    return actions.some((action) => action.type === 'task.pull_request_submitted');
  }
  return authoritativeStatus === 'done' && hasCurrentVerifiedMerge(actions);
}

function rejectProjectionTransition(input: {
  projectPath: string;
  conversationId: string;
  localTaskId: string;
  storageTaskId: string;
  attemptedStatus: TaskStatus;
  authoritativeStatus: TaskStatus;
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
    projectId: input.conversationId,
    projectPath: input.projectPath,
    conversationId: input.conversationId,
    taskId: input.storageTaskId,
    reasonCode,
    message: input.attemptedStatus === 'done'
      ? `Task ${input.localTaskId} 不能通过 TASKS.md 进入 done；必须由当前 QualityGate passed 事件完成。状态已恢复为 ${input.authoritativeStatus}。`
      : `Git 任务 ${input.localTaskId} 不能通过 TASKS.md 进入 ${input.attemptedStatus}；请使用结构化 PR/review 回执。状态已恢复为 ${input.authoritativeStatus}。`,
  });
  updateTaskInMd(input.projectPath, input.localTaskId, { status: input.authoritativeStatus });
}

function rejectInvalidProjectionTransition(input: {
  projectPath: string;
  conversationId: string;
  localTaskId: string;
  storageTaskId: string;
  attemptedStatus: TaskStatus;
  authoritativeStatus: TaskStatus;
  io: IOServer;
}): void {
  const reasonCode = 'task_state.invalid_projection_transition';
  proofLogRepo.append({
    eventType: 'task_graph.transition.blocked',
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
    projectId: input.conversationId,
    projectPath: input.projectPath,
    conversationId: input.conversationId,
    taskId: input.storageTaskId,
    reasonCode,
    message: `TASKS.md 请求了非法任务迁移 ${input.authoritativeStatus} → ${input.attemptedStatus}；权威状态未改变。`,
  });
  updateTaskInMd(input.projectPath, input.localTaskId, { status: input.authoritativeStatus });
}

export function startTaskWatcher(
  projectPath: string,
  conversationId: string,
  io: IOServer,
): () => void {
  const key = watcherKey(projectPath, conversationId);
  if (watchers.has(key)) return () => undefined;

  const tasksFile = `${projectPath}/.ath/TASKS.md`;
  const watcher = watch(tasksFile, {
    persistent: true,
    // Existing files must be reprojected after daemon restart; creation after
    // startup is handled by the same `add` path.
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  const scheduleSync = () => {
    if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key)!);
    debounceTimers.set(key, setTimeout(() => {
      debounceTimers.delete(key);
      syncTasksToDb(projectPath, conversationId, io);
    }, 500));
  };

  // Both a pre-existing file and the normal first-run creation are `add`.
  watcher.on('add', scheduleSync);
  watcher.on('change', scheduleSync);

  watchers.set(key, watcher);

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    if (watchers.get(key) !== watcher) return;
    void watcher.close();
    watchers.delete(key);
    const timer = debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(key);
    }
  };
}

export function syncTasksToDb(
  projectPath: string,
  conversationId: string,
  io: IOServer,
  options: { throwOnError?: boolean } = {},
): void {
  const tasksFile = join(projectPath, '.ath', 'TASKS.md');
  const failures: Error[] = [];

  const { tasks: parsed, blockers } = readTasksMd(projectPath);

  // Alert when file exists and has content but parser returned 0 tasks
  if (parsed.length === 0) {
    if (existsSync(tasksFile)) {
      const raw = readFileSync(tasksFile, 'utf-8');
      const nonEmptyLines = raw.split('\n').filter((l: string) => l.trim().length > 0);
      if (nonEmptyLines.length > 2) {
        console.warn(`[task-watcher] TASKS.md has ${nonEmptyLines.length} lines but parsed 0 tasks — possible format issue at ${tasksFile}`);
        io.to(conversationId).emit('task.sync_error', {
          projectId: conversationId,
          projectPath,
          conversationId,
          message: `TASKS.md 解析失败：文件有 ${nonEmptyLines.length} 行内容但未识别到任何任务。请检查表格格式。`,
          lineCount: nonEmptyLines.length,
        });
      }
    }
    if (blockers.length === 0) return;
  }

  const storageIds = resolveTaskStorageIds(conversationId, parsed.map((task) => task.id));

  for (const t of parsed) {
    const storageId = storageIds.get(t.id)!;
    const storageDependencies = t.depends.map((dependencyId) => (
      storageIds.get(dependencyId) ?? dependencyId
    ));
    const existing = taskRepo.getById(storageId);
    if (!existing) {
      try {
        const createKey = stableTaskCommandKey('task-file:create', {
          conversationId,
          storageId,
          task: t,
          storageDependencies,
        });
        const created = taskCommandService.create({
          conversationId,
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            conversationId,
            createKey,
          ),
          idempotencyKey: createKey,
          actor: { type: 'system' as const, id: 'task-file-watcher' },
          correlationId: `task-file:${conversationId}`,
          causationId: tasksFile,
          task: {
            id: storageId,
            title: t.title,
            description: t.deliverable || '',
            agent_id: t.agent || '',
            dependencies: storageDependencies,
            initialStatus: t.status === 'proposed' ? 'proposed' : 'ready',
          },
        }).tasks[0]!;
        if (created.status !== t.status && isProtectedProjectionTransition(conversationId, t.status)) {
          rejectProjectionTransition({
            projectPath,
            conversationId,
            localTaskId: t.id,
            storageTaskId: storageId,
            attemptedStatus: t.status,
            authoritativeStatus: created.status,
            io,
          });
        } else if (created.status !== t.status) {
          const transitionKey = stableTaskCommandKey('task-file:transition', {
            conversationId,
            storageId,
            expectedTaskRevision: created.revision,
            to: t.status,
          });
          const updated = taskCommandService.transition({
            conversationId,
            taskId: storageId,
            expectedTaskRevision: created.revision,
            expectedGraphRevision: taskCommandService.expectedGraphRevision(
              conversationId,
              transitionKey,
            ),
            idempotencyKey: transitionKey,
            actor: { type: 'system', id: 'task-file-watcher' },
            correlationId: `task-file:${conversationId}`,
            causationId: tasksFile,
            to: t.status,
          }).result.task;
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
        failures.push(e instanceof Error ? e : new Error(String(e)));
      }
      continue;
    }

    const updates: Partial<TaskPatch> = {};
    const changedFields: string[] = [];

    const stalePendingDuringActiveInvocation = existing.status === 'in_progress'
      && t.status === 'ready'
      && hasActiveTaskInvocation(conversationId, storageId, existing.agent_id);
    const protectedProjectionTransition = existing.status !== t.status
      && (isProtectedProjectionTransition(conversationId, t.status)
        || isProtectedGitReceiptRollback(conversationId, storageId, existing.status));
    if (protectedProjectionTransition) {
      rejectProjectionTransition({
        projectPath,
        conversationId,
        localTaskId: t.id,
        storageTaskId: storageId,
        attemptedStatus: t.status,
        authoritativeStatus: existing.status,
        io,
      });
    } else if (existing.status !== t.status && !stalePendingDuringActiveInvocation) {
      if (canTransitionTask(existing.status, t.status)) {
        changedFields.push('status');
      } else {
        rejectInvalidProjectionTransition({
          projectPath,
          conversationId,
          localTaskId: t.id,
          storageTaskId: storageId,
          attemptedStatus: t.status,
          authoritativeStatus: existing.status,
          io,
        });
      }
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
      let current = existing;
      if (Object.keys(updates).length > 0) {
        const { dependencies: dependencyProjection, ...fieldUpdates } = updates;
        const updateKey = stableTaskCommandKey('task-file:update', {
          conversationId,
          storageId,
          expectedTaskRevision: current.revision,
          updates,
        });
        const commandInput = {
          conversationId,
          taskId: storageId,
          expectedTaskRevision: current.revision,
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            conversationId,
            updateKey,
          ),
          idempotencyKey: updateKey,
          actor: { type: 'system' as const, id: 'task-file-watcher' },
          correlationId: `task-file:${conversationId}`,
          causationId: tasksFile,
        };
        current = dependencyProjection === undefined
          ? taskCommandService.update({
              ...commandInput,
              updates: fieldUpdates,
            }).result.task
          : taskCommandService.replaceDependencies({
              ...commandInput,
              dependencyTaskIds: storageDependencies,
              updates: fieldUpdates,
            }).result.task;
      }
      if (changedFields.includes('status')) {
        const transitionKey = stableTaskCommandKey('task-file:transition', {
          conversationId,
          storageId,
          expectedTaskRevision: current.revision,
          to: t.status,
        });
        current = taskCommandService.transition({
          conversationId,
          taskId: storageId,
          expectedTaskRevision: current.revision,
          expectedGraphRevision: taskCommandService.expectedGraphRevision(
            conversationId,
            transitionKey,
          ),
          idempotencyKey: transitionKey,
          actor: { type: 'system', id: 'task-file-watcher' },
          correlationId: `task-file:${conversationId}`,
          causationId: tasksFile,
          to: t.status,
        }).result.task;
      }
      const updated = current;
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

  if (options.throwOnError && failures.length > 0) {
    throw new AggregateError(failures, `task_sync_failed:${failures.length}`);
  }

  const authoritativeTasks = parsed.map((task) => {
    const storageId = storageIds.get(task.id)!;
    const authoritative = taskRepo.getById(storageId);
    if (!authoritative) return task;
    return {
      ...task,
      title: authoritative.title,
      deliverable: authoritative.description ?? '',
      status: authoritative.status,
      agent: authoritative.agent_id ?? '',
    };
  });

  io.to(conversationId).emit('task.sync', {
    projectId: conversationId,
    projectPath,
    conversationId,
    tasks: authoritativeTasks,
    blockers,
  });
}
