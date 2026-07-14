import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeManager, BRANCH_PREFIX } from './worktree-manager';

const execAsync = promisify(exec);

describe('WorktreeManager', () => {
  let testRepo: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'));
    await execAsync('git init -b main', { cwd: testRepo });
    await execAsync('git commit --allow-empty -m "init"', { cwd: testRepo });
    manager = new WorktreeManager(testRepo);
  });

  afterEach(() => {
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  it('should create a worktree with worktree/ prefix from main', async () => {
    const info = await manager.createWorktree('conv-abc123');
    expect(info.branch).toBe(`${BRANCH_PREFIX}/conv-abc123`);
    expect(fs.existsSync(info.path)).toBe(true);
  });

  it('should not duplicate an existing worktree', async () => {
    const first = await manager.createWorktree('conv-dup');
    const second = await manager.createWorktree('conv-dup');
    expect(first.path).toBe(second.path);
    expect(first.branch).toBe(second.branch);
  });

  it('should list worktrees', async () => {
    await manager.createWorktree('conv-wt1');
    await manager.createWorktree('conv-wt2');
    const worktrees = await manager.listWorktrees();
    expect(worktrees.length).toBe(2);
  });

  it('should remove a worktree', async () => {
    await manager.createWorktree('conv-rm');
    await manager.removeWorktree('conv-rm');
    expect(await manager.exists('conv-rm')).toBe(false);
  });

  it('should report exists=false for non-existent worktree', async () => {
    expect(await manager.exists('never-created')).toBe(false);
  });

  it('should return correct worktree path', () => {
    const p = manager.getWorktreePath('conv-path');
    expect(p.replaceAll('\\', '/')).toContain('.worktrees/conv-path');
  });

  it('should return correct branch name', () => {
    const b = manager.getBranchName('conv-branch');
    expect(b).toBe(`${BRANCH_PREFIX}/conv-branch`);
  });

  it('should return valid head commit in worktree info', async () => {
    const info = await manager.createWorktree('conv-head');
    expect(info.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('should only list worktrees under .worktrees directory', async () => {
    await manager.createWorktree('conv-filter');
    const worktrees = await manager.listWorktrees();
    const allStartWithBase = worktrees.every((w) =>
      w.path.includes('.worktrees'),
    );
    expect(allStartWithBase).toBe(true);
  });

  describe('isGitRepo', () => {
    it('should return true for a git repo', async () => {
      expect(await WorktreeManager.isGitRepo(testRepo)).toBe(true);
    });

    it('should return false for a non-git directory', async () => {
      const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
      try {
        expect(await WorktreeManager.isGitRepo(nonGit)).toBe(false);
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
    });
  });

  describe('getRepoRoot', () => {
    it('should return repo root for a git repo', async () => {
      const root = await WorktreeManager.getRepoRoot(testRepo);
      expect(path.resolve(root!)).toBe(path.resolve(fs.realpathSync(testRepo)));
    });

    it('should return null for a non-git directory', async () => {
      const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
      try {
        expect(await WorktreeManager.getRepoRoot(nonGit)).toBeNull();
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
    });
  });
});
