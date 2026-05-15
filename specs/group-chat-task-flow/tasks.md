# Group Chat Task Flow Tasks

> Status: Draft
> Date: 2026-05-15

## Phase 1: Contract and Persistence

- [ ] Define `TaskGraph`, `TaskNode`, `TaskEdge`, `TaskAction`, and `ArtifactRef` types.
- [ ] Decide whether to extend existing task tables or add graph-specific tables.
- [ ] Add durable task action event storage.
- [ ] Add graph reconstruction from task action events.
- [ ] Add migration path for existing conversation tasks.
- [ ] Add repository tests for split, dependency, merge, reopen, and cancel flows.

## Phase 2: Chat and Task Binding

- [ ] Extend chat messages with referenced task ids and action ids.
- [ ] Render task capsules inside group chat messages.
- [ ] Render task action cards for split, claim, handoff, block, merge, review, and reopen events.
- [ ] Collapse verbose runtime logs behind details.
- [ ] Add message-to-task detail navigation.

## Phase 3: Multi-Task Flow

- [ ] Implement root task creation from a user chat request.
- [ ] Implement one-to-many task splitting.
- [ ] Implement dependency and waiting-state transitions.
- [ ] Implement task blocker creation and resume.
- [ ] Implement many-to-one task merge requests and merge completion.
- [ ] Implement reopen or corrective task creation after failed review.

## Phase 4: A2A Possession Integration

- [ ] Link `task.handoff_requested` to A2A pass creation.
- [ ] Include target task id and task summary in handoff packets.
- [ ] Update task owner only after pass start acknowledgement.
- [ ] Preserve existing owner when handoff is blocked, rejected, or timed out.
- [ ] Add anti-ping-pong checks for task handoffs.

## Phase 5: Task Map UI

- [ ] Add task graph view with fan-out and merge visualization.
- [ ] Add compact list mode for dense task graphs.
- [ ] Show owner, status, blockers, dependencies, and artifact count on each node.
- [ ] Add filters by owner, status, branch, and blocked state.
- [ ] Add task detail panel with linked chat messages and artifacts.

## Phase 6: User Controls and Policy

- [ ] Add user controls for split, merge, assign, reassign, pause, cancel, unblock, and summarize.
- [ ] Define which agent-proposed actions auto-apply.
- [ ] Require confirmation for high-impact merge, cancel, and cross-branch reassignment.
- [ ] Block dependency cycles and unsafe ownership steals.
- [ ] Record policy decisions in proof events.

## Phase 7: Documentation and Migration

- [ ] Update product UX documentation for group-chat task flow.
- [ ] Update technical documentation for Task Graph state authority.
- [ ] Update A2A Possession docs to reference task-linked handoff packets.
- [ ] Update System Control Plane docs for task-action proof events.
- [ ] Archive or deprecate conflicting chat-as-state assumptions.
