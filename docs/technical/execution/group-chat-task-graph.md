# Group Chat Task Graph Technical Design

> Status: Baseline implemented
> Date: 2026-05-15
> Source spec: `specs/group-chat-task-flow/`

## Summary

Group Chat Task Flow adds a task graph authority below the group-chat UX.

The goal is to support playful multi-agent conversation while keeping task state deterministic, replayable, and safe under split, parallel execution, dependency waiting, handoff, merge, review failure, and user intervention.

## Architecture Position

```text
Group Chat UX
  ↓ renders
ChatMessage + Task Capsules + Action Cards
  ↓ references
TaskAction Event Log
  ↓ reconstructs
Task Graph Authority
  ↓ coordinates with
A2A Possession + Dispatch Gateway + Proof Log
```

## Ownership Boundaries

### Task Graph Authority

Owns durable task facts:

- task node identity
- task status
- task owner
- task dependencies
- task blockers
- task artifacts
- split and merge lineage
- reopen history

### Chat Layer

Owns user-facing narrative:

- message bubbles
- agent personality
- task capsules
- task action cards
- navigation to task detail

It does not own durable task state.

### A2A Possession

The legacy compatibility Orchestrator still requires its invocation chain,
worklist, delivery cursor, audit log, and delivery outbox projections. A shared
database upgraded by a managed branch may omit those tables, so daemon startup
must repair the exact legacy projection schema atomically before rebuilding A2A
state; a missing optional projection must never take the project socket offline.

Owns collaboration transfer:

- current holder
- pass intent
- handoff packet
- receiver start confirmation

It does not directly mutate task ownership without a task action.

### Task Notification

Owns task-update awareness:

- related-agent recipient resolution
- persisted system chat notice
- conversation-room socket delivery
- explicit non-handoff metadata

It does not transfer possession or start an execution run.

Task notifications may remain visible to every relevant reviewer. Execution wakeups are narrower: when a TeamPack workflow names a `quality_gate`/`review_gate` owner, only that owner is started for an ordinary review. Advisory architecture reviewers require an explicit architecture-risk transition or handoff.

### Wakeup Layer

Owns minimal liveness nudges:

- detects explicit next actors from existing task facts
- persists a visible system “系统轻推” message
- emits `task.wakeup` to the conversation room
- dedupes repeated nudges for the same task, agent, and reason
- marks wakeups as `startsA2AHandoff: false`

It does not choose owners for unassigned work and does not replace agent-to-agent decisions.

### Dispatch Gateway

Owns execution delivery:

- dispatch intent normalization
- policy gates
- runtime health
- execution envelope
- lifecycle acknowledgement
- failure reason

## Event Sourcing Model

Task graph mutations should be represented as append-only `TaskAction` events.

```typescript
interface TaskActionRecord {
  id: string;
  conversationId: string;
  actorId: string;
  actorType: "user" | "agent" | "system";
  type: string;
  taskIds: string[];
  messageId?: string;
  passId?: string;
  possessionId?: string;
  proofEventId?: string;
  payloadJson: string;
  createdAt: string;
}
```

Graph state can be materialized into tables or derived cache, but the event log is the explainability backbone.

## Recommended Persistence

Initial implementation can use three layers:

1. Existing task table for current task cards and compatibility.
2. New task edge table for graph relationships.
3. New task action table for replay and audit.

Suggested tables:

```text
task_action
task_edge
task_artifact_ref
```

If existing task rows cannot represent all graph fields cleanly, add a `task_graph_node_meta` table rather than overloading chat metadata.

### Project-scoped task identity compatibility

Task identifiers written by agents in `.ath/TASKS.md` are project-local labels. Values such as `TASK-001` may therefore legitimately appear in many conversations and must never be treated as globally unique business identities.

The current compatibility table still uses `task.id` as a database-wide primary key. Until that schema is migrated to a composite identity, the TASKS projector applies these rules:

- if the local label is unused, or already belongs to the same conversation, preserve it for backward compatibility;
- if the label belongs to another conversation, store the new row under a deterministic, filesystem-safe conversation-scoped ID (`<conversationId>~<localTaskId>`);
- project dependency references, notifications, wakeups, invocations, and graph links through the same storage-ID mapping;
- never update or attach data to a task row owned by a different conversation.

