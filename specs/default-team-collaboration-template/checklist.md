# Default Team Workflow Harness Checklist

- [x] Role names are user-facing and avoid internal runtime/routing terms.
- [x] Mario remains the intake and escalation owner.
- [x] Luigi and Toad can coordinate directly.
- [x] DK is an on-demand architecture gate, not a normal implementer.
- [x] Peach and Yoshi are modeled as review/test gates.
- [x] Reject loops go directly to responsible roles before escalating to Mario.
- [x] Communication rules preserve review and QA feedback loops.
- [x] Passing review decisions wake the test gate through task state, not live chat.
- [x] Blocked direct handoffs escalate to the configured coordinator.
- [x] Older persisted default-team matrices stay compatible with Harness-critical paths.
- [x] Each default-team role prompt includes GitNexus graph-first duties appropriate to its gate or lane.
- [x] Tasks cannot enter review without implementation evidence.
- [x] Tasks cannot enter done without main-branch delivery evidence.
- [x] CLI success records an evidence blocker instead of silently advancing to review.
- [x] Preset data and product/spec docs describe the same behavior.
- [x] Regression tests verify the sample stays a Harness flow.
