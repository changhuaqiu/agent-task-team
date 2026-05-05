# Role Card Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Role Card ecosystem that supports SoulSpec import, Team Packs, and deep integration with PromptComposer

**Architecture:** Extend existing RoleCard type with engineering fields, add TeamPack as first-class entity, build import pipeline from ClawSouls/SoulSpec ecosystem, and integrate TeamPack workflow/matrix into PromptComposer layers

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Drizzle ORM, Next.js API routes, Zustand store

---

## Context

### Current State

**RoleCard System** (implemented):
- 8-dimensional type: Identity, Responsibility, Work Style, Action Boundaries, Capability Binding, Output & Quality, Persona, Capability Profile
- Stored as JSON in SQLite `role_cards` table
- 6 preset cards: Mario (planner), Luigi (frontend), Toad (backend), Peach (code_reviewer), Donkey Kong (arch_reviewer), Yoshi (qa)
- Bound to agents via `agents.role_card_id`

**Skill System** (implemented):
- Git-based import pipeline (`src/server/skill-import.ts`)
- Tables: `skill`, `skill_file`, `agent_skill`
- PromptComposer integration via SkillLayer + ToolLayer

**PromptComposer** (implemented):
- System prompt (first wake): RoleLayer → ProjectLayer → ProjectStatusLayer
- User prompt (every dispatch): SkillLayer → ToolLayer → TeamLayer → ProtocolLayer → HistoryLayer → TaskContextLayer → A2ALayer → UserMessageLayer → BehaviorLayer

### Gaps to Fill

1. **No Team Pack concept** — agents are independent, no workflow/matrix
2. **No SoulSpec import** — can't import from ClawSouls ecosystem
3. **No engineering workflow fields** — RoleCard lacks step-by-step workflow, escalation rules
4. **No Team Pack UI** — no way to browse/select/configure team packs

### External Ecosystem (Research)

**SoulSpec v0.5** (80+ community souls):
- JSON schema: `specVersion`, `name`, `displayName`, `version`, `description`, `author`, `license`, `tags`, `category`, `files.soul`
- CLI: `npx clawsouls install/export/validate/soulscan`
- Registry: `https://clawsouls.ai/api/v1`
- Validation: SoulScan (53 checks, A+ to F grading)

**souls.directory** (free community templates):
- Copy-paste style, MIT licensed
- API: `GET /api/souls/:slug`

---

## File Structure

### New Files

```
src/
├── types/
│   └── teamPack.ts                    # TeamPack type definition
├── server/
│   ├── db/
│   │   └── teamPackQueries.ts         # TeamPack CRUD operations
│   ├── repositories/
│   │   └── team-pack-repo.ts          # TeamPack repository
│   ├── role-card-import.ts            # SoulSpec → RoleCard converter
│   └── seed-team-packs.ts             # Preset team packs
├── lib/
│   └── agent-context/
│       └── layers/
│           └── teamPackLayer.ts       # TeamPack context for PromptComposer
├── data/
│   └── presetTeamPacks.ts             # Preset team pack definitions
├── pages/
│   └── api/
│       ├── team-packs/
│       │   ├── index.ts               # List/Create team packs
│       │   └── [packId].ts            # Get/Update/Delete team pack
│       └── role-cards/
│           └── import.ts              # Import from SoulSpec URL
└── store/
    └── teamPackStore.ts               # Zustand store for team packs
```

### Modified Files

```
src/
├── types/
│   └── roleCard.ts                    # Add engineering fields
├── server/
│   └── db/
│       ├── schema.ts                  # Add team_pack, team_pack_role tables
│       └── migrate.ts                 # Migration for new tables
├── lib/
│   └── agent-context/
│       └── PromptComposer.ts          # Add TeamPackLayer
└── store/
    └── agentStore.ts                  # Add team pack state
```

---

## Tasks

### Task 1: Extend RoleCard Type with Engineering Fields

**Files:**
- Modify: `src/types/roleCard.ts`

**Rationale:** SoulSpec defines WHO (persona), but engineering roles need HOW (workflow, escalation). We extend RoleCard with optional engineering fields that SoulSpec-imported cards can fill later.

- [ ] **Step 1: Add engineering types**

```typescript
// Add to src/types/roleCard.ts

export type WorkflowStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  output: string;
  reviewGate: boolean;           // Must pass review before next step
  estimatedDuration?: string;    // e.g., "30min", "2h"
}

export interface EscalationRule {
  when: string;                  // Condition description
  action: string;                // What to do
  target: 'human' | string;     // Escalate to human or specific role
}

export interface CommunicationMatrix {
  canSendTo: string[];           // Role IDs this role can send messages to
  canReceiveFrom: string[];      // Role IDs this role can receive messages from
  canEscalateTo: string[];       // Who to escalate to (human or role IDs)
}

export interface EngineeringConfig {
  roleType: 'planner' | 'implementer' | 'reviewer' | 'coordinator' | 'specialist';
  canModifyCode: boolean;
  canApprovePR: boolean;
  mustReportTo: string[];        // Role IDs
  escalationRules: EscalationRule[];
  reviewRequired: boolean;       // Output must pass review
  outputEvidence: boolean;       // Output must include evidence
  workflow?: WorkflowStep[];     // Step-by-step workflow
  communication?: CommunicationMatrix;
}
```