The local label remains the authoring identifier in `TASKS.md`; the scoped storage ID is an internal compatibility detail. A later migration may replace this bridge with a composite `(conversation_id, local_task_id)` key, but it must preserve the same isolation behavior.

Any component that derives a filesystem path from a business ID must still encode the path segment independently. Storage IDs are not a substitute for a path-safety boundary.

## Current Implementation Status

- Migration version 18 creates `task_action`, `task_edge`, `task_artifact_ref`, and `chat_task_binding`, and backfills existing task rows as `task.created` actions.
- `src/server/repositories/task-graph-repo.ts` owns Task Graph persistence. Its public interface exposes domain writes, caller-used domain queries, and the aggregate `TaskGraphView`; per-row lookup helpers used only to finish an internal write are not public repository operations.
- `src/server/task-flow/group-chat-task-flow.ts` provides the first chat-driven domain service on top of the repository API.
- The repository treats `task_action` as the explainability event log and returns `TaskGraphView` as the first read model.
- Chat bindings are read through `TaskGraphView`; callers do not consume a parallel standalone binding-list interface.
- `task_edge` rejects cycles for `subtask_of`, `depends_on`, and `merged_into` relationships.
- Handoff intent is recorded by the A2A owner; Task Graph no longer exposes a parallel
  `recordHandoff*` mutation API.
- Once A2A has accepted the handoff, the Task owner command changes assignment and closes every
  active WorkAuthority for the previous assignee before new work is dispatched.
- `src/pages/api/task-graph.ts` exposes read and structured mutation APIs for create, split, block, resume, merge, reopen, and cancel.
- `src/components/task-hub/TaskCapsules.tsx` renders linked task capsules in the group-chat surface.
- `src/components/task-hub/TaskActionCard.tsx` renders task events as group-chat cards.
- `src/components/task-hub/useTaskGraph.ts` loads the server graph for both map and task detail views.
- `src/components/task-hub/TaskGraphMap.tsx` renders the compact task map used by the project right panel.
- `src/components/task-hub/TaskGraphTimeline.tsx` renders per-task actions, chat bindings, artifacts, and proof events.
- `src/components/task-hub/TaskGraphActionsPanel.tsx` provides structured task controls for split, merge, assign, block, resume, and cancel.
- `src/server/task-flow/task-graph-policy.ts` gates high-impact actions; blocked policy decisions are recorded in `control_proof_event`.
- `assignTask` records `task.claimed`; non-owner reassignment of an `in_progress` task requires confirmation.
- A2A `DispatchRequest` and compatibility dispatch events now carry `taskId` / `referencedTaskId`; `markDispatchStarted()` records `task.handoff_accepted`.
- `src/server/task-flow/task-notifications.ts` resolves task-update recipients without using A2A handoff rules.
- `src/server/task-flow/task-notification-publisher.ts` persists a system chat message and emits `task.notification` to the conversation room.
- `src/server/task-flow/task-wakeup.ts` resolves lightweight owner/reviewer/dependency wakeups without making scheduler decisions.
- `src/server/task-flow/task-notification-publisher.ts` also persists `task-wakeup` system messages and emits `task.wakeup` when an explicit next actor is already known.
- `task.updateStatus`, `task.update`, task tool invocations, structured task graph actions, and `TASKS.md` watcher sync publish task notifications after durable task state changes.
- `TASKS.md` projection treats file IDs as project-local and deterministically scopes collisions, so synchronizing one project cannot overwrite another project's task rows.
- First projection is also a state transition: when a newly discovered file row is already `in_review`, `done`, or another non-default state, the projector publishes the same notification/wakeup decision as an update from `ready`; it must not silently skip the quality gate merely because the row was new.
- Runtime admission may temporarily lead the file projection: while a task-correlated invocation is non-terminal, a stale file `todo/pending` row cannot regress an already confirmed `in_progress` task. Once that invocation is terminal, TASKS.md again has authority to reset the business status.
- The frontend consumes `task.notification` as a system group-chat message instead of dispatching another agent run.
- The frontend consumes `task.wakeup` as a system nudge; `ready` owners move to `in_progress`, and review wakeups dispatch reviewer roles through the review gate.
- Targeted tests live in `src/__tests__/server/repositories/task-graph-repo.test.ts`.
- Flow service tests live in `src/__tests__/server/task-flow/group-chat-task-flow.test.ts`.
- API and UI tests cover graph reads, structured mutations, capsules, action cards, and the task map.

