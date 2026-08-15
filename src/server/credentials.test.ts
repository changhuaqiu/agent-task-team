import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readCredential,
  writeCredential,
  deleteCredential,
  hasCredential,
} from './credentials';

describe('credentials', () => {
  let tmpDir: string;
  const origEnv = process.env.ATH_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-'));
    process.env.ATH_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    process.env.ATH_DATA_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function credPath() {
    return path.join(tmpDir, 'credentials.json');
  }

  function readRawFile(): Record<string, { apiKey: string }> {
    return JSON.parse(fs.readFileSync(credPath(), 'utf-8'));
  }

  describe('readCredential', () => {
    it('returns null for missing id when file does not exist', () => {
      expect(readCredential('missing')).toBeNull();
    });

    it('returns null for missing id when file exists but id absent', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(credPath(), JSON.stringify({ 'acct-1': { apiKey: 'sk-abc' } }));
      expect(readCredential('acct-999')).toBeNull();
    });

    it('returns { apiKey } for existing id', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(credPath(), JSON.stringify({ 'acct-1': { apiKey: 'sk-abc' } }));
      expect(readCredential('acct-1')).toEqual({ apiKey: 'sk-abc' });
    });
  });

  describe('writeCredential', () => {
    it('creates file and directory if not exists', () => {
      const dataDir = path.join(tmpDir, 'nested', 'dir');
      process.env.ATH_DATA_DIR = dataDir;
      writeCredential('acct-1', { apiKey: 'sk-new' });
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'credentials.json'), 'utf-8'));
      expect(raw['acct-1']).toEqual({ apiKey: 'sk-new' });
    });

    it('writes correctly to new file', () => {
      writeCredential('acct-1', { apiKey: 'sk-new' });
      expect(readCredential('acct-1')).toEqual({ apiKey: 'sk-new' });
    });

    it('updates existing entry', () => {
      writeCredential('acct-1', { apiKey: 'old' });
      writeCredential('acct-1', { apiKey: 'updated' });
      expect(readCredential('acct-1')).toEqual({ apiKey: 'updated' });
    });

    it('preserves other entries when updating', () => {
      writeCredential('acct-1', { apiKey: 'a' });
      writeCredential('acct-2', { apiKey: 'b' });
      writeCredential('acct-1', { apiKey: 'updated' });
      expect(readCredential('acct-1')).toEqual({ apiKey: 'updated' });
      expect(readCredential('acct-2')).toEqual({ apiKey: 'b' });
    });

    it('sets file mode to 0o600', () => {
      writeCredential('acct-1', { apiKey: 'sk-secret' });
      const stat = fs.statSync(credPath());
      const mode = stat.mode & 0o777;
      if (process.platform !== 'win32') expect(mode).toBe(0o600);
    });

    it('uses atomic write (tmp file + rename)', () => {
      writeCredential('acct-1', { apiKey: 'sk-test' });
      const dir = fs.readdirSync(tmpDir);
      const tmpFiles = dir.filter((f) => f.startsWith('credentials.json.tmp'));
      expect(tmpFiles.length).toBe(0);
    });
  });

  describe('deleteCredential', () => {
    it('removes entry and leaves others intact', () => {
      writeCredential('acct-1', { apiKey: 'a' });
      writeCredential('acct-2', { apiKey: 'b' });
      deleteCredential('acct-1');
      expect(readCredential('acct-1')).toBeNull();
      expect(readCredential('acct-2')).toEqual({ apiKey: 'b' });
    });

    it('does nothing for missing id', () => {
      writeCredential('acct-1', { apiKey: 'a' });
      deleteCredential('acct-nope');
      expect(readCredential('acct-1')).toEqual({ apiKey: 'a' });
    });

    it('handles delete when file does not exist', () => {
      expect(() => deleteCredential('missing')).not.toThrow();
    });
  });

  describe('hasCredential', () => {
    it('returns false when no file', () => {
      expect(hasCredential('acct-1')).toBe(false);
    });

    it('returns false for missing id', () => {
      writeCredential('acct-1', { apiKey: 'a' });
      expect(hasCredential('acct-2')).toBe(false);
    });

    it('returns true for existing id', () => {
      writeCredential('acct-1', { apiKey: 'a' });
      expect(hasCredential('acct-1')).toBe(true);
    });

    it('returns false for an empty stored API key', () => {
      writeCredential('acct-empty', { apiKey: '   ' });
      expect(hasCredential('acct-empty')).toBe(false);
    });
  });

  describe('corrupt file handling', () => {
    it('returns null for readCredential when file is corrupt', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(credPath(), '{ not valid json !!!');
      expect(readCredential('acct-1')).toBeNull();
    });

    it('overwrites corrupt file on write', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(credPath(), '{ not valid json !!!');
      writeCredential('acct-1', { apiKey: 'fresh' });
      expect(readCredential('acct-1')).toEqual({ apiKey: 'fresh' });
    });
  });

  describe('config directory auto-creation', () => {
    it('creates .ath directory if missing', () => {
      const nested = path.join(tmpDir, 'deep', 'nested');
      process.env.ATH_DATA_DIR = nested;
      writeCredential('acct-1', { apiKey: 'sk-test' });
      expect(fs.existsSync(path.join(nested, 'credentials.json'))).toBe(true);
    });
  });
});
