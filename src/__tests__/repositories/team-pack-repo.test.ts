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

  it('has agent_team_pack table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_team_pack'").all();
    expect(tables).toHaveLength(1);
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

describe('teamPackRepo agent assignment', () => {
  it('assigns and retrieves agents for a pack', () => {
    const pack = teamPackRepo.create({
      name: 'assign-test',
      displayName: 'Assign',
      description: '',
      roles: [{ id: 'dev', displayName: 'Dev', soul: '#', required: true }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    teamPackRepo.assignAgentToPack('agent-1', pack.id, 'dev');
    const agents = teamPackRepo.getAgentsForPack(pack.id);
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe('agent-1');
    expect(agents[0].roleId).toBe('dev');
  });

  it('removes agent from pack', () => {
    const pack = teamPackRepo.create({
      name: 'remove-test',
      displayName: 'Remove',
      description: '',
      roles: [{ id: 'dev', displayName: 'Dev', soul: '#', required: true }],
      workflow: { type: 'linear' },
      communicationMatrix: {},
    });

    teamPackRepo.assignAgentToPack('agent-x', pack.id, 'dev');
    teamPackRepo.removeAgentFromPack('agent-x', pack.id);
    expect(teamPackRepo.getAgentsForPack(pack.id)).toHaveLength(0);
  });
});
