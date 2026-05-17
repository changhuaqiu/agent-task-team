import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const GIT_COLLABORATION_SKILL: CreateSkillInput = {
  name: 'git-collaboration',
  description: 'Shared Git workflow for issues, pull requests, merge requests, reviews, and handoff evidence',
  content: `# Git Collaboration

Use this skill when work touches Git-hosted collaboration: issues, GitHub pull requests, GitLab merge requests, code review, CI checks, branch handoff, or release notes.

## Authority Boundaries

- Read-only Git inspection is allowed when needed for the task.
- Creating issues, pull requests, merge requests, labels, reviewers, approvals, merges, and comments requires explicit task intent or user confirmation.
- Commits, pushes, force pushes, branch creation, merges, and closing issues require explicit user request.
- Never paste access tokens, API keys, or secrets into chat, commit messages, issues, pull requests, or merge requests.
- If provider tooling or authentication is missing, stop and report the exact blocker and the next setup command.

## Credential and Provider Setup

- Git collaboration credentials are not part of the skill. The skill only defines workflow.
- Prefer provider-native auth already configured on the machine:
  - GitHub: \`gh auth status\`, then \`gh auth login\` or a configured GitHub app/connector.
  - GitLab: \`glab auth status\`, then \`glab auth login\` or an approved PAT in the local Git credential helper.
- Before creating issues, PRs, or MRs, verify provider auth and remote:
  \`\`\`bash
  git remote -v
  gh auth status || true
  glab auth status || true
  \`\`\`
- If auth is missing, do not ask the user to paste a token into chat. Tell them to configure \`gh\`, \`glab\`, SSH, or the product account connector.

## Repository Orientation

- Inspect the current branch, remotes, worktree status, and changed files before proposing Git actions.
- Infer GitHub versus GitLab from the remote URL or the user's terminology.
- Use "pull request" for GitHub and "merge request" for GitLab unless the user asks for a different term.
- Keep summaries focused on user-facing work: changed behavior, files touched, tests run, risks, and next action.

## Worktree Branch Workflow

When the system prompt indicates you are in a Git Worktree branch (look for "[系统] 当前在 Git Worktree 分支 worktree/..." in your context):

1. **You are on an isolated branch** — all changes stay local to this worktree until you push.
2. **Commit frequently** — small atomic commits on the \`worktree/{slug}\` branch.
3. **Before finishing**: push the branch and create a PR/MR back to \`main\`:
   \`\`\`bash
   git add -A
   git commit -m "descriptive message"
   git push -u origin worktree/{slug}
   gh pr create --base main --head worktree/{slug} --title "Title" --body "Description"
   \`\`\`
4. **Do NOT merge** the PR yourself — leave it for human review.
5. **If push fails** with auth error, report the blocker: include the exact command that failed and suggest the user verify git credentials (SSH key, PAT, or gh auth status).

## Development → Review → Issue Fix Loop

This is the default engineering collaboration loop after implementation work:

1. **Developer role finishes code**: run focused tests, summarize changed files, commit locally when explicitly allowed, push the branch when explicitly allowed, and open a draft PR/MR for review.
2. **Reviewer roles inspect the PR/MR**: code reviewer, architect, QA, security, or domain owner reviews the diff and test evidence.
3. **Review findings become issues**: when a finding needs follow-up work, the reviewer creates a GitHub issue or GitLab issue linked to the PR/MR instead of only leaving a vague chat note.
4. **Developer fixes from issues**: the implementing agent pulls the issue context, updates the branch, adds tests, and pushes another commit to the same PR/MR.
5. **Review repeats until clear**: reviewers verify linked issues are fixed, then mark the issue resolved or comment with remaining blockers. Only a human or explicitly authorized maintainer merges.

Rules:

- A PR/MR is the review surface for completed code.
- Issues are the durable work queue for review findings, bugs, regressions, or follow-up implementation.
- Reviewers should create issues only for actionable findings that need code, test, UX, doc, or architecture follow-up.
- Developers should not close reviewer-created issues unless the fix is pushed and evidence is attached.
- Link everything: issue ↔ PR/MR ↔ task ID ↔ test evidence.
- Do not open duplicate issues for the same finding; update the existing issue instead.

## Issue Workflow

- Create or draft an issue only when the task asks for tracking, reporting, or follow-up.
- Confirm the issue title, problem statement, expected behavior, evidence, and owner if they are missing.
- Include reproduction steps, logs, screenshots, affected files, and acceptance criteria when available.
- Do not add labels, assignees, milestones, or close issues unless the request or project context makes that intent clear.

## PR or MR Workflow

- Before opening a PR/MR, verify the branch, diff scope, and whether unrelated local changes exist.
- Include summary, test evidence, risk notes, linked issues, and screenshots for UI changes.
- Development agents should open a draft PR/MR after completing implementation when the task is reviewable and the user or task explicitly allows pushing.
- Default to draft when the change still needs review, CI, design validation, or user confirmation.
- Do not push, force-push, merge, rebase shared branches, or create commits without explicit user intent.

## Review Workflow

- Review the diff and CI state before commenting, approving, or requesting changes.
- Prioritize correctness, regressions, security, data loss, test gaps, and user-visible behavior.
- Reference concrete files and lines when possible.
- Distinguish blockers from suggestions, and provide a concise path to resolution.
- For blockers that require implementation, create or update a linked issue with reproduction/evidence and assign or hand off to the responsible developer role when the user or task authorizes issue creation.

## Handoff

- If provider tooling or authentication is unavailable, report the exact blocker and the next command or setup step.
- Record unresolved risks, failing checks, and pending human decisions in the final handoff.
- Avoid exposing internal runtime, routing, provider hint, or session terminology to users.`,
  isPreset: true,
};
