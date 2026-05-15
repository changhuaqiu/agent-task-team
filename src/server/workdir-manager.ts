import fs from 'fs';
import path from 'path';
import { WorktreeManager } from './worktree-manager';

export interface SessionMeta {
  sessionId: string;
  updatedAt: string;
}

export interface GCMeta {
  taskId: string;
  completedAt: string;
}

export class WorkdirManager {
  private root: string;
  private worktreeManager: WorktreeManager;
  private activeDirs: Set<string> = new Set();

  constructor(root: string, repoRoot?: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.worktreeManager = new WorktreeManager(repoRoot || root);
  }

  async resolveProjectWorkdir(projectSlug: string): Promise<string> {
    const worktreePath = this.worktreeManager.getWorktreePath(projectSlug);

    if (!await this.worktreeManager.exists(projectSlug)) {
      await this.worktreeManager.createWorktree(projectSlug);
    }

    return worktreePath;
  }

  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager;
  }

  async resolveWorkdir(
    agentId: string,
    projectId: string,
    taskId: string,
    options?: { useWorktree?: boolean; projectSlug?: string },
  ): Promise<string> {
    if (options?.useWorktree && options?.projectSlug) {
      return this.resolveProjectWorkdir(options.projectSlug);
    }

    const baseDir = path.join(this.root, projectId, agentId, 'base');
    fs.mkdirSync(baseDir, { recursive: true });

    const taskDir = path.join(path.dirname(baseDir), `task-${taskId}`, 'workdir');
    fs.mkdirSync(taskDir, { recursive: true });

    this.activeDirs.add(path.dirname(taskDir));
    return taskDir;
  }

  writeSessionMeta(agentId: string, projectId: string, taskId: string, meta: SessionMeta): void {
    const taskRoot = path.join(this.root, projectId, agentId, `task-${taskId}`);
    const metaPath = path.join(taskRoot, '.session.json');
    fs.writeFileSync(metaPath, JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }));
  }

  readSessionMeta(agentId: string, projectId: string, taskId: string): SessionMeta | null {
    const metaPath = path.join(this.root, projectId, agentId, `task-${taskId}`, '.session.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  writeGCMeta(agentId: string, projectId: string, taskId: string): void {
    const taskRoot = path.join(this.root, projectId, agentId, `task-${taskId}`);
    const gcPath = path.join(taskRoot, '.gc_meta.json');
    fs.writeFileSync(gcPath, JSON.stringify({
      taskId,
      completedAt: new Date().toISOString(),
    }));
    this.activeDirs.delete(taskRoot);
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
    const allWorktrees = await this.worktreeManager.listWorktrees();
    const removed: string[] = [];

    for (const wt of allWorktrees) {
      const slug = wt.branch.replace('worktree/', '');
      if (activeSlugs.has(slug)) continue;
      try {
        await this.worktreeManager.removeWorktree(slug);
        removed.push(slug);
      } catch {
        // Worktree might be locked or have unmerged changes
      }
    }

    return removed;
  }

  refreshContextFiles(workdir: string, context: { roleCardContent?: string; teamInfo?: string }): void {
    if (context.roleCardContent) {
      fs.writeFileSync(path.join(workdir, '.ath-role.md'), context.roleCardContent);
    }
    if (context.teamInfo) {
      fs.writeFileSync(path.join(workdir, '.ath-team.md'), context.teamInfo);
    }
  }
}
