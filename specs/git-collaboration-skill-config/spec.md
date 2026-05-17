# Git Collaboration Skill Config Spec

**Status:** Active
**Date:** 2026-05-09
**Related docs:**
- `docs/superpowers/specs/2026-05-04-skill-system-design.md`
- `specs/team-runtime-contract/spec.md`
- `specs/team-role-card-compatibility/spec.md`

## Problem

Agent Task Team already supports team-level roles, role cards, and skills, but Git collaboration actions are still implicit model behavior. When an agent needs to file an issue, prepare a merge request, summarize a branch, or hand off review evidence, the required workflow depends on the agent's general knowledge instead of a shared team capability.

This causes inconsistent behavior across agents:

- Some agents may create code changes without capturing the issue context first.
- Some agents may open a PR or MR without verifying branch state, tests, or a review-ready summary.
- Review agents may comment without preserving evidence such as changed files, failing checks, or reproduction steps.
- Team roles created from TeamPacks do not automatically inherit a shared Git workflow.

## Goal

Provide a reusable `git-collaboration` skill that can be assigned to every agent or TeamPack role. The skill should standardize how agents work with Git-hosted collaboration surfaces such as issues, pull requests, and merge requests while keeping authority boundaries explicit.

## Non-Goals

- Do not implement a full GitHub or GitLab API client in this spec.
- Do not grant agents new credentials or bypass repository permissions.
- Do not auto-create branches, commits, issues, PRs, or MRs without a clear user or task request.
- Do not replace provider-specific integrations; this skill is the shared workflow layer.
- Do not install project-specific workflow skills into global user-level agent directories.

## Skill Scope

The `git-collaboration` skill covers:

- Repository orientation: inspect remotes, branch, worktree status, and changed files.
- Issue creation: clarify title, expected behavior, evidence, labels, and assignee intent.
- PR or MR preparation: summarize scope, tests, risks, screenshots when relevant, and linked issues.
- Review participation: inspect diffs and CI state before commenting, approving, or requesting changes.
- Development-to-review loop: implementation agents open a draft PR/MR as the review surface, reviewers create linked issues for actionable findings, and developers push follow-up commits to the same PR/MR until linked issues are resolved.
- Handoff: record blockers and next actions in the user-visible task or conversation.

The skill must support both GitHub PR terminology and GitLab MR terminology. Agents should use the provider term that matches the repository remote or user request.

## Default Assignment

The preset skill should be assigned at seed time to the known built-in team role IDs:

- Preset roster: `mario`, `luigi`, `toad`, `peach`, `dk`, `yoshi`
- Engineering trio: `planner`, `coder`, `reviewer`
- Research team: `researcher`, `analyst`, `writer`

Future custom teams should attach the same skill through TeamPack role `skillIds` or the agent skill assignment API.

## Runtime Skill Loading

Agent Task Team uses two complementary skill delivery paths:

- Product-level Skill: `git-collaboration` is resolved from Agent Task Team's Skill repository and injected into every supported runtime prompt through Team Runtime.
- Runtime-native Skill: engine-specific clients may also receive a project-local skill mount. For OpenCode, the project owns `.opencode/skills/agent-task-team-collaboration/SKILL.md`.

OpenCode dispatch runs from Agent Task Team workdirs, not always from the repository root. Therefore the daemon must add the current project's `.opencode/skills` directory to generated `OPENCODE_CONFIG.skills.paths` when it exists. This keeps OpenCode-native Skill loading scoped to the current project while still making it available from `.ath/workspaces` task directories.

Rules:

- Project-local runtime skills are repository-scoped and must not be copied into `~/.opencode` or other global locations by default.
- Runtime-native skill names must remain unique across loaded locations.
- OpenCode skill permission should allow the project-local skill for non-interactive dispatches.
- Product-level Skill injection remains the canonical cross-runtime behavior; runtime-native skill files are an engine adapter layer, not a replacement for Team Runtime Skill assignment.

## Authority Boundaries

Agents using this skill must follow these rules:

- Read-only Git inspection is allowed when needed for the task.
- Issue, PR, MR, label, reviewer, merge, and approval mutations require explicit task intent or user confirmation.
- Commits, pushes, branch creation, force pushes, merges, and closing issues require explicit user request.
- Skills define the workflow only; Git provider credentials must come from configured local tooling, account connectors, or approved credential helpers. Agents must never ask the user to paste a token into chat.
- The skill must not expose internal runtime terms in user-facing summaries.
- If provider tooling is missing, the agent should report the exact missing tool or auth condition and provide the next command the user can run.

## Acceptance Criteria

- A preset skill named `git-collaboration` exists in `PRESET_SKILLS`.
- Seeding creates the skill as a preset and assigns it to all known built-in agent and TeamPack role IDs.
- The skill content includes workflows for issues, PRs, MRs, review, and authority boundaries.
- The skill content includes the default implementation loop: developer draft PR/MR, reviewer linked issues, developer fix commits, reviewer verification, human/authorized merge.
- Preset seeding updates existing preset skill content so older local databases receive workflow corrections.
- Team runtime continues to resolve the skill through existing `agentSkillIds` and TeamPack role `skillIds` behavior.
- Design documentation describes `git-collaboration` as the shared team Git workflow skill.
- The OpenCode adapter exposes project-local `.opencode/skills` through generated runtime config so task workdirs can load the same project-scoped collaboration rules.
