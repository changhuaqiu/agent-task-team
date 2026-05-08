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

## Skill Scope

The `git-collaboration` skill covers:

- Repository orientation: inspect remotes, branch, worktree status, and changed files.
- Issue creation: clarify title, expected behavior, evidence, labels, and assignee intent.
- PR or MR preparation: summarize scope, tests, risks, screenshots when relevant, and linked issues.
- Review participation: inspect diffs and CI state before commenting, approving, or requesting changes.
- Handoff: record blockers and next actions in the user-visible task or conversation.

The skill must support both GitHub PR terminology and GitLab MR terminology. Agents should use the provider term that matches the repository remote or user request.

## Default Assignment

The preset skill should be assigned at seed time to the known built-in team role IDs:

- Preset roster: `mario`, `luigi`, `toad`, `peach`, `dk`, `yoshi`
- Engineering trio: `planner`, `coder`, `reviewer`
- Research team: `researcher`, `analyst`, `writer`

Future custom teams should attach the same skill through TeamPack role `skillIds` or the agent skill assignment API.

## Authority Boundaries

Agents using this skill must follow these rules:

- Read-only Git inspection is allowed when needed for the task.
- Issue, PR, MR, label, reviewer, merge, and approval mutations require explicit task intent or user confirmation.
- Commits, pushes, branch creation, force pushes, merges, and closing issues require explicit user request.
- The skill must not expose internal runtime terms in user-facing summaries.
- If provider tooling is missing, the agent should report the exact missing tool or auth condition and provide the next command the user can run.

## Acceptance Criteria

- A preset skill named `git-collaboration` exists in `PRESET_SKILLS`.
- Seeding creates the skill as a preset and assigns it to all known built-in agent and TeamPack role IDs.
- The skill content includes workflows for issues, PRs, MRs, review, and authority boundaries.
- Team runtime continues to resolve the skill through existing `agentSkillIds` and TeamPack role `skillIds` behavior.
- Design documentation describes `git-collaboration` as the shared team Git workflow skill.
