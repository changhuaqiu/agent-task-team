import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { WorktreeManager } from './worktree-manager';

interface GCMeta {
  completedAt: string;
}

/** Keep resumable ACP turns on one cwd when no task id is present. */
export function stableWorkdirTaskKey(taskId?: string): string {
  return taskId?.trim() || 'adhoc';
}

/** Encode an external business identifier as one portable path segment. */
function safeWorkdirSegment(value: string): string {
  const trimmed = value.trim();
  let sanitized = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '') || '_';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  if (sanitized === trimmed) return sanitized;
  const suffix = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 8);
  return `${sanitized}~${suffix}`;
}

/**
 * A configured non-worktree project is the runtime's real filesystem scope.
 * Scratch space is only a fallback for conversations without a valid path.
 */
export function resolveNonWorktreeExecutionCwd(projectPath: string | undefined, scratchCwd: string): string {
  const candidate = projectPath?.trim();
  if (!candidate) return scratchCwd;
  try {
    const resolved = path.resolve(candidate);
    return fs.statSync(resolved).isDirectory() ? resolved : scratchCwd;
  } catch {
    return scratchCwd;
  }
}

export class WorkdirManager {
  private root: string;
  private worktreeManager: WorktreeManager;
  private repoWorktreeManagers = new Map<string, WorktreeManager>();

  constructor(root: string, repoRoot?: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.worktreeManager = new WorktreeManager(repoRoot || root);
  }

  private managerForRepo(repoRoot?: string): WorktreeManager {
    if (!repoRoot) return this.worktreeManager;
    const normalizedRoot = path.resolve(repoRoot);
    const repoKey = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot;
    const existing = this.repoWorktreeManagers.get(repoKey);
    if (existing) return existing;
    const repoHash = crypto.createHash('sha256').update(repoKey).digest('hex').slice(0, 12);
    const manager = new WorktreeManager(normalizedRoot, path.join(this.root, '.worktrees', repoHash));
    this.repoWorktreeManagers.set(repoKey, manager);
    return manager;
  }

  private async resolveProjectWorkdir(projectSlug: string, startPoint?: string, repoRoot?: string): Promise<string> {
    const manager = this.managerForRepo(repoRoot);
    const worktreePath = manager.getWorktreePath(projectSlug);

    if (!await manager.exists(projectSlug)) {
      await manager.createWorktree(projectSlug, startPoint);
    }

    return worktreePath;
  }

  getWorktreeManager(repoRoot?: string): WorktreeManager {
    return this.managerForRepo(repoRoot);
  }

  private taskRoot(agentId: string, projectId: string, taskId: string): string {
    return path.join(
      this.root,
      safeWorkdirSegment(projectId),
      safeWorkdirSegment(agentId),
      `task-${safeWorkdirSegment(taskId)}`,
    );
  }

  async resolveWorkdir(
    agentId: string,
    projectId: string,
    taskId: string,
    options?: { useWorktree?: boolean; projectSlug?: string; startPoint?: string; repoRoot?: string },
  ): Promise<string> {
    if (options?.useWorktree && options?.projectSlug) {
      return this.resolveProjectWorkdir(options.projectSlug, options.startPoint, options.repoRoot);
    }

    const safeProjectId = safeWorkdirSegment(projectId);
    const safeAgentId = safeWorkdirSegment(agentId);
    const safeTaskId = safeWorkdirSegment(taskId);
    const baseDir = path.join(this.root, safeProjectId, safeAgentId, 'base');
    fs.mkdirSync(baseDir, { recursive: true });

    const taskDir = path.join(path.dirname(baseDir), `task-${safeTaskId}`, 'workdir');
    fs.mkdirSync(taskDir, { recursive: true });

    return taskDir;
  }

  writeGCMeta(agentId: string, projectId: string, taskId: string): void {
    const taskRoot = this.taskRoot(agentId, projectId, taskId);
    fs.mkdirSync(taskRoot, { recursive: true });
    const gcPath = path.join(taskRoot, '.gc_meta.json');
    fs.writeFileSync(gcPath, JSON.stringify({
      completedAt: new Date().toISOString(),
    }));
  }

  gc(ttlMs: number): void {
    if (!fs.existsSync(this.root)) return;

    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    for (const projectDir of entries) {
      if (!projectDir.isDirectory()) continue;
      const projectPath = path.join(this.root, projectDir.name);
      const agents = fs.readdirSync(projectPath, { withFileTypes: true });
      for (const agentDir of agents) {
        if (!agentDir.isDirectory()) continue;
        const agentPath = path.join(projectPath, agentDir.name);
        const tasks = fs.readdirSync(agentPath, { withFileTypes: true });
        for (const taskDir of tasks) {
          if (!taskDir.isDirectory() || !taskDir.name.startsWith('task-')) continue;
          const taskPath = path.join(agentPath, taskDir.name);

          const gcPath = path.join(taskPath, '.gc_meta.json');
          if (!fs.existsSync(gcPath)) {
            continue;
          }

          const meta: GCMeta = JSON.parse(fs.readFileSync(gcPath, 'utf-8'));
          const age = Date.now() - new Date(meta.completedAt).getTime();
          if (age > ttlMs) {
            fs.rmSync(taskPath, { recursive: true, force: true });
          }
        }
      }
    }
  }

  async gcWorktrees(activeSlugs: Set<string>): Promise<string[]> {
    const removed: string[] = [];

    for (const manager of new Set([this.worktreeManager, ...this.repoWorktreeManagers.values()])) {
      const allWorktrees = await manager.listWorktrees();
      for (const wt of allWorktrees) {
        const slug = wt.branch.replace('worktree/', '');
        if (activeSlugs.has(slug)) continue;
        try {
          await manager.removeWorktree(slug);
          removed.push(slug);
        } catch {
          // Worktree might be locked or have unmerged changes
        }
      }
    }

    return removed;
  }

}
