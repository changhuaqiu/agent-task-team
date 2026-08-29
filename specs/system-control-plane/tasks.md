# System Control Plane Tasks

> Status: Draft
> Date: 2026-05-12

## Phase 1: Contract and Data Model

- [x] Create `specs/system-control-plane/` with control-plane architecture.
- [x] Define SQLite schema for proof events.
- [x] Define SQLite schema for runtime nodes.
- [x] Define SQLite schema for agent bindings.
- [x] Define SQLite schema for execution envelopes.
- [x] Add repositories for proof, runtime nodes, agent bindings, and envelopes.
- [x] Add focused unit tests for repository state transitions.

## Phase 2: Runtime Health Registry

- [x] Register local daemon runtime node on startup.
- [x] Register browser client runtime node on socket connection.
- [x] Track 5s runtime heartbeat independently from stream watchdogs.
- [x] Mark nodes stale after 2 missed heartbeats.
- [x] Mark nodes unreachable after 3 missed heartbeats.
- [x] Derive agent binding reachability from node status and runtime profile.
- [x] Emit user-readable health events for unreachable targets.

## Phase 3: Dispatch Gateway

- [x] Add `DispatchGateway` server module.
- [x] Normalize dispatch intents from user, A2A, workflow, review gate, and system sources.
- [x] Implement deterministic gate order.
- [x] Record proof events for every gateway decision.
- [x] Build `ExecutionEnvelope` for allowed dispatches.
- [x] Block missing runtime target before any transport send.
- [x] Block unreachable target before any transport send.

## Phase 4: Runtime Router and Executor Contract

- [x] Add local directed runtime routing by `toNodeId`; unconnected remote executors fail closed.
- [x] Delete parallel socket compatibility events; publish typed presentation through `project:view` only.
- [x] Make daemon acknowledge envelope start explicitly.
- [x] Make local daemon execution report the same lifecycle states.
- [x] Store envelope terminal state on completion, failure, timeout, or rejection.
- [x] Add runtime tests for no-ACK and unreachable-node fail-closed paths.

## Phase 5: Integration Migration

- [x] Route direct user dispatch through `DispatchGateway`.
- [x] Route A2A possession handoff through `DispatchGateway`.
- [x] Route workflow-triggered dispatch through `DispatchGateway`.
- [ ] Move task status mutation behind Task Authority.
- [ ] Reduce `taskHubStore` dispatch responsibilities to intent submission and state subscription.
- [ ] Reduce daemon responsibilities to execution and lifecycle reporting.
- [x] Remove socket-local legacy proposal policy and route the command through Invocation Planner admission.

## Phase 6: Continue Gate and Safety

- [x] Add `ContinueGateLite` for validated, bounded `continue_work` checkpoints and dedicated continuation dispatch across execution, Task review, Delivery review, and acceptance verification Work.
- [ ] Use holder buffer thresholds to decide checkpoint, pass, pause, or stop.
- [x] Add lightweight `SecretGate` for execution envelopes.
- [x] Add circuit breaker for repeated runtime start failures; AutonomyGuard counts failed task/agent attempts since the latest task revision or human-resume window, stops redispatch only when an active Delivery can persist the escalation, and escalates that run to `waiting_human`; ordinary Tasks remain recoverable instead of being silently stranded.
- [x] Require an open revision-matched QualityGate before AutonomyGuard can wake a reviewer, and preserve existing implementer/reviewer WorkAuthority epochs when Delivery adopts a pre-existing Task so Gate actions are not cancelled as stale.
- [x] Validate `record_gate_decision` evidence and exact Task/Delivery Gate target inside WorkContract admission so rejected attempts do not consume the terminal outcome slot.
- [x] Validate Delivery Gate receipt schemas in admission and render their exact required shape in evaluator prompts.
- [x] Project pending Durable Inbox items as queued Work and prohibit duplicate activation while an Agent is busy.
- [x] Bind review/verification Work identity to the exact Gate, recover after a prior authority closed, and keep submitted review schedulable when implementer assignment metadata changes.
- [x] Preserve post-Task Delivery Gate Inbox work and release Control slots on Inbox cancellation/expiry.
- [x] Bump the Delivery control policy revision when Work Cell projection semantics change so persisted deterministic decision identities cannot conflict across a rollout.
- [x] Bound A2A fan-out to three receivers, reopen the original holder for deterministic callback reconciliation, and bind that Possession into the callback WorkContract.
- [x] Build a bounded selective result bundle with successful summaries, failure reasons, and exact branch outcome evidence refs; cover all-success, partial-failure, idempotency, restart binding, and breadth rejection.
- [x] Fence callback dispatch by the open Possession revision; chain abort cancels pending callbacks and closes already-issued callback WorkAuthority.
- [x] Share one normalized handoff payload contract between synchronous WorkContract admission and asynchronous A2A processing; accepted single-agent and fan-out delegation waits for its event callback instead of polling, while malformed handoffs remain correctable without consuming the terminal slot and replay remains bound to its originating outcome epoch.
- [x] Keep internal invocation/protocol exhaustion inside automatic recovery and failure handling; reserve `waiting_human` for explicit Agent blockers, authorization, configuration, or external business decisions, and render those boundaries in user language.
- [x] Replace full task retry after `invocation_completed_without_outcome` with one outcome-only recovery WorkContract that grants no implementation tools and terminates deterministically if recovery does not submit an accepted Outcome.
- [x] Add a durable Work Lifecycle Reconciler for terminal Task/Delivery ownership cleanup and historical orphan repair.
- [x] Enforce one accepted exit per WorkContract and remove direct Task mutation tools from WorkContract execution.
- [x] Make `propose_task_graph` admission atomically commit canonical Task Graph changes, assign eligible existing WorkItems, and enqueue runnable standalone Tasks before returning accepted.
- [x] Queue bounded standalone/A2A `continue_work` commands atomically while keeping Delivery continuation under `ContinueGateLite`.
- [x] Rotate confirmed ACP session generations on cumulative context/Invocation budget exhaustion.
- [x] Replace blind `task.blocked` redispatch with a server-owned Blocked Recovery probe and idempotent Task resume.
- [ ] Add diagnostics view for proof timeline and runtime health.

## Phase 7: Documentation and Cleanup

- [x] Update `docs/wiki/01-architecture.md`.
- [x] Update `docs/wiki/03-store-model.md`.
- [x] Update `docs/wiki/04-backend-daemon.md`.
- [x] Update `specs/a2a-possession-contract/spec.md` to depend on Control Plane for delivery.
- [ ] Archive or deprecate obsolete A2A v2 delivery semantics.
