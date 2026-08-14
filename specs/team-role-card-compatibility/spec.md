# Team Role Card Compatibility Spec

**Status:** Implemented
**Date:** 2026-05-06
**Related docs:**
- `docs/product/business/2026-05-05-role-card-ecosystem-analysis.md`
- `docs/product/business/2026-05-01-engineering-role-card-business-plan.md`
- `docs/archive/specs/team-runtime-contract/spec.md`

## Problem

Team Pack roles such as `planner`, `coder`, and `reviewer` now appear in the project AgentBar through `getEffectiveRoster()`, but they are not fully compatible with the older role/account/skill model.

Observed failures:

- Creating a project with a Team Pack shows dynamic role avatars, but clicking an avatar cannot reliably bind model accounts.
- The binding panel depends on a `RoleCard`; synthesized Team Pack agents use IDs such as `team-role-planner`, but those role cards do not exist.
- Switching a role card mutates only the hardcoded `AGENT_ROSTER`, so it does not affect synthesized Team Pack roles.
- Dispatch still resolves agents from `AGENT_ROSTER`, so dynamic Team Pack role IDs are treated as unknown and lose account, role card, and prompt context.
- Skill assignment APIs can store skills for arbitrary agent IDs, but `loadSkills()` only hydrates hardcoded roster IDs.

## Root Cause

The previous dynamic roster fix solved display, but not runtime identity. The app currently has multiple independent ways to answer "what is this role at runtime?":

- `AgentBar` uses `getEffectiveRoster()`.
- `AgentBindingPanel` uses `getEffectiveRoster()` for display but uses `RoleCard.accountIds` for binding.
- `daemonStore.dispatchToAgent()` uses `AGENT_ROSTER`.
- `setAgentRoleCardId()` mutates `AGENT_ROSTER`.
- `loadSkills()` loads assignments for `AGENT_ROSTER` IDs only.

Team Pack roles must be first-class runtime agents everywhere those paths need an agent.

## Goals

- Clicking a Team Pack role avatar opens a working binding panel.
- A Team Pack role can bind and unbind existing model accounts even when it has no persisted RoleCard.
- A Team Pack role can switch to an existing RoleCard, and that selection affects account resolution and prompt composition.
- A Team Pack role can add/remove skills, and assignments survive reload.
- Dispatch to a Team Pack role uses the same runtime profile as the UI.
- The UI remains user-facing: use "角色", "账号", and "技能"; do not expose internal concepts like runtime, routing, bridge, or provider hints.

## Non-Goals

- Do not build a Team Pack marketplace.
- Do not require imported Team Packs to know local Mario agent IDs.
- Do not redesign account creation UX.
- Do not make project Team Pack switching editable in this task.

## Required Design

Introduce one runtime profile resolver for agent-like identities. It must resolve both hardcoded roster agents and Team Pack roles.

Runtime profile shape:

```typescript
interface AgentRuntimeProfile {
  agent: Agent;
  roleCard?: RoleCard;
  accountIds: string[];
  skills: SkillSummary[];
}
```

Resolution rules after team-first fusion:

1. Start from `getEffectiveRoster()` so Team Pack roles are visible to all consumers.
2. If the selected project has a current TeamPack role, prefer `TeamPackRole.roleCardSnapshot`.
3. Otherwise use `TeamPackRole.roleCardId`, then `agentRoleCardOverrides[agentId]`, then `agent.roleCardId`.
4. Account IDs come from `TeamPackRole.accountIds`, then the resolved RoleCard, then `agentAccountOverrides[agentId]`, then `agent.accountIds`.
5. Skill IDs come from `TeamPackRole.skillIds`, then `agentSkillIds[agentId]`.
6. `TeamPackRole.roleCardSnapshot` is persisted through the team role config API and can be generated through team member materialization.
7. `currentTeamPack` is scoped to the selected project. Creating or selecting a non-TeamPack project must clear `currentTeamPack` and restore the preset default active agents.
8. Async TeamPack loads may update active agents only when the selected project still matches the requested `teamPackId`; stale responses must be ignored.
9. Synthesized TeamPack role snapshots must preserve execution semantics: implementation roles such as backend/frontend/coder can modify code and create files, while reviewer/planner/QA roles remain propose-only unless explicitly bound to a modifying RoleCard.
10. Preset TeamPacks should bind each known role to the matching preset RoleCard so runtime prompts do not accidentally downgrade implementers into advisory-only roles.
11. The browser `Agent` projection does not duplicate RoleCard facts as `role` or `roleLabel`. `TeamPackRole.displayName` remains the member name even when its snapshot RoleCard has a different display name; UI, mentions and prompt presentation resolve global/snapshot RoleCards through the Team Runtime-backed `getAgentRoleCard(agentId)` selector. Missing cards remain visibly unclassified instead of falling back to a guessed three-state role.

## Acceptance Criteria

- A project created with `engineering-trio` has active roles `planner`, `coder`, `reviewer`.
- The default `toad` backend role and `engineering-trio` `coder` role resolve to implementation RoleCards that allow code changes.
- A plain project created after a TeamPack project does not inherit the previous TeamPack roles.
- Switching projects while a TeamPack request is in flight does not let the stale TeamPack response overwrite the newly selected project.
- Clicking `planner` opens the binding panel and shows account binding controls.
- If global accounts exist, clicking "添加账号" on `planner` stores the binding on `TeamPackRole.accountIds` when a TeamPack role exists.
- Switching `planner` to an existing RoleCard stores a `TeamPackRole.roleCardSnapshot` when a TeamPack role exists.
- After switching to a RoleCard, account resolution uses TeamPack member account IDs first, then the role snapshot/source RoleCard as fallback.
- Adding a skill to `planner` writes `TeamPackRole.skillIds` when a TeamPack role exists; legacy `/api/agents/{agentId}/skills` remains the fallback without TeamPack.
- Dispatch to `planner` resolves an agent from `getEffectiveRoster()` and sends the chosen account IDs to `terminal:start`.
- Tests cover dynamic role account binding, role switching, skill hydration IDs, and dispatch profile resolution.
- TeamPacks can be materialized and exported with member snapshots so sharing does not require external RoleCards.
