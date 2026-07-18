import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { seedTeamPacks } from '@/server/seed-team-packs';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
  db.close();
});

describe('seedTeamPacks', () => {
  it('marks a default team as managed on the first seed', () => {
    seedTeamPacks();

    expect(teamPackRepo.getByName('default-team')?.isPreset).toBe(true);
  });

  it('upgrades an existing default Luigi role to the full-stack implementation card', () => {
    const pack = teamPackRepo.create({
      name: 'default-team',
      displayName: '默认团队',
      description: 'Legacy default team',
      roles: [
        {
          id: 'luigi',
          displayName: '全栈开发',
          required: true,
          description: '后端服务、API 开发、数据库',
          soul: '# 后端开发',
        },
      ],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });
    const staleSnapshot = {
      name: 'luigi',
      displayName: '全栈开发',
      description: '后端服务、API 开发、数据库',
      category: 'backend',
      tags: [],
      applicableScenarios: [],
      responsibilities: [],
      nonResponsibilities: [],
      successCriteria: [],
      clarifyBeforeExecute: 'when_ambiguous',
      outputStyle: 'structured',
      preferStructuredOutput: true,
      allowedActions: ['can_propose_only'],
      requiresConfirmation: [],
      forbiddenActions: [],
      preferredEngines: [],
      allowedTools: [],
      accountIds: [],
      outputFormat: 'checklist',
      requiresEvidence: true,
      riskGrading: 'optional',
      snapshotVersion: 1,
      snapshottedAt: new Date().toISOString(),
    };
    db.prepare(`
      UPDATE team_pack_role
      SET role_card_id = NULL, role_card_snapshot = ?
      WHERE pack_id = ? AND role_id = 'luigi'
    `).run(JSON.stringify(staleSnapshot), pack.id);

    seedTeamPacks();

    const luigi = teamPackRepo.getById(pack.id)?.roles.find((role) => role.id === 'luigi');
    expect(luigi?.roleCardId).toBe('preset-frontend');
    expect(luigi?.roleCardSnapshot?.sourceRoleCardId).toBe('preset-frontend');
    expect(luigi?.roleCardSnapshot?.allowedActions).toContain('can_modify_code');
    expect(luigi?.roleCardSnapshot?.allowedActions).not.toContain('can_propose_only');
  });

  it('reconciles a stale six-role preset while preserving role bindings', () => {
    const pack = teamPackRepo.create({
      name: 'default-team',
      displayName: '旧默认团队',
      description: 'Legacy six-role team',
      roles: [
        { id: 'mario', displayName: 'Mario', required: true, soul: 'old mario', accountIds: ['acct-mario'], skillIds: ['skill-plan'] },
        { id: 'luigi', displayName: 'Luigi', required: true, soul: 'old luigi' },
        { id: 'toad', displayName: 'Toad', required: true, soul: 'old toad' },
        { id: 'peach', displayName: 'Peach', required: true, soul: 'old peach' },
        { id: 'dk', displayName: 'DK', required: true, soul: 'old dk' },
        { id: 'yoshi', displayName: 'Yoshi', required: true, soul: 'old yoshi' },
      ],
      teamMode: 'hub_spoke',
      workflow: { type: 'state_machine', states: [{ name: 'test_gate', role: 'yoshi', description: 'legacy', transitions: [] }] },
      communicationMatrix: {
        mario: { canSendTo: ['luigi', 'toad', 'peach', 'dk', 'yoshi'], canReceiveFrom: ['toad', 'yoshi'] },
        toad: { canSendTo: ['mario'], canReceiveFrom: ['mario'] },
        yoshi: { canSendTo: ['mario'], canReceiveFrom: ['mario'] },
      },
    });

    seedTeamPacks();
    seedTeamPacks();

    const reconciled = teamPackRepo.getById(pack.id)!;
    expect(reconciled.roles.map((role) => role.id)).toEqual(['dk', 'luigi', 'mario', 'peach']);
    expect(reconciled.workflow.states?.map((state) => state.name)).toEqual(['planning', 'implementing', 'quality_gate', 'merge_verify', 'done']);
    expect(JSON.stringify(reconciled.communicationMatrix)).not.toMatch(/toad|yoshi/);
    expect(reconciled.roles.find((role) => role.id === 'mario')?.accountIds).toEqual(['acct-mario']);
    expect(reconciled.roles.find((role) => role.id === 'mario')?.skillIds).toEqual(['skill-plan']);
    expect(reconciled.roles.find((role) => role.id === 'mario')?.roleCardSnapshot?.persona?.voice).toContain('沉稳');
    expect(reconciled.roles.find((role) => role.id === 'mario')?.roleCardSnapshot?.persona?.voice).not.toContain('走！');
    expect(reconciled.isPreset).toBe(true);
  });
});
