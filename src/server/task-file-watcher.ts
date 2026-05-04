import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { basename } from 'path';
import { readTasksMd } from './task-file-service';
import { taskRepo } from './repositories/task-repo';
import type { Server as IOServer } from 'socket.io';

function conversationIdFromPath(projectPath: string): string {
  return basename(projectPath);
}

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  const { tasks: parsed, blockers } = readTasksMd(projectPath);
  if (parsed.length === 0 && blockers.length === 0) return;

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

    if (existing.status !== t.status) {
      taskRepo.updateStatus(t.id, t.status);
      if (t.status === 'done') newlyDone.push(t.id);
    }
    if (t.agent && existing.agent_id !== t.agent) {
      taskRepo.update(t.id, { agent_id: t.agent });
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
          io.emit('task.ready', { taskId: t.id, agentId: t.agent, projectPath });
        }
      }
    }
  }

  io.emit('task.sync', { projectPath, conversationId, tasks: parsed, blockers });
}
