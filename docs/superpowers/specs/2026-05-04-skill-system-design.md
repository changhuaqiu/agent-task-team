# Skill System Design

**Date**: 2026-05-04
**Status**: Implemented
**Related**: PromptComposer (2026-05-03), Role-Card System, Multica Skill Architecture

## Problem

Agents currently have a single dimension of behavior configuration: the Role Card. Role Cards define *who* an agent is (persona, responsibilities, constraints). But agents lack a mechanism to acquire reusable *capabilities* — structured instruction sets like code review checklists, TDD workflows, or debugging protocols — that can be loaded independently of identity.

Skills fill this gap. A skill is a loadable capability module bound to an agent. Skills are orthogonal to role cards: an agent has one role that defines its identity, and N skills that define its capabilities.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Binding level | Agent-bound | Skills associate with agent roles, not individual tasks |
| Content format | SKILL.md + supporting files | Instructions in Markdown, plus templates/schemas/references |
| Delivery | PromptComposer SkillLayer | Injects into system prompt via existing CLI arg pipeline |
| Storage | SQLite (3 new tables) | Consistent with existing data layer |
| Relation to Role Card | Orthogonal | One role + N skills per agent |
| Composition | Independent loading, implicit | No dependency chains or grouping |
| Primary source | Internet import (Git) | Most skills imported from external repos |

## Data Model

### New Tables

**`skill`** — core entity:

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Unique skill name (e.g. "code-review") |
| description | TEXT | One-line summary |
| content | TEXT NOT NULL | SKILL.md markdown body (instructions) |
| config | TEXT | JSON extensible configuration |
| is_preset | INTEGER DEFAULT 0 | 1 = built-in, 0 = user-created/imported |
| version | INTEGER DEFAULT 1 | Schema version for migrations |
| created_at | TEXT NOT NULL | ISO timestamp |
| updated_at | TEXT NOT NULL | ISO timestamp |

Unique constraint on `name`.

**`skill_file`** — supporting files:

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| skill_id | TEXT NOT NULL | FK → skill.id, ON DELETE CASCADE |
| path | TEXT NOT NULL | Relative path (e.g. "templates/review.md") |
| content | TEXT NOT NULL | File content |

Unique constraint on `(skill_id, path)`. Path validation rejects `..`, absolute paths.

**`agent_skill`** — many-to-many junction:

| Column | Type | Notes |
|---|---|---|
| agent_id | TEXT NOT NULL | References AGENT_ROSTER agent.id (e.g. "mario") |
| skill_id | TEXT NOT NULL | FK → skill.id, ON DELETE CASCADE |
| assigned_at | TEXT NOT NULL | ISO timestamp |

Primary key on `(agent_id, skill_id)`. No FK to an agent table — agent_id references the hardcoded AGENT_ROSTER.

### ER Diagram

```
skill ──1:N──→ skill_file
  │
  └──M:N──→ agent_skill ←── AGENT_ROSTER (hardcoded agents)
```

## Skill Definition Format

### SKILL.md

```markdown
---
name: code-review
description: Structured code review with checklist and feedback template
version: 1
---

# Code Review Skill

## Rules
- Always review against the project's coding standards
- Provide actionable feedback, not just observations
...

## Checklist
- [ ] Logic correctness
- [ ] Error handling
...
```

Frontmatter fields: `name` (required), `description` (required), `version` (optional, default 1).

### Repository Convention

Skill repos follow a directory convention:

```
skills/
  code-review/
    SKILL.md
    checklist.md
    template.ts
  tdd/
    SKILL.md
    test-template.ts
```

Import logic scans for `skills/{name}/SKILL.md` as the primary discovery path, with `{name}/SKILL.md` as fallback.

## PromptComposer Integration

### New Layer: SkillLayer

Positioned after RoleLayer in the system prompt composition:

```
System Prompt (first wake only):
  Layer 1: RoleLayer     — persona, responsibilities, constraints
  Layer 2: SkillLayer    — [NEW] associated skill instructions
  Layer 3: ProjectLayer  — project context
  Layer 4: TeamLayer     — team roster
```

### Implementation

```typescript
// src/lib/agent-context/layers/skillLayer.ts

interface SkillLayerOptions {
  agentId: string;
}

export async function buildSkillLayer(opts: SkillLayerOptions): Promise<string> {
  const skills = await getSkillsForAgent(opts.agentId); // from src/server/db/skill-queries.ts
  if (skills.length === 0) return '';

  return skills.map(skill => {
    const header = `## Skill: ${skill.name}`;
    return `${header}\n\n${skill.content}`;
  }).join('\n\n---\n\n');
}
```

### ComposeOptions Extension

```typescript
interface ComposeOptions {
  // ... existing fields
  agentId: string; // added for skill resolution
}
```

### Supporting Files in Prompt Context

In the initial version, `skill_file` contents are appended to the SkillLayer output as additional context blocks. This avoids the complexity of file materialization while making reference material available to the agent. Files exceeding 10KB are skipped with a warning, as injecting large files into prompt context is impractical.

```typescript
const MAX_FILE_SIZE = 10_000; // 10KB

