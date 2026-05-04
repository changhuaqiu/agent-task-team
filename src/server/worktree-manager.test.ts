import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeManager } from './worktree-manager';

const execAsync = promisify(exec);

describe('WorktreeManager', () => {
  let testRepo: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'));
    await execAsync('git init', { cwd: testRepo });
    await execAsync('git commit --allow-empty -m "init"', { cwd: testRepo });
    manager = new WorktreeManager(testRepo);
  });

  afterEach(() => {
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  it('should create a worktree', async () => {
    const info = await manager.createWorktree('test-feature');
    expect(info.branch).toBe('feature/test-feature');
    expect(fs.existsSync(info.path)).toBe(true);
  });

  it('should list worktrees', async () => {
    await manager.createWorktree('feature-1');
    await manager.createWorktree('feature-2');
    const worktrees = await manager.listWorktrees();
    expect(worktrees.length).toBe(2);
  });

  it('should remove a worktree', async () => {
    await manager.createWorktree('to-remove');
    await manager.removeWorktree('to-remove');
    expect(await manager.exists('to-remove')).toBe(false);
  });

  it('should report exists=false for non-existent worktree', async () => {
    expect(await manager.exists('never-created')).toBe(false);
  });

  it('should return correct worktree path', () => {
    const p = manager.getWorktreePath('my-project');
    expect(p).toContain('.worktrees/feature/my-project');
  });

  it('should return valid head commit in worktree info', async () => {
    const info = await manager.createWorktree('head-check');
    expect(info.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('should only list worktrees under .worktrees directory', async () => {
    await manager.createWorktree('filtered');
    const worktrees = await manager.listWorktrees();
    const allStartWithBase = worktrees.every((w) =>
      w.path.includes('.worktrees'),
    );
    expect(allStartWithBase).toBe(true);
  });
});
