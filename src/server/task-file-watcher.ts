import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readTasksMd, writeTasksMd, type ParsedTask } from './task-file-service';
import { taskRepo } from './repositories/task-repo';
import { proofLogRepo } from './repositories/proof-log-repo';
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

function localTaskId(conversationId: string, storageTaskId: string): string {
  const prefix = `${conversationId}~`;
  return storageTaskId.startsWith(prefix) ? storageTaskId.slice(prefix.length) : storageTaskId;
}

function projectionEquals(left: ParsedTask[], right: ParsedTask[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function startTaskWatcher(projectPath: string, conversationId: string, io: IOServer): void {
  const key = watcherKey(projectPath, conversationId);
  if (watchers.has(key)) return;

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
}

export function stopTaskWatcher(projectPath: string, conversationId: string): void {
  const key = watcherKey(projectPath, conversationId);
  const watcher = watchers.get(key);
  if (watcher) {
    watcher.close();
    watchers.delete(key);
  }
  const timer = debounceTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(key);
  }
}

export function syncTasksToDb(projectPath: string, conversationId: string, io: IOServer): void {
  const tasksFile = join(projectPath, '.ath', 'TASKS.md');

  const { tasks: parsed, blockers } = readTasksMd(projectPath);

  // Alert when file exists and has content but parser returned 0 tasks
  if (parsed.length === 0) {
    if (existsSync(tasksFile)) {
      const raw = readFileSync(tasksFile, 'utf-8');
      const nonEmptyLines = raw.split('\n').filter((l: string) => l.trim().length > 0);
      if (nonEmptyLines.length > 2) {
        console.warn(`[task-watcher] TASKS.md has ${nonEmptyLines.length} lines but parsed 0 tasks — possible format issue at ${tasksFile}`);
        io.to(conversationId).emit('task.sync_error', {
          projectPath,
          conversationId,
          message: `TASKS.md 解析失败：文件有 ${nonEmptyLines.length} 行内容但未识别到任何任务。请检查表格格式。`,
          lineCount: nonEmptyLines.length,
        });
      }
    }
  }

  const storageIds = resolveTaskStorageIds(conversationId, parsed.map((task) => task.id));
  const parsedByStorageId = new Map(parsed.map((task) => [storageIds.get(task.id)!, task]));
  const authoritativeRows = taskRepo.getByConversation(conversationId);
  const authoritativeIds = new Set(authoritativeRows.map((task) => task.id));
  const drifts: Array<{ taskId: string; attempted?: ParsedTask; authoritative?: ParsedTask }> = [];

  for (const task of parsed) {
    const storageId = storageIds.get(task.id)!;
    if (!authoritativeIds.has(storageId)) {
      drifts.push({ taskId: storageId, attempted: task });
    }
  }

  const authoritativeTasks = authoritativeRows.map((row): ParsedTask => {
    const prior = parsedByStorageId.get(row.id);
    const dependencyIds = JSON.parse(normalizeDependencyList(row.dependencies)) as string[];
    const projection: ParsedTask = {
      id: prior?.id ?? localTaskId(conversationId, row.id),
      title: row.title,
      phase: prior?.phase ?? '',
      role: prior?.role ?? 'worker',
      agent: row.agent_id ?? '',
      status: row.status,
      depends: dependencyIds.map((dependencyId) => localTaskId(conversationId, dependencyId)),
      deliverable: row.description ?? '',
    };
    if (!prior || !projectionEquals([prior], [projection])) {
      drifts.push({ taskId: row.id, attempted: prior, authoritative: projection });
    }
    return projection;
  });

  if (!projectionEquals(parsed, authoritativeTasks)) {
    writeTasksMd(projectPath, authoritativeTasks, blockers);
  }

  for (const drift of drifts) {
    proofLogRepo.append({
      eventType: 'task_graph.file_projection.reconciled',
      conversationId,
      taskId: drift.taskId,
      actorId: 'task-file-watcher',
      reasonCode: 'task_graph.file_projection_read_only',
      metadata: {
        source: 'TASKS.md',
        attempted: drift.attempted,
        authoritative: drift.authoritative,
      },
    });
  }

  if (drifts.length > 0) {
    io.to(conversationId).emit('task.sync_error', {
      projectPath,
      conversationId,
      reasonCode: 'task_graph.file_projection_read_only',
      taskIds: drifts.map((drift) => drift.taskId),
      message: 'TASKS.md 是只读投影；文件漂移已按 Task Graph 权威状态恢复。',
    });
  }

  io.to(conversationId).emit('task.sync', {
    projectPath,
    conversationId,
    tasks: authoritativeTasks,
    blockers,
  });
}
