import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const GIT_COLLABORATION_SKILL: CreateSkillInput = {
  name: 'git-collaboration',
  description: 'Shared Git workflow for issues, pull requests, merge requests, reviews, and handoff evidence',
  content: `# Git Collaboration

Use this skill when work touches Git-hosted collaboration: issues, GitHub pull requests, GitLab merge requests, code review, CI checks, branch handoff, or release notes.

## Repository Orientation

- Inspect the current branch, remotes, worktree status, and changed files before proposing Git actions.
- Infer GitHub versus GitLab from the remote URL or the user's terminology.
- Use "pull request" for GitHub and "merge request" for GitLab unless the user asks for a different term.
- Keep summaries focused on user-facing work: changed behavior, files touched, tests run, risks, and next action.

## Issue Workflow

- Create or draft an issue only when the task asks for tracking, reporting, or follow-up.
- Confirm the issue title, problem statement, expected behavior, evidence, and owner if they are missing.
- Include reproduction steps, logs, screenshots, affected files, and acceptance criteria when available.
- Do not add labels, assignees, milestones, or close issues unless the request or project context makes that intent clear.

## PR or MR Workflow

- Before opening a PR/MR, verify the branch, diff scope, and whether unrelated local changes exist.
- Include summary, test evidence, risk notes, linked issues, and screenshots for UI changes.
- Default to draft when the change still needs review, CI, design validation, or user confirmation.
- Do not push, force-push, merge, rebase shared branches, or create commits without explicit user intent.

## Review Workflow

- Review the diff and CI state before commenting, approving, or requesting changes.
- Prioritize correctness, regressions, security, data loss, test gaps, and user-visible behavior.
- Reference concrete files and lines when possible.
- Distinguish blockers from suggestions, and provide a concise path to resolution.

## Handoff

- If provider tooling or authentication is unavailable, report the exact blocker and the next command or setup step.
- Record unresolved risks, failing checks, and pending human decisions in the final handoff.
- Avoid exposing internal runtime, routing, provider hint, or session terminology to users.`,
  isPreset: true,
};