## State Transition Rules

The managed Task lifecycle uses the same canonical status contract in the
repository, API, browser store, and UI:

```text
proposed -> ready | cancelled
ready -> in_progress | blocked | cancelled
in_progress -> blocked | in_review | cancelled
blocked -> ready | in_progress | cancelled
in_review -> done | in_progress | blocked | cancelled
done -> ready
cancelled -> (terminal)
```

Rules:

- `in_progress` requires an owner.
- A configured quality-gate reviewer may make a narrow decision on the specific `in_review` task that woke it: PASS advances that task to `done` with review evidence; changes requested return it to `in_progress`, while an external blocker advances it to `blocked` with a reason. This exception does not grant permission to edit the implementation, title, owner, or unrelated task rows.
- Reopening a completed task is the explicit `done -> ready` transition and should reference a review finding or corrective action.
- Terminal history is not deleted when a task is cancelled or reopened.

## Edge Rules

- `subtask_of`: decomposition relationship.
- `depends_on`: target cannot proceed until source reaches an acceptable state.
- `blocks`: source prevents target progress.
- `derived_from`: source inspired or generated target, without strict dependency.
- `merged_into`: source has been folded into target.
- `review_of`: review task validates target.
- `reopens`: new task reopens prior done or review work.

Validation:

- Block dependency cycles.
- Block merge cycles.
- Allow reopen edges only when they create a new corrective branch.
- Preserve source nodes after merge.

## A2A Handoff Integration

A task handoff is a two-system operation:

1. Task Graph records `task.handoff_requested`.
2. A2A Possession creates a pass and handoff packet.
3. Dispatch Gateway attempts delivery.
4. Receiver start acknowledgement arrives.
5. Task Graph records `task.handoff_accepted` and updates owner.

Failure behavior:

- `blocked`, `rejected`, `timeout`, or `error` handoffs do not change task owner.
- The failed pass reason is attached to the task action or blocker.
- The user can retry, reassign, or take the task back.

Current implementation notes:

- `task.handoff_requested` is recorded when a task-linked pass is created.
- `task.handoff_accepted` is recorded only after the receiving agent starts.
- The compatibility socket payload includes `referencedTaskId` so the UI can keep chat, task, and pass context aligned.

## Task Update Notification Integration

Task updates are informational unless the actor asks another agent to perform new work.

An informational `知会 @agent` is a chat-plane notification: it records awareness but never creates an A2A possession pass and never means execution has started. A new possession state such as `standby` is intentionally not introduced because awareness and execution have different authorities. Explicit execution language may appear before or after the target mention (for example `分派 @peach 做代码质量评审` or `把架构评审拆给 @dk`) and must be recognized as a handoff.

Flow:

1. A task mutation is applied through `/api/mutations`, `/api/task-graph`, an intercepted task tool, or `TASKS.md` watcher sync.
2. The previous and updated task rows are compared to determine changed fields.
3. Recipients are resolved from current owner, previous owner, coordinator roles, reviewer roles, and downstream dependency owners.
4. A system chat message is persisted with `startsA2AHandoff: false`.
5. `task.notification` is emitted to `io.to(conversationId)`.
6. The UI renders the notification in group chat without starting a new agent execution.

This prevents the previous failure mode where an agent updated task state but related agents had no visible awareness signal unless the agent also attempted an A2A pass.

Dependency wakeups have one producer: `TaskNotificationPublisher`. It resolves downstream relations from both normalized Task Graph edges and compatibility `task.dependencies` / TASKS.md `Depends` values, submits the server Harness once, and emits the resulting handled event for rendering. The file watcher must not emit a second legacy `task.wakeup`.

For an ordinary quality gate, the `in_review` transition is also the complete execution request. The implementer must not repeat the same request as an A2A `@reviewer` handoff after updating the task. A second pass is allowed only when the platform reports that the configured gate wakeup failed, or when a distinct risk-specific reviewer is explicitly required.

