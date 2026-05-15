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

- [ ] Add directed runtime routing by `toNodeId`.
- [x] Keep socket compatibility events as transport adapters.
- [x] Make daemon acknowledge envelope start explicitly.
- [x] Make bridge execution report the same lifecycle states.
- [x] Store envelope terminal state on completion, failure, timeout, or rejection.
- [ ] Add integration tests for no-ACK and unreachable-node paths.

## Phase 5: Integration Migration

- [x] Route direct user dispatch through `DispatchGateway`.
- [x] Route A2A possession handoff through `DispatchGateway`.
- [x] Route workflow-triggered dispatch through `DispatchGateway`.
- [ ] Move task status mutation behind Task Authority.
- [ ] Reduce `taskHubStore` dispatch responsibilities to intent submission and state subscription.
- [ ] Reduce daemon responsibilities to execution and lifecycle reporting.

## Phase 6: Continue Gate and Safety

- [ ] Add `ContinueGateLite`.
- [ ] Use holder buffer thresholds to decide checkpoint, pass, pause, or stop.
- [x] Add lightweight `SecretGate` for execution envelopes.
- [ ] Add circuit breaker for repeated runtime start failures.
- [ ] Add diagnostics view for proof timeline and runtime health.

## Phase 7: Documentation and Cleanup

- [x] Update `docs/wiki/01-architecture.md`.
- [x] Update `docs/wiki/03-store-model.md`.
- [x] Update `docs/wiki/04-backend-daemon.md`.
- [x] Update `specs/a2a-possession-contract/spec.md` to depend on Control Plane for delivery.
- [ ] Archive or deprecate obsolete A2A v2 delivery semantics.
