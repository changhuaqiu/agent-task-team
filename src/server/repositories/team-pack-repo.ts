import { getDb } from '../db/index';
import { loadAllRoleCards } from '../db/roleCardQueries';
import { generateSortableId } from './sortable-id';
import type { TeamPack, TeamPackRole, CreateTeamPackInput } from '@/types/teamPack';
import type { RoleCard } from '@/types/roleCard';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { materializeTeamPack, materializeTeamRoleSnapshot } from '../team-pack-role-snapshot';

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
    workflow: JSON.parse(row.workflow),
    communicationMatrix: JSON.parse(row.communication_matrix),
    sharedContext: row.shared_context ? JSON.parse(row.shared_context) : undefined,
    rules: row.rules ? JSON.parse(row.rules) : undefined,
    source: row.source ? JSON.parse(row.source) : undefined,
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
      roleCardSnapshot: r.role_card_snapshot ? JSON.parse(r.role_card_snapshot) : undefined,
      accountIds: r.account_ids ? JSON.parse(r.account_ids) : undefined,
      skillIds: r.skill_ids ? JSON.parse(r.skill_ids) : undefined,
    })),
  };
}

function loadSnapshotSourceCards(): RoleCard[] {
  const cards = new Map<string, RoleCard>();
  for (const card of PRESET_ROLE_CARDS) cards.set(card.id, card);
  try {
    for (const card of loadAllRoleCards()) cards.set(card.id, card);
  } catch {
    // Test databases and early migrations may not have role card rows yet.
  }
  return [...cards.values()];
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

    const sourceCards = loadSnapshotSourceCards();
    for (const inputRole of input.roles) {
      const role = materializeTeamRoleSnapshot(inputRole, sourceCards, now);
      db.prepare(
        `INSERT INTO team_pack_role (
          id, pack_id, role_id, display_name, soul, required, description,
          role_card_id, role_card_snapshot, account_ids, skill_ids, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateSortableId('tpr'),
        id,
        role.id,
        role.displayName,
        role.soul,
        role.required ? 1 : 0,
        role.description ?? null,
        role.roleCardId ?? null,
        role.roleCardSnapshot ? JSON.stringify(role.roleCardSnapshot) : null,
        role.accountIds ? JSON.stringify(role.accountIds) : null,
        role.skillIds ? JSON.stringify(role.skillIds) : null,
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
      const sourceCards = loadSnapshotSourceCards();
      for (const inputRole of updates.roles) {
        const role = materializeTeamRoleSnapshot(inputRole, sourceCards, now);
        db.prepare(
          `INSERT INTO team_pack_role (
            id, pack_id, role_id, display_name, soul, required, description,
            role_card_id, role_card_snapshot, account_ids, skill_ids, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          generateSortableId('tpr'),
          id,
          role.id,
          role.displayName,
          role.soul,
          role.required ? 1 : 0,
          role.description ?? null,
          role.roleCardId ?? null,
          role.roleCardSnapshot ? JSON.stringify(role.roleCardSnapshot) : null,
          role.accountIds ? JSON.stringify(role.accountIds) : null,
          role.skillIds ? JSON.stringify(role.skillIds) : null,
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

  // ── Role Management ──────────────────────

  addRole(packId: string, inputRole: TeamPackRole): void {
    const now = new Date().toISOString();
    const role = materializeTeamRoleSnapshot(inputRole, loadSnapshotSourceCards(), now);
    getDb().prepare(
      `INSERT INTO team_pack_role (
        id, pack_id, role_id, display_name, soul, required, description,
        role_card_id, role_card_snapshot, account_ids, skill_ids, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateSortableId('tpr'),
      packId,
      role.id,
      role.displayName,
      role.soul,
      role.required ? 1 : 0,
      role.description ?? null,
      role.roleCardId ?? null,
      role.roleCardSnapshot ? JSON.stringify(role.roleCardSnapshot) : null,
      role.accountIds ? JSON.stringify(role.accountIds) : null,
      role.skillIds ? JSON.stringify(role.skillIds) : null,
      now
    );
  },

  removeRole(packId: string, roleId: string): void {
    getDb().prepare('DELETE FROM team_pack_role WHERE pack_id = ? AND role_id = ?').run(packId, roleId);
  },

  updateRoleConfig(
    packId: string,
    roleId: string,
    patch: Pick<Partial<TeamPackRole>, 'roleCardId' | 'roleCardSnapshot' | 'accountIds' | 'skillIds'>,
  ): TeamPackRole | undefined {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.roleCardId !== undefined) {
      sets.push('role_card_id = ?');
      values.push(patch.roleCardId ?? null);
    }
    if (patch.roleCardSnapshot !== undefined) {
      sets.push('role_card_snapshot = ?');
      values.push(patch.roleCardSnapshot ? JSON.stringify(patch.roleCardSnapshot) : null);
    }
    if (patch.accountIds !== undefined) {
      sets.push('account_ids = ?');
      values.push(JSON.stringify(patch.accountIds));
    }
    if (patch.skillIds !== undefined) {
      sets.push('skill_ids = ?');
      values.push(JSON.stringify(patch.skillIds));
    }
    if (sets.length === 0) {
      return teamPackRepo.getById(packId)?.roles.find((role) => role.id === roleId);
    }

    values.push(packId, roleId);
    getDb().prepare(`UPDATE team_pack_role SET ${sets.join(', ')} WHERE pack_id = ? AND role_id = ?`).run(...values);
    return teamPackRepo.getById(packId)?.roles.find((role) => role.id === roleId);
  },

  materializeRoleSnapshots(packId: string): TeamPack | undefined {
    const pack = teamPackRepo.getById(packId);
    if (!pack) return undefined;

    const sourceCards = loadSnapshotSourceCards();
    const materialized = materializeTeamPack(pack, sourceCards);
    const db = getDb();
    for (const role of materialized.roles) {
      db.prepare(
        'UPDATE team_pack_role SET role_card_snapshot = ? WHERE pack_id = ? AND role_id = ?',
      ).run(JSON.stringify(role.roleCardSnapshot), packId, role.id);
    }
    return teamPackRepo.getById(packId);
  },

  getExportById(packId: string): TeamPack | undefined {
    const pack = teamPackRepo.getById(packId);
    if (!pack) return undefined;
    return materializeTeamPack(pack, loadSnapshotSourceCards());
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
