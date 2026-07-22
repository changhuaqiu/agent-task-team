import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, createTestDb, setTestDb } from '../db';
import { seedPresetAgents } from '../db/seed-agents';
import { seedTeamPacks } from '../seed-team-packs';
import { teamPackRepo } from '../repositories/team-pack-repo';
import { updateAgentAccountIds } from '../db/agentQueries';
import { writeAccount } from '../accounts-file';
import { resolveTeamPackRuntimeReadiness } from './conversation-runtime';

describe('conversation runtime account readiness', () => {
  let dataDir: string;
  let previousDataDir: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'team-runtime-readiness-'));
    previousDataDir = process.env.ATH_DATA_DIR;
    process.env.ATH_DATA_DIR = dataDir;
    setTestDb(createTestDb());
    seedPresetAgents();
    seedTeamPacks();
    writeAccount({
      id: 'acc-codex', name: 'Codex', authMode: 'oauth', provider: 'openai', models: [],
      enabled: true, status: 'unknown', createdAt: '', updatedAt: '',
    });
  });

  afterEach(() => {
    closeDb();
    if (previousDataDir === undefined) delete process.env.ATH_DATA_DIR;
    else process.env.ATH_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports every required role until persisted Agent bindings are available', () => {
    const pack = teamPackRepo.getByName('default-team')!;
    expect(resolveTeamPackRuntimeReadiness(pack.id)).toMatchObject({
      ready: false,
      missingRoles: expect.arrayContaining([
        expect.objectContaining({ id: 'mario' }),
        expect.objectContaining({ id: 'luigi' }),
        expect.objectContaining({ id: 'peach' }),
        expect.objectContaining({ id: 'dk' }),
      ]),
    });

    for (const agentId of ['mario', 'luigi', 'peach', 'dk']) {
      updateAgentAccountIds(agentId, ['acc-codex']);
    }
    expect(resolveTeamPackRuntimeReadiness(pack.id)).toEqual({ ready: true, missingRoles: [] });
  });

  it('keeps an explicit TeamPack account ahead of the global Agent fallback', () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'mario', { accountIds: ['missing-explicit'] });
    updateAgentAccountIds('mario', ['acc-codex']);
    for (const agentId of ['luigi', 'peach', 'dk']) updateAgentAccountIds(agentId, ['acc-codex']);

    expect(resolveTeamPackRuntimeReadiness(pack.id)).toMatchObject({
      ready: false,
      missingRoles: [expect.objectContaining({ id: 'mario' })],
    });
  });
});
