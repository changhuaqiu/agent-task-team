# Personality-Led Autonomy Spec

**Status:** Active
**Date:** 2026-05-21
**Related specs:**
- `specs/default-team-collaboration-template/spec.md`
- `specs/a2a-possession-contract/spec.md`
- `specs/system-control-plane/spec.md`
- `specs/group-chat-task-flow/spec.md`

## Problem

The user expects to state a goal once and let the configured team keep working until the work is delivered or a real human decision is needed.

Current collaboration can stall after one or two turns because:

- an agent can write scheduling text without creating a real task dispatch
- A2A chains can complete even when the Task Graph still has runnable work
- agents may interpret anti-echo guidance as permission to stop after writing a status update
- missing gate evidence can block a transition without creating a recovery habit
- session or page lifecycle can end while the durable task still needs work

The product goal is not to replace agent judgment with a rigid central workflow. The configured personalities should remain the primary autonomy mechanism.

## Goal

Make the default autonomy model personality-led:

- agents decide how to plan, implement, review, test, hand off, and escalate according to their role identity
- the system verifies only hard facts such as dispatch receipt, task status, evidence, blocker ownership, and timeout
- the system nudges the responsible personality back into the loop when a fact is missing

## Non-Goals

- Do not introduce a central scheduler that chooses implementation strategy instead of Mario, Peach, DK, Yoshi, Luigi, or Toad.
- Do not make every mention a dispatch.
- Do not bypass A2A possession, Team Runtime communication policy, or Task Graph state authority.
- Do not mark work complete from chat text alone.

## Autonomy Layers

```text
Personality Layer -> Protocol Layer -> Fact Guard Layer
```

### Personality Layer

The role personality owns judgment:

- Mario owns planning, dispatch intent, escalation, and final delivery judgment.
- Luigi and Toad own implementation decisions and implementation evidence.
- Peach owns review judgment.
- DK owns architecture judgment when risk crosses module, schema, security, performance, or boundary lines.
- Yoshi owns validation judgment.

Every role must end each turn with a closure action.

Valid closure actions:

1. update task state with required evidence
2. create a real structured dispatch or A2A handoff and verify receipt
3. create or update a blocker and escalate to the configured coordinator
4. state a concrete external wait condition with the recovery owner

Invalid closure actions:

- "已通知" without a dispatch receipt
- "两条管道已启动" without one receipt per target
- "无待办" while the active workflow still has open runnable tasks or gates
- review pass without downstream test gate dispatch or structured gate wakeup
- implementation complete without install/build/GitNexus evidence

### Protocol Layer

The shared protocol teaches the personalities the operating habits:

- Text scheduling is intent, not execution.
- A task is started only when a structured dispatch returns a receipt or lifecycle acknowledgement.
- Parallel lanes must be counted as `n/n dispatched`.
- A2A is for explicit handoff, not status broadcast.
- Task state belongs to Task Graph or approved task tools.
- Every gate decision must name evidence or missing evidence.
- A blocked handoff must immediately use the configured escalation path.

### Fact Guard Layer

The system should provide only minimum fact guarding:

- detect missing dispatch receipt after a claimed dispatch
- detect gate evidence rejection and prompt the same agent to repair evidence
- detect a stale review or test gate and wake the gate owner or coordinator
- detect runnable pending work with no active dispatch and wake the responsible personality
- detect blocked A2A policy and route an escalation prompt to the coordinator

The guard must not decide the implementation approach, review verdict, test verdict, or product trade-off.

## Dispatch Receipt Gate

Dispatch claims must be backed by receipts.

Rules:

- A role may not claim a lane has started unless the system produced a dispatch receipt for that target.
- Fan-out requires one receipt per target.
- If a dispatch is partial, the agent must report the partial state and either retry or escalate.
- Text `@agent` mentions are never sufficient proof of execution by themselves.
- A2A pass offers, `terminal:start`, task wakeups, or future execution envelopes may serve as receipts when correlated to task, target, and conversation.

Recommended receipt metadata:

```typescript
interface DispatchReceipt {
  receiptId: string;
  conversationId: string;
  taskId?: string;
  targetAgentId: string;
  source: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';
  phase: 'offered' | 'sent' | 'started' | 'blocked' | 'failed';
  chainId?: string;
  passId?: string;
  runId?: string;
  reasonCode?: string;
  createdAt: string;
}
```

## Autonomy Guard Wakeups

Initial guard wakeups should be conservative:

| Condition | Wake target | Prompt shape |
| --- | --- | --- |
| Claimed dispatch without receipt | original claimer | "你刚才只有文本调度，没有真实派发回执。请补发或说明阻塞。" |
| Missing implementation evidence | implementer | "请补 install/build/GitNexus evidence，再进入 review_gate。" |
| Missing delivery evidence | Mario | "请完成 main_verify 和 delivery_evidence，再标记 done。" |
| Stale review gate | Peach or Mario | "review_gate 已停滞，请评审、退回或升级。" |
| Stale test gate | Yoshi or Mario | "test_gate 已停滞，请测试、退回或升级。" |
| Runnable unowned task | Mario | "任务已可执行但没有负责人，请分派。" |
| Runnable owned task with no active dispatch | task owner | "任务可继续但没有活跃派发，请恢复执行或说明阻塞。" |

## Acceptance Criteria

- Default team role prompts include the personality-led closure contract.
- Task management skill guidance says dispatch claims require real receipts.
- Default-team spec documents that autonomy is personality-led and system guards are fact-only.
- A2A possession spec documents dispatch receipt as the boundary between text intent and execution fact.
- Future code changes that add guard wakeups must not centralize role judgment away from the configured personalities.
