import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

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

  async createWorktree(projectSlug: string): Promise<WorktreeInfo> {
    const branchName = `feature/${projectSlug}`;
    const worktreePath = path.join(this.worktreeBase, branchName);

    await execAsync(
      `git worktree add -b ${branchName} ${worktreePath}`,
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

    return worktrees.filter((w) => w.path.startsWith(this.worktreeBase));
  }

  async removeWorktree(projectSlug: string): Promise<void> {
    const branchName = `feature/${projectSlug}`;
    const worktreePath = path.join(this.worktreeBase, branchName);

    await execAsync(`git worktree remove ${worktreePath}`, { cwd: this.repoRoot });
    try {
      await execAsync(`git branch -d ${branchName}`, { cwd: this.repoRoot });
    } catch {
      // Branch might not be merged yet, that's okay
    }
  }

  async exists(projectSlug: string): Promise<boolean> {
    const branchName = `feature/${projectSlug}`;
    const worktreePath = path.join(this.worktreeBase, branchName);
    return fs.existsSync(worktreePath);
  }

  getWorktreePath(projectSlug: string): string {
    return path.join(this.worktreeBase, `feature/${projectSlug}`);
  }

  private async getHead(worktreePath: string): Promise<string> {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: worktreePath });
    return stdout.trim();
  }
}
