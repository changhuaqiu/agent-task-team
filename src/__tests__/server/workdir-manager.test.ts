import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkdirManager } from '@/server/workdir-manager';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
    it('creates task workdir structure on first use', () => {
      const wd = mgr().resolveWorkdir('mario', 'proj-1', 'TASK-001');
      expect(wd).toContain('proj-1');
      expect(wd).toContain('mario');
      expect(wd).toContain('TASK-001');
      expect(fs.existsSync(wd)).toBe(true);
    });

    it('reuses existing workdir for same task', () => {
      const m = mgr();
      const first = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const second = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      expect(first).toBe(second);
    });

    it('creates separate workdirs for different tasks', () => {
      const m = mgr();
      const wd1 = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const wd2 = m.resolveWorkdir('mario', 'proj-1', 'TASK-002');
      expect(wd1).not.toBe(wd2);
    });

    it('shares base directory across tasks for same agent+project', () => {
      const m = mgr();
      m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.resolveWorkdir('mario', 'proj-1', 'TASK-002');
      const basePath = path.join(tmpRoot, 'proj-1', 'mario', 'base');
      expect(fs.existsSync(basePath)).toBe(true);
    });
  });

  describe('writeSessionMeta / readSessionMeta', () => {
    it('writes and reads session metadata', () => {
      const m = mgr();
      m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
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
    it('removes task dirs with expired gc_meta', () => {
      const m = mgr();
      const wd = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const gcPath = path.join(path.dirname(wd), '.gc_meta.json');
      fs.writeFileSync(gcPath, JSON.stringify({
        taskId: 'TASK-001',
        completedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      }));
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(false);
    });

    it('keeps task dirs within TTL', () => {
      const m = mgr();
      const wd = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      const gcPath = path.join(path.dirname(wd), '.gc_meta.json');
      fs.writeFileSync(gcPath, JSON.stringify({
        taskId: 'TASK-001',
        completedAt: new Date().toISOString(),
      }));
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(true);
    });

    it('keeps active dirs without gc_meta', () => {
      const m = mgr();
      const wd = m.resolveWorkdir('mario', 'proj-1', 'TASK-001');
      m.gc(24 * 3600 * 1000);
      expect(fs.existsSync(wd)).toBe(true);
    });
  });
});