`TaskWakeupRouter` treats that transition as a durable request: after confirming the Task is still `in_review`, it idempotently creates the one `code_review` Gate for the Task's current revision before dispatch. The event revision may be older because review-time metadata edits can advance the Task revision without leaving review. A current `task.updated` supersedes older open Gates, queued reviewer work and active reviewer authority before dispatching the new revision. Stale-authority reconciliation runs on every replay, even when the current Gate already exists, and shares one immediate database transaction with current-Gate lookup/creation. Task-scoped review WorkContract issuance revalidates under its own immediate transaction that the Task is still `in_review`, the referenced Gate is open, and its artifact revision equals the Task revision; therefore contract issuance and supersession serialize instead of leaving a late stale reviewer authority. Gate outcome admission additionally enforces the frozen evaluator allow-list and self-review prohibition before consuming the terminal slot. A new handler version intentionally replays historical `task.in_review` facts, so Tasks stranded by an older missing-Gate implementation self-heal after restart. If an active Delivery owns the Project, the router leaves reviewer dispatch to the Delivery control plane consuming `gate.requested`; otherwise it writes the reviewer request through `CollaborationKernel`/AgentInbox.

If an agent writes "通知 @agent" or "@agent 已完成/已写入 TASKS.md" in narrative output, A2A treats it as non-actionable awareness and emits a neutral scoped group-chat notice instead of an error-style handoff block. To wake another agent, the output must include an explicit execution request such as "`@agent 请评审 TASK-003`" or "`@agent 需要验证 TASK-010`".

The same boundary is injected into agent prompts through `buildCollaborationLayer()`. This keeps the primary behavior in the agent's instructions: status changes use Task Graph / `TASKS.md`, notification-style mentions stay in group chat, and A2A is reserved for explicit execution requests.

The intent detector accepts task-flow verbs agents naturally use for execution handoff, including 启动, 执行, 完成, 认领, 推进, plus English implementation verbs such as fix and update. Status summaries such as "已完成" or "已写入 TASKS.md" remain informational and must not wake another agent.

## Wakeup Layer Integration

Wakeups sit between task notifications and execution dispatch.

Flow:

1. A task mutation or `TASKS.md` sync changes a durable task fact.
2. The notification publisher resolves recipients and then asks the Wakeup Layer whether the next actor is explicit.
3. Wakeup Layer emits only these cases:
   - `owner_ready`: a `ready` task has an owner and all dependencies are satisfied.
   - `review_requested`: a task enters `in_review` and reviewer roles are known.
   - `dependency_resolved`: a dependency task reaches `done`, unblocking downstream `ready` owners.
4. A `task-wakeup` system message is persisted with `startsA2AHandoff: false` and `startsDispatch: true`.
5. `task.wakeup` is emitted to `io.to(conversationId)`.
6. The server-side Agent Inbox and Harness start the known next actor; busy,
   retry and recovery remain in the service. The browser only renders the wakeup.

This is intentionally a narrow server-side scheduler, not a general planner. If
there is no explicit owner or reviewer, the framework does not guess. It only
leaves a visible notification for the planner/coordinator to decide.

### Coordinator planning contract

The planner/coordinator decision is itself governed by an immutable WorkContract. When planning admission finds one or more unassigned `proposed` or `ready` Tasks, the contract freezes those IDs as a `task_graph_first` coordination obligation. The Coordinator must inspect the goal, acceptance criteria, current graph and Project members, then submit one structured Task Graph proposal that includes and assigns every frozen Task. Multi-step work should add bounded nodes, dependencies and review/verification intents where they materially define execution order or closure.

A narrative plan, chat mention or direct A2A handoff is not a substitute for this proposal. The accepted-Outcome owner verifies coverage before any mutation, commits the complete graph in one transaction, promotes **every assigned Task in an accepted `task_graph_first` graph** from `proposed` to `ready`, and then dispatches every dependency-ready assigned Task through the Collaboration Kernel. `proposed` means the assignment or plan is not yet accepted; it never means “accepted but waiting for dependencies”. Dependency satisfaction is an orthogonal scheduling predicate over a ready Task.

