# A2A Possession Contract Tasks

## Phase 1: Data Model

- [x] Add `a2a_chain` fields needed for `current_holder_id` and possession migration, or create a new `a2a_possession_chain` table.
- [x] Add `a2a_possession` table with holder, status, summary, start, and completion fields.
- [x] Add `a2a_pass` table with phase-specific status, target, reason, and packet references.
- [x] Add `a2a_handoff_packet` table for compact handoff payloads and source message ids.
- [x] Add `a2a_delivery` table for compatibility dispatch outbox, attempts, and deferred retry state.
- [x] Add indexes by conversation, chain, holder, pass status, and created time.

## Phase 2: Orchestrator State Machine

- [x] Introduce a possession-oriented orchestrator facade.
- [x] Implement chain creation from `user_turn_created`.
- [x] Implement current-holder enforcement.
- [x] Implement branch-holder enforcement for fan-out chains.
- [x] Implement pass draft validation against Team Runtime roster.
- [x] Implement CommunicationPolicy validation before offer.
- [x] Implement possession completion without pass.
- [ ] Implement chain interruption when the user takes the ball back.
- [x] Rebuild active orchestrator and dedup memory state from SQLite on startup.
- [x] Wrap possession multi-table transitions in SQLite transactions.

## Phase 3: Event Protocol

- [x] Replace `a2a:user-message` semantics with `user_turn_created`.
- [x] Replace `a2a:dispatch` with `pass_offer`.
- [x] Add client ACK event for `accepted` and `rejected`.
- [x] Add client busy/deferred event that returns delivery to the retry queue.
- [ ] Add execution events for `agent_starting`, `agent_started`, and `agent_completed`.
- [x] Add blocked and timeout server events with phase-specific reason codes.
- [x] Scope A2A socket events to the conversation room.

## Phase 4: Execution Adapter

- [ ] Make `dispatchToAgent()` return structured rejection reasons.
- [ ] Report missing runtime/account before pass acceptance.
- [x] Report process spawn success as `agent_started`.
- [x] Retry busy A2A compatibility dispatches after the target becomes idle.
- [ ] Report process exit or backend `done` as `agent_completed`.
- [x] Remove any path that marks work `executing` before real start.

## Phase 5: Handoff Packet

- [x] Create deterministic handoff packet builder.
- [ ] Buffer holder text, tool use, tool result, user follow-up, and relevant system events per possession.
- [x] Extract requested action from explicit pass intent.
- [x] Extract possession summary, relevant decisions, evidence refs, and open questions from holder text.
- [x] Include anti-echo and TASKS.md source-of-truth constraints.
- [ ] Use handoff packet in target agent prompt instead of raw upstream response.

## Phase 6: Parser and Policy

- [x] Replace raw `@mention` auto-dispatch with pass-intent parsing.
- [x] Ignore code blocks, quotes, and non-actionable mentions.
- [x] Treat dispatch summary language as actionable handoff intent.
- [x] Ignore completed-state dispatch summaries such as "已分配给 @agent".
- [x] Evaluate repeated mentions so later actionable mentions are not missed.
- [x] Reject negated action-before-target mentions and route chainless handoffs through the standard dispatch policy.
- [x] Prevent task-linked A2A from implicitly reopening or reassigning terminal tasks.
- [ ] Add diagnostics for uncertain mentions.
- [x] Block non-holder pass attempts.
- [x] Add loop and fanout budget checks.

## Phase 7: UI

- [x] Show current holder in the conversation workspace.
- [x] Show handoff sequence as user-facing collaboration history.
- [x] Show blocked pass reasons with product language.
- [x] Add expandable recent handoff timeline.
- [x] Distinguish offer, run, and holder idle timeouts in compatibility mode; keep start timeout configuration for the accepted/start split.
- [x] Avoid primary UX labels such as runtime, routing, worklist, chain, or provider.

## Phase 8: Migration

- [x] Keep A2A v2 tables readable during migration.
- [ ] Add adapter to translate current chain/worklist rows into possession/pass debug views.
- [ ] Stop writing new v2 worklist rows once possession orchestrator is enabled.
- [ ] Archive or deprecate A2A v2 docs after implementation lands.

## Phase 9: Tests

- [x] Unit test pass-intent parser.
- [x] Unit test possession state transitions.
- [x] Unit test handoff packet builder.
- [x] Integration test user -> agent -> agent pass.
- [x] Integration test batch dispatch summary wakes multiple agents.
- [x] Integration test branch holders can complete independently after fan-out.
- [x] Integration test client-driven user fan-out registers independent holders.
- [x] Integration test busy dispatch defers and retries from the delivery outbox.
- [ ] Integration test multi-turn holder buffer collapsed into one handoff.
- [ ] Integration test missing runtime rejects before accepted.
- [x] Integration test non-holder cannot pass.
- [x] Integration test non-roster target blocks without timeout.
- [x] Integration test phase-specific timeout messages.
- [x] Integration test restart state rebuild keeps A2A handoff continuity.
- [x] Store test possession UI runtime state.
- [x] Store test handoff timeline retention.
