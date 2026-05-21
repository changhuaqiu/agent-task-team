# Default Team Workflow Harness Spec

**Status:** Active
**Date:** 2026-05-17
**Related docs:**
- `docs/product/business/2026-05-17-default-team-collaboration-template.md`
- `docs/product/ux/2026-05-15-group-chat-task-flow.md`
- `docs/superpowers/specs/2026-05-17-team-workflow-harness-refactor-design.md`
- `specs/team-runtime-contract/spec.md`
- `specs/group-chat-task-flow/spec.md`

## Problem

The default TeamPack is named "Mario 6人组", but its current collaboration contract behaves like a smaller team:

- The visible roster contains Mario, Luigi, Toad, Peach, DK, and Yoshi.
- The preset workflow mainly describes Mario -> Luigi -> Peach.
- Toad, DK, and Yoshi are present but not clearly positioned in the main delivery loop.
- The communication matrix is too narrow for normal frontend/backend/review/QA feedback.
- DK is represented as a deprecated worker role even though the RoleCard is propose-only.

This makes the default team a weak sample for future TeamPacks: users see six roles, but the system does not clearly explain when each role owns work, reviews work, or hands work off.

## Goal

Make the default 6-person team the canonical workflow-harness sample for future packs.

The sample must define:

- pipeline stages
- autonomous implementation lanes
- approval gates
- direct reject loops
- escalation paths
- user-facing collaboration language
- a communication matrix that enables necessary handoffs without exposing internal routing terms

## Non-Goals

- Do not redesign Team Runtime.
- Do not change the Task Graph data model.
- Do not introduce new TeamPack schema fields.
- Do not build a marketplace or pack editor in this iteration.

## Harness Model

The default team follows a Harness-like pipeline:

```text
planning -> implementing -> review_gate -> test_gate -> done
 Mario       Luigi/Toad      Peach + DK      Yoshi
```

Rules:

- Mario stays a pure coordinator: planning, dispatch, escalation, and final summary.
- Luigi and Toad execute independently in the implementation stage according to frontend/backend task domain.
- Peach owns the code review gate.
- DK participates in the review gate only when architecture, schema, security, performance, or cross-module boundaries are involved.
- Yoshi owns the test gate and validates integration, spec consistency, and delivery completeness.
- Reject loops go directly back to the responsible implementer or gate owner; they do not pass through Mario unless escalation is required.
- If the same task is rejected more than twice, Mario should be notified for escalation.

Because the current `TeamPackWorkflow.states[]` schema has a single `role` field, the preset state machine represents the Harness stages by name and description while the communication matrix and prompt guidance carry multi-owner lane semantics.

## Role Contract

| Role | User-facing name | Primary job | Owns code changes | Gate |
| --- | --- | --- | --- | --- |
| `mario` | 项目统筹 | intake, planning, dependency ordering, escalation | no | plan approval and conflict resolution |
| `luigi` | 前端实现 | UI, interaction, client state, frontend integration | yes | frontend implementation evidence |
| `toad` | 后端开发 | API, data model, server behavior, migrations | yes | backend implementation evidence |
| `peach` | 代码评审 | code review, maintainability, security, regression risk | no | review approval or change request |
| `dk` | 架构工程 | architecture risk, boundaries, technical direction | no | on-demand architecture review |
| `yoshi` | QA 测试 | validation plan, regression checks, final acceptance | no | quality sign-off |

## Stage Contract

| Stage | Owner(s) | Entry | Exit |
| --- | --- | --- | --- |
| `planning` | Mario | user goal or escalation | clear task description and target lane/gate |
| `implementing` | Luigi / Toad | task has domain and implementer | `implementation_evidence` accepted and review request |
| `review_gate` | Peach + optional DK | implementer submitted evidence | review pass to test gate, or direct reject |
| `test_gate` | Yoshi | review passed | test pass to merge-ready, or direct reject |
| `merge_ready` | Mario | test gate passed | merge or prepare target branch verification |
| `main_verify` | Mario | merged or target branch ready | `delivery_evidence` accepted |
| `done` | Mario | delivery evidence accepted | terminal |

Chat is still the user experience, but task ownership changes must be represented by structured task actions or A2A handoff packets.

## Personality-Led Autonomy Contract

The default team is personality-led, not centrally scripted.

Role personalities own judgment:

- Mario decides planning, dispatch intent, escalation, and final delivery judgment.
- Luigi and Toad decide implementation details and produce implementation evidence.
- Peach decides review outcomes.
- DK decides architecture risk when invoked.
- Yoshi decides validation outcomes.

The system only guards hard facts: task status, evidence, dispatch receipts, blocker ownership, communication policy, and stale gates. It must not replace a role's judgment about how to implement, approve, reject, test, or escalate.

Every role turn must close with one of these actions:

- update task state with required evidence
- create a real structured dispatch or A2A handoff and verify receipt
- create or update a blocker and escalate to the configured coordinator
- state a concrete external wait condition with the recovery owner

The following are not valid closure:

- "已通知" without a dispatch receipt
- "管道已启动" without one receipt per target
- "无待办" while runnable tasks, review gates, test gates, evidence blockers, or merge verification remain open
- review pass without downstream test gate dispatch or structured gate wakeup
- implementation complete without implementation evidence

