import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/autonomous-delivery';
import accountHandler from '@/pages/api/agents/[agentId]/accounts';
import { closeDb, createTestDb, getDb, setTestDb } from '@/server/db';
import { seedPresetAgents } from '@/server/db/seed-agents';
import { parseAgentAccountIds, getAgentById } from '@/server/db/agentQueries';
import { seedTeamPacks } from '@/server/seed-team-packs';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { writeAccount } from '@/server/accounts-file';

function responseCapture() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
    setHeader() { return this; },
  } as unknown as NextApiResponse;
  return { response, read: () => ({ statusCode, body }) };
}

describe('autonomous delivery team preflight', () => {
  let dataDir: string;
  let previousDataDir: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'delivery-preflight-'));
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

  it('returns actionable missing members without creating delivery state', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    const capture = responseCapture();
    await handler({
      method: 'POST',
      body: { action: 'preflight', teamPackId: pack.id },
    } as NextApiRequest, capture.response);

    expect(capture.read()).toMatchObject({
      statusCode: 409,
      body: {
        reasonCode: 'team_runtime_profile_missing',
        error: expect.stringContaining('项目统筹'),
        missingRoles: expect.arrayContaining([expect.objectContaining({ id: 'mario' })]),
      },
    });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM conversation').get()).toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM autonomous_delivery_run').get()).toEqual({ count: 0 });
  });

  it('persists Agent accounts and lets an unconfigured TeamPack inherit them', async () => {
    for (const agentId of ['mario', 'luigi', 'peach', 'dk']) {
      const accountCapture = responseCapture();
      await accountHandler({
        method: 'POST',
        query: { agentId },
        body: { accountIds: ['acc-codex'] },
      } as unknown as NextApiRequest, accountCapture.response);
      expect(accountCapture.read()).toEqual({ statusCode: 200, body: { accountIds: ['acc-codex'] } });
      expect(parseAgentAccountIds(getAgentById(agentId)!)).toEqual(['acc-codex']);
    }

    const pack = teamPackRepo.getByName('default-team')!;
    const capture = responseCapture();
    await handler({
      method: 'POST',
      body: { action: 'preflight', teamPackId: pack.id },
    } as NextApiRequest, capture.response);
    expect(capture.read()).toEqual({ statusCode: 200, body: { ready: true, missingRoles: [] } });
  });
});
