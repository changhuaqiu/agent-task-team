import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { basename } from 'path';
import { readTasksMd } from './task-file-service';
import { taskRepo } from './repositories/task-repo';
import { publishTaskChangeNotification, resolveTaskNotificationAudience } from './task-flow/task-notification-publisher';
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

export function startTaskWatcher(projectPath: string, io: IOServer): void {
  if (watchers.has(projectPath)) return;

  const tasksFile = `${projectPath}/.ath/TASKS.md`;
  const watcher = watch(tasksFile, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('change', () => {
    if (debounceTimers.has(projectPath)) clearTimeout(debounceTimers.get(projectPath)!);
    debounceTimers.set(projectPath, setTimeout(() => {
      debounceTimers.delete(projectPath);
      syncTasksToDb(projectPath, io);
    }, 500));
  });

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
  const { existsSync, readFileSync } = require('fs');
  const { join } = require('path');
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

  const newlyDone: string[] = [];
  const conversationId = conversationIdFromPath(projectPath);

  for (const t of parsed) {
    const existing = taskRepo.getById(t.id);
    if (!existing) {
      try {
        taskRepo.create({
          id: t.id,
          conversation_id: conversationId,
          title: t.title,
          description: t.deliverable || '',
          agent_id: t.agent || '',
          dependencies: t.depends,
        });
      } catch (e) {
        console.error(`[watcher] failed to create task ${t.id}:`, e);
      }
      continue;
    }

    const updates: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (existing.status !== t.status) {
      updates.status = t.status;
      changedFields.push('status');
      if (t.status === 'done') newlyDone.push(t.id);
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
    const nextDependencies = JSON.stringify(t.depends);
    if (normalizeDependencyList(existing.dependencies) !== nextDependencies) {
      updates.dependencies = nextDependencies;
      changedFields.push('dependencies');
    }

    if (changedFields.length > 0) {
      taskRepo.update(t.id, updates);
      const updated = taskRepo.getById(t.id);
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

  // Dependency resolution: check if any todo tasks are now unblocked
  for (const doneId of newlyDone) {
    for (const t of parsed) {
      if (t.depends.includes(doneId) && t.status === 'pending' && t.agent) {
        const allDone = t.depends.every((depId) => {
          const dep = parsed.find((p) => p.id === depId);
          return dep?.status === 'done';
        });
        if (allDone) {
          io.to(conversationId).emit('task.wakeup', {
            conversationId,
            taskId: t.id,
            agentId: t.agent,
            reasonCode: 'dependency_resolved',
            dispatchSource: 'workflow',
            prompt: `依赖已满足，开始执行 ${t.id}: ${t.title}. ${t.deliverable || ''}`,
            content: `系统轻推 @${t.agent}：${t.id}「${t.title}」依赖已满足，请继续处理。`,
            metadata: {
              taskId: t.id,
              taskTitle: t.title,
              taskStatus: t.status,
              ownerAgentId: t.agent,
              reasonCode: 'dependency_resolved',
              idempotencyKey: `${conversationId}:${t.id}:${t.agent}:dependency_resolved`,
              startsA2AHandoff: false,
              startsDispatch: true,
            },
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  // Notify coordinators when downstream tasks are unblocked but have no owner
  for (const doneId of newlyDone) {
    for (const t of parsed) {
      if (t.depends.includes(doneId) && t.status === 'pending' && !t.agent) {
        const allDone = t.depends.every((depId) => {
          const dep = parsed.find((p) => p.id === depId);
          return dep?.status === 'done';
        });
        if (allDone) {
          const audience = resolveTaskNotificationAudience(conversationId);
          for (const coordinatorId of audience.coordinatorAgentIds) {
            io.to(conversationId).emit('task.wakeup', {
              conversationId,
              taskId: t.id,
              agentId: coordinatorId,
              reasonCode: 'unblocked_unassigned',
              dispatchSource: 'workflow',
              prompt: `请分配负责人：${t.id}: ${t.title} 的依赖已全部满足，但尚未分配负责人。请指定负责人并更新任务看板。`,
              content: `系统轻推 @${coordinatorId}：${t.id}「${t.title}」依赖已满足，需要分配负责人。`,
              metadata: {
                taskId: t.id,
                taskTitle: t.title,
                taskStatus: t.status,
                ownerAgentId: '',
                reasonCode: 'unblocked_unassigned',
                idempotencyKey: `${conversationId}:${t.id}:${coordinatorId}:unblocked_unassigned`,
                startsA2AHandoff: false,
                startsDispatch: true,
              },
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  io.to(conversationId).emit('task.sync', { projectPath, conversationId, tasks: parsed, blockers });
}