Dispatch receipt rule:

- Text scheduling is intent, not execution.
- A lane is started only when the runtime records a dispatch receipt, pass offer, task wakeup dispatch, or lifecycle acknowledgement correlated to the target agent and task.
- Fan-out must report `n/n dispatched`; partial dispatch must be retried or escalated.

Executable gate rule:

- Moving a task into `in_review` requires `implementation_evidence` with `installResult`, `buildResult`, and `gitnexusEvidence`.
- Moving a task into `done` requires `delivery_evidence` with `mergedToMain`, `mainInstallResult`, `mainBuildResult`, `mainTestResult`, and `gitnexusDetectChangesResult`.
- CLI exit success does not auto-advance a task into review. It opens an evidence blocker until the implementer submits the required fields.
- Dependency additions or lockfile changes must be mentioned in implementation evidence and checked by the review gate.
- Missing evidence must block the status transition and create a proof event that names the missing fields.

## GitNexus Graph-First Protocol

The default team is the reference TeamPack for graph-first work:

- Mario uses GitNexus before task breakdown to identify relevant flows, clusters, modules, and dependency boundaries.
- Luigi and Toad use GitNexus before implementation to inspect the target feature or symbol and its upstream/downstream impact.
- Peach uses GitNexus impact or detect-changes evidence before approving or rejecting review work.
- DK uses GitNexus cluster, process, context, and impact data when judging architecture, schema, security, performance, or cross-module boundaries.
- Yoshi uses GitNexus affected processes and entry points to choose integration and regression tests.
- Every non-trivial handoff should include the GitNexus evidence that informed the next step.
- If GitNexus is unavailable or stale, the agent must say so, refresh the index when safe, or explicitly document the fallback.

Review gate callback rule:

- When a review-role owner such as Peach or DK submits a review decision, the coordinator must be notified through `task.wakeup` with `reasonCode: review_decision_ready`.
- This callback is a gate-control wakeup, not a new A2A handoff in the current chain. It must bypass chain-scoped duplicate-agent suppression so Mario can confirm pass/reject and unlock downstream tasks.
- Implementers entering `in_review` still wake review roles first. Coordinator callbacks are only for reviewer-owned decisions or review-note updates.
- When the review decision is a pass, the test gate owner must also be notified through `task.wakeup` with `reasonCode: test_requested`. This is the structured exit from `review_gate` into `test_gate`; it must not depend on the reviewer sending a live `@yoshi` chat handoff.
- If a direct A2A handoff is blocked by the communication matrix, the sender must not wait silently. The runtime should escalate the blocked handoff to the sender's configured escalation target, normally Mario, with the original requested action and block reason.
- Existing conversations that still carry an older default-team communication matrix must be normalized at runtime so Harness-critical paths such as `peach -> yoshi` remain available.

## Pass Intents

The A2A intent parser should recognize these additional Harness transfers:

| Intent | Meaning |
| --- | --- |
| `reject` | a review or test gate sends work back with required fixes |
| `escalate` | a role hits a scope boundary and asks Mario to decide |
| `coord` | implementation lanes coordinate interface or contract details |
| `handoff_test` | review gate passes work to QA |

Existing intents remain valid.

## Communication Rules

The default team should allow these handoffs:

- Mario can dispatch to any team member and receive escalation from any team member.
- Luigi and Toad can talk to each other for interface alignment.
- Implementers can request review from Peach and validation from Yoshi.
- Peach can send review rejection directly to Luigi or Toad.
- Peach can escalate architecture concerns to DK and hand reviewed work to Yoshi.
- DK can provide architecture feedback to Luigi, Toad, and Peach.
- Yoshi can send test failures directly to Luigi, Toad, Peach, or Mario depending on cause.
- DK and Yoshi do not normally talk directly.

Blocked collaboration should use the existing user-facing copy: "团队协作规则阻止了这次转交".

Blocked collaboration escalation rule:

- A blocked direct handoff is not terminal when the sender has an escalation path.
- The runtime should create an escalation dispatch to the first non-human escalation target, preserving the original target and requested action in the prompt.
- This escalation is actionable coordination, not a notification echo.

## Acceptance Criteria

- The preset `default-team` marks all six roles as required sample members.
- The preset workflow uses the Harness stage names: planning, implementing, review_gate, test_gate, done.
- The preset communication matrix supports implementation coordination, review feedback, and QA feedback.
- DK's deprecated `AgentRole` classification is reviewer, not worker.
- A2A pass intent parsing supports reject, escalate, coord, and handoff_test.
- Prompt layers explain stage-specific gate behavior.
- Review decision callbacks wake the coordinator without being blocked by A2A duplicate-agent dedupe.
- Passing review decisions wake the test gate owner without relying on a live A2A session.
- Communication-policy blocks automatically escalate to the sender's configured coordinator when one exists.
- Older persisted default-team matrices are runtime-compatible with the Harness communication paths.
- Default-team prompts require GitNexus evidence for planning, implementation, review, architecture, testing, and handoff decisions.
- Status transitions into review and done are blocked unless the required gate evidence is supplied.
- CLI success does not auto-advance implementation tasks into review without evidence.
- Tests cover the default team role completeness and critical communication paths.
- Product documentation explains why the 6-person team is the template for future TeamPacks.
