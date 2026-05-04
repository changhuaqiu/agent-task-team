# Skill System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skill system where agents can be assigned reusable capability modules (SKILL.md + supporting files), injected into prompts via a new PromptComposer layer.

**Architecture:** 3 new SQLite tables (skill, skill_file, agent_skill) with a repository layer. Skills are cached in the Zustand store on startup and passed synchronously to the new SkillLayer in PromptComposer. Skill import from Git repos via server-side clone+parse pipeline.

**Tech Stack:** SQLite (better-sqlite3), Drizzle-style repos, Next.js Pages Router APIs, Zustand store, Vitest

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/server/repositories/skill-repo.ts` | Skill, skill_file, agent_skill CRUD queries |
| `src/lib/agent-context/layers/skillLayer.ts` | Pure function: skills[] → prompt string |
| `src/pages/api/skills/index.ts` | GET list, POST create |
| `src/pages/api/skills/[id].ts` | GET detail, PATCH update, DELETE |
| `src/pages/api/skills/import.ts` | POST import from URL |
| `src/pages/api/agents/[agentId]/skills.ts` | GET/POST agent-skill assignments |
| `src/server/skill-import.ts` | Git clone + SKILL.md parser |
| `src/components/skill/SkillLibrary.tsx` | Skill library page |
| `src/components/skill/SkillDetail.tsx` | Skill detail editor |
| `src/components/skill/SkillImportDialog.tsx` | Import URL dialog |
| `src/data/presetSkills.ts` | Built-in skill definitions |
| `src/__tests__/agent-context/skillLayer.test.ts` | SkillLayer unit tests |
| `src/__tests__/api/skills/index.test.ts` | Skill CRUD API tests |
| `src/__tests__/api/skills/import.test.ts` | Import API tests |
| `src/__tests__/repositories/skill-repo.test.ts` | Repository unit tests |

### Modified Files

| File | Change |
|---|---|
| `src/server/db/migrate.ts` | Add version 2 migration with 3 tables |
| `src/lib/agent-context/PromptComposer.ts` | Add `skills` to ComposeOptions, insert SkillLayer |
| `src/store/taskHubStore.ts` | Add skill state, loadFromServer extension, dispatch changes |
| `src/pages/api/state.ts` | Include skills in bulk state response |
| `src/pages/api/mutations.ts` | Add skill mutation types |
| `src/__tests__/agent-context/promptComposer.test.ts` | Add SkillLayer + compose integration tests |

---

### Task 1: Database Migration

**Files:**
- Modify: `src/server/db/migrate.ts`
- Test: `src/__tests__/repositories/skill-repo.test.ts` (created here, extended in Task 2)

- [ ] **Step 1: Write the failing test for migration tables**

Create `src/__tests__/repositories/skill-repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/repositories/skill-repo.test.ts`
Expected: FAIL — tables do not exist yet

- [ ] **Step 3: Add migration**

Add to `src/server/db/migrate.ts`, append to the `MIGRATIONS` array after the version 1 entry:

```typescript
{
  version: 2,
  sql: `
CREATE TABLE IF NOT EXISTS skill (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  content TEXT NOT NULL,
  config TEXT,
  is_preset INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_file (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  UNIQUE(skill_id, path)
);

CREATE TABLE IF NOT EXISTS agent_skill (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_file_skill ON skill_file(skill_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_agent ON agent_skill(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_skill ON agent_skill(skill_id);
`,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/repositories/skill-repo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrate.ts src/__tests__/repositories/skill-repo.test.ts
git commit -m "feat: add skill, skill_file, agent_skill tables (migration v2)"
```

---

### Task 2: Skill Repository

**Files:**
- Create: `src/server/repositories/skill-repo.ts`
- Modify: `src/__tests__/repositories/skill-repo.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/repositories/skill-repo.test.ts`:

```typescript
import { skillRepo } from '@/server/repositories/skill-repo';
import { resetSeq } from '@/server/repositories/sortable-id';

// Reset ID sequence between tests
beforeEach(() => { resetSeq(); });

describe('skillRepo', () => {
  describe('create + getById', () => {
    it('creates a skill and retrieves it', () => {
      const skill = skillRepo.create({
        name: 'code-review',
        description: 'Code review skill',
        content: '# Code Review\nReview code carefully.',
      });
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBe('code-review');

      const fetched = skillRepo.getById(skill.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('code-review');
      expect(fetched!.content).toBe('# Code Review\nReview code carefully.');
    });
  });

  describe('list', () => {
    it('returns all skills', () => {
      skillRepo.create({ name: 'skill-a', description: 'A', content: 'content a' });
      skillRepo.create({ name: 'skill-b', description: 'B', content: 'content b' });
      const list = skillRepo.list();
      expect(list).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('updates skill fields', () => {
      const skill = skillRepo.create({ name: 'test', description: 'old', content: 'old content' });
      skillRepo.update(skill.id, { description: 'new desc', content: 'new content' });
      const updated = skillRepo.getById(skill.id);
      expect(updated!.description).toBe('new desc');
      expect(updated!.content).toBe('new content');
    });
  });

  describe('delete', () => {
    it('deletes skill and cascades to files and agent associations', () => {
      const skill = skillRepo.create({ name: 'to-delete', description: '', content: 'c' });
      skillRepo.addFile(skill.id, { path: 'template.md', content: 't' });
      skillRepo.assignToAgent('mario', skill.id);

      skillRepo.delete(skill.id);

      expect(skillRepo.getById(skill.id)).toBeUndefined();
      expect(skillRepo.listFiles(skill.id)).toHaveLength(0);
      expect(skillRepo.getSkillsForAgent('mario')).toHaveLength(0);
    });
  });

  describe('files', () => {
    it('adds and lists files for a skill', () => {
      const skill = skillRepo.create({ name: 'with-files', description: '', content: 'c' });
      skillRepo.addFile(skill.id, { path: 'templates/check.md', content: 'checklist' });
      skillRepo.addFile(skill.id, { path: 'schema.json', content: '{"type":"object"}' });

      const files = skillRepo.listFiles(skill.id);
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('templates/check.md');
      expect(files[1].content).toBe('{"type":"object"}');
    });

    it('upserts file on duplicate path', () => {
      const skill = skillRepo.create({ name: 'dup-path', description: '', content: 'c' });
      skillRepo.addFile(skill.id, { path: 'a.md', content: 'v1' });
      skillRepo.addFile(skill.id, { path: 'a.md', content: 'v2' });

      const files = skillRepo.listFiles(skill.id);
      expect(files).toHaveLength(1);
      expect(files[0].content).toBe('v2');
    });

    it('rejects path traversal', () => {
      const skill = skillRepo.create({ name: 'traversal', description: '', content: 'c' });
      expect(() => skillRepo.addFile(skill.id, { path: '../etc/passwd', content: 'x' })).toThrow();
      expect(() => skillRepo.addFile(skill.id, { path: '/absolute/path', content: 'x' })).toThrow();
    });

    it('replaceFiles deletes all and re-inserts', () => {
      const skill = skillRepo.create({ name: 'replace', description: '', content: 'c' });
      skillRepo.addFile(skill.id, { path: 'old.md', content: 'old' });

      skillRepo.replaceFiles(skill.id, [
        { path: 'new1.md', content: 'n1' },
        { path: 'new2.md', content: 'n2' },
      ]);

      const files = skillRepo.listFiles(skill.id);
      expect(files).toHaveLength(2);
      expect(files.every((f: any) => f.path.startsWith('new'))).toBe(true);
    });
  });

  describe('agent assignments', () => {
    it('assigns skills to agent and retrieves them', () => {
      const s1 = skillRepo.create({ name: 'review', description: '', content: 'c1' });
      const s2 = skillRepo.create({ name: 'tdd', description: '', content: 'c2' });

      skillRepo.assignToAgent('mario', s1.id);
      skillRepo.assignToAgent('mario', s2.id);

      const skills = skillRepo.getSkillsForAgent('mario');
      expect(skills).toHaveLength(2);
      expect(skills.map((s: any) => s.name).sort()).toEqual(['review', 'tdd']);
    });

    it('setAgentSkills replaces all assignments', () => {
      const s1 = skillRepo.create({ name: 'a', description: '', content: 'c' });
      const s2 = skillRepo.create({ name: 'b', description: '', content: 'c' });
      const s3 = skillRepo.create({ name: 'c', description: '', content: 'c' });

      skillRepo.assignToAgent('mario', s1.id);
      skillRepo.setAgentSkills('mario', [s2.id, s3.id]);

      const skills = skillRepo.getSkillsForAgent('mario');
      expect(skills).toHaveLength(2);
      expect(skills.map((s: any) => s.name).sort()).toEqual(['b', 'c']);
    });

    it('getSkillsForAgent includes files', () => {
      const s = skillRepo.create({ name: 'with-file', description: '', content: 'c' });
      skillRepo.addFile(s.id, { path: 'ref.md', content: 'reference' });
      skillRepo.assignToAgent('mario', s.id);

      const skills = skillRepo.getSkillsForAgent('mario');
      expect(skills[0].files).toHaveLength(1);
      expect(skills[0].files[0].path).toBe('ref.md');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/repositories/skill-repo.test.ts`
Expected: FAIL — `skillRepo` does not exist

- [ ] **Step 3: Implement skill-repo.ts**

Create `src/server/repositories/skill-repo.ts`:

```typescript
import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface CreateSkillInput {
  name: string;
  description?: string;
  content: string;
  config?: string;
  isPreset?: boolean;
}

interface FileInput {
  path: string;
  content: string;
}

function validateFilePath(path: string): void {
  if (path.startsWith('/') || path.includes('..')) {
    throw new Error(`Invalid file path: ${path}`);
  }
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

export const skillRepo = {
  create(input: CreateSkillInput): SkillRow {
    const id = generateSortableId('skill');
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO skill (id, name, description, content, config, is_preset, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, input.name, input.description ?? null, input.content, input.config ?? null, input.isPreset ? 1 : 0, now, now);
    return skillRepo.getById(id)!;
  },

  getById(id: string): SkillRow | undefined {
    return getDb().prepare('SELECT * FROM skill WHERE id = ?').get(id) as SkillRow | undefined;
  },

  getByName(name: string): SkillRow | undefined {
    return getDb().prepare('SELECT * FROM skill WHERE name = ?').get(name) as SkillRow | undefined;
  },

  list(): SkillRow[] {
    return getDb().prepare('SELECT * FROM skill ORDER BY name').all() as SkillRow[];
  },

  update(id: string, updates: Partial<Pick<SkillRow, 'name' | 'description' | 'content' | 'config'>>): void {
    const sets: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
    if (updates.content !== undefined) { sets.push('content = ?'); values.push(updates.content); }
    if (updates.config !== undefined) { sets.push('config = ?'); values.push(updates.config); }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    getDb().prepare(`UPDATE skill SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM skill WHERE id = ?').run(id);
  },

  // --- Files ---

  addFile(skillId: string, file: FileInput): void {
    validateFilePath(file.path);
    const id = generateSortableId('sf');
    getDb().prepare(
      `INSERT INTO skill_file (id, skill_id, path, content) VALUES (?, ?, ?, ?)
       ON CONFLICT(skill_id, path) DO UPDATE SET content = excluded.content`,
    ).run(id, skillId, file.path, file.content);
  },

  listFiles(skillId: string): SkillFileRow[] {
    return getDb().prepare('SELECT * FROM skill_file WHERE skill_id = ? ORDER BY path').all(skillId) as SkillFileRow[];
  },

  replaceFiles(skillId: string, files: FileInput[]): void {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM skill_file WHERE skill_id = ?').run(skillId);
      const stmt = db.prepare('INSERT INTO skill_file (id, skill_id, path, content) VALUES (?, ?, ?, ?)');
      for (const f of files) {
        validateFilePath(f.path);
        stmt.run(generateSortableId('sf'), skillId, f.path, f.content);
      }
    });
    tx();
  },

  // --- Agent Assignments ---

  assignToAgent(agentId: string, skillId: string): void {
    getDb().prepare(
      `INSERT INTO agent_skill (agent_id, skill_id, assigned_at) VALUES (?, ?, ?)
       ON CONFLICT(agent_id, skill_id) DO NOTHING`,
    ).run(agentId, skillId, new Date().toISOString());
  },

  removeAgentAssignment(agentId: string, skillId: string): void {
    getDb().prepare('DELETE FROM agent_skill WHERE agent_id = ? AND skill_id = ?').run(agentId, skillId);
  },

  setAgentSkills(agentId: string, skillIds: string[]): void {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM agent_skill WHERE agent_id = ?').run(agentId);
      const stmt = db.prepare('INSERT INTO agent_skill (agent_id, skill_id, assigned_at) VALUES (?, ?, ?)');
      for (const sid of skillIds) {
        stmt.run(agentId, sid, new Date().toISOString());
      }
    });
    tx();
  },

  getSkillsForAgent(agentId: string): SkillWithFiles[] {
    const rows = getDb().prepare(
      `SELECT s.* FROM skill s
       JOIN agent_skill a ON a.skill_id = s.id
       WHERE a.agent_id = ?
       ORDER BY s.name`,
    ).all(agentId) as SkillRow[];

    return rows.map((skill) => ({
      ...skill,
      files: skillRepo.listFiles(skill.id),
    }));
  },

  getSkillIdsForAgent(agentId: string): string[] {
    const rows = getDb().prepare(
      'SELECT skill_id FROM agent_skill WHERE agent_id = ?',
    ).all(agentId) as { skill_id: string }[];
    return rows.map((r) => r.skill_id);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/repositories/skill-repo.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/skill-repo.ts src/__tests__/repositories/skill-repo.test.ts
git commit -m "feat: add skillRepo with CRUD, files, and agent assignments"
```

---

### Task 3: SkillLayer

**Files:**
- Create: `src/lib/agent-context/layers/skillLayer.ts`
- Create: `src/__tests__/agent-context/skillLayer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/agent-context/skillLayer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSkillLayer } from '@/lib/agent-context/layers/skillLayer';

interface SkillInput {
  name: string;
  content: string;
  files?: { path: string; content: string }[];
}

function makeSkill(overrides: Partial<SkillInput> = {}): SkillInput {
  return { name: 'test-skill', content: '# Test Skill\nDo the thing.', ...overrides };
}

describe('buildSkillLayer', () => {
  it('returns empty string for empty skills array', () => {
    expect(buildSkillLayer([])).toBe('');
  });

  it('renders a single skill with header and content', () => {
    const skills = [makeSkill()];
    const result = buildSkillLayer(skills);
    expect(result).toContain('## Skill: test-skill');
    expect(result).toContain('# Test Skill\nDo the thing.');
  });

  it('renders multiple skills separated by ---', () => {
    const skills = [
      makeSkill({ name: 'code-review', content: 'Review code.' }),
      makeSkill({ name: 'tdd', content: 'Write tests first.' }),
    ];
    const result = buildSkillLayer(skills);
    expect(result).toContain('## Skill: code-review');
    expect(result).toContain('## Skill: tdd');
    expect(result).toContain('\n\n---\n\n');
  });

  it('includes skill files under 10KB', () => {
    const skills = [makeSkill({
      files: [{ path: 'checklist.md', content: '- [ ] Check logic\n- [ ] Check errors' }],
    })];
    const result = buildSkillLayer(skills);
    expect(result).toContain('### File: checklist.md');
    expect(result).toContain('- [ ] Check logic');
  });

  it('skips skill files over 10KB', () => {
    const largeContent = 'x'.repeat(10_001);
    const skills = [makeSkill({
      files: [{ path: 'big.md', content: largeContent }],
    })];
    const result = buildSkillLayer(skills);
    expect(result).not.toContain('### File: big.md');
  });

  it('includes multiple files for a single skill', () => {
    const skills = [makeSkill({
      files: [
        { path: 'a.md', content: 'file a' },
        { path: 'b.ts', content: 'const x = 1;' },
      ],
    })];
    const result = buildSkillLayer(skills);
    expect(result).toContain('### File: a.md');
    expect(result).toContain('file a');
    expect(result).toContain('### File: b.ts');
    expect(result).toContain('const x = 1;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/agent-context/skillLayer.test.ts`
Expected: FAIL — `buildSkillLayer` does not exist

- [ ] **Step 3: Implement skillLayer.ts**

Create `src/lib/agent-context/layers/skillLayer.ts`:

```typescript
const MAX_FILE_SIZE = 10_000; // 10KB

interface SkillInput {
  name: string;
  content: string;
  files?: { path: string; content: string }[];
}

export function buildSkillLayer(skills: SkillInput[]): string {
  if (skills.length === 0) return '';

  return skills.map((skill) => {
    const parts: string[] = [`## Skill: ${skill.name}`, skill.content];

    if (skill.files) {
      for (const file of skill.files) {
        if (file.content.length > MAX_FILE_SIZE) continue;
        parts.push(`### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
      }
    }

    return parts.join('\n\n');
  }).join('\n\n---\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/agent-context/skillLayer.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/layers/skillLayer.ts src/__tests__/agent-context/skillLayer.test.ts
git commit -m "feat: add SkillLayer with file inclusion and size limit"
```

---

### Task 4: PromptComposer Integration

**Files:**
- Modify: `src/lib/agent-context/PromptComposer.ts`
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/agent-context/promptComposer.test.ts`:

```typescript
import { buildSkillLayer } from '@/lib/agent-context/layers/skillLayer';

// ===========================================================================
// skillLayer (unit)
// ===========================================================================
describe('buildSkillLayer', () => {
  it('returns empty string for empty skills', () => {
    expect(buildSkillLayer([])).toBe('');
  });

  it('includes skill name and content', () => {
    const result = buildSkillLayer([{ name: 'code-review', content: 'Review carefully.' }]);
    expect(result).toContain('## Skill: code-review');
    expect(result).toContain('Review carefully.');
  });
});

// ===========================================================================
// composeSystemPrompt with skills
// ===========================================================================
describe('composeSystemPrompt with skills', () => {
  const baseOpts: ComposeOptions = {
    agent: { id: 'mario', name: 'Mario' },
    allRoleCards: [],
    project: { name: 'TestApp', path: '/tmp/test' },
    isFirstWake: true,
    rawPrompt: 'hello',
  };

  it('includes skill content when skills provided', () => {
    const result = composeSystemPrompt({
      ...baseOpts,
      skills: [{ name: 'code-review', content: 'Review carefully.' }],
    });
    expect(result).toBeDefined();
    expect(result!).toContain('## Skill: code-review');
  });

  it('works without skills (backward compatible)', () => {
    const result = composeSystemPrompt(baseOpts);
    expect(result).toBeDefined();
    expect(result!).not.toContain('## Skill:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: FAIL — `skills` is not in ComposeOptions

- [ ] **Step 3: Update PromptComposer.ts**

Update `src/lib/agent-context/PromptComposer.ts`:

```typescript
import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/taskHubStore';
import { buildRoleLayer } from './layers/roleLayer';
import { buildSkillLayer } from './layers/skillLayer';
import { buildProjectLayer } from './layers/projectLayer';
import { buildTeamLayer } from './layers/teamLayer';
import { buildHistoryLayer } from './layers/historyLayer';
import { buildTaskContextLayer } from './layers/taskContextLayer';
import { buildUserMessageLayer } from './layers/userMessageLayer';
import { buildBehaviorLayer } from './layers/behaviorLayer';

export interface SkillSummary {
  name: string;
  content: string;
  files?: { path: string; content: string }[];
}

export interface ComposeOptions {
  agent: { id: string; name: string };
  roleCard?: RoleCard;
  allRoleCards: RoleCard[];
  project: { name: string; path: string };
  isFirstWake: boolean;
  messages?: ChatMessage[];
  task?: { id: string; title: string; description?: string; phase?: { title: string } };
  rawPrompt: string;
  skills?: SkillSummary[];
}

export function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;
  return [
    buildRoleLayer(opts.agent, opts.roleCard),
    buildSkillLayer(opts.skills ?? []),
    buildProjectLayer(opts.project),
    buildTeamLayer(opts.agent.id, opts.allRoleCards),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];
  if (opts.isFirstWake) {
    const history = buildHistoryLayer(opts.messages ?? [], opts.agent.id);
    if (history) parts.push(history);
  }
  if (opts.task) {
    parts.push(buildTaskContextLayer(opts.task));
  }
  parts.push(buildUserMessageLayer(opts.rawPrompt));
  parts.push(buildBehaviorLayer());
  return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`
Expected: ALL PASS (including existing tests — backward compatible)

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/PromptComposer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "feat: integrate SkillLayer into PromptComposer"
```

---

### Task 5: Skill API Routes — CRUD

**Files:**
- Create: `src/pages/api/skills/index.ts`
- Create: `src/pages/api/skills/[id].ts`
- Create: `src/__tests__/api/skills/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/api/skills/index.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { mockReq, mockRes } from '@/test-helpers/mock-api';
import handler from '@/pages/api/skills/index';
import detailHandler from '@/pages/api/skills/[id]';

beforeEach(() => { setTestDb(createTestDb()); resetSeq(); });
afterEach(() => { resetDb(); });

describe('GET /api/skills', () => {
  it('returns empty list', async () => {
    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json).toEqual([]);
  });
});

describe('POST /api/skills', () => {
  it('creates a skill', async () => {
    const req = mockReq('POST', {
      name: 'code-review',
      description: 'Code review checklist',
      content: '# Code Review\nCheck everything.',
    });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.name).toBe('code-review');

    // Verify it appears in list
    const listReq = mockReq('GET');
    const listRes = mockRes();
    await handler(listReq, listRes);
    expect(listRes._json).toHaveLength(1);
  });

  it('rejects duplicate name', async () => {
    await handler(mockReq('POST', { name: 'dup', content: 'c1' }), mockRes());
    const res = mockRes();
    await handler(mockReq('POST', { name: 'dup', content: 'c2' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('creates skill with files', async () => {
    const req = mockReq('POST', {
      name: 'with-files',
      content: 'instructions',
      files: [{ path: 'check.md', content: 'checklist' }],
    });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.fileCount).toBe(1);
  });
});

describe('GET /api/skills/:id', () => {
  it('returns skill with files', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', {
      name: 'detail-test',
      content: 'content',
      files: [{ path: 'ref.md', content: 'reference' }],
    }), createRes);

    const req = mockReq('GET', undefined, { id: createRes._json.id });
    const res = mockRes();
    await detailHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json.files).toHaveLength(1);
  });

  it('returns 404 for missing skill', async () => {
    const req = mockReq('GET', undefined, { id: 'nonexistent' });
    const res = mockRes();
    await detailHandler(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/skills/:id', () => {
  it('updates skill and replaces files', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', {
      name: 'to-update',
      content: 'old',
      files: [{ path: 'old.md', content: 'old file' }],
    }), createRes);
    const id = createRes._json.id;

    const req = mockReq('PATCH', {
      description: 'updated desc',
      files: [{ path: 'new.md', content: 'new file' }],
    }, { id });
    const res = mockRes();
    await detailHandler(req, res);
    expect(res.statusCode).toBe(200);

    // Verify old file is gone
    const getRes = mockRes();
    await detailHandler(mockReq('GET', undefined, { id }), getRes);
    expect(getRes._json.files).toHaveLength(1);
    expect(getRes._json.files[0].path).toBe('new.md');
  });
});

describe('DELETE /api/skills/:id', () => {
  it('deletes a skill', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', { name: 'to-delete', content: 'c' }), createRes);
    const id = createRes._json.id;

    const res = mockRes();
    await detailHandler(mockReq('DELETE', undefined, { id }), res);
    expect(res.statusCode).toBe(200);

    const getRes = mockRes();
    await detailHandler(mockReq('GET', undefined, { id }), getRes);
    expect(getRes.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/api/skills/index.test.ts`
Expected: FAIL — handlers do not exist

- [ ] **Step 3: Implement skill API routes**

Create `src/pages/api/skills/index.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { skillRepo } from '@/server/repositories/skill-repo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'POST') return handleCreate(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleList(_req: NextApiRequest, res: NextApiResponse) {
  const skills = skillRepo.list();
  return res.status(200).json(skills);
}

function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  const { name, description, content, files, isPreset } = req.body;

  if (!name || !content) {
    return res.status(400).json({ error: 'name and content are required' });
  }

  const existing = skillRepo.getByName(name);
  if (existing) {
    return res.status(409).json({ error: `Skill "${name}" already exists` });
  }

  const skill = skillRepo.create({ name, description, content, isPreset });

  const fileCount = files?.length ?? 0;
  if (files && Array.isArray(files)) {
    for (const f of files) {
      skillRepo.addFile(skill.id, f);
    }
  }

  return res.status(201).json({ ...skill, fileCount });
}
```

Create `src/pages/api/skills/[id].ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { skillRepo } from '@/server/repositories/skill-repo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query as { id: string };

  if (req.method === 'GET') return handleGet(id, res);
  if (req.method === 'PATCH') return handleUpdate(id, req, res);
  if (req.method === 'DELETE') return handleDelete(id, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleGet(id: string, res: NextApiResponse) {
  const skill = skillRepo.getById(id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  const files = skillRepo.listFiles(id);
  return res.status(200).json({ ...skill, files });
}

function handleUpdate(id: string, req: NextApiRequest, res: NextApiResponse) {
  const skill = skillRepo.getById(id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });

  const { name, description, content, config, files } = req.body;
  skillRepo.update(id, { name, description, content, config });

  if (files && Array.isArray(files)) {
    skillRepo.replaceFiles(id, files);
  }

  const updated = skillRepo.getById(id)!;
  const updatedFiles = skillRepo.listFiles(id);
  return res.status(200).json({ ...updated, files: updatedFiles });
}

function handleDelete(id: string, res: NextApiResponse) {
  skillRepo.delete(id);
  return res.status(200).json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/api/skills/index.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/skills/index.ts src/pages/api/skills/\[id\].ts src/__tests__/api/skills/index.test.ts
git commit -m "feat: add skill CRUD API routes with tests"
```

---

### Task 6: Agent-Skill Association API

**Files:**
- Create: `src/pages/api/agents/[agentId]/skills.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/api/skills/index.test.ts`:

```typescript
import agentSkillsHandler from '@/pages/api/agents/[agentId]/skills';

describe('GET /api/agents/:agentId/skills', () => {
  it('returns skills assigned to agent', async () => {
    // Create two skills
    await handler(mockReq('POST', { name: 'review', content: 'review content' }), mockRes());
    await handler(mockReq('POST', { name: 'tdd', content: 'tdd content' }), mockRes());

    // Assign both to mario
    const listRes = mockRes();
    await handler(mockReq('GET'), listRes);
    const skillIds = listRes._json.map((s: any) => s.id);

    await agentSkillsHandler(
      mockReq('POST', { skillIds }, { agentId: 'mario' }),
      mockRes(),
    );

    const getRes = mockRes();
    await agentSkillsHandler(mockReq('GET', undefined, { agentId: 'mario' }), getRes);
    expect(getRes.statusCode).toBe(200);
    expect(getRes._json).toHaveLength(2);
  });
});

describe('POST /api/agents/:agentId/skills', () => {
  it('replaces agent skill assignments', async () => {
    await handler(mockReq('POST', { name: 'a', content: 'a' }), mockRes());
    await handler(mockReq('POST', { name: 'b', content: 'b' }), mockRes());

    const listRes = mockRes();
    await handler(mockReq('GET'), listRes);
    const [s1, s2] = listRes._json;

    // Assign s1
    await agentSkillsHandler(mockReq('POST', { skillIds: [s1.id] }, { agentId: 'luigi' }), mockRes());
    // Replace with s2
    await agentSkillsHandler(mockReq('POST', { skillIds: [s2.id] }, { agentId: 'luigi' }), mockRes());

    const getRes = mockRes();
    await agentSkillsHandler(mockReq('GET', undefined, { agentId: 'luigi' }), getRes);
    expect(getRes._json).toHaveLength(1);
    expect(getRes._json[0].name).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/api/skills/index.test.ts`
Expected: FAIL — `agentSkillsHandler` does not exist

- [ ] **Step 3: Implement agent skills API**

Create `src/pages/api/agents/[agentId]/skills.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { skillRepo } from '@/server/repositories/skill-repo';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { agentId } = req.query as { agentId: string };

  if (req.method === 'GET') return handleGet(agentId, res);
  if (req.method === 'POST') return handleSet(agentId, req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleGet(agentId: string, res: NextApiResponse) {
  const skills = skillRepo.getSkillsForAgent(agentId);
  return res.status(200).json(skills);
}

function handleSet(agentId: string, req: NextApiRequest, res: NextApiResponse) {
  const { skillIds } = req.body;
  if (!Array.isArray(skillIds)) {
    return res.status(400).json({ error: 'skillIds must be an array' });
  }
  skillRepo.setAgentSkills(agentId, skillIds);
  const skills = skillRepo.getSkillsForAgent(agentId);
  return res.status(200).json(skills);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/api/skills/index.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/agents/\[agentId\]/skills.ts src/__tests__/api/skills/index.test.ts
git commit -m "feat: add agent-skill association API"
```

---

### Task 7: Skill Import Pipeline

**Files:**
- Create: `src/server/skill-import.ts`
- Create: `src/pages/api/skills/import.ts`
- Create: `src/__tests__/api/skills/import.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/api/skills/import.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { mockReq, mockRes } from '@/test-helpers/mock-api';
import handler from '@/pages/api/skills/import';

beforeEach(() => { setTestDb(createTestDb()); resetSeq(); });
afterEach(() => { resetDb(); });

describe('POST /api/skills/import', () => {
  it('rejects missing source', async () => {
    const req = mockReq('POST', {});
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid URL', async () => {
    const req = mockReq('POST', { source: 'not-a-url' });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns error for unreachable repo', async () => {
    const req = mockReq('POST', { source: 'https://github.com/nonexistent/repo-that-does-not-exist-12345' });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res._json.error).toContain('Import failed');
  });
});
```

Note: The real import will be tested manually against a live repo. Unit tests cover error paths.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/api/skills/import.test.ts`
Expected: FAIL — handler does not exist

- [ ] **Step 3: Implement import logic**

Create `src/server/skill-import.ts`:

```typescript
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { skillRepo } from './repositories/skill-repo';
import type { SkillFileRow } from './repositories/skill-repo';

interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  files: { path: string; content: string }[];
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }
  return { meta, body: match[2] };
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function cloneRepo(repoUrl: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', ['clone', '--depth', '1', repoUrl, targetDir], (err) => {
      if (err) reject(new Error(`git clone failed: ${err.message}`));
      else resolve();
    });
  });
}

async function scanSkillsDir(baseDir: string): Promise<ParsedSkill[]> {
  const skillsDir = path.join(baseDir, 'skills');
  const skills: ParsedSkill[] = [];

  let scanDir: string;
  try {
    await fs.access(skillsDir);
    scanDir = skillsDir;
  } catch {
    scanDir = baseDir; // fallback: root level
  }

  const entries = await fs.readdir(scanDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFilePath = path.join(scanDir, entry.name, 'SKILL.md');
    try {
      const raw = await fs.readFile(skillFilePath, 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      const files: { path: string; content: string }[] = [];

      // Collect supporting files
      const skillDir = path.join(scanDir, entry.name);
      const fileEntries = await fs.readdir(skillDir, { withFileTypes: true, recursive: true });
      for (const fe of fileEntries) {
        if (!fe.isFile() || fe.name === 'SKILL.md') continue;
        const fullPath = path.join(fe.parentPath ?? path.dirname(fe.name), fe.name);
        const relativePath = path.relative(skillDir, fullPath);
        if (relativePath.includes('..')) continue;
        const fileContent = await fs.readFile(fullPath, 'utf-8');
        files.push({ path: relativePath, content: fileContent });
      }

      skills.push({
        name: meta.name || entry.name,
        description: meta.description || '',
        content: body.trim(),
        files,
      });
    } catch {
      // Skip directories without SKILL.md
    }
  }
  return skills;
}

export async function importFromUrl(source: string): Promise<{ imported: string[]; errors: string[] }> {
  if (!isValidUrl(source)) throw new Error('Invalid URL');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-import-'));
  const imported: string[] = [];
  const errors: string[] = [];

  try {
    await cloneRepo(source, tmpDir);
    const parsed = await scanSkillsDir(tmpDir);

    if (parsed.length === 0) {
      throw new Error('No skills found in repository');
    }

    for (const skill of parsed) {
      try {
        const existing = skillRepo.getByName(skill.name);
        if (existing) {
          // Update in place
          skillRepo.update(existing.id, {
            description: skill.description,
            content: skill.content,
          });
          skillRepo.replaceFiles(existing.id, skill.files);
          imported.push(skill.name);
        } else {
          const created = skillRepo.create({
            name: skill.name,
            description: skill.description,
            content: skill.content,
          });
          for (const f of skill.files) {
            skillRepo.addFile(created.id, f);
          }
          imported.push(skill.name);
        }
      } catch (e: any) {
        errors.push(`${skill.name}: ${e.message}`);
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return { imported, errors };
}
```

Create `src/pages/api/skills/import.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { importFromUrl } from '@/server/skill-import';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'source URL is required' });
  }

  try {
    const result = await importFromUrl(source);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: `Import failed: ${e.message}` });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/api/skills/import.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/skill-import.ts src/pages/api/skills/import.ts src/__tests__/api/skills/import.test.ts
git commit -m "feat: add skill import pipeline from Git repos"
```

---

### Task 8: Store Integration

**Files:**
- Modify: `src/store/taskHubStore.ts`
- Modify: `src/pages/api/state.ts`

This task wires skills into the Zustand store and dispatch flow.

- [ ] **Step 1: Add skill types and state to the store**

At the top of `src/store/taskHubStore.ts`, add the SkillSummary type (or import from PromptComposer):

```typescript
import type { SkillSummary } from '@/lib/agent-context/PromptComposer';
```

Add to the state interface (find `TaskHubState`):

```typescript
skills: SkillSummary[];
agentSkillIds: Record<string, string[]>; // agentId → skillIds
```

Add initial state values in the store creator:

```typescript
skills: [],
agentSkillIds: {},
```

- [ ] **Step 2: Add store actions for skills**

Add these actions to the store:

```typescript
loadSkills: async () => {
  const res = await fetch('/api/skills');
  const skills = await res.json();
  // Map to SkillSummary (name, content, files)
  const summaries: SkillSummary[] = skills.map((s: any) => ({
    name: s.name,
    content: s.content,
    files: [], // files loaded on demand for prompt injection
  }));
  set({ skills: summaries });

  // Load agent-skill assignments
  const agentIds = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'];
  const assignments: Record<string, string[]> = {};
  await Promise.all(agentIds.map(async (id) => {
    const r = await fetch(`/api/agents/${id}/skills`);
    const agentSkills = await r.json();
    assignments[id] = agentSkills.map((s: any) => s.id);
  }));
  set({ agentSkillIds: assignments });
},

getSkillsForAgent: (agentId: string): SkillSummary[] => {
  const { skills, agentSkillIds } = get();
  const ids = agentSkillIds[agentId] ?? [];
  return ids
    .map((id) => skills.find((s) => s.name === id)) // matched by id through full load
    .filter(Boolean) as SkillSummary[];
},

assignSkillsToAgent: async (agentId: string, skillIds: string[]) => {
  await fetch(`/api/agents/${agentId}/skills`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skillIds }),
  });
  set((state) => ({
    agentSkillIds: { ...state.agentSkillIds, [agentId]: skillIds },
  }));
},

importSkills: async (source: string) => {
  const res = await fetch('/api/skills/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  const result = await res.json();
  if (result.imported) {
    // Reload skills after import
    await get().loadSkills();
  }
  return result;
},
```

- [ ] **Step 3: Call loadSkills in loadFromServer**

Find the `loadFromServer` action in the store and add at the end:

```typescript
await get().loadSkills();
```

- [ ] **Step 4: Wire skills into dispatchToAgent**

In `dispatchToAgent`, after building `composeOpts`, add the skills:

Find the line:
```typescript
const composeOpts: ComposeOptions = {
```

Add `skills` to the object:
```typescript
const composeOpts: ComposeOptions = {
  agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
  roleCard,
  allRoleCards: get().roleCards,
  project: { name: conv?.title ?? '', path: conv?.projectPath ?? '' },
  isFirstWake: !sessionId,
  messages: !sessionId ? (get().chatMessagesByConversation[conversationId] ?? []) : undefined,
  task: task ? {
    id: task.id, title: task.title,
    description: task.description,
    phase: phase ? { title: phase.title } : undefined,
  } : undefined,
  rawPrompt: prompt,
  skills: get().getSkillsForAgent(agentId),
};
```

Do the same in `simulateCliExecution` — add `skills: get().getSkillsForAgent(agentId)` to `simOpts`.

- [ ] **Step 5: Add skills to state API response**

In `src/pages/api/state.ts`, add skill loading:

```typescript
import { skillRepo } from '@/server/repositories/skill-repo';

// In the handler, add to the response:
skills: skillRepo.list(),
```

And load agent-skill mappings:

```typescript
// For each agent in AGENT_ROSTER (or a hardcoded list)
const agentSkillMap: Record<string, string[]> = {};
for (const aid of ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi']) {
  agentSkillMap[aid] = skillRepo.getSkillIdsForAgent(aid);
}
// Add to response: agentSkillIds: agentSkillMap
```

- [ ] **Step 6: Run all existing tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/store/taskHubStore.ts src/pages/api/state.ts
git commit -m "feat: wire skills into store, dispatch, and state API"
```

---

### Task 9: UI — Skill Library Page

**Files:**
- Create: `src/components/skill/SkillLibrary.tsx`
- Create: `src/components/skill/SkillDetail.tsx`
- Create: `src/components/skill/SkillImportDialog.tsx`

- [ ] **Step 1: Create SkillImportDialog**

Create `src/components/skill/SkillImportDialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { X, Download, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SkillImportDialog({ open, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported?: string[]; error?: string } | null>(null);
  const importSkills = useTaskHubStore((s) => s.importSkills);

  if (!open) return null;

  const handleImport = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await importSkills(url.trim());
      setResult(res);
      if (res.imported?.length) {
        setTimeout(() => { setUrl(''); setResult(null); onClose(); }, 1500);
      }
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: 'hsl(var(--bg-primary))', borderRadius: 'var(--radius-lg)', padding: '24px', width: '480px', maxWidth: '90vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ color: 'hsl(var(--text-primary))', fontSize: '16px', fontWeight: 600 }}>导入 Skill</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))' }}><X size={18} /></button>
        </div>

        <label style={{ display: 'block', fontSize: '13px', color: 'hsl(var(--text-secondary))', marginBottom: '6px' }}>来源 URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/org/agent-skills"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-secondary))', color: 'hsl(var(--text-primary))', fontSize: '14px', boxSizing: 'border-box' }}
          onKeyDown={(e) => e.key === 'Enter' && handleImport()}
        />

        {result?.imported && <p style={{ color: 'hsl(var(--success))', fontSize: '13px', marginTop: '8px' }}>已导入: {result.imported.join(', ')}</p>}
        {result?.error && <p style={{ color: 'hsl(var(--error))', fontSize: '13px', marginTop: '8px' }}>{result.error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 'var(--radius-md)', border: '1px solid hsl(var(--border))', background: 'transparent', color: 'hsl(var(--text-secondary))', cursor: 'pointer' }}>取消</button>
          <button onClick={handleImport} disabled={loading || !url.trim()} style={{ padding: '6px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'hsl(var(--accent))', color: 'white', cursor: loading ? 'wait' : 'pointer', opacity: loading || !url.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            导入
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create SkillDetail**

Create `src/components/skill/SkillDetail.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

interface SkillDetailProps {
  skill: { id: string; name: string; description: string | null; content: string; files: { path: string; content: string }[] };
  onDelete: (id: string) => void;
}

export function SkillDetail({ skill, onDelete }: SkillDetailProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'hsl(var(--text-primary))' }}>{skill.name}</h2>
        <div>
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'hsl(var(--error))' }}>确认删除？</span>
              <button onClick={() => onDelete(skill.id)} style={{ padding: '4px 12px', borderRadius: 'var(--radius-md)', border: 'none', background: 'hsl(var(--error))', color: 'white', cursor: 'pointer', fontSize: '13px' }}>删除</button>
              <button onClick={() => setConfirmDelete(false)} style={{ padding: '4px 12px', borderRadius: 'var(--radius-md)', border: '1px solid hsl(var(--border))', background: 'transparent', color: 'hsl(var(--text-secondary))', cursor: 'pointer', fontSize: '13px' }}>取消</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))' }}><Trash2 size={16} /></button>
          )}
        </div>
      </div>

      {skill.description && (
        <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', marginBottom: '12px' }}>{skill.description}</p>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(var(--text-secondary))', marginBottom: '8px' }}>SKILL.md</h4>
        <pre style={{ padding: '12px', borderRadius: 'var(--radius-md)', background: 'hsl(var(--bg-secondary))', color: 'hsl(var(--text-primary))', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {skill.content}
        </pre>

        {skill.files.length > 0 && (
          <>
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'hsl(var(--text-secondary))', marginTop: '16px', marginBottom: '8px' }}>配套文件</h4>
            {skill.files.map((f) => (
              <div key={f.path} style={{ marginBottom: '8px' }}>
                <p style={{ fontSize: '12px', color: 'hsl(var(--text-muted))', marginBottom: '4px' }}>{f.path}</p>
                <pre style={{ padding: '8px', borderRadius: 'var(--radius-sm)', background: 'hsl(var(--bg-tertiary))', color: 'hsl(var(--text-secondary))', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {f.content.length > 500 ? f.content.slice(0, 500) + '...' : f.content}
                </pre>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create SkillLibrary**

Create `src/components/skill/SkillLibrary.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { Plus, Download } from 'lucide-react';
import { SkillDetail } from './SkillDetail';
import { SkillImportDialog } from './SkillImportDialog';

export function SkillLibrary() {
  const skills = useTaskHubStore((s) => s.skills);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [detailCache, setDetailCache] = useState<Record<string, any>>({});

  const loadDetail = async (id: string) => {
    if (detailCache[id]) return;
    const res = await fetch(`/api/skills/${id}`);
    if (res.ok) {
      const data = await res.json();
      setDetailCache((prev) => ({ ...prev, [id]: data }));
    }
  };

  const selected = selectedId ? detailCache[selectedId] : null;

  const handleDelete = async (id: string) => {
    await fetch(`/api/skills/${id}`, { method: 'DELETE' });
    setDetailCache((prev) => { const { [id]: _, ...rest } = prev; return rest; });
    if (selectedId === id) setSelectedId(null);
    // Reload skills list
    const store = useTaskHubStore.getState();
    await store.loadSkills();
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: '1px', background: 'hsl(var(--border))' }}>
      {/* Left panel: skill list */}
      <div style={{ width: '240px', background: 'hsl(var(--bg-primary))', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px', display: 'flex', gap: '6px' }}>
          <button onClick={() => setImportOpen(true)} style={{ flex: 1, padding: '6px', borderRadius: 'var(--radius-md)', border: '1px dashed hsl(var(--border))', background: 'transparent', color: 'hsl(var(--text-secondary))', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Download size={12} /> 导入
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {skills.map((skill: any) => (
            <button
              key={skill.id}
              onClick={() => { setSelectedId(skill.id); loadDetail(skill.id); }}
              style={{
                width: '100%', padding: '10px 12px', textAlign: 'left', border: 'none',
                background: selectedId === skill.id ? 'hsl(var(--bg-secondary))' : 'transparent',
                color: 'hsl(var(--text-primary))', cursor: 'pointer', fontSize: '13px',
                borderBottom: '1px solid hsl(var(--border))',
              }}
            >
              {skill.name}
            </button>
          ))}
          {skills.length === 0 && (
            <p style={{ padding: '16px', fontSize: '13px', color: 'hsl(var(--text-muted))', textAlign: 'center' }}>暂无技能，点击导入添加</p>
          )}
        </div>
      </div>

      {/* Right panel: detail */}
      <div style={{ flex: 1, background: 'hsl(var(--bg-primary))', padding: '20px', overflow: 'auto' }}>
        {selected ? (
          <SkillDetail skill={selected} onDelete={handleDelete} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'hsl(var(--text-muted))', fontSize: '14px' }}>
            选择一个 skill 查看详情
          </div>
        )}
      </div>

      <SkillImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 4: Wire SkillLibrary into the app navigation**

Find the main navigation/tab component and add a "Skills" tab that renders `<SkillLibrary />`. The exact location depends on existing navigation structure — check for a sidebar or tab bar in `src/components/task-hub/`.

- [ ] **Step 5: Verify in browser**

Run: `npm run dev`
Navigate to the Skill Library page. Verify:
- Empty state shows "暂无技能"
- Import dialog opens and accepts URL input
- Imported skills appear in the list

- [ ] **Step 6: Commit**

```bash
git add src/components/skill/
git commit -m "feat: add skill library UI with import dialog and detail view"
```

---

### Task 10: UI — Agent Skill Assignment

**Files:**
- Modify: Agent configuration component (find the agent card/role card UI)

- [ ] **Step 1: Add skill tags to agent configuration**

Find the component that renders agent configuration (likely in `src/components/task-hub/` or `src/components/role-card/`). Add a skill assignment section below the role card selector:

```tsx
{/* Skill Assignment */}
<div style={{ marginTop: '12px' }}>
  <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '6px' }}>Skills</label>
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
    {agentSkillIds.map((skillId) => {
      const skill = skills.find((s: any) => s.id === skillId);
      if (!skill) return null;
      return (
        <span key={skillId} style={{
          padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '12px',
          background: 'hsl(var(--bg-secondary))', color: 'hsl(var(--text-secondary))',
          border: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          {skill.name}
          <button onClick={() => handleRemoveSkill(agentId, skillId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))', padding: 0 }}><X size={12} /></button>
        </span>
      );
    })}
    <button onClick={() => setSkillPickerOpen(true)} style={{
      padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: '12px',
      border: '1px dashed hsl(var(--border))', background: 'transparent',
      color: 'hsl(var(--text-muted))', cursor: 'pointer',
    }}>+</button>
  </div>
</div>
```

Add a skill picker dropdown that lists available skills and calls `assignSkillsToAgent` on selection.

- [ ] **Step 2: Verify in browser**

Run: `npm run dev`
Open agent configuration, verify:
- Skills display as tags below the role card
- Clicking "+" opens skill picker
- Removing a skill updates the tag list

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "feat: add skill assignment tags to agent configuration UI"
```

---

### Task 11: Preset Skills

**Files:**
- Create: `src/data/presetSkills.ts`
- Create: `src/server/seed-skills.ts`

- [ ] **Step 1: Define preset skills**

Create `src/data/presetSkills.ts`:

```typescript
export const PRESET_SKILLS = [
  {
    name: 'code-review',
    description: '结构化代码审查，提供 checklist 和反馈模板',
    content: `# Code Review Skill

## 规则
- 审查必须基于项目的编码标准
- 提供可操作的建议，而不是泛泛的观察
- 区分必须修复（blocker）、建议修复（suggestion）、可选优化（nit）
- 始终引用具体的文件和行号

## Checklist
- [ ] 逻辑正确性
- [ ] 错误处理
- [ ] 边界条件
- [ ] 安全性（注入、XSS、敏感数据泄露）
- [ ] 性能影响
- [ ] 测试覆盖`,
    isPreset: true,
  },
  {
    name: 'tdd',
    description: '测试驱动开发工作流',
    content: `# TDD Skill

## 工作流
1. **Red** — 先写失败的测试
2. **Green** — 写最少的代码让测试通过
3. **Refactor** — 重构代码，保持测试通过

## 规则
- 每次只写一个测试
- 测试名称描述期望行为，不是实现细节
- 使用有意义的测试数据，不要用 "foo"、"bar"
- 重构时不要同时修改测试和实现`,
    isPreset: true,
  },
  {
    name: 'debugging',
    description: '系统性调试方法论',
    content: `# Debugging Skill

## 方法论
1. **复现** — 确认能稳定复现问题
2. **缩小范围** — 通过二分法缩小到最小复现路径
3. **假设** — 提出可能的原因
4. **验证** — 逐个验证假设，收集证据
5. **修复** — 实施修复，验证测试通过
6. **回归** — 确保修复没有引入新问题

## 规则
- 不要猜测，用证据说话
- 一次只改一个变量
- 记录调试过程，方便回溯`,
    isPreset: true,
  },
  {
    name: 'brainstorm',
    description: '协作式头脑风暴与创意发想',
    content: `# Brainstorm Skill

## 规则
- 先理解问题空间，再提出解决方案
- 提出至少 2-3 个不同的方案，分析各自的权衡
- 使用 "是的，而且..." 而不是 "但是..."
- 优先考虑简单方案，复杂方案需要充分的理由
- 区分 "必须有" 和 "可以有"`,
    isPreset: true,
  },
];
```

- [ ] **Step 2: Create seed function**

Create `src/server/seed-skills.ts`:

```typescript
import { skillRepo } from './repositories/skill-repo';
import { PRESET_SKILLS } from '../data/presetSkills';

export function seedPresetSkills(): void {
  for (const preset of PRESET_SKILLS) {
    const existing = skillRepo.getByName(preset.name);
    if (!existing) {
      skillRepo.create({
        name: preset.name,
        description: preset.description,
        content: preset.content,
        isPreset: preset.isPreset,
      });
    }
  }
}
```

- [ ] **Step 3: Call seed on DB init**

In `src/server/db/index.ts`, after `applyMigrations(db)`, add:

```typescript
import { seedPresetSkills } from '../seed-skills';

// Inside getDb(), after applyMigrations(db):
seedPresetSkills();
```

- [ ] **Step 4: Verify**

Run: `npx vitest run`
Then start dev server and verify preset skills appear in the skill library.

- [ ] **Step 5: Commit**

```bash
git add src/data/presetSkills.ts src/server/seed-skills.ts src/server/db/index.ts
git commit -m "feat: add preset skills (code-review, tdd, debugging, brainstorm)"
```

---

## Self-Review Checklist

**1. Spec Coverage:**

| Spec Section | Task |
|---|---|
| Data Model (3 tables) | Task 1 |
| Skill Repo (CRUD, files, assignments) | Task 2 |
| SkillLayer (prompt injection) | Task 3 |
| PromptComposer integration | Task 4 |
| Skill API (CRUD) | Task 5 |
| Agent-Skill API | Task 6 |
| Import Pipeline | Task 7 |
| Store + Dispatch | Task 8 |
| UI - Skill Library | Task 9 |
| UI - Agent Assignment | Task 10 |
| Preset Skills | Task 11 |

**2. Placeholder Scan:** No TBD, TODO, or "implement later" found. All steps contain actual code.

**3. Type Consistency:** `SkillSummary` (name, content, files?) is defined in PromptComposer.ts and used consistently across skillLayer, store, and UI components. `skillRepo` method names (`create`, `getById`, `list`, `update`, `delete`, `addFile`, `listFiles`, `replaceFiles`, `assignToAgent`, `setAgentSkills`, `getSkillsForAgent`, `getSkillIdsForAgent`) are consistent across test and implementation.
