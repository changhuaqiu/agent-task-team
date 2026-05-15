# Group Chat Task Flow

> Status: Draft for implementation
> Date: 2026-05-15
> Related specs: `a2a-possession-contract/`, `system-control-plane/`, `team-runtime-contract/`

## Problem Statement

The product wants Agent collaboration to feel like a lively team group chat, not a dry queue or hidden orchestration system.

However, a pure chat model cannot safely support complex task flow:

- one user request can split into many parallel tasks
- parallel tasks can depend on each other
- tasks can be handed off between agents
- blocked tasks can later resume
- several tasks can merge into one integration or review task
- agents may discuss work without changing task state
- users need to understand who owns what without reading every message

The root design challenge is to make group chat fun while keeping task state deterministic.

## Product Principle

The user experience is a group chat.

The source of truth is a task graph.

Chat messages create presence, personality, and momentum. Task actions create state.

The system must never infer durable task state from casual chat text alone. Durable state changes require a structured action event.

## Goals

- Preserve a playful multi-agent group-chat experience.
- Support split, parallel work, dependency waiting, handoff, merge, review, block, resume, and reopen flows.
- Make every task answerable: owner, state, blockers, dependencies, artifacts, and next step.
- Keep the chat readable by rendering task changes as compact cards, capsules, and timeline moments.
- Connect A2A possession handoffs to task ownership and task transitions.
- Keep Task Graph as the state authority and A2A as the collaboration handoff authority.
- Allow the user to interrupt, reassign, merge, split, pause, or summarize work at any time.

## Non-Goals

- This spec does not turn every chat message into a task.
- This spec does not replace Team Runtime, A2A Possession, or System Control Plane.
- This spec does not require autonomous unlimited agent spawning.
- This spec does not expose internal terms such as runtime, worklist, routing, provider, or chain in the primary UX.
- This spec does not make chat transcript ordering the only source of task truth.

## Core UX Model

The primary workspace has two synchronized surfaces:

1. **Group Chat Stage**
   - Shows users and agents talking in one shared room.
   - Renders important task actions inline as task capsules or event cards.
   - Allows lightweight agent personality, short reactions, and progress narration.

2. **Task Map**
   - Shows the durable task graph.
   - Displays task nodes, dependencies, branches, merges, owners, blockers, and artifacts.
   - Lets the user inspect or manipulate task structure without parsing the full chat.

The chat is the theater. The task map is the whiteboard.

## Core Concepts

### Task Graph

`TaskGraph` is the source of truth for multi-task collaboration in a conversation.

```typescript
interface TaskGraph {
  id: string;
  conversationId: string;
  rootTaskIds: string[];
  nodes: TaskNode[];
  edges: TaskEdge[];
  updatedAt: string;
}
```

Rules:

- A conversation may have one active task graph.
- The graph may contain multiple roots if the user starts independent workstreams.
- Nodes and edges are mutated only by structured task actions.
- Chat messages may reference nodes, but message text is not the state authority.

### Task Node

`TaskNode` represents one unit of work that can be owned, discussed, executed, blocked, reviewed, merged, or completed.

```typescript
interface TaskNode {
  id: string;
  conversationId: string;
  title: string;
  description?: string;
  status:
    | 'created'
    | 'planned'
    | 'ready'
    | 'claimed'
    | 'running'
    | 'waiting'
    | 'blocked'
    | 'review'
    | 'merged'
    | 'done'
    | 'reopened'
    | 'cancelled';
  ownerAgentId?: string;
  parentTaskId?: string;
  originActionId?: string;
  currentPossessionId?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  blocker?: TaskBlocker;
  artifactRefs: ArtifactRef[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

Rules:

- A node has at most one current owner.
- A node can be unowned when it is planned, ready, waiting, merged, done, cancelled, or blocked by missing input.
- A running node must have an owner agent or user.
- A merged node preserves history and points to the merge target through an edge.
- A reopened node must create a new action explaining why completed work is no longer accepted.

### Task Edge

`TaskEdge` describes the relationship between task nodes.

```typescript
interface TaskEdge {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  type:
    | 'subtask_of'
    | 'depends_on'
    | 'blocks'
    | 'derived_from'
    | 'merged_into'
    | 'review_of'
    | 'reopens';
  createdByActionId: string;
  createdAt: string;
}
```

Rules:

- `subtask_of` is used for decomposition.
- `depends_on` is used when one task cannot proceed without another task's output.
- `merged_into` never deletes the source task.
- Cycles are blocked unless the edge type is `reopens` and points to a new corrective task.

### Task Action

`TaskAction` is the durable event created when a user or agent changes the graph.

```typescript
type TaskActionType =
  | 'task.created'
  | 'task.split'
  | 'task.claimed'
  | 'task.handoff_requested'
  | 'task.handoff_accepted'
  | 'task.status_changed'
  | 'task.blocked'
  | 'task.resumed'
  | 'task.artifact_attached'
  | 'task.review_requested'
  | 'task.merge_requested'
  | 'task.merged'
  | 'task.reopened'
  | 'task.cancelled';

