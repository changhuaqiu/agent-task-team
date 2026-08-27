import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteCustomAcpHarness, listCustomAcpHarnesses, saveCustomAcpHarness } from './customCatalog';
import { loadCatalog } from './catalog';

describe('custom ACP catalog', () => {
  let dataDir = '';
  let previousDataDir: string | undefined;

  beforeEach(() => {
    previousDataDir = process.env.ATH_DATA_DIR;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-custom-acp-'));
    process.env.ATH_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.ATH_DATA_DIR;
    else process.env.ATH_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('persists a custom launcher and merges it into the startup source of truth', () => {
    const saved = saveCustomAcpHarness({
      id: 'my-agent',
      label: 'My ACP Agent',
      command: 'my-agent-acp',
      args: ['serve', '--acp'],
    });

    expect(saved).toMatchObject({
      id: 'custom:my-agent',
      launcher: {
        command: 'my-agent-acp',
        args: ['serve', '--acp'],
      },
    });
    expect(loadCatalog().some((entry) => entry.id === 'custom:my-agent')).toBe(true);
    expect(listCustomAcpHarnesses()).toHaveLength(1);
    expect(deleteCustomAcpHarness('custom:my-agent')).toBe(true);
    expect(listCustomAcpHarnesses()).toHaveLength(0);
  });

  it('rejects shell fragments disguised as a launcher command', () => {
    expect(() => saveCustomAcpHarness({
      id: 'unsafe-agent', label: 'Unsafe', command: 'agent\r\nmalicious', args: [],
    })).toThrow('custom_runtime_command_invalid');
  });

  it('rejects environment values so credentials never enter the catalog file', () => {
    expect(() => saveCustomAcpHarness({
      id: 'secret-agent', label: 'Secret', command: 'agent', args: [],
      env: { API_KEY: 'secret' } as never,
    })).toThrow('custom_runtime_env_invalid');
    expect(fs.existsSync(path.join(dataDir, 'custom-acp-runtimes.json'))).toBe(false);
  });

  it('rejects secret-bearing launcher arguments before persistence', () => {
    for (const args of [
      ['--api-key', 'secret-value'],
      ['--authorization=Bearer secret-value'],
      ['--client-secret', 'secret-value'],
      ['--key', 'sk-live-123456789'],
      ['--credential', 'hidden'],
      ['--private-key', 'hidden'],
      ['serve', 'github_pat_1234567890'],
      ['--header', 'Authorization: Bearer opaque-value'],
      ['--header', 'X-API-Key: opaque-value'],
      ['--header=Authorization: Bearer opaque-value'],
      ['-HAuthorization: Bearer opaque-value'],
    ]) {
      expect(() => saveCustomAcpHarness({
        id: 'secret-args', label: 'Secret Args', command: 'agent', args,
      })).toThrow('custom_runtime_secret_arg_invalid');
    }
    expect(fs.existsSync(path.join(dataDir, 'custom-acp-runtimes.json'))).toBe(false);
  });

  it('revalidates stored launchers written by older versions before listing them', () => {
    fs.writeFileSync(path.join(dataDir, 'custom-acp-runtimes.json'), JSON.stringify([{
      id: 'custom:legacy-secret',
      label: 'Legacy secret launcher',
      command: 'agent',
      args: ['--key', 'sk-legacy-secret'],
    }]));

    expect(listCustomAcpHarnesses()).toEqual([]);
    expect(loadCatalog().some((entry) => entry.id === 'custom:legacy-secret')).toBe(false);
  });
});
