import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const BRANCH_PREFIX = 'worktree';

interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

interface RegisteredWorktree {
  path: string;
  branch?: string;
  head: string;
}

export interface WorktreeDispatchBaseline {
  useWorktree: boolean;
  repoRoot?: string;
  startPoint?: string;
}

export class WorktreeManager {
  private repoRoot: string;
  private worktreeBase: string;

  constructor(repoRoot: string, worktreeBase?: string) {
    this.repoRoot = repoRoot;
    const raw = worktreeBase ?? path.join(repoRoot, '.worktrees');
    fs.mkdirSync(raw, { recursive: true });
    this.worktreeBase = fs.realpathSync(raw);
  }

  // ── Git detection ──────────────────────────────────

  static async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dirPath });
      return true;
    } catch {
      return false;
    }
  }

  static async getRepoRoot(dirPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: dirPath });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  static async getHead(dirPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dirPath });
      const head = stdout.trim();
      return /^[0-9a-f]{40}$/i.test(head) ? head : null;
    } catch {
      return null;
    }
  }

  static async resolveDispatchBaseline(input: {
    projectPath?: string;
    useWorktree: boolean;
    startPoint?: string;
  }): Promise<WorktreeDispatchBaseline> {
    if (!input.useWorktree) return { useWorktree: false };
    const projectPath = input.projectPath?.trim();
    if (!projectPath) throw new Error('Git-backed dispatch requires projectPath');
    if (!await WorktreeManager.isGitRepo(projectPath)) {
      throw new Error('configured project path is not a Git worktree');
    }
    const repoRoot = await WorktreeManager.getRepoRoot(projectPath) ?? undefined;
    const head = await WorktreeManager.getHead(projectPath) ?? undefined;
    if (!repoRoot || !head) throw new Error('git repo root or HEAD could not be resolved');
    return {
      useWorktree: true,
      repoRoot,
      startPoint: input.startPoint ?? head,
    };
  }

  // ── Worktree CRUD ──────────────────────────────────

  async createWorktree(projectSlug: string, startPoint = 'main'): Promise<WorktreeInfo> {
    const branchName = `${BRANCH_PREFIX}/${projectSlug}`;
    const worktreePath = path.join(this.worktreeBase, projectSlug);
    const allWorktrees = await this.listAllWorktrees();
    const targetRegistration = allWorktrees.find(
      (worktree) => path.resolve(worktree.path) === path.resolve(worktreePath),
    );
    if (fs.existsSync(worktreePath)) {
      if (targetRegistration?.branch === branchName) {
        return this.getWorktreeInfo(projectSlug);
      }
      throw new Error(`worktree_target_exists: ${worktreePath}`);
    }

    const registered = allWorktrees.find((worktree) => worktree.branch === branchName);
    if (registered) {
      return this.migrateRegisteredWorktree(registered as WorktreeInfo, worktreePath, startPoint);
    }
    const detachedLegacy = allWorktrees.find((worktree) => (
      !worktree.branch
      && path.basename(path.resolve(worktree.path)) === projectSlug
      && path.resolve(worktree.path) !== path.resolve(worktreePath)
    ));
    if (detachedLegacy) {
      throw new Error(`legacy_worktree_detached: ${detachedLegacy.path}`);
    }

    const existingBranchHead = await this.getBranchHead(branchName);
    if (existingBranchHead) {
      await this.assertCompatibleHistory(existingBranchHead, startPoint);
      await execFileAsync('git', ['worktree', 'add', worktreePath, branchName], { cwd: this.repoRoot });
      await this.fastForwardIfBehind(worktreePath, existingBranchHead, startPoint);
      return this.getWorktreeInfo(projectSlug);
    }

    await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, startPoint], { cwd: this.repoRoot });

    return {
      path: worktreePath,
      branch: branchName,
      head: await this.getHead(worktreePath),
    };
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const worktrees = await this.listAllWorktrees();

    const base = path.resolve(this.worktreeBase);
    return worktrees.filter((worktree): worktree is WorktreeInfo => {
      if (!worktree.branch) return false;
      const relative = path.relative(base, path.resolve(worktree.path));
      return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  async removeWorktree(projectSlug: string): Promise<void> {
    const branchName = `${BRANCH_PREFIX}/${projectSlug}`;
    const worktreePath = path.join(this.worktreeBase, projectSlug);

    await execFileAsync('git', ['worktree', 'remove', worktreePath], { cwd: this.repoRoot });
    try {
      await execFileAsync('git', ['branch', '-d', branchName], { cwd: this.repoRoot });
    } catch {
      // Branch might not be merged yet
    }
  }

  async exists(projectSlug: string): Promise<boolean> {
    const worktreePath = path.join(this.worktreeBase, projectSlug);
    if (!fs.existsSync(worktreePath)) return false;
    const branchName = this.getBranchName(projectSlug);
    return (await this.listAllWorktrees()).some((worktree) => (
      path.resolve(worktree.path) === path.resolve(worktreePath)
      && worktree.branch === branchName
    ));
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
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath });
    return stdout.trim();
  }

  private async listAllWorktrees(): Promise<RegisteredWorktree[]> {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: this.repoRoot });
    const worktrees: RegisteredWorktree[] = [];
    let current: Partial<RegisteredWorktree> = {};

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path && current.head) worktrees.push(current as RegisteredWorktree);
        current = { path: line.slice(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      }
    }
    if (current.path && current.head) worktrees.push(current as RegisteredWorktree);
    return worktrees;
  }

  private async getBranchHead(branchName: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${branchName}`], { cwd: this.repoRoot });
      const head = stdout.trim();
      return /^[0-9a-f]{40}$/i.test(head) ? head : null;
    } catch {
      return null;
    }
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: this.repoRoot });
      return true;
    } catch {
      return false;
    }
  }

  private async assertCompatibleHistory(existingHead: string, startPoint: string): Promise<void> {
    if (existingHead === startPoint) return;
    const existingIsAncestor = await this.isAncestor(existingHead, startPoint);
    const startIsAncestor = await this.isAncestor(startPoint, existingHead);
    if (!existingIsAncestor && !startIsAncestor) {
      throw new Error(`worktree_history_diverged: existing ${existingHead} is not compatible with baseline ${startPoint}`);
    }
  }

  private async fastForwardIfBehind(worktreePath: string, existingHead: string, startPoint: string): Promise<void> {
    if (existingHead === startPoint || !await this.isAncestor(existingHead, startPoint)) return;
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: worktreePath });
    if (stdout.trim()) {
      throw new Error('legacy_worktree_dirty: cannot fast-forward a worktree with uncommitted changes');
    }
    await execFileAsync('git', ['merge', '--ff-only', startPoint], { cwd: worktreePath });
  }

  private async migrateRegisteredWorktree(
    registered: WorktreeInfo,
    targetPath: string,
    startPoint: string,
  ): Promise<WorktreeInfo> {
    if (path.resolve(registered.path) === path.resolve(targetPath)) {
      return {
        ...registered,
        head: await this.getHead(targetPath),
      };
    }
    if (fs.existsSync(targetPath)) {
      throw new Error(`worktree_target_exists: ${targetPath}`);
    }

    await this.assertCompatibleHistory(registered.head, startPoint);
    if (registered.head !== startPoint && await this.isAncestor(registered.head, startPoint)) {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: registered.path });
      if (stdout.trim()) {
        throw new Error('legacy_worktree_dirty: cannot migrate and fast-forward a worktree with uncommitted changes');
      }
    }

    await execFileAsync('git', ['worktree', 'move', registered.path, targetPath], { cwd: this.repoRoot });
    await this.fastForwardIfBehind(targetPath, registered.head, startPoint);
    return {
      path: targetPath,
      branch: registered.branch,
      head: await this.getHead(targetPath),
    };
  }
}