interface TaskAction {
  id: string;
  conversationId: string;
  actorId: string;
  actorType: 'user' | 'agent' | 'system';
  type: TaskActionType;
  taskIds: string[];
  messageId?: string;
  passId?: string;
  possessionId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

Rules:

- Every graph mutation has a corresponding `TaskAction`.
- A chat message may carry zero, one, or multiple task actions.
- The UI may render task actions as group-chat cards.
- The event log must be replayable to reconstruct the graph.

### Chat Message

`ChatMessage` remains the user-facing narrative layer.

```typescript
interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: 'user' | 'agent' | 'system';
  content: string;
  referencedTaskIds: string[];
  actionIds: string[];
  createdAt: string;
}
```

Rules:

- Chat can be casual, playful, and expressive.
- Task capsules appear when `referencedTaskIds` is non-empty.
- Action cards appear when `actionIds` is non-empty.
- Casual mentions do not wake agents or mutate task state.

### Handoff Packet

A handoff packet connects A2A possession to task flow.

It must include:

- target task id
- current owner
- next owner
- requested action
- task summary
- current blockers
- relevant artifacts
- open questions
- constraints and forbidden behaviors

Rules:

- A task handoff must be linked to an A2A pass.
- The receiver becomes task owner only after the pass is accepted and execution starts.
- Failed handoff preserves the existing owner unless the user explicitly reassigns.

### Artifact

`ArtifactRef` points to evidence or output.

```typescript
interface ArtifactRef {
  id: string;
  kind: 'file' | 'diff' | 'test' | 'doc' | 'design' | 'url' | 'log' | 'proof';
  label: string;
  path?: string;
  url?: string;
  proofEventId?: string;
  createdByActionId: string;
}
```

Rules:

- Artifacts are references, not pasted blobs.
- Completed or review-ready tasks should have at least one artifact or explicit no-artifact reason.

## Flow Patterns

### 1. User Starts Work

```text
user message
  -> chat message
  -> task.created(root)
  -> coordinator/planner claims root task
  -> task.status_changed(planned or running)
```

UX:

- The chat shows the user's request.
- The system creates a root task capsule.
- The current owner is visible on the capsule.

### 2. One Task Splits Into Many

```text
owner proposes split
  -> task.split
  -> child task nodes created
  -> subtask_of edges created
  -> dependency edges created when needed
```

UX:

- The chat shows a "task split" card.
- The task map fans out from the root.
- Each child task can be claimed independently.

### 3. Parallel Execution

```text
ready child tasks
  -> agents claim disjoint tasks
  -> each task enters running
  -> artifacts attach as work completes
```

UX:

- The group chat shows multiple agents working, but each message carries task capsules.
- The task map shows several running nodes.
- File or resource conflicts are shown as blockers, not hidden chat confusion.

### 4. Dependency Waiting

```text
task B depends_on task A
  -> B stays waiting until A is review or done
  -> B resumes when dependency condition is satisfied
```

UX:

- B's card says "Waiting for A".
- The chat may show a short explanation and next expected unblock.

### 5. Agent Handoff

```text
current owner requests handoff
  -> task.handoff_requested
  -> A2A pass created
  -> handoff packet sent
  -> pass accepted and started
  -> task.handoff_accepted
  -> owner changes
```

UX:

- The chat shows "Agent A handed #T3 to Agent B".
- The task capsule owner changes only after the receiver starts.
- If handoff fails, the card shows why and what the user can do.

### 6. Task Blocks and Resumes

```text
owner cannot proceed
  -> task.blocked(reason)
  -> blocker visible
  -> user or agent resolves blocker
  -> task.resumed
```

UX:

- The group chat shows a blocker card with a practical next step.
- The task map highlights the blocked node and downstream waiting tasks.

### 7. Many Tasks Merge Into One

```text
tasks A, B, C are review-ready
  -> task.merge_requested
  -> integration task M created or selected
  -> merged_into edges A/B/C -> M
  -> task.merged for A/B/C
  -> M enters ready/running/review
```

UX:

- The chat shows a "merge proposal" card.
- The task map collapses completed branches into an integration node.
- The user can inspect source tasks from the merged node.

### 8. Review Fails and Reopens Work

```text
review task finds issue
  -> task.reopened or corrective task created
  -> reopens edge links review finding to new work
  -> original task history remains immutable
```

UX:

- The chat shows "Review found an issue" with a new fix task.
- Completed history is not overwritten.

## State Authority Boundaries

### Task Graph Owns

- task nodes
- task edges
- task status
- task owner
- task blockers
- task artifacts
- split and merge history

### Group Chat Owns

- narrative messages
- user-facing personality
- lightweight progress narration
- task and action rendering

### A2A Possession Owns

- current collaboration holder
- pass intent
- handoff packet
- receiver start confirmation
- anti-echo and non-holder rules

### System Control Plane Owns

- dispatch authorization
- runtime health
- execution envelope
- proof log
- lifecycle acknowledgement
- delivery failure reason

## User Controls

The user must be able to:

- create a root task from chat
- ask agents to split a task
- manually split or merge tasks
- assign or reassign a task
- pause a task
- cancel a task
- unblock or mark blocker unresolved
- force a handoff
- take a task back
- request summary for a task, branch, or whole graph
- inspect artifacts and proof timeline

## UI Requirements

### Group Chat

- Render normal messages as conversational bubbles.
- Render task references as compact capsules such as `#T12 A2A 群聊协作闭环`.
- Render structured task actions as event cards.
- Keep playful agent copy allowed, but keep task cards precise.
- Collapse noisy execution logs behind "details".

### Task Map

- Show fan-out and merge visually.
- Show owner, status, blockers, dependency count, and artifact count.
- Highlight the currently active task and active holder.
- Support filtering by owner, status, branch, and blocked state.
- Support a compact list mode for dense projects.

### Task Detail

- Show task summary, owner, state, dependencies, downstream tasks, artifacts, recent actions, and linked chat messages.
- Show "what happens next" in user language.
- Provide controls appropriate to the task state.

## Safety and Governance

- Task mutations require structured actions.
- Agents may propose split or merge actions; the system may auto-apply low-risk actions if policy allows.
- High-impact merge, cancel, or cross-branch reassignment should be confirmable by the user or a designated coordinator.
- Agents cannot silently take ownership of tasks already owned by another active agent.
- The system must prevent dependency cycles and ping-pong handoffs.
- Conflict with another active task should create a blocker or coordination prompt, not hidden overwrites.

## Implementation Phases

### Phase 1: Specification and Data Model

- Define Task Graph schema and action event model.
- Map existing task and chat records into the new contract.
- Add graph reconstruction tests.

### Phase 2: Chat Rendering Contract

- Add task capsules and action cards to chat.
- Keep chat playful while moving state changes into structured actions.
- Add task split and merge cards.

### Phase 3: A2A Integration

- Link task handoff actions to A2A pass ids.
- Attach handoff packets to target tasks.
- Change task owner only after receiver start acknowledgement.

### Phase 4: Task Map

- Add fan-out, dependency, blocker, and merge visualization.
- Add compact task list fallback.

### Phase 5: Control Plane and Proof

- Route task-affecting execution through Dispatch Gateway.
- Attach proof and artifact refs to task actions.
- Surface structured failure reasons in task cards.

### Phase 6: Autonomy Policy

- Define which actions agents can auto-apply.
- Define which actions require user confirmation.
- Add policy tests for dangerous graph mutations.

## Acceptance Criteria

- A user can start one request and see it split into multiple visible tasks.
- Agents can discuss tasks in group chat without mutating state accidentally.
- Every state change is backed by a structured task action.
- Parallel tasks show separate owners and statuses.
- Dependency waiting is visible and explainable.
- A2A handoff changes task ownership only after receiver start confirmation.
- Blocked handoffs do not silently change owner.
- Multiple completed branches can merge into an integration or review task.
- A failed review creates a reopen or corrective task without deleting history.
- The user can inspect a task from either chat or task map and see the same facts.
