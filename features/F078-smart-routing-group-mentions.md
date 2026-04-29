---
feature_ids: [F078]
related_features: [F032, F042, F046]
topics: [routing, mentions, ux]
doc_kind: spec
created: 2026-03-07
completed: 2026-03-07
---

# F078: Smart Routing & Group Mentions

> **Status**: done | **Owner**: Agent-R

## Why

When users send messages without @mention, the system currently routes to ALL thread participants (activity-sorted). This causes unexpected multi-agent responses when users just want to continue talking to the agent they were chatting with. Additionally, there's no way to broadcast to all agents, a specific breed, or all thread participants without manually @mentioning each one.

## What

Four routing improvements:

1. **Default to last replier** -- When no @mention is present and the thread has participants, route only to the most recent replier (not all participants). When `preferredCats` is set, last-replier is scoped to that set; if last replier is outside preferred, falls back to first preferred agent (#58). No participants and no preferredCats -> default to opus.

2. **@all / @全体** -- Route to all available agents.

3. **@全体{breed}** -- Route to all variants of a breed (e.g. @全体Agent-R -> opus, sonnet, opus-45).

4. **@thread / @本帖 / @全体参与者** -- Route to all current thread participants.

## Acceptance Criteria

- [x] AC-A1: Message without @mention routes to the agent that most recently replied in the thread
- [x] AC-A2: New thread without participants defaults to opus (unchanged)
- [x] AC-A3: `@all` or `@全体` routes to all available agents
- [x] AC-A4: `@全体Agent-R` / `@all-Agent-R` routes to all Agent-R variants
- [x] AC-A5: `@全体Agent-M` / `@all-maine-coon` routes to all maine-coon variants
- [x] AC-A6: `@全体Siamese` / `@all-siamese` routes to all siamese variants
- [x] AC-A7: `@thread` / `@本帖` / `@全体参与者` routes to all thread participants
- [x] AC-A8: Group mentions respect agent availability (skip unavailable agents)
- [x] AC-A9: Existing individual @mention behavior unchanged
- [x] AC-A10: All new patterns use longest-match-first + token boundary to avoid collisions

## Key Decisions

- Group mentions are parsed BEFORE individual mentions (they are longer patterns)
- `@thread` requires ThreadStore access; if no participants, falls back to default agent (opus)
- Breed group patterns derived from `agent-config.json` breeds array (not hardcoded)
- Token boundary matching prevents substring collisions (e.g. `@allison` ≠ `@all`)

## Dependencies

- **Evolved from**: F032 (thread-level agent selection), F046 (A2A mention simplification)
- **Related**: F042 (prompt engineering audit -- routing policy)

## Risk

- Low. Changes are localized to AgentRouter.parseMentions + peekTargets.
- Backward compatible: existing @mention behavior untouched.

## Review Gate

- Reviewer: @codex (cross-family)
- Tests: agent-router.test.js extended with group mention cases

## Requirements Checklist

| # | Requirement | Source | AC | Status |
|---|------------|--------|-----|--------|
| R1 | Default to last replier when no @mention | Interview | AC-1 | done |
| R2 | New thread defaults to opus | Interview | AC-2 | done |
| R3 | @all broadcasts to all agents | Interview | AC-3 | done |
| R4 | Per-breed group mentions | Interview | AC-4,5,6 | done |
| R5 | @thread mentions all participants | Interview | AC-7 | done |
| R6 | Availability filtering | Derived | AC-8 | done |
| R7 | No regression on individual mentions | Derived | AC-9,10 | done |

## Vision Guardian Sign-off

| agent | Documents Read | Three Questions | Sign-off |
|-----|---------------|-----------------|----------|
| opus (self) | VISION.md, F078 spec, plan, AgentRouter.ts, tests | 1. Core problem: no-mention fanout + no group broadcast. 2. Solved: last-replier default + group mentions. 3. UX: natural continuation with explicit broadcast when needed. | Passed |
| gpt52 (cross-family) | VISION.md, F078 spec, plan, AgentRouter.ts, tests, review mailbox | 5/5 dimensions passed. Non-blocking: spec status drift (fixed). | Passed |
