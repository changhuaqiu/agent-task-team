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
- Use provider-native CLI auth as the default path:
  - GitHub: use \`gh\` first for issues, pull requests, review comments, and auth checks.
  - GitLab: use \`glab\` first for issues, merge requests, review comments, and auth checks.
- Only fall back to raw Git hosting APIs or manual URLs when \`gh\`/\`glab\` is unavailable and the user explicitly authorizes the fallback.
- Before creating issues, PRs, or MRs, verify provider auth and remote:
  \`\`\`bash
  git remote -v
  gh auth status
  glab auth status
  \`\`\`
- If the remote is GitHub and \`gh auth status\` fails, stop and ask the user to run \`gh auth login\`.
- If the remote is GitLab and \`glab auth status\` fails, stop and ask the user to run \`glab auth login\`.
- If auth is missing, do not ask the user to paste a token into chat.

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
   Use \`glab mr create\` instead when the remote is GitLab.
4. **Do NOT merge** the PR yourself — leave it for human review.
5. **If push or PR/MR creation fails** with auth error, report the blocker: include the exact command that failed and suggest \`gh auth status\` / \`gh auth login\` for GitHub or \`glab auth status\` / \`glab auth login\` for GitLab.

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

## Provider-verified task receipts

- For a Git-backed task, Luigi must call \`collaboration_record_pr\` after commit, push and PR creation. A pasted URL or prose claim cannot move the task to review.
- Peach must review the exact head SHA from the delivery card, leave a real provider review/comment, then call \`collaboration_record_review\` with that canonical URL and test evidence.
- A new commit invalidates the previous review. Luigi records the same PR again; Peach must review the new SHA.
- Mario calls \`collaboration_record_merge\` only after an authorized merge and main-branch install/build/test/impact verification. This verified receipt is the only Git-backed closure path.
- Do not call \`task_update_status\` to imitate these transitions; the receipt tools atomically update Task Graph, proof log and chat cards.

## Issue Workflow

- Create or draft an issue only when the task asks for tracking, reporting, or follow-up.
- For GitHub, use \`gh issue create\` and \`gh issue view/comment/close\` before considering any other API path.
- For GitLab, use \`glab issue create\` and \`glab issue view/comment/close\` before considering any other API path.
- Confirm the issue title, problem statement, expected behavior, evidence, and owner if they are missing.
- Include reproduction steps, logs, screenshots, affected files, and acceptance criteria when available.
- Do not add labels, assignees, milestones, or close issues unless the request or project context makes that intent clear.

## PR or MR Workflow

- Before opening a PR/MR, verify the branch, diff scope, and whether unrelated local changes exist.
- For GitHub, use \`gh pr create/view/comment/review\` as the default PR surface.
- For GitLab, use \`glab mr create/view/note\` as the default MR surface.
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
  config: JSON.stringify({
    tools: [
      {
        name: 'collaboration_record_pr',
        description: 'Verify a GitHub pull request and publish the task delivery card',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID owned by the calling implementer' },
          { name: 'pull_request_url', type: 'string', required: true, description: 'Canonical GitHub pull request URL' },
          { name: 'evidence', type: 'object', required: true, description: 'installResult, buildResult, testResult, impactEvidence, and optional riskSummary' },
        ],
        handler: 'api://collaboration/pull-request',
      },
      {
        name: 'collaboration_record_review',
        description: 'Verify a real GitHub review or comment on the current PR head and publish the review card',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID in review' },
          { name: 'pull_request_url', type: 'string', required: true, description: 'Canonical GitHub pull request URL' },
          { name: 'review_url', type: 'string', required: true, description: 'Canonical GitHub review or comment URL' },
          { name: 'evidence', type: 'object', required: true, description: 'testResult, blockerCount, and summary' },
        ],
        handler: 'api://collaboration/review',
      },
      {
        name: 'collaboration_record_merge',
        description: 'Verify the reviewed PR merge and publish the main-branch closure card',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID awaiting merge closure' },
          { name: 'pull_request_url', type: 'string', required: true, description: 'Canonical GitHub pull request URL' },
          { name: 'evidence', type: 'object', required: true, description: 'mergedToMain plus main install, build, test and impact verification results' },
        ],
        handler: 'api://collaboration/merge',
      },
    ],
  }),
  isPreset: true,
};
