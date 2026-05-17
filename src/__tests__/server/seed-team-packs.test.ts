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
  it('upgrades existing default Toad role to the backend implementation card', () => {
    const pack = teamPackRepo.create({
      name: 'default-team',
      displayName: '默认团队（Mario 6人组）',
      description: 'Legacy default team',
      roles: [
        {
          id: 'toad',
          displayName: '后端开发',
          required: true,
          description: '后端服务、API 开发、数据库',
          soul: '# 后端开发',
        },
      ],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });
    const staleSnapshot = {
      name: 'toad',
      displayName: '后端开发',
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
      WHERE pack_id = ? AND role_id = 'toad'
    `).run(JSON.stringify(staleSnapshot), pack.id);

    seedTeamPacks();

    const toad = teamPackRepo.getById(pack.id)?.roles.find((role) => role.id === 'toad');
    expect(toad?.roleCardId).toBe('preset-backend');
    expect(toad?.roleCardSnapshot?.sourceRoleCardId).toBe('preset-backend');
    expect(toad?.roleCardSnapshot?.allowedActions).toContain('can_modify_code');
    expect(toad?.roleCardSnapshot?.allowedActions).not.toContain('can_propose_only');
  });
});
