---
name: agent-task-team-collaboration
description: Use this in the Agent Task Team project for task-board collaboration, A2A wake phrasing, draft PR/MR review loops, and role handoffs.
---

# Agent Task Team Collaboration

This skill is project-local to Agent Task Team. Use it whenever you are working inside this repository or an Agent Task Team workdir created for this repository.

## Task Board Is The Durable Coordination Surface

- Update `TASKS.md` or the available task tools whenever you change task status, finish work, find blockers, or complete a review.
- Treat task status changes as team-visible state. Do not rely on a casual chat message as the only record of progress.
- If you need another agent to act, write an actionable A2A instruction instead of only mentioning them.

## A2A Wake Phrasing

- Awareness only: `知会 @agent ...`, `cc @agent ...`, or plain `@agent` should not wake the target.
- Wake another agent only with a clear action, such as `@toad 请实现 TASK-003`, `@peach 请评审 PR #12`, or `@yoshi 请验证 ISSUE-9`.
- Include the concrete object to act on: task id, issue id, PR/MR link, file path, or acceptance criteria.
- After updating task state, notify only when a human or agent must do the next action.

## Git Review Loop

1. Implementation agents finish code, run targeted checks, update the task, then open a draft PR/MR when the task explicitly allows pushing.
2. Reviewer agents review the PR/MR as the main review surface.
3. Actionable review findings become linked issues with evidence, expected behavior, affected files, and acceptance criteria.
4. Implementation agents fix linked issues on the same branch and push follow-up commits to the same PR/MR.
5. Reviewer agents re-check the linked issues before the task moves to done.
6. Do not merge unless the user or a role with explicit merge authority asks you to merge.

## Git Credentials

- Do not ask the user to paste tokens into chat.
- For GitHub remotes, use `gh` first for issues, pull requests, comments, reviews, and auth checks.
- For GitLab remotes, use `glab` first for issues, merge requests, comments, reviews, and auth checks.
- If GitHub auth is missing, report `gh auth status` and ask the user to run `gh auth login`.
- If GitLab auth is missing, report `glab auth status` and ask the user to run `glab auth login`.
- Only use raw provider APIs or manual web URLs when `gh`/`glab` is unavailable and the user explicitly authorizes the fallback.

## Role Boundaries

- Backend/frontend/coder implementation roles can modify code when assigned implementation work.
- Planner roles coordinate scope, task sequencing, and handoff clarity.
- Reviewer and QA roles should record findings and linked issues instead of silently editing unrelated implementation code.
- If a role boundary conflicts with the task, escalate the conflict in the task record instead of stalling silently.
