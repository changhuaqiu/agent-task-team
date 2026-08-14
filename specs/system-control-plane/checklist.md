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

## Policy

- [x] Gate order is deterministic.
- [ ] Missing identity or session fails before policy evaluation.
- [ ] Team policy failures are not masked by breadth, dedup, or timeout checks.
- [ ] Possession violations are reported as holder failures.
- [x] Secret material is blocked or redacted before cross-instance delivery.

## Migration

- [ ] Existing A2A possession behavior remains compatible during migration.
- [ ] Existing direct user dispatch still works while moving through Dispatch Gateway.
- [ ] Existing runtime execution can report lifecycle events in the new model.
- [ ] Old compatibility socket events are treated as transport adapters.
- [ ] Documentation reflects actual implementation state at every phase.
