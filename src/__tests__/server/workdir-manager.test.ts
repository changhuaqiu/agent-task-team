import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveNonWorktreeExecutionCwd, safeWorkdirSegment, stableWorkdirTaskKey, WorkdirManager } from '@/server/workdir-manager';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const tmpRoot = path.join(os.tmpdir(), `ath-wd-test-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('WorkdirManager', () => {
  const mgr = () => new WorkdirManager(tmpRoot);

  describe('resolveWorkdir', () => {
    it('creates task workdir structure on first use', async () => {
      const wd = await mgr().resolveWorkdir('mario', 'proj-1', 'TASK-001');
      expect(wd).toContain('proj-1');
      expect(wd).toContain('mario');
      expect(wd).toContain('TASK-001');
      expect(fs.existsSync(wd)).toBe(true);
    });

    it('reuses existing workdir for same task', async () => {
      const m = mgr();
      const first = await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const second = await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      expect(first).toBe(second);
    });

    it('creates separate workdirs for different tasks', async () => {
      const m = mgr();
      const wd1 = await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const wd2 = await m.resolveWorkdir('mario', 'proj-1', 'TASK-002');
      expect(wd1).not.toBe(wd2);
    });

    it('shares base directory across tasks for same agent+project', async () => {
      const m = mgr();
      await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      await m.resolveWorkdir('mario', 'proj-1', 'TASK-002');
      const basePath = path.join(tmpRoot, 'proj-1', 'mario', 'base');
      expect(fs.existsSync(basePath)).toBe(true);
    });

    it('encodes Windows-reserved characters in scoped task IDs', async () => {
      const taskId = 'conv-1:TASK-001';
      const wd = await mgr().resolveWorkdir('peach', 'conv-1', taskId);
      expect(path.basename(path.dirname(wd))).toBe(`task-${safeWorkdirSegment(taskId)}`);
      expect(wd).not.toContain(':TASK');
      expect(fs.existsSync(wd)).toBe(true);
    });

    it('creates an isolated worktree from the configured external repository', async () => {
      const repoRoot = path.join(tmpRoot, 'external-repo');
      fs.mkdirSync(repoRoot, { recursive: true });
      await execAsync('git init -b main', { cwd: repoRoot });
      await execAsync('git commit --allow-empty -m "init"', { cwd: repoRoot });

      const m = mgr();
      const wd = await m.resolveWorkdir('mario', 'proj-1', 'TASK-EXT', {
        useWorktree: true,
        projectSlug: 'conv-external',
        startPoint: 'HEAD',
        repoRoot,
      });

      expect(wd).toContain(path.join('.worktrees', ''));
      expect(path.resolve(await m.getWorktreeManager(repoRoot).getWorktreePath('conv-external'))).toBe(path.resolve(wd));
    });
  });

  describe('writeSessionMeta / readSessionMeta', () => {
    it('writes and reads session metadata', async () => {
      const m = mgr();
      await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.writeSessionMeta('mario', 'proj-1', 'TASK-001', { sessionId: 'sess-abc' });
      const meta = m.readSessionMeta('mario', 'proj-1', 'TASK-001');
      expect(meta?.sessionId).toBe('sess-abc');
    });

    it('returns null when no session metadata exists', () => {
      const meta = mgr().readSessionMeta('mario', 'proj-1', 'TASK-999');
      expect(meta).toBeNull();
    });
  });

  describe('gc', () => {
    it('removes task dirs with expired gc_meta', async () => {
      const m = mgr();
      const wd = await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const gcPath = path.join(path.dirname(wd), '.gc_meta.json');
      fs.writeFileSync(gcPath, JSON.stringify({
        taskId: 'TASK-001',
        completedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      }));
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(false);
    });

    it('keeps task dirs within TTL', async () => {
      const m = mgr();
      const wd = await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const gcPath = path.join(path.dirname(wd), '.gc_meta.json');
      fs.writeFileSync(gcPath, JSON.stringify({
        taskId: 'TASK-001',
        completedAt: new Date().toISOString(),
      }));
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(true);
    });

    it('keeps active dirs without gc_meta', async () => {
      const m = mgr();
      const wd = await m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(true);
    });
  });
});

describe('stableWorkdirTaskKey', () => {
  it('keeps ad-hoc turns on a stable cwd', () => {
    expect(stableWorkdirTaskKey()).toBe('adhoc');
    expect(stableWorkdirTaskKey('')).toBe('adhoc');
    expect(stableWorkdirTaskKey('  ')).toBe('adhoc');
  });

  it('preserves explicit task identity', () => {
    expect(stableWorkdirTaskKey('TASK-001')).toBe('TASK-001');
  });
});

describe('resolveNonWorktreeExecutionCwd', () => {
  it('uses an existing configured project directory', () => {
    const projectDir = path.join(tmpRoot, 'real-project');
    fs.mkdirSync(projectDir, { recursive: true });
    expect(resolveNonWorktreeExecutionCwd(projectDir, path.join(tmpRoot, 'scratch'))).toBe(path.resolve(projectDir));
  });

  it('falls back to scratch when the project path is missing or invalid', () => {
    const scratch = path.join(tmpRoot, 'scratch');
    expect(resolveNonWorktreeExecutionCwd(undefined, scratch)).toBe(scratch);
    expect(resolveNonWorktreeExecutionCwd(path.join(tmpRoot, 'missing'), scratch)).toBe(scratch);
  });
});
