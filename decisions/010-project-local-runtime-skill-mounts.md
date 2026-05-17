---
topics: [agent, skills, opencode]
doc_kind: decision
created: 2026-05-17
status: accepted
---

# ADR-010: Project-local runtime Skill mounts

## Context

Agent Task Team has a product-level Skill repository that injects assigned skills into runtime prompts. Some agent engines also support native Skill files. OpenCode supports `SKILL.md` definitions and additional `skills.paths` in `opencode.json`.

The older ADR-009 assumed user-level Skill distribution, but that creates two problems for this project:

- Agent Task Team collaboration rules should not leak into every OpenCode project on the machine.
- Agent Task Team dispatch often runs OpenCode from `.ath/workspaces/...`, so cwd-based discovery of repository-local `.opencode/skills` is unreliable.

## Decision

Use a two-layer policy:

1. Product-level skills remain canonical for cross-runtime behavior and role assignment.
2. Runtime-native skills are adapter-specific and project-scoped.

For OpenCode, this repository owns project-local Skill files under `.opencode/skills/`. The daemon adds the current project's `.opencode/skills` directory to generated `OPENCODE_CONFIG.skills.paths` when the directory exists, and allows skill loading for non-interactive dispatches.

## Consequences

- OpenCode agents can load Agent Task Team collaboration rules even when running from task workdirs.
- The rules stay scoped to the current repository and are not installed into `~/.opencode` by default.
- Other runtime adapters may add their own project-local mount logic later, but must keep product-level Skill injection as the cross-runtime baseline.

## Non-goals

- Do not replace Team Runtime Skill assignment.
- Do not store Git tokens or provider credentials in Skill files.
- Do not auto-install this project's Skill files globally.
