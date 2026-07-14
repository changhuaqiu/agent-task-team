import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { seedPresetAgents } from '@/server/db/seed-agents';
import { seedTeamPacks } from '@/server/seed-team-packs';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { writeAccount } from '@/server/accounts-file';
import { RepositoryHarnessPlanner } from '@/server/harness/context-planner';

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  setTestDb(createTestDb());
  seedPresetAgents();
  seedTeamPacks();
  previousDataDir = process.env.ATH_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'ath-harness-'));
  process.env.ATH_DATA_DIR = dataDir;
});
afterEach(() => {
  resetDb();
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ATH_DATA_DIR;
  else process.env.ATH_DATA_DIR = previousDataDir;
});

describe('RepositoryHarnessPlanner', () => {
  it('resolves role, account, context and project data on the server', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'luigi', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai',
      name: 'OpenAI',
      authMode: 'oauth',
      provider: 'openai',
      models: [],
      enabled: true,
      status: 'valid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({
      id: 'conv-1',
      title: 'Harness Project',
      team_pack_id: pack.id,
      project_path: 'C:/workspace/project',
    });
    taskRepo.create({
      id: 'TASK-1',
      conversation_id: 'conv-1',
      title: 'Implement server loop',
      description: 'Move continuation to the server',
      agent_id: 'luigi',
    });

    const result = await new RepositoryHarnessPlanner().prepare({
      id: 'trigger-1',
      source: 'workflow',
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      agentId: 'luigi',
      prompt: 'Start TASK-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      engine: 'codex',
      accountId: 'account-openai',
      runtimeId: 'codex-cli',
      projectPath: 'C:/workspace/project',
    });
    expect(result.plan.prompt).toContain('TASK-1');
    expect(result.plan.systemPrompt).toContain('Luigi');
  });

  it('blocks with a stable reason when the role has no enabled runtime profile', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    conversationRepo.create({ id: 'conv-2', title: 'No Runtime', team_pack_id: pack.id });

    const result = await new RepositoryHarnessPlanner().prepare({
      id: 'trigger-2',
      source: 'system',
      conversationId: 'conv-2',
      agentId: 'luigi',
      prompt: 'Continue',
    });

    expect(result).toEqual({
      ok: false,
      outcome: { status: 'blocked', reasonCode: 'runtime_profile_missing' },
    });
  });
});
