import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { resetSeq } from '@/server/repositories/sortable-id';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { agentDefinitionRepo } from '@/server/agents/agent-definition-repo';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
  resetSeq();
});

function saveAgent(id: string, name = id) {
  return agentDefinitionRepo.save({
    id, name, runtimeId: 'codex', accountIds: [], skillIds: [], instructions: `Run as ${name}.`,
  });
}

function input(memberIds: string[]) {
  return {
    name: 'delivery-team', displayName: 'Delivery Team', description: 'Coordinates real Agents.',
    members: memberIds.map((agentId) => ({ agentId, required: true })),
    teamMode: 'hub_spoke' as const,
    workflow: { type: 'linear' as const, steps: memberIds.map((role) => ({ role, action: 'work', output: 'outcome' })) },
    communicationMatrix: Object.fromEntries(memberIds.map((id) => [id, {
      canSendTo: memberIds.filter((other) => other !== id),
      canReceiveFrom: memberIds.filter((other) => other !== id),
    }])),
  };
}

describe('Agent Team repository projection', () => {
  it('keeps the historical tables for migration compatibility', () => {
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_pack'").all()).toHaveLength(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_pack_role'").all()).toHaveLength(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_team_pack'").all()).toEqual([]);
  });

  it('creates a Team from real Agent references and never writes capability snapshots', () => {
    saveAgent('builder', 'Builder');
    saveAgent('reviewer', 'Reviewer');
    const team = teamPackRepo.createFromAgentRefs(input(['builder', 'reviewer']));
    expect(team.roles).toEqual([
      expect.objectContaining({ id: 'builder', displayName: 'Builder', required: true }),
      expect.objectContaining({ id: 'reviewer', displayName: 'Reviewer', required: true }),
    ]);
    const rows = db.prepare(`SELECT role_card_id,role_card_snapshot,account_ids,skill_ids
      FROM team_pack_role WHERE pack_id=? ORDER BY role_id`).all(team.id);
    expect(rows).toEqual([
      { role_card_id: null, role_card_snapshot: null, account_ids: null, skill_ids: null },
      { role_card_id: null, role_card_snapshot: null, account_ids: null, skill_ids: null },
    ]);
  });

  it('rejects missing Agent references', () => {
    expect(() => teamPackRepo.createFromAgentRefs(input(['missing']))).toThrow('agent_team_member_not_found:missing');
  });

  it('updates collaboration topology without copying Agent configuration', () => {
    saveAgent('builder', 'Builder');
    saveAgent('reviewer', 'Reviewer');
    const team = teamPackRepo.createFromAgentRefs(input(['builder']));
    const updated = teamPackRepo.updateFromAgentRefs(team.id, { ...input(['reviewer']), displayName: 'Review Team' });
    expect(updated.displayName).toBe('Review Team');
    expect(updated.roles).toEqual([expect.objectContaining({ id: 'reviewer', displayName: 'Reviewer' })]);
  });

  it('resolves the current Agent name rather than a stale Team snapshot', () => {
    const agent = saveAgent('builder', 'Builder');
    const team = teamPackRepo.createFromAgentRefs(input(['builder']));
    agentDefinitionRepo.save({
      id: agent.id, name: 'Principal Builder', runtimeId: 'codex', accountIds: [], skillIds: [], instructions: agent.instructions,
    });
    expect(teamPackRepo.getById(team.id)?.roles[0]?.displayName).toBe('Principal Builder');
  });

  it('does not project historical orphan roles or topology edges as current Agent references', () => {
    saveAgent('builder', 'Builder');
    const team = teamPackRepo.seedLegacy({
      name: 'legacy-orphan', displayName: 'Legacy Orphan', description: '', teamMode: 'hub_spoke',
      roles: [
        { id: 'builder', displayName: 'Old Builder', soul: '', required: true },
        { id: 'missing-agent', displayName: 'Old Missing Agent', soul: '', required: true },
      ],
      workflow: { type: 'linear', steps: [
        { role: 'builder', action: 'work', output: 'result' },
        { role: 'missing-agent', action: 'review', output: 'result' },
      ] },
      communicationMatrix: {
        builder: { canSendTo: ['missing-agent'], canReceiveFrom: ['missing-agent'] },
        'missing-agent': { canSendTo: ['builder'], canReceiveFrom: ['builder'] },
      },
    });
    const projected = teamPackRepo.getById(team.id)!;
    expect(projected.roles).toEqual([{ id: 'builder', displayName: 'Builder', required: true }]);
    expect(projected.workflow.steps).toEqual([{ role: 'builder', action: 'work', output: 'result' }]);
    expect(projected.communicationMatrix).toEqual({ builder: { canSendTo: [], canReceiveFrom: [] } });
  });

  it('lists and deletes teams', () => {
    saveAgent('builder');
    const team = teamPackRepo.createFromAgentRefs(input(['builder']));
    expect(teamPackRepo.list().map((item) => item.id)).toContain(team.id);
    teamPackRepo.delete(team.id);
    expect(teamPackRepo.getById(team.id)).toBeUndefined();
  });
});
