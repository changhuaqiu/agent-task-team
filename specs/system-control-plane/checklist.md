# System Control Plane Checklist

> Status: Draft
> Date: 2026-05-12

## Architecture

- [x] Control Plane owns dispatch decisions.
- [ ] Execution Plane only executes envelopes and reports lifecycle events.
- [ ] UI store is not authoritative for runtime delivery success.
- [ ] Daemon is not authoritative for team policy or workflow decisions.
- [x] Socket compatibility transport does not duplicate legacy proposal policy or Proof facts.
- [ ] A2A Possession owns collaboration semantics, not transport truth.

## State and Proof

- [x] Runtime nodes are durable or recoverable after restart.
- [x] Agent bindings are queryable by conversation and agent.
- [x] Execution envelopes have explicit lifecycle states.
- [x] Proof events correlate by envelope, conversation, task, chain, pass, node, and agent.
- [ ] Failure reasons are phase-specific and user-readable.

## Health and Routing

- [x] Runtime heartbeat is independent from stream watchdog.
- [x] Stale and unreachable states are computed deterministically.
- [x] Dispatch to unreachable nodes is blocked before transport send.
- [ ] Runtime routing is directed by `toNodeId`, not broadcast-only.
- [x] Executor start acknowledgement is required before marking dispatch started.
- [x] Autonomy recovery observes active Invocations and stops identical task/agent redispatch after the configured attempt budget only when an active Delivery owns a durable `waiting_human` escalation; ordinary Tasks are not silently stranded, and a human resume opens a fresh bounded attempt window.
- [x] Reviewer wakeups require a requested/evaluating QualityGate for the current Task revision; a rejected or missing Gate never loops back to the same reviewer.
- [x] `record_gate_decision` admission transaction rejects informal verdict aliases, missing evidence, Gate ids whose Task/Delivery target does not match the WorkContract, and invalid Delivery review/verification receipts before the outcome can be recorded as accepted; a rejected attempt does not consume the terminal outcome slot.
- [x] Repeated review cycles for the same Task/reviewer use distinct Gate-scoped Work identities, remain schedulable across implementer metadata changes, deduplicate pending Inbox work, and restart without human input unless the evaluator records an explicit human blocker.
- [x] An accepted `continue_work` checkpoint from execution, Task review, Delivery review, or acceptance verification becomes a dedicated bounded continuation, carries the exact next action into a fresh WorkContract epoch, never consumes the Invocation failure budget, and a WorkContract cannot admit a second continuation checkpoint; queued continuations reserve durable capacity, while legacy unversioned rows retain retry compatibility.
- [x] A shared canonical-realpath runtime directory has one Conversation-owned `TASKS.md` projection; takeover commits claiming while preserving legacy bytes, commits import/quarantine next, and only then rebuilds from committed Task Authority and publishes owned. Every phase uses the same crash-released SQLite mutex and atomic file replacement; stale watchers stop, empty/deleted membership rebuilds, unknown post-claim rows are rejected, and foreign rows cannot become shadow work.
- [x] A Task with WorkContract history rejects every file-originated business-field mutation, restores its authoritative projection, and preserves the Task revision frozen by an active QualityGate.

## Policy

- [x] Gate order is deterministic.
- [ ] Missing identity or session fails before policy evaluation.
- [ ] Team policy failures are not masked by breadth, dedup, or timeout checks.
- [ ] Possession violations are reported as holder failures.
- [x] Secret material is blocked or redacted before cross-instance delivery.
- [x] Handoffs accept at most three distinct receivers; once every Agent-owned single-transfer or fan-out branch settles, exactly one durable callback returns a bounded complete/partial result bundle to the original holder; human-originated work retains direct completion semantics.
- [x] The callback WorkContract authoritatively binds its reconciliation Possession; dispatch and admission fence its revision, while chain abort cancels pending callback Inbox work and closes active callback authority.
- [x] `handoff_to_agent` uses one admission/processing schema, accepts compatible string evidence by normalizing it into structured references, and cannot be accepted then dead-lettered for a schema disagreement between layers.
- [x] Handoff admission atomically creates the durable PassGroup and receiver Inbox commands with the accepted outcome; aggregate invariants roll back fully and leave a rejected outcome that can be corrected and resubmitted.
- [x] A2A outcome handler v3 safely recovers unsuperseded v2 dead letters, binds replay to the originating accepted outcome and Work epoch, compares the full normalized PassGroup request digest, and rejects later-epoch idempotency-key reuse instead of waiting on an unrelated group.
- [x] A v84 PassGroup without origin columns can only be claimed by the earliest accepted handoff that used its Work/key pair; a later callback epoch cannot adopt that historical group even when its normalized digest is identical.
- [x] Durable v2 recovery derives a stable outcome-scoped key for historical accepted handoffs that predate the key requirement, while current synchronous admission still rejects a new handoff without `idempotencyKey`.
- [x] An accepted handoff is dependency waiting until the durable A2A callback wakes the original holder; coordinator Agents do not spend continuation budget on receiver polling.
- [x] Internal completion-without-outcome exhaustion fails visibly as a system problem instead of asking the user to decide Agent-lane health; genuine human boundaries use actionable, user-readable copy without ControlAction ids.
- [x] Completion without Outcome opens exactly one fresh fenced outcome-only epoch, preserves the last durable output in context, exposes only `agent_submit_outcome`, grants no native edit/execute or Skill tools, and fails without human escalation if that recovery turn does not submit an accepted Outcome.
- [x] One oversized ACP session update is truncated at the display boundary without terminating the turn; cumulative output and queued-event limits remain hard, so a large tool result cannot strand the visible chat before the final reply.
- [x] `task.blocked` is never a wakeup by itself; only a satisfied machine recovery probe can resume Task-execution `report_blocked`, while `request_human_decision` and Gate blockers remain explicitly human-owned.
- [x] Terminal Task/Delivery replay closes every in-scope current Work Authority, cancels pending Inbox work, and releases its applied Control slot without terminating a possibly live Invocation from another runtime owner.

## Migration

- [ ] Existing A2A possession behavior remains compatible during migration.
- [ ] Existing direct user dispatch still works while moving through Dispatch Gateway.
- [ ] Existing runtime execution can report lifecycle events in the new model.
- [ ] Old compatibility socket events are treated as transport adapters.
- [ ] Documentation reflects actual implementation state at every phase.
