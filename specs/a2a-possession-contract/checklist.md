# A2A Possession Contract Checklist

- [x] A chain has exactly one current holder.
- [x] Only the current holder can create a pass.
- [x] `@agent` alone does not wake an agent.
- [x] Actionable pass intent is required for agent-originated handoff.
- [ ] Multi-turn holder activity is buffered into a possession.
- [x] Handoff packet summarizes the possession instead of forwarding raw chat.
- [ ] Runtime roster mismatch produces an explicit block message.
- [x] CommunicationPolicy blocks are auditable and user-visible.
- [ ] Missing account or runtime rejects before pass acceptance.
- [x] Agent work is not marked `executing` until process/session start is confirmed.
- [ ] Busy targets do not create false executing entries.
- [x] Timeout messages identify offer, start, run, or holder idle phase.
- [ ] User can interrupt and retake the ball.
- [x] Old possessions cannot wake agents after a newer user turn.
- [x] UI shows handoff sequence with user-facing labels.
- [ ] Tests cover state machine, parser, handoff packet, policy, and timeout behavior.
