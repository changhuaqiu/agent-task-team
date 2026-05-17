# Team Workflow Harness Refactor Design

> Date: 2026-05-17
> Status: Approved
> Scope: 6-person Mario team workflow, communication matrix, and pipeline stages

## Background

The current 6-person team (Mario, Luigi, Toad, Peach, DK, Yoshi) has three structural problems:

1. **Communication bottleneck**: DK and Yoshi can only talk to Mario. Peach must route through Mario to reach DK for architectural issues.
2. **Incomplete workflow**: The state machine only has `implementing(luigi)`, with no path for Toad or parallel execution.
3. **Role misclassification**: DK is classified as `worker` but his RoleCard defines `can_propose_only`.

This design draws from Harness engineering principles: **Pipeline Stages** with **Approval Gates**, autonomous execution within stages, and policy-driven communication.

## Design Decisions

1. **Approach**: Open communication matrix + dual-track workflow (Scheme A) — minimal changes, maximum impact.
2. **Mario stays pure coordinator**: No code execution, only planning and dispatch.
3. **Yoshi participates throughout**: QA is involved from early stages, not just at the end.
4. **DK reclassified to `reviewer`**: Fix the agentRole mismatch.

## Pipeline Workflow

### State Machine

```
planning ──→ implementing ──→ review_gate ──→ test_gate ──→ done
(Mario)       (Luigi/Toad)    (Peach+DK)      (Yoshi)
               ↺                    ↺                ↺
               └──── reject ────────┘                │
               └──────────── reject ─────────────────┘
```

### State Definitions

| State | Owner(s) | Description |
|-------|----------|-------------|
| `planning` | Mario | Task decomposition, priority ranking, assignment |
| `implementing` | Luigi (frontend), Toad (backend) | Code implementation, can run in parallel |
| `review_gate` | Peach (code), DK (architecture, on-demand) | Code quality + architecture review |
| `test_gate` | Yoshi | Integration testing, spec consistency, delivery completeness |
| `done` | — | Terminal state |

### Multi-track Implementing

Mario dispatches tasks with a domain tag (`frontend` or `backend`). Luigi and Toad receive tasks matching their domain independently. They can run in parallel on different tasks.

When a task spans both domains, Mario splits it into two tasks with a dependency edge: Toad's backend task → Luigi's frontend task.

### Reject Flow

- `review_gate` reject → Peach/DK sends directly back to the originating implementer with rejection reason. Does NOT go through Mario.
- `test_gate` reject → Yoshi sends back to the implementer (code issue) or Peach (review oversight). Does NOT go through Mario.
- If reject count exceeds 2 for the same task, Mario is auto-notified (escalation).

### Stage Gate Criteria

**implementing Stage:**
- Entry: Mario has dispatched task with clear description + target implementer
- Exit: Code changes made, change summary provided, review request submitted
- Max parallel: Luigi + Toad can execute simultaneously

**review_gate Stage:**
- Entry: Implementer submitted review request with code change description + diff summary
- Peach scope: Code quality, security, test coverage
- DK trigger: Peach judges issue is architectural, or Mario explicitly requested architecture review
- Exit:
  - Peach passes → mark `review_passed`, flow to `test_gate`
  - Peach/DK rejects → direct back to implementer with rejection reason
- Timeout: Peach 45 min → auto-notify Mario

**test_gate Stage:**
- Entry: `review_gate` passed
- Yoshi scope: Integration test, spec consistency, delivery completeness
- Exit:
  - Yoshi passes → mark `testing_passed`, flow to `done`
  - Yoshi rejects → back to implementer (code issue) or Peach (review oversight)
- Timeout: Yoshi 30 min → auto-notify Mario

## Communication Matrix

Replace the current hub-spoke matrix with a responsibility-based open matrix:

| From ↓ To → | Mario | Luigi | Toad | Peach | DK | Yoshi |
|--------------|-------|-------|------|-------|----|-------|
| **Mario** | — | dispatch | dispatch | dispatch | dispatch | dispatch |
| **Luigi** | escalate | — | coord | submit review | ✗ | fix test |
| **Toad** | escalate | coord | — | submit review | ✗ | fix test |
| **Peach** | escalate | reject | reject | — | escalate arch | handoff test |
| **DK** | escalate | arch feedback | arch feedback | arch review done | — | ✗ |
| **Yoshi** | escalate | test feedback | test feedback | found code issue | found arch issue | — |

### Path Semantics

| Path Type | Meaning |
|-----------|---------|
| dispatch | Mario assigns task to implementer/reviewer |
| escalate | Agent hits issue beyond their scope, asks Mario to decide |
| coord | Luigi ↔ Toad coordinate on frontend-backend interface |
| submit review | Implementer sends completed work to Peach |
| reject | Reviewer sends work back to implementer with issues |
| escalate arch | Peach discovers architectural issue, sends to DK |
| arch feedback | DK provides architecture guidance to implementer |
| arch review done | DK reports findings back to Peach |
| handoff test | Peach passes reviewed work to Yoshi for testing |
| fix test | Yoshi reports test failure to implementer |
| test feedback | Yoshi provides test results to implementer |
| found code issue | Yoshi discovers code quality issue during testing |
| found arch issue | Yoshi discovers architectural issue during testing |

### Design Principles

1. **Every path has a reason** — paths are not "chat", they are purposeful transfers
2. **Escalate to Mario** — anyone can escalate when hitting scope boundaries
3. **No Mario bottleneck** — review/test rejections flow directly between roles
4. **DK does not talk to Yoshi directly** — their domains don't overlap in normal flow

## Role Classification Fix

### DK AgentRole Change

| Field | Current | New |
|-------|---------|-----|
| `ROLE_MAP['dk']` | `'worker'` | `'reviewer'` |
| `ROLE_LABEL_MAP['dk']` | `'Architecture Engineering'` | unchanged |

This aligns the deprecated AgentRole with DK's actual behavior (`can_propose_only`, no code modification).

## A2A Pass Intent Extension

Add new pass intent types to support the open communication matrix:

| Intent | Trigger | Example |
|--------|---------|---------|
| `reject` | Review/test failed | `@luigi 代码不符合规范，请修改 xxx` |
| `escalate` | Scope boundary hit | `@mario 这个需求涉及架构调整，请决策` |
| `coord` | Cross-domain coordination | `@toad API 接口定义好了，请确认` |
| `handoff_test` | Review passed, hand to QA | `@yoshi review 通过，请做集成测试` |

Existing intents (`delegate`, `review`, `answer`, `verify`, `implement`, `plan`) remain unchanged.

## Implementation Scope

### What Changes

1. **`src/data/presetTeamPacks.ts`** — Update default-team workflow states and communication matrix
2. **`src/store/agentStore.ts`** — Fix DK's `ROLE_MAP` entry
3. **`src/server/a2a/pass-intent.ts`** — Add `reject`, `escalate`, `coord`, `handoff_test` intent patterns
4. **`src/server/a2a/types-v2.ts`** — Extend `PassIntentType` union
5. **`src/lib/agent-context/layers/teamPackLayer.ts`** — Update workflow state descriptions in prompt
6. **`src/lib/agent-context/layers/roleLayer.ts`** — Add gate-specific guidance per role

### What Does NOT Change

- RoleCard definitions (persona, responsibilities, capabilities)
- PromptComposer layer architecture
- A2A possession model (chain, pass, handoff packet)
- Team Runtime Contract
- Database schema

## Out of Scope

- New TeamPack templates
- UI changes to the task detail panel
- Dark mode or accessibility fixes
- Test coverage improvements