- [ ] **Step 2: Add engineering field to RoleCard interface**

```typescript
// Add to RoleCard interface in src/types/roleCard.ts

export interface RoleCard {
  // ... existing fields ...

  // Dimension 9: Engineering (optional, for team collaboration)
  engineering?: EngineeringConfig;

  // ... rest of existing fields ...
}
```

- [ ] **Step 3: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/types/roleCard.ts
git commit -m "feat: add engineering fields to RoleCard type"
```

---

### Task 2: Create TeamPack Type Definition

**Files:**
- Create: `src/types/teamPack.ts`

**Rationale:** TeamPack is a first-class entity that groups roles with collaboration rules (workflow, communication matrix, shared context). This is the core abstraction for team-based collaboration.

- [ ] **Step 1: Create TeamPack type**

```typescript
// src/types/teamPack.ts

export type WorkflowType = 'linear' | 'state_machine';

export interface WorkflowTransition {
  from: string;           // State/role name
  to: string;             // State/role name
  condition: string;      // When to transition
  trigger?: string;       // What triggers the transition
}

export interface LinearWorkflowStep {
  role: string;           // Role ID
  action: string;         // What to do
  output: string;         // What to produce
  canReject?: boolean;    // Can reject and send back
}

export interface StateMachineState {
  name: string;           // State name
  role: string;           // Responsible role ID
  description: string;
  transitions: WorkflowTransition[];
  terminal?: boolean;     // Is this a final state
}

export interface TeamPackWorkflow {
  type: WorkflowType;
  description?: string;
  // For linear workflow
  steps?: LinearWorkflowStep[];
  // For state machine
  states?: StateMachineState[];
}

export interface TeamPackRole {
  id: string;             // Unique within pack (e.g., "planner")
  displayName: string;
  soul: string;           // Path to SOUL.md content or inline content
  required: boolean;      // Is this role mandatory
  description?: string;
  roleCardId?: string;    // Link to existing RoleCard (optional)
}

export interface TeamPackCommunicationMatrix {
  [roleId: string]: {
    canSendTo: string[];
    canReceiveFrom: string[];
    canEscalateTo?: string[];
  };
}

export interface TeamPackSharedContext {
  files?: string[];       // Shared file paths
  state?: string[];       // Shared state keys
  memory?: string[];      // Shared memory keys
}

export interface TeamPackRules {
  maxIterations?: number;         // Max retry iterations
  escalationTimeoutHours?: number; // When to escalate
  requireEvidence?: boolean;       // Require evidence for outputs
  autoAssign?: boolean;            // Auto-assign tasks to roles
}

export interface TeamPack {
  id: string;
  specVersion: 'team-pack/0.1';
  name: string;                   // Unique identifier (kebab-case)
  displayName: string;
  description: string;
  version: string;                // Semver
  author?: {
    name: string;
    github?: string;
  };
  license?: string;
  tags: string[];
  category: string;               // e.g., "team/engineering"
  roles: TeamPackRole[];
  workflow: TeamPackWorkflow;
  communicationMatrix: TeamPackCommunicationMatrix;
  sharedContext?: TeamPackSharedContext;
  rules?: TeamPackRules;
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
}

// For creating new team packs
export interface CreateTeamPackInput {
  name: string;
  displayName: string;
  description: string;
  version?: string;
  author?: { name: string; github?: string };
  license?: string;
  tags?: string[];
  category?: string;
  roles: TeamPackRole[];
  workflow: TeamPackWorkflow;
  communicationMatrix: TeamPackCommunicationMatrix;
  sharedContext?: TeamPackSharedContext;
  rules?: TeamPackRules;
}
```

- [ ] **Step 2: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/types/teamPack.ts
git commit -m "feat: add TeamPack type definition"
```

---

### Task 3: Add TeamPack Database Schema

**Files:**
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/migrate.ts`

**Rationale:** TeamPack needs its own tables to store pack metadata, roles, and workflow definitions. We follow the same pattern as skill/skill_file.

- [ ] **Step 1: Add Drizzle schema for team_pack**

```typescript
// Add to src/server/db/schema.ts

