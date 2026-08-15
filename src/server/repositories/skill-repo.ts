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
  active_revision_id: string | null;
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

export interface SkillRevisionRow {
  id: string;
  skill_id: string;
  content_hash: string;
  description: string;
  body: string;
  package_path: string;
  config: string | null;
  created_at: string;
}

export interface SkillRevisionFileRow {
  id: string;
  revision_id: string;
  path: string;
  kind: string;
  content_hash: string;
  byte_size: number;
}

export interface CreateSkillRevisionInput {
  skillId: string;
  contentHash: string;
  description: string;
  body: string;
  packagePath: string;
  config?: string;
  files: Array<Pick<SkillRevisionFileRow, 'path' | 'kind' | 'content_hash' | 'byte_size'>>;
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
    if ('name' in updates || 'description' in updates || 'content' in updates || 'config' in updates) {
      sets.push('active_revision_id = NULL');
    }
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
    getDb().prepare('UPDATE skill SET active_revision_id = NULL, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), skillId);
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
      db.prepare('UPDATE skill SET active_revision_id = NULL, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), skillId);
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

  getAllAgentSkillIds(): Record<string, string[]> {
    const rows = getDb()
      .prepare('SELECT agent_id, skill_id FROM agent_skill ORDER BY agent_id, skill_id')
      .all() as { agent_id: string; skill_id: string }[];
    const result: Record<string, string[]> = {};
    for (const row of rows) {
      result[row.agent_id] = [...(result[row.agent_id] ?? []), row.skill_id];
    }
    return result;
  },

  // ── Immutable installed revisions ───────────

  getRevisionById(id: string): SkillRevisionRow | undefined {
    return getDb().prepare('SELECT * FROM skill_revision WHERE id = ?').get(id) as SkillRevisionRow | undefined;
  },

  getActiveRevision(skillId: string): SkillRevisionRow | undefined {
    return getDb()
      .prepare(`SELECT r.* FROM skill s JOIN skill_revision r ON r.id = s.active_revision_id WHERE s.id = ?`)
      .get(skillId) as SkillRevisionRow | undefined;
  },

  listRevisionFiles(revisionId: string): SkillRevisionFileRow[] {
    return getDb()
      .prepare('SELECT * FROM skill_revision_file WHERE revision_id = ? ORDER BY path ASC')
      .all(revisionId) as SkillRevisionFileRow[];
  },

  createOrActivateRevision(input: CreateSkillRevisionInput): SkillRevisionRow {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM skill_revision WHERE skill_id = ? AND content_hash = ?')
      .get(input.skillId, input.contentHash) as SkillRevisionRow | undefined;
    if (existing) {
      db.prepare('UPDATE skill SET active_revision_id = ? WHERE id = ?').run(existing.id, input.skillId);
      return existing;
    }

    const revisionId = generateSortableId('skill-rev');
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO skill_revision (id, skill_id, content_hash, description, body, package_path, config, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(revisionId, input.skillId, input.contentHash, input.description, input.body, input.packagePath, input.config ?? null, now);
      const insertFile = db.prepare(`
        INSERT INTO skill_revision_file (id, revision_id, path, kind, content_hash, byte_size)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const file of input.files) {
        insertFile.run(
          generateSortableId('skill-rev-file'),
          revisionId,
          file.path,
          file.kind,
          file.content_hash,
          file.byte_size,
        );
      }
      db.prepare('UPDATE skill SET active_revision_id = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(revisionId, now, input.skillId);
    })();
    return skillRepo.getRevisionById(revisionId)!;
  },
};
