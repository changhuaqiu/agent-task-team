import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeManager, BRANCH_PREFIX } from './worktree-manager';

const execAsync = promisify(exec);

describe('WorktreeManager', { timeout: 15_000 }, () => {
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

  it('creates a conversation worktree from the configured project HEAD instead of stale main', async () => {
    await execAsync('git checkout -b current-project', { cwd: testRepo });
    await execAsync('git commit --allow-empty -m "project head"', { cwd: testRepo });
    const projectHead = await WorktreeManager.getHead(testRepo);

    const info = await manager.createWorktree('conv-project-head', projectHead!);

    expect(info.head).toBe(projectHead);
  });

  it('keeps Git operations in the configured repository while storing worktrees elsewhere', async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-storage-'));
    try {
      const externalManager = new WorktreeManager(testRepo, storageRoot);
      const expectedHead = await WorktreeManager.getHead(testRepo);
      const info = await externalManager.createWorktree('conv-external', expectedHead!);

      expect(path.dirname(info.path)).toBe(fs.realpathSync(storageRoot));
      expect(info.head).toBe(expectedHead);
      const { stdout } = await execAsync(`git branch --list "${BRANCH_PREFIX}/conv-external"`, { cwd: testRepo });
      expect(stdout).toContain(`${BRANCH_PREFIX}/conv-external`);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('migrates a legacy registered worktree instead of recreating its existing branch', async () => {
    const legacy = await manager.createWorktree('conv-migrate');
    await execAsync('git commit --allow-empty -m "new baseline"', { cwd: testRepo });
    const currentHead = await WorktreeManager.getHead(testRepo);
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-migrated-storage-'));
    try {
      const scopedManager = new WorktreeManager(testRepo, storageRoot);
      const migrated = await scopedManager.createWorktree('conv-migrate', currentHead!);

      expect(fs.existsSync(legacy.path)).toBe(false);
      expect(path.dirname(migrated.path)).toBe(fs.realpathSync(storageRoot));
      expect(migrated.branch).toBe(`${BRANCH_PREFIX}/conv-migrate`);
      expect(migrated.head).toBe(currentHead);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when a dirty legacy worktree would need a baseline fast-forward', async () => {
    fs.writeFileSync(path.join(testRepo, 'tracked.txt'), 'base');
    await execAsync('git add tracked.txt && git commit -m "tracked base"', { cwd: testRepo });
    const legacy = await manager.createWorktree('conv-dirty');
    fs.writeFileSync(path.join(legacy.path, 'tracked.txt'), 'local change');
    await execAsync('git commit --allow-empty -m "new baseline"', { cwd: testRepo });
    const currentHead = await WorktreeManager.getHead(testRepo);
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-dirty-storage-'));
    try {
      const scopedManager = new WorktreeManager(testRepo, storageRoot);
      await expect(scopedManager.createWorktree('conv-dirty', currentHead!))
        .rejects.toThrow('legacy_worktree_dirty');
      expect(fs.existsSync(legacy.path)).toBe(true);
      expect(fs.existsSync(path.join(storageRoot, 'conv-dirty'))).toBe(false);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('preserves committed history that is ahead of the requested baseline', async () => {
    const baseline = await WorktreeManager.getHead(testRepo);
    const legacy = await manager.createWorktree('conv-ahead');
    await execAsync('git commit --allow-empty -m "conversation work"', { cwd: legacy.path });
    const aheadHead = await WorktreeManager.getHead(legacy.path);
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-ahead-storage-'));
    try {
      const migrated = await new WorktreeManager(testRepo, storageRoot)
        .createWorktree('conv-ahead', baseline!);
      expect(migrated.head).toBe(aheadHead);
      expect(fs.existsSync(legacy.path)).toBe(false);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('fails closed without moving a diverged legacy worktree', async () => {
    const legacy = await manager.createWorktree('conv-diverged');
    await execAsync('git commit --allow-empty -m "conversation work"', { cwd: legacy.path });
    await execAsync('git commit --allow-empty -m "new incompatible baseline"', { cwd: testRepo });
    const currentHead = await WorktreeManager.getHead(testRepo);
    const legacyHead = await WorktreeManager.getHead(legacy.path);
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-diverged-storage-'));
    try {
      const scopedManager = new WorktreeManager(testRepo, storageRoot);
      await expect(scopedManager.createWorktree('conv-diverged', currentHead!))
        .rejects.toThrow('worktree_history_diverged');
      expect(await WorktreeManager.getHead(legacy.path)).toBe(legacyHead);
      expect(fs.existsSync(path.join(storageRoot, 'conv-diverged'))).toBe(false);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('attaches an existing unregistered conversation branch', async () => {
    const currentHead = await WorktreeManager.getHead(testRepo);
    await execAsync(`git branch "${BRANCH_PREFIX}/conv-unregistered" "${currentHead}"`, { cwd: testRepo });
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-unregistered-storage-'));
    try {
      const attached = await new WorktreeManager(testRepo, storageRoot)
        .createWorktree('conv-unregistered', currentHead!);
      expect(attached.branch).toBe(`${BRANCH_PREFIX}/conv-unregistered`);
      expect(attached.head).toBe(currentHead);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the matching legacy worktree is detached', async () => {
    const legacy = await manager.createWorktree('conv-detached');
    await execAsync('git checkout --detach', { cwd: legacy.path });
    const currentHead = await WorktreeManager.getHead(testRepo);
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-detached-storage-'));
    try {
      const scopedManager = new WorktreeManager(testRepo, storageRoot);
      await expect(scopedManager.createWorktree('conv-detached', currentHead!))
        .rejects.toThrow('legacy_worktree_detached');
      expect(fs.existsSync(legacy.path)).toBe(true);
      expect(fs.existsSync(path.join(storageRoot, 'conv-detached'))).toBe(false);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('moves a dirty legacy worktree without losing edits when no fast-forward is needed', async () => {
    const legacy = await manager.createWorktree('conv-dirty-equal');
    fs.writeFileSync(path.join(legacy.path, 'uncommitted.txt'), 'preserve me');
    const currentHead = await WorktreeManager.getHead(testRepo);
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-dirty-equal-storage-'));
    try {
      const migrated = await new WorktreeManager(testRepo, storageRoot)
        .createWorktree('conv-dirty-equal', currentHead!);
      expect(fs.readFileSync(path.join(migrated.path, 'uncommitted.txt'), 'utf8')).toBe('preserve me');
      expect(fs.existsSync(legacy.path)).toBe(false);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
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