// Within buildSkillLayer, after skill content:
for (const file of skill.files) {
  if (file.content.length > MAX_FILE_SIZE) continue; // skip oversized files
  parts.push(`### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
}
```

## Delivery Pipeline

### Changed Components

| File | Change |
|---|---|
| `PromptComposer.ts` | Add `agentId` to ComposeOptions, insert SkillLayer call after RoleLayer |
| `taskHubStore.ts` | Pass `agentId` in `dispatchToAgent` and `simulateCliExecution` |
| `skillLayer.ts` | New file — SkillLayer builder |
| `migrate.ts` | New version with 3 skill tables |

### Unchanged Components

- `daemon.ts` — receives composed systemPrompt unchanged
- All backends (claude.ts, opencode.ts, codex.ts) — unchanged
- Existing 7 layers — unchanged
- Agent roster — unchanged

### Flow

```
dispatchToAgent(agentId, prompt, taskId)
  → resolve agent, roleCard, engine, account
  → composeSystemPrompt({ roleCard, agentId, project, team })
      → buildRoleLayer(roleCard)
      → buildSkillLayer({ agentId })       ← loads from SQLite
      → buildProjectLayer(project)
      → buildTeamLayer(selfId, allRoleCards)
  → composeUserPrompt({ history, task, rawPrompt })
  → socket.emit('terminal:start', { systemPrompt, prompt, ... })
```

## Import Pipeline

Most skills are imported from the internet via Git repositories.

### Import Sources

1. **Git repository** — clone to temp dir, scan `skills/` directory, parse SKILL.md files
2. **Single file URL** — download and parse a standalone SKILL.md

### Import Flow

```
User provides URL
  → Parse source type (Git repo vs single file)
  → Git: shallow clone (--depth 1), scan skills/ dir, parse each SKILL.md
  → Single: download, parse frontmatter + body
  → Validate paths (no ../ traversal)
  → Deduplicate by name: if skill with same name exists, update in place (replace-all files)
  → Write to skill + skill_file tables
  → Clean up temp resources
```

### API

```
POST /api/skills/import
  body: { source: "https://github.com/org/agent-skills" }
  → imports all skills found in repo

POST /api/skills/import
  body: { source: "https://raw.githubusercontent.com/org/skills/main/review/SKILL.md" }
  → imports single skill

POST /api/skills
  body: { name, description, content, files: [{ path, content }] }
  → creates skill manually

GET /api/skills
  → lists all skills

GET /api/skills/:id
  → skill with files

PATCH /api/skills/:id
  → updates skill (replace-all files strategy)

DELETE /api/skills/:id
  → deletes skill (cascades to files + agent associations)

GET /api/agents/:agentId/skills
  → lists skills for agent

POST /api/agents/:agentId/skills
  body: { skillIds: string[] }
  → replaces agent's skill assignments (clear-then-add)
```

### Security

- Git clone uses `--depth 1` to minimize exposure
- skill_file.path validation rejects `..` components and absolute paths
- Imported skills are `is_preset = 0` (user-level, editable/deletable)

## UI

### Agent Configuration — Skill Assignment

Each agent card shows assigned skills as tags, with add/remove controls:

```
┌─ Mario (Planner) ────────────────┐
│  Role Card: Jean (规划师)         │
│                                   │
│  Skills:                          │
│   [code-review] [brainstorm] [+]  │
│                                   │
└───────────────────────────────────┘
```

### Skill Library Page

Two-panel layout for browsing, importing, and managing skills:

```
┌─────────────────┬──────────────────────────┐
│ Skill 库         │ Code Review              │
│                  │                          │
│ [+ 导入] [+ 创建] │ SKILL.md:               │
│                  │ 代码审查技能...           │
│ > code-review    │                          │
│   brainstorm     │ 配套文件:                │
│   tdd            │  checklist.md            │
│   debugging      │  template.ts             │
│                  │                          │
│                  │ [编辑] [删除]             │
└─────────────────┴──────────────────────────┘
```

### Import Dialog

URL input for Git repos or direct SKILL.md links:

```
┌─ 导入 Skill ──────────────────┐
│                                │
│  来源 URL:                     │
│  [https://github.com/...]      │
│                                │
│  [导入] [取消]                  │
└────────────────────────────────┘
```

## Preset Skills

Initial built-in skills shipped with the application (is_preset = 1):

1. **code-review** — structured code review with checklist
2. **tdd** — test-driven development workflow
3. **debugging** — systematic debugging methodology
4. **brainstorm** — collaborative ideation facilitation

These serve as examples and defaults. Users can import additional skills from external repos.

## Future Considerations (Out of Scope)

- File materialization to `.claude/skills/` for provider-native discovery
- Skill versioning and update tracking from source repos
- Skill dependency chains or grouping
- Per-task skill override (currently agent-bound only)
- Skill marketplace / registry browsing