// ──────────────────────────────────────────────
// team_pack
// ──────────────────────────────────────────────
export const teamPack = sqliteTable('team_pack', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  version: text('version').notNull().default('1.0.0'),
  author: text('author'),           // JSON: { name, github }
  license: text('license'),
  tags: text('tags'),               // JSON string[]
  category: text('category').notNull().default('team/general'),
  workflow: text('workflow').notNull(),  // JSON: TeamPackWorkflow
  communicationMatrix: text('communication_matrix').notNull(),  // JSON
  sharedContext: text('shared_context'),  // JSON
  rules: text('rules'),             // JSON: TeamPackRules
  isPreset: integer('is_preset', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type TeamPackRow = InferSelectModel<typeof teamPack>;
export type NewTeamPackRow = InferInsertModel<typeof teamPack>;

// ──────────────────────────────────────────────
// team_pack_role
// ──────────────────────────────────────────────
export const teamPackRole = sqliteTable('team_pack_role', {
  id: text('id').primaryKey(),
  packId: text('pack_id').notNull()
    .references(() => teamPack.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull(),  // e.g., "planner"
  displayName: text('display_name').notNull(),
  soul: text('soul').notNull(),       // SOUL.md content
  required: integer('required', { mode: 'boolean' }).notNull().default(true),
  description: text('description'),
  roleCardId: text('role_card_id'),   // Optional link to existing RoleCard
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('uq_team_pack_role').on(table.packId, table.roleId),
  index('idx_team_pack_role_pack').on(table.packId),
]);

export type TeamPackRoleRow = InferSelectModel<typeof teamPackRole>;
export type NewTeamPackRoleRow = InferInsertModel<typeof teamPackRole>;

// ──────────────────────────────────────────────
// agent_team_pack (junction table)
// ──────────────────────────────────────────────
export const agentTeamPack = sqliteTable('agent_team_pack', {
  agentId: text('agent_id').notNull(),
  packId: text('pack_id').notNull()
    .references(() => teamPack.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull(),  // Which role in the pack
  assignedAt: text('assigned_at').notNull(),
}, (table) => [
  index('idx_agent_team_pack_agent').on(table.agentId),
  index('idx_agent_team_pack_pack').on(table.packId),
]);

export type AgentTeamPackRow = InferSelectModel<typeof agentTeamPack>;
export type NewAgentTeamPackRow = InferInsertModel<typeof agentTeamPack>;
```

- [ ] **Step 2: Add migration**

```typescript
// Add to src/server/db/migrate.ts as new version

{
  version: 12,  // Adjust based on current latest version
  sql: `
    CREATE TABLE IF NOT EXISTS team_pack (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      author TEXT,
      license TEXT,
      tags TEXT,
      category TEXT NOT NULL DEFAULT 'team/general',
      workflow TEXT NOT NULL,
      communication_matrix TEXT NOT NULL,
      shared_context TEXT,
      rules TEXT,
      is_preset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_pack_role (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL REFERENCES team_pack(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      soul TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      role_card_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(pack_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS agent_team_pack (
      agent_id TEXT NOT NULL,
      pack_id TEXT NOT NULL REFERENCES team_pack(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, pack_id)
    );

    CREATE INDEX IF NOT EXISTS idx_team_pack_role_pack ON team_pack_role(pack_id);
    CREATE INDEX IF NOT EXISTS idx_agent_team_pack_agent ON agent_team_pack(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_team_pack_pack ON agent_team_pack(pack_id);
  `,
},
```

- [ ] **Step 3: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.ts src/server/db/migrate.ts
git commit -m "feat: add TeamPack database schema"
```

---

### Task 4: Create TeamPack Repository

**Files:**
- Create: `src/server/repositories/team-pack-repo.ts`

**Rationale:** Follow the same repository pattern as skill-repo.ts for consistency.

- [ ] **Step 1: Create repository**

```typescript
// src/server/repositories/team-pack-repo.ts

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
  // ── Pack CRUD ─────────────────────────────

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

    // Insert roles
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

    if (updates.displayName !== undefined) {
      sets.push('display_name = ?');
      values.push(updates.displayName);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      values.push(updates.description);
    }
    if (updates.workflow !== undefined) {
      sets.push('workflow = ?');
      values.push(JSON.stringify(updates.workflow));
    }
    if (updates.communicationMatrix !== undefined) {
      sets.push('communication_matrix = ?');
      values.push(JSON.stringify(updates.communicationMatrix));
    }

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

  addRole(packId: string, role: Omit<TeamPackRole, 'id'>): void {
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
      role.roleCardId ?? null,
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
      'SELECT agent_id, role_id FROM agent_team_pack WHERE pack_id = ?'
    ).all(packId) as { agentId: string; roleId: string }[];
  },

  getPacksForAgent(agentId: string): TeamPack[] {
    const rows = getDb().prepare(
      `SELECT tp.* FROM team_pack tp
       JOIN agent_team_pack atp ON atp.pack_id = tp.id
       WHERE atp.agent_id = ?
       ORDER BY tp.name ASC`
    ).all(agentId) as TeamPackRow[];

    return rows.map(pack => {
      const roles = getDb().prepare('SELECT * FROM team_pack_role WHERE pack_id = ? ORDER BY role_id').all(pack.id) as TeamPackRoleRow[];
      return rowToTeamPack(pack, roles);
    });
  },
};
```

- [ ] **Step 2: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/server/repositories/team-pack-repo.ts
git commit -m "feat: add TeamPack repository"
```

---

### Task 5: Create SoulSpec Import Pipeline

**Files:**
- Create: `src/server/role-card-import.ts`

**Rationale:** Reuse the existing skill-import.ts pattern (Git clone → scan → parse → upsert) for role cards. Support both SoulSpec format and raw SOUL.md files.

- [ ] **Step 1: Create import functions**

```typescript
// src/server/role-card-import.ts

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { upsertRoleCard } from './db/roleCardQueries';
import type { RoleCard } from '@/types/roleCard';

interface SoulSpecMetadata {
  specVersion: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author?: { name: string; github?: string };
  license?: string;
  tags?: string[];
  category?: string;
  files?: { soul?: string; identity?: string; agents?: string };
}

interface ParsedSoul {
  metadata: SoulSpecMetadata;
  soulContent: string;      // SOUL.md content
  identityContent?: string; // IDENTITY.md content
  agentsContent?: string;   // AGENTS.md content
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const CLONE_TIMEOUT_MS = 30_000;

function classifyCloneError(err: Error): Error {
  const msg = err.message.toLowerCase();
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return new Error('网络连接失败，请检查网络连接或代理设置。');
  }
  if (msg.includes('not found') || msg.includes('404')) {
    return new Error('仓库不存在，请检查 URL 是否正确。');
  }
  if (msg.includes('authentication') || msg.includes('403')) {
    return new Error('仓库需要认证或无访问权限。仅支持公开仓库。');
  }
  return new Error(`克隆仓库失败: ${err.message}`);
}

async function cloneRepo(repoUrl: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['clone', '--depth', '1', repoUrl, targetDir], (err) => {
      if (err) reject(classifyCloneError(err));
      else resolve();
    });
    setTimeout(() => {
      child.kill();
      reject(new Error('克隆超时（30秒），请检查网络连接。'));
    }, CLONE_TIMEOUT_MS);
  });
}

// ──────────────────────────────────────────────
// Parsers
// ──────────────────────────────────────────────

async function parseSoulSpec(dirPath: string): Promise<ParsedSoul | null> {
  // Try to find soul.json
  const soulJsonPath = path.join(dirPath, 'soul.json');
  let metadata: SoulSpecMetadata;

  try {
    const raw = await fs.readFile(soulJsonPath, 'utf-8');
    metadata = JSON.parse(raw);
  } catch {
    // No soul.json, try to infer from SOUL.md
    return parseRawSoulMd(dirPath);
  }

  // Read SOUL.md
  const soulPath = path.join(dirPath, metadata.files?.soul ?? 'SOUL.md');
  let soulContent: string;
  try {
    soulContent = await fs.readFile(soulPath, 'utf-8');
  } catch {
    return null; // No SOUL.md found
  }

  // Read optional files
  let identityContent: string | undefined;
  let agentsContent: string | undefined;

  if (metadata.files?.identity) {
    try {
      identityContent = await fs.readFile(path.join(dirPath, metadata.files.identity), 'utf-8');
    } catch { /* ignore */ }
  }

  if (metadata.files?.agents) {
    try {
      agentsContent = await fs.readFile(path.join(dirPath, metadata.files.agents), 'utf-8');
    } catch { /* ignore */ }
  }

  return { metadata, soulContent, identityContent, agentsContent };
}

async function parseRawSoulMd(dirPath: string): Promise<ParsedSoul | null> {
  const soulPath = path.join(dirPath, 'SOUL.md');
  let soulContent: string;

  try {
    soulContent = await fs.readFile(soulPath, 'utf-8');
  } catch {
    return null;
  }

  // Extract name from first heading
  const nameMatch = soulContent.match(/^#\s+(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : path.basename(dirPath);

  return {
    metadata: {
      specVersion: 'raw',
      name: name.toLowerCase().replace(/\s+/g, '-'),
      displayName: name,
      version: '1.0.0',
      description: '',
    },
    soulContent,
  };
}

// ──────────────────────────────────────────────
// Converter
// ──────────────────────────────────────────────

function soulToRoleCard(parsed: ParsedSoul): RoleCard {
  const { metadata, soulContent } = parsed;
  const now = new Date().toISOString();

  // Extract persona from SOUL.md content
  const personaMatch = soulContent.match(/##\s*(?:Personality|Persona|Vibe|核心身份)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const persona = personaMatch ? personaMatch[1].trim() : '';

  // Extract principles
  const principlesMatch = soulContent.match(/##\s*(?:Principles|Core Truths|核心原则)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const principles = principlesMatch
    ? principlesMatch[1].split('\n').filter(l => l.startsWith('-')).map(l => l.slice(1).trim())
    : [];

  // Extract boundaries
  const boundariesMatch = soulContent.match(/##\s*(?:Boundaries|Limits|边界)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const boundaries = boundariesMatch
    ? boundariesMatch[1].split('\n').filter(l => l.startsWith('-')).map(l => l.slice(1).trim())
    : [];

  // Map category
  const categoryMap: Record<string, RoleCard['category']> = {
    'work/engineering': 'backend',
    'work/frontend': 'frontend',
    'work/devops': 'backend',
    'work/qa': 'qa',
    'work/planning': 'planner',
    'work/review': 'code_reviewer',
  };

  return {
    id: `imported-${metadata.name}`,
    name: metadata.name,
    displayName: metadata.displayName,
    description: metadata.description,
    category: categoryMap[metadata.category ?? ''] ?? 'backend',
    tags: metadata.tags ?? [],
    applicableScenarios: [],
    responsibilities: principles.slice(0, 5),
    nonResponsibilities: boundaries,
    successCriteria: [],
    clarifyBeforeExecute: 'when_ambiguous',
    outputStyle: 'concise',
    preferStructuredOutput: false,
    allowedActions: [],
    requiresConfirmation: [],
    forbiddenActions: [],
    preferredEngines: [],
    allowedTools: [],
    accountIds: [],
    outputFormat: 'freeform',
    requiresEvidence: false,
    riskGrading: 'none',
    persona: {
      introduction: persona.slice(0, 500),
      voice: '',
      mindset: '',
      habits: '',
      collaboration: '',
    },
    isPreset: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// ──────────────────────────────────────────────
// Main Import
// ──────────────────────────────────────────────

export async function importRoleCardFromUrl(source: string): Promise<{ imported: string[]; errors: string[] }> {
  if (!isValidUrl(source)) throw new Error('Invalid URL');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-card-import-'));
  const imported: string[] = [];
  const errors: string[] = [];

  try {
    await cloneRepo(source, tmpDir);

    // Check if it's a single soul or a collection
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    const soulDirs: string[] = [];

    // Check root for soul.json or SOUL.md
    const hasSoulJson = entries.some(e => e.isFile() && e.name === 'soul.json');
    const hasSoulMd = entries.some(e => e.isFile() && e.name === 'SOUL.md');

    if (hasSoulJson || hasSoulMd) {
      soulDirs.push(tmpDir);
    } else {
      // Check subdirectories
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(tmpDir, entry.name);
        const subEntries = await fs.readdir(subDir);
        if (subEntries.includes('soul.json') || subEntries.includes('SOUL.md')) {
          soulDirs.push(subDir);
        }
      }
    }

    if (soulDirs.length === 0) {
      throw new Error('未找到 soul.json 或 SOUL.md 文件');
    }

    for (const dir of soulDirs) {
      try {
        const parsed = await parseSoulSpec(dir);
        if (!parsed) {
          errors.push(`${dir}: 无法解析`);
          continue;
        }

        const roleCard = soulToRoleCard(parsed);
        upsertRoleCard(roleCard);
        imported.push(roleCard.name);
      } catch (e: any) {
        errors.push(`${dir}: ${e.message}`);
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return { imported, errors };
}

// ──────────────────────────────────────────────
// Import from ClawSouls Registry
// ──────────────────────────────────────────────

export async function importFromClawSouls(ownerName: string): Promise<{ imported: string[]; errors: string[] }> {
  // Convert to GitHub URL
  const url = `https://github.com/clawsouls/${ownerName}`;
  return importRoleCardFromUrl(url);
}
```

- [ ] **Step 2: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/server/role-card-import.ts
git commit -m "feat: add SoulSpec import pipeline"
```

---

### Task 6: Create TeamPack API Endpoints

**Files:**
- Create: `src/pages/api/team-packs/index.ts`
- Create: `src/pages/api/team-packs/[packId].ts`
- Create: `src/pages/api/role-cards/import.ts`

**Rationale:** REST API for team pack CRUD and role card import.

- [ ] **Step 1: Create team packs list endpoint**

```typescript
// src/pages/api/team-packs/index.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const packs = teamPackRepo.list();
    return res.status(200).json(packs);
  }

  if (req.method === 'POST') {
    try {
      const pack = teamPackRepo.create(req.body);
      return res.status(201).json(pack);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
}
```

- [ ] **Step 2: Create team pack detail endpoint**

```typescript
// src/pages/api/team-packs/[packId].ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { packId } = req.query as { packId: string };

  if (req.method === 'GET') {
    const pack = teamPackRepo.getById(packId);
    if (!pack) return res.status(404).json({ error: 'Team pack not found' });
    return res.status(200).json(pack);
  }

  if (req.method === 'PATCH') {
    teamPackRepo.update(packId, req.body);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    teamPackRepo.delete(packId);
    return res.status(204).end();
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
  res.status(405).end();
}
```

- [ ] **Step 3: Create role card import endpoint**

```typescript
// src/pages/api/role-cards/import.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { importRoleCardFromUrl } from '@/server/role-card-import';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end();
  }

  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'Missing source URL' });
  }

  try {
    const result = await importRoleCardFromUrl(source);
    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}
```

- [ ] **Step 4: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/team-packs/ src/pages/api/role-cards/import.ts
git commit -m "feat: add TeamPack and RoleCard import API endpoints"
```

---

### Task 7: Create Preset Team Packs

**Files:**
- Create: `src/data/presetTeamPacks.ts`
- Create: `src/server/seed-team-packs.ts`

**Rationale:** Ship with pre-built team packs (Engineering Trio, Full Stack Team, Research Team) so users can start immediately.

- [ ] **Step 1: Create preset team packs data**

```typescript
// src/data/presetTeamPacks.ts

import type { CreateTeamPackInput } from '@/types/teamPack';

export const PRESET_TEAM_PACKS: CreateTeamPackInput[] = [
  {
    name: 'engineering-trio',
    displayName: '工程三件套',
    description: 'Planner + Coder + Reviewer 经典组合，适合中小型项目',
    version: '1.0.0',
    tags: ['engineering', 'planning', 'coding', 'review'],
    category: 'team/engineering',
    roles: [
      {
        id: 'planner',
        displayName: '规划师',
        required: true,
        description: '拆解任务、排优先级、梳理依赖',
        soul: `# 规划师

## 核心身份
我是规划师，负责把模糊的需求变成清晰可执行的任务。

## 核心原则
- 先理解再拆解
- 小步快跑
- 依赖显性化
- 风险前置

## 工作流程
1. 理解需求
2. 任务拆解
3. 派发任务
4. 跟踪进度
5. 处理审查结果`,
      },
      {
        id: 'coder',
        displayName: '实现者',
        required: true,
        description: '写代码、调 bug、实现功能',
        soul: `# 实现者

## 核心身份
我是实现者，负责把任务列表变成可运行的代码。

## 核心原则
- 测试先行（TDD）
- 小步提交
- 代码即文档
- 遵循规范

## 工作流程
1. 接收任务
2. 设计实现方案
3. 编写测试
4. 实现代码
5. 提交审查
6. 处理审查反馈`,
      },
      {
        id: 'reviewer',
        displayName: '审查者',
        required: true,
        description: '审查质量、发现问题、把关交付',
        soul: `# 审查者

## 核心身份
我是审查者，负责确保代码质量。

## 核心原则
- 标准统一
- 建设性反馈
- 证据驱动
- 及时响应

## 审查维度
- 正确性
- 可读性
- 可维护性
- 测试覆盖
- 安全性

## 工作流程
1. 接收审查请求
2. 代码审查
3. 测试验证
4. 出具审查结论
5. 通知结果`,
      },
    ],
    workflow: {
      type: 'state_machine',
      description: '任务从规划到交付的完整流转',
      states: [
        {
          name: 'planning',
          role: 'planner',
          description: '规划师拆解任务',
          transitions: [
            { from: 'planning', to: 'implementing', condition: '任务拆解完成', trigger: 'planner 发送任务列表' },
          ],
        },
        {
          name: 'implementing',
          role: 'coder',
          description: '实现者编写代码',
          transitions: [
            { from: 'implementing', to: 'reviewing', condition: 'PR 提交', trigger: 'coder 提交代码' },
            { from: 'implementing', to: 'blocked', condition: '遇到阻塞', trigger: 'coder 上报阻塞' },
          ],
        },
        {
          name: 'reviewing',
          role: 'reviewer',
          description: '审查者检查代码',
          transitions: [
            { from: 'reviewing', to: 'done', condition: '审查通过', trigger: 'reviewer 批准' },
            { from: 'reviewing', to: 'implementing', condition: '审查不通过', trigger: 'reviewer 打回' },
          ],
        },
        {
          name: 'blocked',
          role: 'planner',
          description: '阻塞状态，规划师协调解决',
          transitions: [
            { from: 'blocked', to: 'implementing', condition: '阻塞解决', trigger: 'planner 解除阻塞' },
          ],
        },
        {
          name: 'done',
          role: '',
          description: '任务完成',
          terminal: true,
          transitions: [],
        },
      ],
    },
    communicationMatrix: {
      planner: { canSendTo: ['coder'], canReceiveFrom: ['reviewer', 'coder'], canEscalateTo: ['human'] },
      coder: { canSendTo: ['reviewer', 'planner'], canReceiveFrom: ['planner', 'reviewer'], canEscalateTo: ['planner'] },
      reviewer: { canSendTo: ['planner', 'coder'], canReceiveFrom: ['coder'], canEscalateTo: ['human'] },
    },
    rules: {
      maxIterations: 3,
      escalationTimeoutHours: 2,
      requireEvidence: true,
      autoAssign: true,
    },
  },
  // Add more preset packs here (full-stack-team, research-team, etc.)
];
```

- [ ] **Step 2: Create seed function**

```typescript
// src/server/seed-team-packs.ts

import { teamPackRepo } from './repositories/team-pack-repo';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';

export function seedTeamPacks(): void {
  for (const packInput of PRESET_TEAM_PACKS) {
    const existing = teamPackRepo.getByName(packInput.name);
    if (!existing) {
      teamPackRepo.create(packInput);
      console.log(`✅ Seeded team pack: ${packInput.displayName}`);
    }
  }
}
```

- [ ] **Step 3: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/data/presetTeamPacks.ts src/server/seed-team-packs.ts
git commit -m "feat: add preset team packs (Engineering Trio)"
```

---

### Task 8: Create TeamPackLayer for PromptComposer

**Files:**
- Create: `src/lib/agent-context/layers/teamPackLayer.ts`
- Modify: `src/lib/agent-context/PromptComposer.ts`

**Rationale:** Inject TeamPack context (workflow, communication matrix, shared context) into agent prompts so they understand the team structure.

- [ ] **Step 1: Create TeamPackLayer**

```typescript
// src/lib/agent-context/layers/teamPackLayer.ts

import type { TeamPack } from '@/types/teamPack';

export function buildTeamPackLayer(
  agentId: string,
  teamPack: TeamPack | undefined
): string {
  if (!teamPack) return '';

  const parts: string[] = [];

  // Team identity
  parts.push(`## 团队：${teamPack.displayName}`);
  parts.push(teamPack.description);

  // Agent's role in the team
  const agentRole = teamPack.roles.find(r => r.id === agentId);
  if (agentRole) {
    parts.push(`### 你在团队中的角色`);
    parts.push(`**${agentRole.displayName}**：${agentRole.description ?? ''}`);
  }

  // Workflow
  if (teamPack.workflow.type === 'state_machine' && teamPack.workflow.states) {
    parts.push(`### 团队工作流程`);
    const stateDescriptions = teamPack.workflow.states
      .filter(s => !s.terminal)
      .map(s => `- **${s.name}** (${s.role})：${s.description}`);
    parts.push(stateDescriptions.join('\n'));
  } else if (teamPack.workflow.type === 'linear' && teamPack.workflow.steps) {
    parts.push(`### 团队工作流程`);
    const stepDescriptions = teamPack.workflow.steps
      .map((s, i) => `${i + 1}. **${s.role}**：${s.action} → ${s.output}`);
    parts.push(stepDescriptions.join('\n'));
  }

  // Communication matrix
  const matrix = teamPack.communicationMatrix[agentId];
  if (matrix) {
    parts.push(`### 沟通规则`);
    if (matrix.canSendTo.length > 0) {
      parts.push(`- 可以发送消息给：${matrix.canSendTo.join('、')}`);
    }
    if (matrix.canReceiveFrom.length > 0) {
      parts.push(`- 可以接收来自以下角色的消息：${matrix.canReceiveFrom.join('、')}`);
    }
    if (matrix.canEscalateTo && matrix.canEscalateTo.length > 0) {
      parts.push(`- 可以升级给：${matrix.canEscalateTo.join('、')}`);
    }
  }

  // Team rules
  if (teamPack.rules) {
    parts.push(`### 团队规则`);
    if (teamPack.rules.maxIterations) {
      parts.push(`- 最大重试次数：${teamPack.rules.maxIterations}`);
    }
    if (teamPack.rules.requireEvidence) {
      parts.push(`- 产出必须附带证据`);
    }
  }

  return parts.join('\n\n');
}
```

- [ ] **Step 2: Integrate into PromptComposer**

```typescript
// Add to src/lib/agent-context/PromptComposer.ts

import { buildTeamPackLayer } from './layers/teamPackLayer';
import type { TeamPack } from '@/types/teamPack';

// Add to ComposeOptions interface
export interface ComposeOptions {
  // ... existing fields ...
  teamPack?: TeamPack;  // NEW: Team pack context
}

// In composeUserPrompt function, add after team layer:
export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];

  // ... existing layers ...

  // Team pack context (if agent is part of a team pack)
  if (opts.teamPack) {
    const teamPackLayer = buildTeamPackLayer(opts.agent.id, opts.teamPack);
    if (teamPackLayer) parts.push(teamPackLayer);
  }

  // ... rest of existing layers ...

  return parts.filter(Boolean).join('\n\n');
}
```

- [ ] **Step 3: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent-context/layers/teamPackLayer.ts src/lib/agent-context/PromptComposer.ts
git commit -m "feat: add TeamPackLayer to PromptComposer"
```

---

### Task 9: Create TeamPack Zustand Store

**Files:**
- Create: `src/store/teamPackStore.ts`

**Rationale:** Frontend state management for team packs, following the same pattern as agentStore.

- [ ] **Step 1: Create store**

```typescript
// src/store/teamPackStore.ts

import { create } from 'zustand';
import type { TeamPack, CreateTeamPackInput } from '@/types/teamPack';

interface TeamPackState {
  // Data
  teamPacks: TeamPack[];
  selectedPackId: string | null;

  // Loading
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchTeamPacks: () => Promise<void>;
  createTeamPack: (input: CreateTeamPackInput) => Promise<TeamPack>;
  deleteTeamPack: (id: string) => Promise<void>;
  selectPack: (id: string | null) => void;

  // Computed
  getSelectedPack: () => TeamPack | undefined;
}

export const useTeamPackStore = create<TeamPackState>((set, get) => ({
  // Initial state
  teamPacks: [],
  selectedPackId: null,
  isLoading: false,
  error: null,

  // Actions
  fetchTeamPacks: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/team-packs');
      if (!res.ok) throw new Error('Failed to fetch team packs');
      const packs = await res.json();
      set({ teamPacks: packs, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  createTeamPack: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/team-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to create team pack');
      const pack = await res.json();
      set(state => ({
        teamPacks: [...state.teamPacks, pack],
        isLoading: false,
      }));
      return pack;
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
      throw e;
    }
  },

  deleteTeamPack: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/team-packs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete team pack');
      set(state => ({
        teamPacks: state.teamPacks.filter(p => p.id !== id),
        selectedPackId: state.selectedPackId === id ? null : state.selectedPackId,
        isLoading: false,
      }));
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  selectPack: (id) => set({ selectedPackId: id }),

  // Computed
  getSelectedPack: () => {
    const { teamPacks, selectedPackId } = get();
    return teamPacks.find(p => p.id === selectedPackId);
  },
}));
```

- [ ] **Step 2: Run type check**

```bash
pnpm tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/store/teamPackStore.ts
git commit -m "feat: add TeamPack Zustand store"
```

---

### Task 10: Integration Tests

**Files:**
- Create: `src/__tests__/repositories/team-pack-repo.test.ts`
- Create: `src/__tests__/role-card-import.test.ts`

**Rationale:** Verify the core logic works correctly.

- [ ] **Step 1: Create team pack repo test**

```typescript
// src/__tests__/repositories/team-pack-repo.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { initializeTestDb } from './test-helpers';

describe('teamPackRepo', () => {
  beforeEach(() => {
    initializeTestDb();
  });

  it('should create and retrieve a team pack', () => {
    const pack = teamPackRepo.create({
      name: 'test-pack',
      displayName: 'Test Pack',
      description: 'A test team pack',
      roles: [
        { id: 'role1', displayName: 'Role 1', soul: '# Role 1', required: true },
      ],
      workflow: { type: 'linear', steps: [] },
      communicationMatrix: {},
    });

    expect(pack.name).toBe('test-pack');
    expect(pack.roles).toHaveLength(1);

    const retrieved = teamPackRepo.getById(pack.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.displayName).toBe('Test Pack');
  });

  it('should list all team packs', () => {
    teamPackRepo.create({
      name: 'pack-1',
      displayName: 'Pack 1',
      description: 'First pack',
      roles: [],
      workflow: { type: 'linear', steps: [] },
      communicationMatrix: {},
    });

    teamPackRepo.create({
      name: 'pack-2',
      displayName: 'Pack 2',
      description: 'Second pack',
      roles: [],
      workflow: { type: 'linear', steps: [] },
      communicationMatrix: {},
    });

    const packs = teamPackRepo.list();
    expect(packs).toHaveLength(2);
  });

  it('should delete a team pack', () => {
    const pack = teamPackRepo.create({
      name: 'to-delete',
      displayName: 'To Delete',
      description: 'Will be deleted',
      roles: [],
      workflow: { type: 'linear', steps: [] },
      communicationMatrix: {},
    });

    teamPackRepo.delete(pack.id);
    expect(teamPackRepo.getById(pack.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test src/__tests__/repositories/team-pack-repo.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/repositories/team-pack-repo.test.ts
git commit -m "test: add TeamPack repository tests"
```

---

## Summary

This plan implements:

1. ✅ **Extended RoleCard type** with engineering fields (workflow, escalation, communication)
2. ✅ **TeamPack as first-class entity** with workflow, communication matrix, shared context
3. ✅ **SoulSpec import pipeline** to import from ClawSouls ecosystem
4. ✅ **TeamPack database schema** with proper relations
5. ✅ **TeamPack repository** following existing patterns
6. ✅ **API endpoints** for CRUD and import
7. ✅ **Preset team packs** (Engineering Trio)
8. ✅ **PromptComposer integration** via TeamPackLayer
9. ✅ **Zustand store** for frontend state
10. ✅ **Integration tests**

### What Users Get

- **Import SoulSpec roles** from ClawSouls registry or any GitHub repo
- **Browse preset team packs** (Engineering Trio, etc.)
- **Create custom team packs** with workflow and communication rules
- **Agents understand team context** via PromptComposer integration
- **Task dispatch follows workflow** (state machine or linear)

### Future Extensions

- Team Pack UI (browse, select, configure)
- More preset team packs (Full Stack, Research, Content)
- Team Pack marketplace
- Dynamic team composition
- Team Pack versioning and updates
