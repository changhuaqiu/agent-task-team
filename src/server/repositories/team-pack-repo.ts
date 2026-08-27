import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';
import type {
  AgentTeamDefinitionInput,
  LegacyTeamPackSeedInput,
  TeamPack,
  TeamPackCommunicationMatrix,
  TeamPackWorkflow,
} from '@/types/teamPack';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface TeamPackRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  version: string;
  author: string | null;
  license: string | null;
  tags: string | null;
  category: string;
  team_mode: string;
  workflow: string;
  communication_matrix: string;
  shared_context: string | null;
  rules: string | null;
  source: string | null;
  is_preset: number;
  created_at: string;
  updated_at: string;
}

interface TeamPackRoleRow {
  id: string;
  pack_id: string;
  role_id: string;
  display_name: string;
  soul: string;
  required: number;
  description: string | null;
  role_card_id: string | null;
  role_card_snapshot: string | null;
  account_ids: string | null;
  skill_ids: string | null;
  created_at: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function rowToTeamPack(row: TeamPackRow, roles: TeamPackRoleRow[]): TeamPack {
  const db = getDb();
  const resolvedRoles = roles.flatMap((role) => {
    const agent = db.prepare('SELECT name FROM agents WHERE id=?').get(role.role_id) as { name: string } | undefined;
    return agent ? [{ id: role.role_id, displayName: agent.name, required: role.required === 1 }] : [];
  });
  const memberIds = new Set(resolvedRoles.map((role) => role.id));
  const workflow = projectWorkflowToMembers(JSON.parse(row.workflow) as TeamPackWorkflow, memberIds);
  const communicationMatrix = projectMatrixToMembers(
    JSON.parse(row.communication_matrix) as TeamPackCommunicationMatrix,
    memberIds,
  );
  return {
    id: row.id,
    specVersion: 'team-pack/0.1',
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    version: row.version,
    author: row.author ? JSON.parse(row.author) : undefined,
    license: row.license ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    category: row.category,
    teamMode: row.team_mode as 'pipeline' | 'parallel' | 'hub_spoke' | 'custom',
    workflow,
    communicationMatrix,
    sharedContext: row.shared_context ? JSON.parse(row.shared_context) : undefined,
    rules: row.rules ? JSON.parse(row.rules) : undefined,
    source: row.source ? JSON.parse(row.source) : undefined,
    isPreset: row.is_preset === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Historical role/card/capability columns stay in SQLite for migration
    // compatibility only. Current projections resolve identity from Agent.
    roles: resolvedRoles,
    revision: ((db.prepare(`SELECT MAX(aggregate_version) AS revision FROM platform_event
      WHERE aggregate_type='agent_team' AND aggregate_id=?`).get(row.id) as { revision?: number | null } | undefined)?.revision ?? 1),
  };
}

function projectWorkflowToMembers(workflow: TeamPackWorkflow, memberIds: Set<string>): TeamPackWorkflow {
  if (workflow.type === 'linear') {
    return {
      ...workflow,
      steps: (workflow.steps ?? []).filter((step) => memberIds.has(step.role)),
    };
  }
  const states = (workflow.states ?? []).filter((state) => memberIds.has(state.role));
  const stateNames = new Set(states.map((state) => state.name));
  return {
    ...workflow,
    states: states.map((state) => ({
      ...state,
      transitions: state.transitions.filter((transition) => (
        stateNames.has(transition.from) && stateNames.has(transition.to)
      )),
    })),
  };
}

function projectMatrixToMembers(
  matrix: TeamPackCommunicationMatrix,
  memberIds: Set<string>,
): TeamPackCommunicationMatrix {
  return Object.fromEntries(Object.entries(matrix).flatMap(([agentId, routes]) => {
    if (!memberIds.has(agentId)) return [];
    return [[agentId, {
      canSendTo: routes.canSendTo.filter((targetId) => memberIds.has(targetId)),
      canReceiveFrom: routes.canReceiveFrom.filter((targetId) => memberIds.has(targetId)),
      ...(routes.canEscalateTo
        ? { canEscalateTo: routes.canEscalateTo.filter((targetId) => memberIds.has(targetId)) }
        : {}),
    }]];
  }));
}

// ──────────────────────────────────────────────
// Repository
// ──────────────────────────────────────────────

export const teamPackRepo = {
  seedLegacy(input: LegacyTeamPackSeedInput): TeamPack {
    const id = generateSortableId('tp');
    const now = new Date().toISOString();
    const db = getDb();

    db.prepare(
      `INSERT INTO team_pack (id, name, display_name, description, version, author, license, tags, category, team_mode, workflow, communication_matrix, shared_context, rules, source, is_preset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      input.displayName,
      input.description,
      input.version ?? '1.0.0',
      input.author ? JSON.stringify(input.author) : null,
      input.license ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.category ?? 'team/general',
      input.teamMode ?? 'hub_spoke',
      JSON.stringify(input.workflow),
      JSON.stringify(input.communicationMatrix),
      input.sharedContext ? JSON.stringify(input.sharedContext) : null,
      input.rules ? JSON.stringify(input.rules) : null,
      input.source ? JSON.stringify(input.source) : null,
      input.isPreset ? 1 : 0,
      now,
      now
    );

    for (const inputRole of input.roles) {
      db.prepare(
        `INSERT INTO team_pack_role (
          id, pack_id, role_id, display_name, soul, required, description,
          role_card_id, role_card_snapshot, account_ids, skill_ids, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateSortableId('tpr'),
        id,
        inputRole.id,
        inputRole.displayName,
        '',
        inputRole.required ? 1 : 0,
        null,
        null,
        null,
        null,
        null,
        now
      );
    }

    return teamPackRepo.getById(id)!;
  },

  getById(id: string): TeamPack | undefined {
    const db = getDb();
    const pack = db.prepare('SELECT * FROM team_pack WHERE id = ?').get(id) as TeamPackRow | undefined;
    if (!pack) return undefined;
    const roles = db.prepare('SELECT * FROM team_pack_role WHERE pack_id = ? ORDER BY role_id').all(id) as TeamPackRoleRow[];
    return rowToTeamPack(pack, roles);
  },

  getByName(name: string): TeamPack | undefined {
    const db = getDb();
    const pack = db.prepare('SELECT * FROM team_pack WHERE name = ?').get(name) as TeamPackRow | undefined;
    if (!pack) return undefined;
    const roles = db.prepare('SELECT * FROM team_pack_role WHERE pack_id = ? ORDER BY role_id').all(pack.id) as TeamPackRoleRow[];
    return rowToTeamPack(pack, roles);
  },

  list(): TeamPack[] {
    const db = getDb();
    const packs = db.prepare('SELECT * FROM team_pack ORDER BY name ASC').all() as TeamPackRow[];
    return packs.map(pack => {
      const roles = db.prepare('SELECT * FROM team_pack_role WHERE pack_id = ? ORDER BY role_id').all(pack.id) as TeamPackRoleRow[];
      return rowToTeamPack(pack, roles);
    });
  },

  reconcileLegacySeed(id: string, updates: Partial<LegacyTeamPackSeedInput>): void {
    const db = getDb();
    const now = new Date().toISOString();
    const applyUpdate = db.transaction(() => {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.displayName !== undefined) { sets.push('display_name = ?'); values.push(updates.displayName); }
    if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
    if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
    if (updates.version !== undefined) { sets.push('version = ?'); values.push(updates.version); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
    if (updates.teamMode !== undefined) { sets.push('team_mode = ?'); values.push(updates.teamMode); }
    if (updates.workflow !== undefined) { sets.push('workflow = ?'); values.push(JSON.stringify(updates.workflow)); }
    if (updates.communicationMatrix !== undefined) { sets.push('communication_matrix = ?'); values.push(JSON.stringify(updates.communicationMatrix)); }
    if (updates.sharedContext !== undefined) { sets.push('shared_context = ?'); values.push(updates.sharedContext ? JSON.stringify(updates.sharedContext) : null); }
    if (updates.rules !== undefined) { sets.push('rules = ?'); values.push(updates.rules ? JSON.stringify(updates.rules) : null); }
    if (updates.isPreset !== undefined) { sets.push('is_preset = ?'); values.push(updates.isPreset ? 1 : 0); }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE team_pack SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    if (updates.roles !== undefined) {
      db.prepare('DELETE FROM team_pack_role WHERE pack_id = ?').run(id);
      for (const inputRole of updates.roles) {
        db.prepare(
          `INSERT INTO team_pack_role (
            id, pack_id, role_id, display_name, soul, required, description,
            role_card_id, role_card_snapshot, account_ids, skill_ids, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          generateSortableId('tpr'),
          id,
          inputRole.id,
          inputRole.displayName,
          '',
          inputRole.required ? 1 : 0,
          null,
          null,
          null,
          null,
          null,
          now
        );
      }
    }
    });
    applyUpdate();
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM team_pack WHERE id = ?').run(id);
  },

  createFromAgentRefs(input: AgentTeamDefinitionInput): TeamPack {
    const agents = new Map((getDb().prepare('SELECT id,name FROM agents').all() as Array<{ id: string; name: string }>)
      .map((agent) => [agent.id, agent]));
    return teamPackRepo.seedLegacy({
      ...input,
      roles: input.members.map((member) => {
        const agent = agents.get(member.agentId);
        if (!agent) throw new Error(`agent_team_member_not_found:${member.agentId}`);
        return { id: agent.id, displayName: agent.name, soul: '', required: member.required !== false };
      }),
    });
  },

  updateFromAgentRefs(id: string, input: AgentTeamDefinitionInput): TeamPack {
    const agents = new Map((getDb().prepare('SELECT id,name FROM agents').all() as Array<{ id: string; name: string }>)
      .map((agent) => [agent.id, agent]));
    teamPackRepo.reconcileLegacySeed(id, {
      ...input,
      roles: input.members.map((member) => {
        const agent = agents.get(member.agentId);
        if (!agent) throw new Error(`agent_team_member_not_found:${member.agentId}`);
        return { id: agent.id, displayName: agent.name, soul: '', required: member.required !== false };
      }),
    });
    const team = teamPackRepo.getById(id);
    if (!team) throw new Error('agent_team_not_found');
    return team;
  },

};
