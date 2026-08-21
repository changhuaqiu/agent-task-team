import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { skillRepo } from '@/server/repositories/skill-repo';
import { seedPresetSkills } from '@/server/seed-skills';
import type Database from 'better-sqlite3';

let db: Database.Database;

const skillIdsForAgent = (agentId: string): string[] => (
  skillRepo.getSkillsForAgent(agentId).map((skill) => skill.id)
);

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('skill tables exist after migration', () => {
  it('has skill table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill'").all();
    expect(tables).toHaveLength(1);
  });

  it('has skill_file table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_file'").all();
    expect(tables).toHaveLength(1);
  });

  it('has agent_skill table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_skill'").all();
    expect(tables).toHaveLength(1);
  });

  it('has immutable revision tables and active revision pointer', () => {
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_revision'").all()).toHaveLength(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_revision_file'").all()).toHaveLength(1);
    const columns = db.prepare('PRAGMA table_info(skill)').all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toContain('active_revision_id');
  });
});

describe('skillRepo', () => {
  describe('create + getById', () => {
    it('creates a skill and retrieves it', () => {
      const created = skillRepo.create({
        name: 'my-skill',
        content: 'You are a helpful assistant.',
      });

      expect(created.id).toMatch(/^skill-/);
      expect(created.name).toBe('my-skill');
      expect(created.content).toBe('You are a helpful assistant.');
      expect(created.description).toBeNull();
      expect(created.config).toBeNull();
      expect(created.is_preset).toBe(0);
      expect(created.version).toBe(1);

      const fetched = skillRepo.getById(created.id);
      expect(fetched).toEqual(created);
    });

    it('creates a skill with optional fields', () => {
      const created = skillRepo.create({
        name: 'full-skill',
        description: 'A full skill',
        content: 'content',
        config: '{"model":"gpt-4"}',
        isPreset: true,
      });

      expect(created.description).toBe('A full skill');
      expect(created.config).toBe('{"model":"gpt-4"}');
      expect(created.is_preset).toBe(1);
    });
  });

  describe('getByName', () => {
    it('finds a skill by name', () => {
      skillRepo.create({ name: 'find-me', content: 'x' });
      const found = skillRepo.getByName('find-me');
      expect(found).toBeDefined();
      expect(found!.name).toBe('find-me');
    });

    it('returns undefined for unknown name', () => {
      expect(skillRepo.getByName('nope')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns all skills ordered by name', () => {
      skillRepo.create({ name: 'bravo', content: 'b' });
      skillRepo.create({ name: 'alpha', content: 'a' });

      const list = skillRepo.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('alpha');
      expect(list[1].name).toBe('bravo');
    });
  });

  describe('update', () => {
    it('updates skill fields', () => {
      const created = skillRepo.create({ name: 'original', content: 'v1' });

      skillRepo.update(created.id, {
        name: 'updated',
        content: 'v2',
        description: 'new desc',
        config: '{"key":"val"}',
      });

      const fetched = skillRepo.getById(created.id)!;
      expect(fetched.name).toBe('updated');
      expect(fetched.content).toBe('v2');
      expect(fetched.description).toBe('new desc');
      expect(fetched.config).toBe('{"key":"val"}');
      // updated_at is set to a new ISO string (may match if same millisecond)
      expect(typeof fetched.updated_at).toBe('string');
    });

    it('updates only provided fields', () => {
      const created = skillRepo.create({ name: 'patch', content: 'c' });

      skillRepo.update(created.id, { description: 'added' });

      const fetched = skillRepo.getById(created.id)!;
      expect(fetched.name).toBe('patch');
      expect(fetched.content).toBe('c');
      expect(fetched.description).toBe('added');
    });
  });

  describe('delete', () => {
    it('deletes the skill', () => {
      const created = skillRepo.create({ name: 'to-delete', content: 'x' });
      skillRepo.delete(created.id);
      expect(skillRepo.getById(created.id)).toBeUndefined();
    });

    it('cascades to files and agent associations', () => {
      const skill = skillRepo.create({ name: 'cascade', content: 'c' });
      skillRepo.addFile(skill.id, { path: 'foo.md', content: 'f' });
      skillRepo.assignToAgent('agent-1', skill.id);

      skillRepo.delete(skill.id);

      // files gone
      expect(skillRepo.listFiles(skill.id)).toHaveLength(0);
      // agent association gone
      expect(skillIdsForAgent('agent-1')).toHaveLength(0);
    });
  });

  describe('files', () => {
    it('adds files and lists them', () => {
      const skill = skillRepo.create({ name: 'files', content: 'c' });

      skillRepo.addFile(skill.id, { path: 'dir/a.md', content: 'aaa' });
      skillRepo.addFile(skill.id, { path: 'dir/b.md', content: 'bbb' });

      const files = skillRepo.listFiles(skill.id);
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('dir/a.md');
      expect(files[0].content).toBe('aaa');
      expect(files[1].path).toBe('dir/b.md');
    });

    it('upserts on duplicate path', () => {
      const skill = skillRepo.create({ name: 'upsert', content: 'c' });

      skillRepo.addFile(skill.id, { path: 'readme.md', content: 'v1' });
      skillRepo.addFile(skill.id, { path: 'readme.md', content: 'v2' });

      const files = skillRepo.listFiles(skill.id);
      expect(files).toHaveLength(1);
      expect(files[0].content).toBe('v2');
    });

    it('rejects path traversal', () => {
      const skill = skillRepo.create({ name: 'secure', content: 'c' });

      expect(() => skillRepo.addFile(skill.id, { path: '../etc/passwd', content: 'x' })).toThrow(
        'Invalid file path: ../etc/passwd',
      );

      expect(() => skillRepo.addFile(skill.id, { path: '/absolute/path', content: 'x' })).toThrow(
        'Invalid file path: /absolute/path',
      );
    });

    it('replaces files', () => {
      const skill = skillRepo.create({ name: 'replace', content: 'c' });

      skillRepo.addFile(skill.id, { path: 'old.md', content: 'old' });
      skillRepo.addFile(skill.id, { path: 'keep.md', content: 'keep' });

      skillRepo.replaceFiles(skill.id, [
        { path: 'new1.md', content: 'n1' },
        { path: 'new2.md', content: 'n2' },
      ]);

      const files = skillRepo.listFiles(skill.id);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.path).sort()).toEqual(['new1.md', 'new2.md']);
    });
  });

  describe('agent assignments', () => {
    it('assigns skills to agent and retrieves ids', () => {
      const s1 = skillRepo.create({ name: 's1', content: 'c1' });
      const s2 = skillRepo.create({ name: 's2', content: 'c2' });

      skillRepo.assignToAgent('agent-x', s1.id);
      skillRepo.assignToAgent('agent-x', s2.id);

      const ids = skillIdsForAgent('agent-x');
      expect(ids).toHaveLength(2);
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
    });

    it('removes an agent assignment', () => {
      const s1 = skillRepo.create({ name: 'rm', content: 'c' });
      skillRepo.assignToAgent('agent-y', s1.id);

      skillRepo.removeAgentAssignment('agent-y', s1.id);
      expect(skillIdsForAgent('agent-y')).toHaveLength(0);
    });

    it('setAgentSkills replaces all assignments', () => {
      const s1 = skillRepo.create({ name: 'old', content: 'o' });
      const s2 = skillRepo.create({ name: 'new', content: 'n' });

      skillRepo.assignToAgent('agent-z', s1.id);
      skillRepo.setAgentSkills('agent-z', [s2.id]);

      const ids = skillIdsForAgent('agent-z');
      expect(ids).toHaveLength(1);
      expect(ids).toContain(s2.id);
    });

    it('getSkillsForAgent includes files', () => {
      const skill = skillRepo.create({ name: 'full', content: 'body' });
      skillRepo.addFile(skill.id, { path: 'guide.md', content: 'guide content' });
      skillRepo.assignToAgent('agent-f', skill.id);

      const skills = skillRepo.getSkillsForAgent('agent-f');
      expect(skills).toHaveLength(1);
      expect(skills[0].files).toHaveLength(1);
      expect(skills[0].files[0].path).toBe('guide.md');
      expect(skills[0].files[0].content).toBe('guide content');
    });
  });
});

