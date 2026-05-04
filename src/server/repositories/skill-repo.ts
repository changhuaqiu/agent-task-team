import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  content: string;
  config: string | null;
  is_preset: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SkillFileRow {
  id: string;
  skill_id: string;
  path: string;
  content: string;
}

export interface SkillWithFiles extends SkillRow {
  files: SkillFileRow[];
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  content: string;
  config?: string;
  isPreset?: boolean;
}

export interface FileInput {
  path: string;
  content: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function validateFilePath(path: string): void {
  if (path.startsWith('/') || path.includes('..')) {
    throw new Error(`Invalid file path: ${path}`);
  }
}

// ──────────────────────────────────────────────
// Repository
// ──────────────────────────────────────────────

export const skillRepo = {
  // ── Skill CRUD ───────────────────────────

  create(input: CreateSkillInput): SkillRow {
    const id = generateSortableId('skill');
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO skill (id, name, description, content, config, is_preset, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        input.content,
        input.config ?? null,
        input.isPreset ? 1 : 0,
        now,
        now,
      );
    return skillRepo.getById(id)!;
  },

  getById(id: string): SkillRow | undefined {
    return getDb().prepare('SELECT * FROM skill WHERE id = ?').get(id) as SkillRow | undefined;
  },

  getByName(name: string): SkillRow | undefined {
    return getDb().prepare('SELECT * FROM skill WHERE name = ?').get(name) as SkillRow | undefined;
  },

  list(): SkillRow[] {
    return getDb().prepare('SELECT * FROM skill ORDER BY name ASC').all() as SkillRow[];
  },

  update(id: string, updates: Partial<Pick<SkillRow, 'name' | 'description' | 'content' | 'config'>>): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    getDb().prepare(`UPDATE skill SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM skill WHERE id = ?').run(id);
  },

  // ── Files ────────────────────────────────

  addFile(skillId: string, file: FileInput): void {
    validateFilePath(file.path);
    const id = generateSortableId('sf');
    getDb()
      .prepare(
        `INSERT INTO skill_file (id, skill_id, path, content)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(skill_id, path) DO UPDATE SET content = excluded.content`,
      )
      .run(id, skillId, file.path, file.content);
  },

  listFiles(skillId: string): SkillFileRow[] {
    return getDb()
      .prepare('SELECT * FROM skill_file WHERE skill_id = ? ORDER BY path ASC')
      .all(skillId) as SkillFileRow[];
  },

  replaceFiles(skillId: string, files: FileInput[]): void {
    const db = getDb();
    const deleteAll = db.prepare('DELETE FROM skill_file WHERE skill_id = ?');
    const insert = db.prepare(
      `INSERT INTO skill_file (id, skill_id, path, content) VALUES (?, ?, ?, ?)`,
    );

    db.transaction(() => {
      deleteAll.run(skillId);
      for (const file of files) {
        validateFilePath(file.path);
        insert.run(generateSortableId('sf'), skillId, file.path, file.content);
      }
    })();
  },

  // ── Agent Assignments ────────────────────

  assignToAgent(agentId: string, skillId: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_skill (agent_id, skill_id, assigned_at)
         VALUES (?, ?, ?)
         ON CONFLICT(agent_id, skill_id) DO NOTHING`,
      )
      .run(agentId, skillId, now);
  },

  removeAgentAssignment(agentId: string, skillId: string): void {
    getDb()
      .prepare('DELETE FROM agent_skill WHERE agent_id = ? AND skill_id = ?')
      .run(agentId, skillId);
  },

  setAgentSkills(agentId: string, skillIds: string[]): void {
    const db = getDb();
    const deleteAll = db.prepare('DELETE FROM agent_skill WHERE agent_id = ?');
    const insert = db.prepare(
      `INSERT INTO agent_skill (agent_id, skill_id, assigned_at) VALUES (?, ?, ?)`,
    );
    const now = new Date().toISOString();

    db.transaction(() => {
      deleteAll.run(agentId);
      for (const skillId of skillIds) {
        insert.run(agentId, skillId, now);
      }
    })();
  },

  getSkillsForAgent(agentId: string): SkillWithFiles[] {
    const skills = getDb()
      .prepare(
        `SELECT s.* FROM skill s
         JOIN agent_skill a ON a.skill_id = s.id
         WHERE a.agent_id = ?
         ORDER BY s.name ASC`,
      )
      .all(agentId) as SkillRow[];

    return skills.map((skill) => {
      const files = skillRepo.listFiles(skill.id);
      return { ...skill, files };
    });
  },

  getSkillIdsForAgent(agentId: string): string[] {
    const rows = getDb()
      .prepare('SELECT skill_id FROM agent_skill WHERE agent_id = ?')
      .all(agentId) as { skill_id: string }[];
    return rows.map((r) => r.skill_id);
  },
};
