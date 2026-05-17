# Group Chat Task Flow Tasks

> Status: Implemented baseline
> Date: 2026-05-15

## Phase 1: Contract and Persistence

- [x] Define `TaskGraph`, `TaskNode`, `TaskEdge`, `TaskAction`, and `ArtifactRef` types.
- [x] Decide whether to extend existing task tables or add graph-specific tables.
- [x] Add durable task action event storage.
- [x] Add graph reconstruction from task action events.
- [x] Add migration path for existing conversation tasks.
- [x] Add repository tests for split, dependency, and merge flows.
- [x] Add repository tests for reopen flows.
- [x] Add repository tests for cancel flows.

## Phase 2: Chat and Task Binding

- [x] Extend chat messages with referenced task ids and action ids.
- [x] Render task capsules inside group chat messages.
- [x] Render task action cards for split, claim, handoff, block, merge, review, and reopen events.
- [x] Collapse verbose runtime logs behind details.
- [x] Add message-to-task detail navigation.
- [x] Add read-only Task Graph API for conversation graph views.

## Phase 3: Multi-Task Flow

- [x] Implement root task creation from a user chat request.
- [x] Implement one-to-many task splitting.
- [x] Implement dependency edge creation for split task flows.
- [x] Implement task blocker creation and resume.
- [x] Implement many-to-one task merge completion.
- [x] Implement reopen or corrective task creation after failed review.

## Phase 4: A2A Possession Integration

- [x] Link `task.handoff_requested` to A2A pass creation.
- [x] Include target task id and task summary in handoff packets.
- [x] Update task owner only after pass start acknowledgement.
- [x] Preserve existing owner when handoff is blocked, rejected, or timed out.
- [x] Add anti-ping-pong checks for task handoffs.

## Phase 5: Task Map UI

- [x] Add task graph view with fan-out and merge visualization.
- [x] Add compact list mode for dense task graphs.
- [x] Show owner, status, blockers, dependencies, and artifact count on each node.
- [x] Add filters by owner, status, branch, and blocked state.
- [x] Add task detail panel with linked chat messages and artifacts.
- [x] Add task detail timeline with task actions, chat bindings, artifacts, and proof events.

## Phase 6: User Controls and Policy

- [x] Add user controls for split, merge, assign, reassign, pause, cancel, unblock, and summarize.
- [x] Define which agent-proposed actions auto-apply.
- [x] Require confirmation for high-impact merge, cancel, and cross-branch reassignment.
- [x] Block dependency cycles and unsafe ownership steals.
- [x] Record policy decisions in proof events.

## Phase 6.5: Task Awareness Notifications

- [x] Add a Task Notification contract separate from A2A possession handoff.
- [x] Resolve related recipients from owner, previous owner, coordinator, reviewer, and dependency owners.
- [x] Persist notifications as system chat messages.
- [x] Emit `task.notification` to the conversation room.
- [x] Publish notifications from task mutation APIs, structured task graph actions, and `TASKS.md` watcher sync.
- [x] Update agent guidance so status updates use Task Notification instead of A2A handoff.

## Phase 6.6: Wakeup Layer

- [x] Add a Task Wakeup contract separate from A2A possession handoff and task notifications.
- [x] Wake explicit pending owners when dependencies are satisfied.
- [x] Wake reviewer roles when tasks enter review.
- [x] Wake downstream owners when dependency tasks complete.
- [x] Persist and emit wakeups as visible group-chat system nudges.
- [x] Add idempotency to avoid repeated wakeups for the same task/agent/reason.
- [x] Update agent guidance with self-start rules for assigned work and review work.

## Phase 7: Documentation and Migration

- [x] Update product UX documentation for group-chat task flow.
- [x] Update technical documentation for Task Graph state authority.
- [x] Update A2A Possession docs to reference task-linked handoff packets.
- [x] Update System Control Plane docs for task-action proof events.
- [x] Archive or deprecate conflicting chat-as-state assumptions.
