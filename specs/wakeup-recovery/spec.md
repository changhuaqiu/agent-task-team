# Wakeup Recovery Compatibility

Status: `active`

## Problem

The managed Task lifecycle and server-owned wakeup loop can be healthy while the
legacy project UI or an ACP launcher makes the wakeup appear lost. The production
failure combined three independent faults:

1. `/api/state` exposed managed `ready` rows to a legacy Kanban that only accepts
   `pending`, causing the project surface to crash.
2. adapter runtimes were launched through `npx` even though their pinned packages
   were installed locally; inside the long-lived Next.js daemon this produced
   immediate stdio `EPIPE` failures.
3. a batched Control Decision threw on one stale Work epoch, leaving the same
   ready action to fail every periodic reconcile and preventing valid sibling
   actions from being claimed.

## Contract

- Managed Task storage remains authoritative. Legacy projections map
  `proposed`/`ready` to `pending` and `cancelled` to `blocked`.
- Adapter construction prefers the pinned installed `node_modules/.bin` binary
  and keeps the exact-version `npx` launcher as fallback.
- Claude ACP sessions send
  `_meta.claudeCode.options.forwardSubagentText=true` for both new and resumed
  sessions, preserving runtime-native subagent output through the parent turn.
- Direct action claims remain fail-closed. Batch claims cancel stale ready actions
  with `failure_code=stale_work_epoch` and continue valid siblings atomically.

## Long-term Documentation

- `docs/technical/execution/opencode-integration-executable-chain.md`
- `docs/technical/execution/group-chat-task-graph.md`
- `docs/technical/execution/platform-harness-state-machine-design.md`

## Exit Condition

All items in `tasks.md` and `checklist.md` are complete; stable behavior has been
written into the long-term technical documentation above; then this directory is
archived under `docs/archive/specs/`.
