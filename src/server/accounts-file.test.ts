import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readAccount,
  writeAccount,
  deleteAccount,
  listAccounts,
  hasAccount,
  type AccountMeta,
} from './accounts-file';

function makeAccount(overrides: Partial<AccountMeta> = {}): AccountMeta {
  return {
    id: 'acct-1',
    name: 'Test Account',
    authMode: 'api_key',
    provider: 'anthropic',
    models: ['claude-sonnet-4-6'],
    enabled: true,
    status: 'unknown',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('accounts-file', () => {
  let tmpDir: string;
  const origEnv = process.env.ATH_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-test-'));
    process.env.ATH_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    process.env.ATH_DATA_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function acctPath() {
    return path.join(tmpDir, 'accounts.json');
  }

  describe('readAccount', () => {
    it('returns undefined for missing id when file does not exist', () => {
      expect(readAccount('missing')).toBeUndefined();
    });

    it('returns undefined for missing id when file exists', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      const acct = makeAccount({ id: 'acct-1' });
      fs.writeFileSync(acctPath(), JSON.stringify({ 'acct-1': acct }));
      expect(readAccount('acct-999')).toBeUndefined();
    });

    it('returns AccountMeta for existing id', () => {
      const acct = makeAccount();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(acctPath(), JSON.stringify({ 'acct-1': acct }));
      expect(readAccount('acct-1')).toEqual(acct);
    });
  });

  describe('writeAccount', () => {
    it('creates new entry', () => {
      const acct = makeAccount();
      writeAccount(acct);
      expect(readAccount('acct-1')).toEqual(acct);
    });

    it('creates file and directory if not exists', () => {
      const dataDir = path.join(tmpDir, 'nested', 'dir');
      process.env.ATH_DATA_DIR = dataDir;
      writeAccount(makeAccount());
      expect(fs.existsSync(path.join(dataDir, 'accounts.json'))).toBe(true);
    });

    it('updates existing entry preserving createdAt', () => {
      const original = makeAccount();
      writeAccount(original);

      const updated = makeAccount({
        name: 'Updated Name',
        updatedAt: '2026-05-02T00:00:00.000Z',
      });
      writeAccount(updated);

      const result = readAccount('acct-1')!;
      expect(result.name).toBe('Updated Name');
      expect(result.createdAt).toBe('2026-05-01T00:00:00.000Z');
    });

    it('sets createdAt on new account', () => {
      const acct = makeAccount();
      delete (acct as any).createdAt;
      delete (acct as any).updatedAt;
      writeAccount(acct);
      const stored = readAccount('acct-1')!;
      expect(stored.createdAt).toBeTruthy();
      expect(stored.updatedAt).toBeTruthy();
    });

    it('preserves other accounts when adding new one', () => {
      writeAccount(makeAccount({ id: 'acct-1', name: 'First' }));
      writeAccount(makeAccount({ id: 'acct-2', name: 'Second' }));
      expect(readAccount('acct-1')!.name).toBe('First');
      expect(readAccount('acct-2')!.name).toBe('Second');
    });
  });

  describe('deleteAccount', () => {
    it('removes entry', () => {
      writeAccount(makeAccount({ id: 'acct-1' }));
      writeAccount(makeAccount({ id: 'acct-2' }));
      deleteAccount('acct-1');
      expect(readAccount('acct-1')).toBeUndefined();
      expect(readAccount('acct-2')).toBeDefined();
    });

    it('does nothing for missing id', () => {
      writeAccount(makeAccount({ id: 'acct-1' }));
      deleteAccount('acct-nope');
      expect(readAccount('acct-1')).toBeDefined();
    });

    it('handles delete when file does not exist', () => {
      expect(() => deleteAccount('missing')).not.toThrow();
    });
  });

  describe('listAccounts', () => {
    it('returns empty array when no file', () => {
      expect(listAccounts()).toEqual([]);
    });

    it('returns all accounts as array', () => {
      writeAccount(makeAccount({ id: 'acct-1' }));
      writeAccount(makeAccount({ id: 'acct-2' }));
      const list = listAccounts();
      expect(list.length).toBe(2);
      const ids = list.map((a) => a.id).sort();
      expect(ids).toEqual(['acct-1', 'acct-2']);
    });
  });

  describe('hasAccount', () => {
    it('returns false when no file', () => {
      expect(hasAccount('acct-1')).toBe(false);
    });

    it('returns false for missing id', () => {
      writeAccount(makeAccount({ id: 'acct-1' }));
      expect(hasAccount('acct-2')).toBe(false);
    });

    it('returns true for existing id', () => {
      writeAccount(makeAccount({ id: 'acct-1' }));
      expect(hasAccount('acct-1')).toBe(true);
    });
  });

  describe('config directory auto-creation', () => {
    it('creates nested directory if missing', () => {
      const nested = path.join(tmpDir, 'deep', 'nested');
      process.env.ATH_DATA_DIR = nested;
      writeAccount(makeAccount());
      expect(fs.existsSync(path.join(nested, 'accounts.json'))).toBe(true);
    });
  });

  describe('corrupt file handling', () => {
    it('returns undefined for readAccount when file is corrupt', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(acctPath(), '{ not valid json !!!');
      expect(readAccount('acct-1')).toBeUndefined();
    });

    it('returns empty array for listAccounts when file is corrupt', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(acctPath(), '{ not valid json !!!');
      expect(listAccounts()).toEqual([]);
    });

    it('backs up corrupt file to .bak before overwrite', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(acctPath(), 'corrupt content');
      writeAccount(makeAccount());
      expect(fs.existsSync(acctPath() + '.bak')).toBe(true);
      expect(readAccount('acct-1')).toBeDefined();
    });

    it('overwrites corrupt file on write and starts fresh', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(acctPath(), '{ bad');
      writeAccount(makeAccount({ id: 'acct-1' }));
      const list = listAccounts();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('acct-1');
    });
  });

  describe('no secrets in accounts file', () => {
    it('never stores apiKey in accounts.json', () => {
      const acct = makeAccount();
      writeAccount(acct);
      const raw = JSON.parse(fs.readFileSync(acctPath(), 'utf-8'));
      const stored = raw['acct-1'];
      expect(stored.apiKey).toBeUndefined();
      expect(stored.authMode).toBe('api_key');
    });
  });
});
