import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';
import type { TeamPack, TeamPackRole, CreateTeamPackInput } from '@/types/teamPack';

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
  workflow: string;
  communication_matrix: string;
  shared_context: string | null;
  rules: string | null;
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
  created_at: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function rowToTeamPack(row: TeamPackRow, roles: TeamPackRoleRow[]): TeamPack {
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
    workflow: JSON.parse(row.workflow),
    communicationMatrix: JSON.parse(row.communication_matrix),
    sharedContext: row.shared_context ? JSON.parse(row.shared_context) : undefined,
    rules: row.rules ? JSON.parse(row.rules) : undefined,
    isPreset: row.is_preset === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    roles: roles.map(r => ({
      id: r.role_id,
      displayName: r.display_name,
      soul: r.soul,
      required: r.required === 1,
      description: r.description ?? undefined,
      roleCardId: r.role_card_id ?? undefined,
    })),
  };
}

// ──────────────────────────────────────────────
// Repository
// ──────────────────────────────────────────────

export const teamPackRepo = {
  create(input: CreateTeamPackInput): TeamPack {
    const id = generateSortableId('tp');
    const now = new Date().toISOString();
    const db = getDb();

    db.prepare(
      `INSERT INTO team_pack (id, name, display_name, description, version, author, license, tags, category, workflow, communication_matrix, shared_context, rules, is_preset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
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
      JSON.stringify(input.workflow),
      JSON.stringify(input.communicationMatrix),
      input.sharedContext ? JSON.stringify(input.sharedContext) : null,
      input.rules ? JSON.stringify(input.rules) : null,
      now,
      now
    );

    for (const role of input.roles) {
      db.prepare(
        `INSERT INTO team_pack_role (id, pack_id, role_id, display_name, soul, required, description, role_card_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateSortableId('tpr'),
        id,
        role.id,
        role.displayName,
        role.soul,
        role.required ? 1 : 0,
        role.description ?? null,
        role.roleCardId ?? null,
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

  update(id: string, updates: Partial<CreateTeamPackInput>): void {
    const db = getDb();
    const now = new Date().toISOString();
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.displayName !== undefined) { sets.push('display_name = ?'); values.push(updates.displayName); }
    if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
    if (updates.workflow !== undefined) { sets.push('workflow = ?'); values.push(JSON.stringify(updates.workflow)); }
    if (updates.communicationMatrix !== undefined) { sets.push('communication_matrix = ?'); values.push(JSON.stringify(updates.communicationMatrix)); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(now);
    values.push(id);

    db.prepare(`UPDATE team_pack SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM team_pack WHERE id = ?').run(id);
  },

  // ── Role Management ──────────────────────

  addRole(packId: string, role: Omit<TeamPackRole, 'roleCardId'>): void {
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO team_pack_role (id, pack_id, role_id, display_name, soul, required, description, role_card_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateSortableId('tpr'),
      packId,
      role.id,
      role.displayName,
      role.soul,
      role.required ? 1 : 0,
      role.description ?? null,
      null,
      now
    );
  },

  removeRole(packId: string, roleId: string): void {
    getDb().prepare('DELETE FROM team_pack_role WHERE pack_id = ? AND role_id = ?').run(packId, roleId);
  },

  // ── Agent Assignment ─────────────────────

  assignAgentToPack(agentId: string, packId: string, roleId: string): void {
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO agent_team_pack (agent_id, pack_id, role_id, assigned_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id, pack_id) DO UPDATE SET role_id = excluded.role_id, assigned_at = excluded.assigned_at`
    ).run(agentId, packId, roleId, now);
  },

  removeAgentFromPack(agentId: string, packId: string): void {
    getDb().prepare('DELETE FROM agent_team_pack WHERE agent_id = ? AND pack_id = ?').run(agentId, packId);
  },

  getAgentsForPack(packId: string): { agentId: string; roleId: string }[] {
    return getDb().prepare(
      'SELECT agent_id as agentId, role_id as roleId FROM agent_team_pack WHERE pack_id = ?'
    ).all(packId) as { agentId: string; roleId: string }[];
  },

  getPacksForAgent(agentId: string): TeamPack[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT tp.* FROM team_pack tp
       JOIN agent_team_pack atp ON atp.pack_id = tp.id
       WHERE atp.agent_id = ?
       ORDER BY tp.name ASC`
    ).all(agentId) as TeamPackRow[];

    return rows.map(pack => {
      const roles = db.prepare('SELECT * FROM team_pack_role WHERE pack_id = ? ORDER BY role_id').all(pack.id) as TeamPackRoleRow[];
      return rowToTeamPack(pack, roles);
    });
  },
};