describe('seedPresetSkills', () => {
  it('keeps full task management planner-only and assigns narrow status receipts to delivery roles', () => {
    seedPresetSkills();

    const management = skillRepo.getByName('task-management');
    const receipt = skillRepo.getByName('task-status-receipt');
    expect(management).toBeDefined();
    expect(receipt).toBeDefined();
    expect(receipt!.content).toContain('mainImpactReviewResult');
    expect(receipt!.content).toContain('reviewReceipt');
    for (const agentId of ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi', 'planner', 'coder', 'reviewer', 'researcher', 'analyst', 'writer']) {
      expect(skillIdsForAgent(agentId)).toContain(receipt!.id);
    }
    expect(skillIdsForAgent('mario')).toContain(management!.id);
    expect(skillIdsForAgent('planner')).toContain(management!.id);
    expect(skillIdsForAgent('peach')).not.toContain(management!.id);
  });

  it('idempotently backfills narrow receipt assignments into an existing seeded database', () => {
    const existing = skillRepo.create({
      name: 'task-management',
      content: 'legacy task management',
      isPreset: true,
    });
    skillRepo.assignToAgent('mario', existing.id);
    skillRepo.assignToAgent('peach', existing.id);

    seedPresetSkills();
    seedPresetSkills();

    const receipt = skillRepo.getByName('task-status-receipt');
    expect(receipt).toBeDefined();
    for (const agentId of ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi', 'planner', 'coder', 'reviewer', 'researcher', 'analyst', 'writer']) {
      expect(skillIdsForAgent(agentId).filter((id) => id === receipt!.id)).toHaveLength(1);
    }
    expect(skillIdsForAgent('peach')).not.toContain(existing.id);
    expect(skillIdsForAgent('planner')).toContain(existing.id);
  });

  it('updates existing Task presets to the canonical status contract', () => {
    for (const name of ['task-management', 'task-status-receipt']) {
      skillRepo.create({
        name,
        content: 'legacy pending and rejected contract',
        config: JSON.stringify({ legacy: true }),
        isPreset: true,
      });
    }

    seedPresetSkills();

    for (const name of ['task-management', 'task-status-receipt']) {
      const updated = skillRepo.getByName(name)!;
      expect(`${updated.content}\n${updated.config}`).not.toMatch(/\b(?:pending|rejected)\b/);
      expect(updated.config).toContain('proposed, ready, in_progress, blocked, in_review, done, cancelled');
    }
  });

  it('seeds git-collaboration and assigns it to built-in team role ids', () => {
    seedPresetSkills();

    const skill = skillRepo.getByName('git-collaboration');
    expect(skill).toBeDefined();
    expect(skill!.is_preset).toBe(1);
    expect(skill!.content).toContain('GitHub pull requests');
    expect(skill!.content).toContain('GitLab merge requests');
    expect(skill!.content).toContain('Development → Review → Issue Fix Loop');
    expect(skill!.content).toContain('Credential and Provider Setup');
    expect(skill!.content).toContain('GitHub: use `gh` first');
    expect(skill!.content).toContain('GitLab: use `glab` first');

    for (const agentId of ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi', 'planner', 'coder', 'reviewer', 'researcher', 'analyst', 'writer']) {
      expect(skillIdsForAgent(agentId)).toContain(skill!.id);
    }
  });

  it('seeds browser verification as an eligible capability for built-in roles', () => {
    seedPresetSkills();

    const skill = skillRepo.getByName('browser-verification');
    expect(skill).toBeDefined();
    expect(skill!.is_preset).toBe(1);
    expect(skill!.content).toContain('verification_serve_artifact');
    expect(skill!.content).toContain('do not import or require Playwright');
    for (const agentId of ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi', 'planner', 'coder', 'reviewer', 'researcher', 'analyst', 'writer']) {
      expect(skillIdsForAgent(agentId)).toContain(skill!.id);
    }
  });

  it('updates existing preset git-collaboration content on seed', () => {
    const stale = skillRepo.create({
      name: 'git-collaboration',
      description: 'old',
      content: 'old content',
      isPreset: true,
    });

    seedPresetSkills();

    const updated = skillRepo.getById(stale.id);
    expect(updated!.description).toBe('Shared Git workflow for issues, pull requests, merge requests, reviews, and handoff evidence');
    expect(updated!.content).toContain('Development → Review → Issue Fix Loop');
    expect(updated!.content).toContain('GitHub: use `gh` first');
    expect(updated!.content).toContain('gh auth login');
  });
});
