import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('team_pack tables exist after migration', () => {
  it('has team_pack table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_pack'").all();
    expect(tables).toHaveLength(1);
  });

  it('has team_pack_role table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_pack_role'").all();
    expect(tables).toHaveLength(1);
  });

  it('does not retain the retired agent_team_pack table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_team_pack'").all();
    expect(tables).toEqual([]);
  });
});

describe('teamPackRepo.create', () => {
  it('creates a team pack with roles', () => {
    const pack = teamPackRepo.create({
      name: 'test-trio',
      displayName: 'Test Trio',
      description: 'A test team pack',
      roles: [
        { id: 'role-a', displayName: 'Role A', soul: '# Role A', required: true },
        { id: 'role-b', displayName: 'Role B', soul: '# Role B', required: false, description: 'Optional role' },
      ],
      workflow: { type: 'linear', steps: [{ role: 'role-a', action: 'do thing', output: 'result' }] },
      communicationMatrix: {
        'role-a': { canSendTo: ['role-b'], canReceiveFrom: ['role-b'] },
        'role-b': { canSendTo: ['role-a'], canReceiveFrom: ['role-a'] },
      },
    });

    expect(pack.id).toMatch(/^tp-/);
    expect(pack.name).toBe('test-trio');
    expect(pack.displayName).toBe('Test Trio');
    expect(pack.roles).toHaveLength(2);
    expect(pack.roles[0].id).toBe('role-a');
    expect(pack.roles[0].required).toBe(true);
    expect(pack.roles[1].description).toBe('Optional role');
    expect(pack.workflow.type).toBe('linear');
    expect(pack.communicationMatrix['role-a'].canSendTo).toEqual(['role-b']);
  });

  it('enforces unique name', () => {
    teamPackRepo.create({
      name: 'unique-pack',
      displayName: 'Pack 1',
      description: 'First',
      roles: [],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    expect(() => teamPackRepo.create({
      name: 'unique-pack',
      displayName: 'Pack 2',
      description: 'Duplicate',
      roles: [],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    })).toThrow();
  });

  it('persists role snapshot, account IDs, and skill IDs on team pack roles', () => {
    const pack = teamPackRepo.create({
      name: 'role-snapshot-pack',
      displayName: 'Role Snapshot Pack',
      description: 'Stores member config',
      roles: [{
        id: 'planner',
        displayName: '规划师',
        soul: '# 规划师',
        required: true,
        roleCardSnapshot: {
          name: 'planner',
          displayName: '团队内规划师',
          description: 'Plans work',
          category: 'planner',
          tags: [],
          applicableScenarios: [],
          responsibilities: ['Plan'],
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
          sourceRoleCardId: 'preset-planner',
          snapshotVersion: 1,
          snapshottedAt: '2026-05-06T00:00:00.000Z',
        },
        accountIds: ['acc-1'],
        skillIds: ['skill-1'],
      }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    const fetched = teamPackRepo.getById(pack.id)!;
    expect(fetched.roles[0].roleCardSnapshot?.displayName).toBe('团队内规划师');
    expect(fetched.roles[0].accountIds).toEqual(['acc-1']);
    expect(fetched.roles[0].skillIds).toEqual(['skill-1']);
  });

  it('creates self-contained snapshots for roles without role cards', () => {
    const pack = teamPackRepo.create({
      name: 'self-contained-pack',
      displayName: 'Self-contained Pack',
      description: 'Creates member snapshots',
      roles: [{
        id: 'planner',
        displayName: '规划师',
        soul: '# 规划师\n\n负责拆解工作。',
        required: true,
        description: 'Plans work',
      }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    expect(pack.roles[0].roleCardSnapshot?.displayName).toBe('规划师');
    expect(pack.roles[0].roleCardSnapshot?.sourceRoleCardId).toBeUndefined();
    expect(pack.roles[0].roleCardSnapshot?.snapshotVersion).toBe(1);
  });
});

describe('teamPackRepo.getById / getByName', () => {
  it('retrieves by id', () => {
    const created = teamPackRepo.create({
      name: 'get-test',
      displayName: 'Get Test',
      description: 'Test',
      roles: [{ id: 'r1', displayName: 'R1', soul: '#R1', required: true }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    const fetched = teamPackRepo.getById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('get-test');
    expect(fetched!.roles).toHaveLength(1);
  });

  it('retrieves by name', () => {
    teamPackRepo.create({
      name: 'by-name-test',
      displayName: 'By Name',
      description: 'Test',
      roles: [],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    const fetched = teamPackRepo.getByName('by-name-test');
    expect(fetched).toBeDefined();
    expect(fetched!.displayName).toBe('By Name');
  });

  it('returns undefined for non-existent id', () => {
    expect(teamPackRepo.getById('non-existent')).toBeUndefined();
  });
});

describe('teamPackRepo.update', () => {
  it('updates editable team pack fields and replaces roles with snapshots', () => {
    const pack = teamPackRepo.create({
      name: 'editable-pack',
      displayName: 'Editable Pack',
      description: 'Before',
      roles: [{ id: 'planner', displayName: '规划师', soul: '# 规划师', required: true }],
      teamMode: 'pipeline',
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    teamPackRepo.update(pack.id, {
      displayName: 'Edited Pack',
      description: 'After',
      teamMode: 'parallel',
      roles: [
        { id: 'writer', displayName: '撰稿人', soul: '# 撰稿人', required: true, description: 'Writes docs' },
        { id: 'reviewer', displayName: '审查者', soul: '# 审查者', required: false, description: 'Reviews docs' },
      ],
      workflow: {
        type: 'linear',
        steps: [{ role: 'writer', action: 'write', output: 'draft' }],
      },
      communicationMatrix: {
        writer: { canSendTo: ['reviewer'], canReceiveFrom: ['reviewer'] },
        reviewer: { canSendTo: ['writer'], canReceiveFrom: ['writer'] },
      },
    });

    const updated = teamPackRepo.getById(pack.id)!;
    expect(updated.displayName).toBe('Edited Pack');
    expect(updated.description).toBe('After');
    expect(updated.teamMode).toBe('parallel');
    expect(updated.roles.map((role) => role.id)).toEqual(['reviewer', 'writer']);
    expect(updated.roles[0].roleCardSnapshot?.displayName).toBe('审查者');
    expect(updated.workflow.steps?.[0].role).toBe('writer');
    expect(updated.communicationMatrix.writer.canSendTo).toEqual(['reviewer']);
  });

  it('rolls back metadata and roles when role replacement fails', () => {
    const pack = teamPackRepo.create({
      name: 'atomic-pack',
      displayName: 'Before',
      description: 'Atomic update',
      roles: [{ id: 'planner', displayName: '规划师', soul: '# 规划师', required: true }],
      teamMode: 'pipeline',
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    expect(() => teamPackRepo.update(pack.id, {
      displayName: 'Should Roll Back',
      roles: [
        { id: 'duplicate', displayName: 'A', soul: '# A', required: true },
        { id: 'duplicate', displayName: 'B', soul: '# B', required: true },
      ],
    })).toThrow();

    const unchanged = teamPackRepo.getById(pack.id)!;
    expect(unchanged.displayName).toBe('Before');
    expect(unchanged.roles.map((role) => role.id)).toEqual(['planner']);
  });
});

describe('teamPackRepo.updateRoleConfig', () => {
  it('updates persisted role config and returns the updated role', () => {
    const pack = teamPackRepo.create({
      name: 'update-role-config-pack',
      displayName: 'Update Role Config Pack',
      description: 'Updates member config',
      roles: [{ id: 'planner', displayName: '规划师', soul: '# 规划师', required: true }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    const updated = teamPackRepo.updateRoleConfig(pack.id, 'planner', {
      roleCardId: 'preset-planner',
      accountIds: ['acc-2'],
      skillIds: ['skill-2'],
    });

    expect(updated?.roleCardId).toBe('preset-planner');
    expect(updated?.accountIds).toEqual(['acc-2']);
    expect(updated?.skillIds).toEqual(['skill-2']);
    expect(teamPackRepo.getById(pack.id)?.roles[0].accountIds).toEqual(['acc-2']);
  });

  it('returns undefined when updating a missing role', () => {
    const pack = teamPackRepo.create({
      name: 'missing-role-config-pack',
      displayName: 'Missing Role Config Pack',
      description: 'Missing member config',
      roles: [{ id: 'planner', displayName: '规划师', soul: '# 规划师', required: true }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    expect(teamPackRepo.updateRoleConfig(pack.id, 'missing', { accountIds: ['acc-3'] })).toBeUndefined();
  });
});

describe('teamPackRepo.materializeRoleSnapshots', () => {
  it('copies role card definitions into missing role snapshots', () => {
    const pack = teamPackRepo.create({
      name: 'materialize-role-card-pack',
      displayName: 'Materialize Role Card Pack',
      description: 'Uses existing role card as source',
      roles: [{
        id: 'planner',
        displayName: '规划师',
        soul: '# 规划师',
        required: true,
        roleCardId: 'preset-planner',
        roleCardSnapshot: undefined,
      }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    db.prepare('UPDATE team_pack_role SET role_card_snapshot = NULL WHERE pack_id = ? AND role_id = ?').run(pack.id, 'planner');

    const materialized = teamPackRepo.materializeRoleSnapshots(pack.id);

    expect(materialized?.roles[0].roleCardSnapshot?.sourceRoleCardId).toBe('preset-planner');
    expect(materialized?.roles[0].roleCardSnapshot?.displayName).toBeTruthy();
    expect(teamPackRepo.getById(pack.id)?.roles[0].roleCardSnapshot?.sourceRoleCardId).toBe('preset-planner');
  });
});

describe('teamPackRepo.list', () => {
  it('lists all packs ordered by name', () => {
    teamPackRepo.create({ name: 'z-pack', displayName: 'Z', description: '', roles: [], workflow: { type: 'linear' }, communicationMatrix: {} });
    teamPackRepo.create({ name: 'a-pack', displayName: 'A', description: '', roles: [], workflow: { type: 'linear' }, communicationMatrix: {} });

    const list = teamPackRepo.list();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('a-pack');
    expect(list[1].name).toBe('z-pack');
  });
});

describe('teamPackRepo.delete', () => {
  it('deletes pack and cascades to roles', () => {
    const pack = teamPackRepo.create({
      name: 'to-delete',
      displayName: 'Delete Me',
      description: '',
      roles: [{ id: 'r1', displayName: 'R1', soul: '#', required: true }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    teamPackRepo.delete(pack.id);
    expect(teamPackRepo.getById(pack.id)).toBeUndefined();

    const roleRows = db.prepare('SELECT * FROM team_pack_role WHERE pack_id = ?').all(pack.id);
    expect(roleRows).toHaveLength(0);
  });
});
