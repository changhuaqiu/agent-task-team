# Frontend Runtime Performance Refactor Spec

**Status:** Active
**Date:** 2026-05-15
**Related docs:**
- `docs/wiki/03-store-model.md`
- `specs/team-runtime-contract/spec.md`
- `specs/unify-integration-config-center/spec.md`

## Problem

The frontend store currently exposes Team Runtime data through methods such as `getEffectiveRoster()` and `getAgentRuntimeProfile()`. Those methods rebuild Team Runtime from Zustand state every time a component calls them, even when the relevant inputs have not changed.

This is especially costly in render paths such as agent binding, kanban columns, chat mentions and task details, because the runtime resolver scans conversations, maps preset agents, resolves TeamPack roles, and creates fresh objects on each call.

Several large UI components also subscribe to many independent store slices. This makes their render boundaries broad and makes it harder to reason about which state changes should refresh which part of the screen.

## Goals

- Keep Team Runtime as the domain contract and store as a runtime cache.
- Cache resolved Team Runtime by stable input references and invalidate it when one of its inputs changes.
- Return stable effective roster objects while cached inputs are unchanged.
- Cache per-agent runtime profiles by agent id and account reference.
- Reduce `AgentBindingPanel` subscription spread without changing user-facing behavior.
- Capture the refactor as an incremental path, not a full store split.

## Non-Goals

- Do not split `taskHubStore` into independent stores in this iteration.
- Do not move `AGENT_ROSTER` into Zustand in this iteration.
- Do not redesign settings, account creation, TeamPack or role-card UX.
- Do not introduce new state libraries or dependencies.
- Do not change dispatch, prompt composition or daemon contracts.

## Design

### Runtime Cache Boundary

`taskHubStore` keeps a module-local cache for derived runtime data. The cache is invalidated when any of the following references or values changes:

- `selectedConversationId`
- `conversations`
- `currentTeamPack`
- `activeAgentIds`
- `roleCards`
- `skillsMap`
- `agentSkillIds`
- `agentAccountOverrides`
- `agentRoleCardOverrides`
- preset roster signature

The preset roster signature exists because `AGENT_ROSTER` is currently a module-level mutable value. It is not a long-term fact-source decision; it is a compatibility guard until the roster owner is formalized.

### Stable Derived Values

The runtime cache owns:

- `TeamRuntime`
- legacy-compatible `Agent[]` effective roster
- per-agent `RuntimeAgentProfile | null`, keyed by `agentId` and invalidated when `accounts` changes

Components continue to call the existing store methods, but repeated calls in the same state version reuse cached derived objects.

### Component Boundary

`AgentBindingPanel` should select related state in one shallow selector instead of many independent subscriptions. This does not fully split the component yet, but it narrows the first render boundary and prepares a later extraction into:

- role card section
- skill binding section
- account binding section
- debug session section

## Risks

- Caching must not hide changes from existing mutable `AGENT_ROSTER` updates.
- Returning stable arrays can expose accidental mutation by consumers; UI code must treat returned arrays and objects as read-only.
- Full store splitting remains a separate architecture task because it changes fact-source ownership and persistence boundaries.

