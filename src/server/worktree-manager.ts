import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

export const BRANCH_PREFIX = 'worktree';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export class WorktreeManager {
  private repoRoot: string;
  private worktreeBase: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    const raw = path.join(repoRoot, '.worktrees');
    fs.mkdirSync(raw, { recursive: true });
    this.worktreeBase = fs.realpathSync(raw);
  }

  // ── Git detection ──────────────────────────────────

  static async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: dirPath });
      return true;
    } catch {
      return false;
    }
  }

  static async getRepoRoot(dirPath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel', { cwd: dirPath });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  // ── Worktree CRUD ──────────────────────────────────

  async createWorktree(projectSlug: string): Promise<WorktreeInfo> {
    if (await this.exists(projectSlug)) {
      return this.getWorktreeInfo(projectSlug);
    }

    const branchName = `${BRANCH_PREFIX}/${projectSlug}`;
    const worktreePath = path.join(this.worktreeBase, projectSlug);

    await execAsync(
      `git worktree add -b "${branchName}" "${worktreePath}" main`,
      { cwd: this.repoRoot },
    );

    return {
      path: worktreePath,
      branch: branchName,
      head: await this.getHead(worktreePath),
    };
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const { stdout } = await execAsync('git worktree list --porcelain', { cwd: this.repoRoot });

    const worktrees: WorktreeInfo[] = [];
    const lines = stdout.split('\n');

    let current: Partial<WorktreeInfo> = {};
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = { path: line.slice(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      }
    }

    if (current.path) {
      worktrees.push(current as WorktreeInfo);
    }

    const base = path.resolve(this.worktreeBase);
    return worktrees.filter((worktree) => {
      const relative = path.relative(base, path.resolve(worktree.path));
      return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  async removeWorktree(projectSlug: string): Promise<void> {
    const branchName = `${BRANCH_PREFIX}/${projectSlug}`;
    const worktreePath = path.join(this.worktreeBase, projectSlug);

    await execAsync(`git worktree remove "${worktreePath}"`, { cwd: this.repoRoot });
    try {
      await execAsync(`git branch -d "${branchName}"`, { cwd: this.repoRoot });
    } catch {
      // Branch might not be merged yet
    }
  }

  async exists(projectSlug: string): Promise<boolean> {
    const worktreePath = path.join(this.worktreeBase, projectSlug);
    return fs.existsSync(worktreePath);
  }

  getWorktreePath(projectSlug: string): string {
    return path.join(this.worktreeBase, projectSlug);
  }

  getBranchName(projectSlug: string): string {
    return `${BRANCH_PREFIX}/${projectSlug}`;
  }

  // ── Private ────────────────────────────────────────

  private async getWorktreeInfo(projectSlug: string): Promise<WorktreeInfo> {
    const worktreePath = this.getWorktreePath(projectSlug);
    return {
      path: worktreePath,
      branch: this.getBranchName(projectSlug),
      head: await this.getHead(worktreePath),
    };
  }

  private async getHead(worktreePath: string): Promise<string> {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: worktreePath });
    return stdout.trim();
  }
}