The same Outcome owner is the activation and recovery seam. A versioned durable handler replays historical accepted graph Outcomes after upgrade. When their commit already exists, it does not recommit or rewrite graph structure: it activates only Tasks that are still `proposed`, still assigned as committed, still in the same Project, and whose latest owning commit is that Outcome. It then reuses the normal idempotent dispatch path for dependency-ready Tasks. Later replans, active/terminal Tasks and Tasks owned by a newer commit are left untouched. This is a reconciliation loop over desired accepted state and observed Task state, not a one-shot event-success assumption.

Dispatch liveness also includes the queue gap before an ExecutionEnvelope or Invocation exists. Autonomy Guard therefore treats Task-correlated Agent Inbox rows in `enqueued`, `released` or `claimed` as an active dispatch path. A ready Task waiting behind the same Agent lane is not “idle” and must not receive a second `owner_ready` request from the recovery sweep.

Therefore the Coordinator coordinates and replans; it does not implement the work, duplicate scheduler dispatch, or claim that another Agent started without a durable receipt. Truly missing, non-inferable product choices may still exit through a human-decision request, and external blockers may exit through a structured blocker. A coordinator outcome-recovery Invocation re-evaluates remaining unassigned Tasks and retains the same Task Graph-first exits, so failure to submit the first structured result cannot reopen a direct-handoff bypass.

Wakeup copy uses “系统轻推” so users understand this as a gentle nudge, not hidden orchestration.

Automatic wakeup applies only to an already-modeled Task Graph node whose owner/reviewer and dependency state are known. A chat mention, an unresolved external reference, or a task that has not been created cannot rely on dependency wakeup and must not be described as “the system will schedule it automatically”.

## Chat Binding

Chat messages should reference task facts without becoming the facts.

```typescript
interface ChatTaskBinding {
  messageId: string;
  taskIds: string[];
  actionIds: string[];
}
```

Rendering rules:

- `taskIds` render as task capsules.
- `actionIds` render as task event cards.
- A message can reference multiple tasks during split or merge.
- A casual mention can reference a task without changing it.

## Concurrency and Safety

The graph authority must protect against:

- two agents claiming the same running task
- owner changes before handoff start acknowledgement
- dependency cycles
- merge cycles
- hidden overwrite conflicts
- ping-pong handoffs
- stale chat messages mutating current task state

Minimum gates:

- `OwnershipGate`: only owner, user, coordinator, or system policy can mutate active task state.
- `GraphGate`: blocks invalid edges and cycles.
- `PossessionGate`: validates A2A holder before handoff.
- `ConfirmationGate`: requires user confirmation for high-impact operations.
- `ProofGate`: records policy and execution-relevant decisions.

## Materialized Views

Useful read models:

- `TaskGraphView`: nodes and edges for the map.
- `TaskInboxView`: ready or blocked tasks grouped by owner.
- `TaskBranchView`: subtree under one root.
- `TaskMergeView`: source tasks and integration target.
- `TaskTimelineView`: task actions plus linked chat messages and proof events.

## Migration Notes

- Existing tasks remain valid task nodes.
- The Task repository, API, browser store, socket projection, and platform tool
  schemas consume the canonical managed lifecycle directly. Unknown states fail
  at their ingress and are never re-projected as another internal lifecycle.
- The browser, `/api/state`, socket task sync, and Task repository now share the
  managed status vocabulary and legal transition interface. Compatibility for
  historical TASKS.md labels remains at server intake; managed state is no
  longer projected into a second browser lifecycle.
- Migration version 18 creates a synthetic `task.created` action for each pre-existing task using `task-action-migrated-<taskId>`.
- Existing chat messages can be backfilled with empty task/action bindings.
- Existing A2A pass metadata can be linked opportunistically when chain/pass ids are present.
- Do not infer historical graph edges from old casual chat text.

## Verification

The first implementation should include tests for:

- reconstructing graph from actions
- one-to-many split
- dependency wait and resume
- handoff success and failed handoff owner preservation
- many-to-one merge
- review failure reopen
- cycle rejection
- chat message binding without state mutation
- repeated local task labels across conversations without cross-project mutation
- first projection of an `in_review` task dispatching the configured review gate
- an implementer entering `in_review` ending its turn without a redundant A2A pass to the configured review-gate owner
- reviewer PASS on an explicitly assigned `in_review` task resolving downstream dependencies
