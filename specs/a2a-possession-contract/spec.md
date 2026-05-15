# A2A Possession Contract

> Status: Implementation started
> Date: 2026-05-11
> Supersedes: `specs/a2a-v2/README.md` coordination semantics

## Problem Statement

The current A2A model treats cross-agent collaboration as message routing:

- A user or agent mentions `@agent`.
- The system scans the message.
- The orchestrator records a work item.
- A client or daemon tries to start the target.

This looks simple, but it causes collaboration confusion:

- A mention can be interpreted as a dispatch even when the speaker only referenced a person.
- Several agents can wake each other without clear control ownership.
- A chain can mark work as `executing` before an agent process actually starts.
- Long or multi-turn agent conversations are split into noisy fragments instead of one clear handoff.
- Timeout messages hide the real phase that failed: offer, start, execution, policy, roster, or missing runtime.
- The user cannot tell whether a failure was caused by role mismatch, communication policy, queueing, startup failure, or model runtime failure.

The root design flaw is that A2A is currently modeled as a message pipe. Real collaboration should be modeled as control transfer.

## Product Metaphor

A2A collaboration is a ball-passing workflow.

- The holder has the ball.
- Only the holder can decide the next pass.
- A pass carries a prepared handoff packet.
- The receiver becomes the new holder only after the pass is accepted and execution starts.
- Non-holders may be mentioned, but they do not wake automatically.

This is closer to how expert teams work: a person finishes a coherent unit of thought, summarizes the situation, and hands it to the next person with a specific ask.

## Goals

- Make collaboration deterministic and easy to explain.
- Prevent false `executing` chains and fake 120s A2A timeouts.
- Replace per-message `@mention` dispatch with explicit possession handoff.
- Merge multi-turn holder activity into one handoff packet.
- Separate failure reasons by phase.
- Keep Team Runtime Contract as the roster, role, account, skill, workflow, and communication policy source.
- Keep TASKS.md or the project task system as the source of project state, not A2A messages.

## Non-Goals

- A2A is not a broadcast channel.
- A2A is not a status sync mechanism.
- A2A does not replace task assignment, Kanban status, or review gates.
- A2A does not let any agent wake any other agent at any time.
- A2A does not require every mention to become a pass.

## Core Concepts

### Chain

A chain is one collaboration episode rooted in a user turn or scheduled trigger.

```typescript
interface A2AChain {
  id: string;
  conversationId: string;
  rootTriggerType: 'user_turn' | 'scheduled' | 'system';
  rootTriggerId: string;
  status: 'active' | 'completed' | 'aborted' | 'timeout';
  currentHolderId: string; // user or runtime agent id
  createdAt: string;
  completedAt?: string;
  config: A2AChainConfig;
}
```

Chain rules:

- A chain has exactly one current holder.
- A new user turn may either continue the active possession, interrupt it, or create a new chain.
- A completed or aborted chain never receives new passes.
- Chain status is derived from possessions and passes, not from raw chat messages.

### Possession

A possession is a holder's coherent period of control.

```typescript
interface A2APossession {
  id: string;
  chainId: string;
  holderId: string;
  holderType: 'user' | 'agent' | 'system';
  status:
    | 'open'
    | 'handoff_drafted'
    | 'handoff_offered'
    | 'handoff_accepted'
    | 'handoff_started'
    | 'completed'
    | 'aborted'
    | 'timeout';
  startedAt: string;
  completedAt?: string;
  summary?: string;
}
```

Possession rules:

- Only the open possession holder can pass the ball.
- All holder text, tool use, tool results, system feedback, and relevant user follow-ups during the possession form the possession buffer.
- The buffer is not forwarded as raw chat history.
- The possession ends when the holder completes, aborts, or successfully passes the ball.
- A holder can complete without passing.

### Pass

A pass is an explicit handoff from the current holder to a target runtime agent.

```typescript
interface A2APass {
  id: string;
  chainId: string;
  fromPossessionId: string;
  fromHolderId: string;
  toAgentId: string;
  status:
    | 'drafted'
    | 'validated'
    | 'offered'
    | 'accepted'
    | 'starting'
    | 'started'
    | 'completed'
    | 'blocked'
    | 'rejected'
    | 'timeout'
    | 'error';
  intent: 'delegate' | 'review' | 'answer' | 'verify' | 'implement' | 'plan';
  reason?: string;
  handoffPacketId?: string;
  createdAt: string;
  updatedAt: string;
}
```

Pass rules:

- A pass must be created by the current holder.
- A pass must target a runtime roster member.
- A pass must pass communication policy before it can be offered.
- A pass must not become `started` until the execution adapter confirms an agent process/session has started.
- A pass failure must preserve its phase-specific reason.

### Handoff Packet

A handoff packet is the compact work package sent to the next holder.

```typescript
interface A2AHandoffPacket {
  id: string;
  chainId: string;
  passId: string;
  fromHolderId: string;
  toAgentId: string;
  title: string;
  requestedAction: string;
  possessionSummary: string;
  relevantDecisions: string[];
  evidenceRefs: Array<{ label: string; path?: string; taskId?: string; url?: string }>;
  constraints: string[];
  openQuestions: string[];
  forbiddenBehaviors: string[];
  sourceMessageIds: string[];
  createdAt: string;
}
```

Handoff packet rules:

- It is generated from the possession buffer, not from the full conversation.
- It must include a concrete requested action.
- It must include enough context for the receiver to act without reading every prior message.
- It must include anti-echo guidance: do not reply only to acknowledge receipt, and do not pass back to the sender for courtesy.
- It must reference TASKS.md or task ids for project state instead of embedding stale status.

## Holder Eligibility

Only these actors can hold the ball:

- `user`
- runtime agent in the current Team Runtime roster
- `system` for explicit platform-controlled transitions

Non-holder behavior:

- Non-holder agent output cannot create passes.
- Non-holder mentions are logged as notes or diagnostics.
- A user can interrupt and take possession back.
- A user can explicitly force a new holder; this ends or aborts the current possession.

## Pass Intent

`@agent` alone is not a pass.

Pass detection must require an actionable handoff pattern:

- `@dk 请审查...`
- `交给 @coder 实现...`
- `需要 @reviewer 检查...`
- `handoff to @agent: ...`

Non-pass mention examples:

- `等 @dk 后面看看`
- `这和 @coder 上次说的一样`
- `不要再 @reviewer 确认收到`
- code blocks or quoted logs containing mentions

If the parser is uncertain, it must not wake an agent. It should record a diagnostic and leave the holder unchanged.

## State Machine

### User Starts Chain

```text
user_turn
  -> chain.active
  -> possession.open(holder=user)
```

User can:

- complete the turn with no pass
- pass to a runtime agent
- ask the current holder a follow-up
- interrupt and take the ball back

### Direct User Pass

```text
user possession
  -> pass.drafted
  -> pass.validated
  -> pass.offered
  -> pass.accepted
  -> pass.starting
  -> pass.started
  -> possession.open(holder=targetAgent)
```

Direct user pass may have looser communication policy than agent-originated pass, but it still must validate roster, runtime profile, account, and execution availability.

### Agent Pass

```text
agent possession completes or requests handoff
  -> possession buffer summarized
  -> handoff packet created
  -> pass.drafted
  -> pass.validated
  -> pass.offered
  -> pass.accepted
  -> pass.starting
  -> pass.started
  -> previous possession.completed
  -> new possession.open(holder=targetAgent)
```

### Completion Without Pass

```text
holder possession
  -> holder reports final result
  -> possession.completed
  -> chain.completed
```

### Blocked Pass

```text
pass.drafted
  -> validation fails
  -> pass.blocked
  -> possession remains with current holder or completes with blocked outcome
```

Blocked reasons:

- `unknown_target`
- `target_not_in_roster`
- `communication_policy`
- `missing_runtime_profile`
- `missing_account`
- `target_busy`
- `budget_exceeded`
- `duplicate_pass`
- `loop_risk`

## Timeout Model

Timeouts must be phase-specific.

```typescript
interface A2ATimeouts {
  offerTimeoutMs: number;    // server offered pass, client did not acknowledge
  startTimeoutMs: number;    // client accepted, process/session did not start
  runTimeoutMs: number;      // process/session started, possession did not complete
  holderIdleTimeoutMs: number; // holder stays open without pass/complete
}
```

User-facing messages:

- `offer_timeout`: "A2A 转交未被执行端确认"
- `start_timeout`: "A2A 转交已接受但目标角色未启动"
- `run_timeout`: "目标角色执行超时"
- `holder_idle_timeout`: "当前持球者长时间未继续或交接"
- `target_not_in_roster`: "当前团队没有可接收 @agent 的角色"
- `communication_policy`: "团队协作规则阻止了这次转交"
- `missing_runtime_profile`: "请先为该角色绑定可用账号或执行引擎"

The generic message "A2A 链超时终止 (120s)" is deprecated.

## Event Protocol

### Client to Server

```typescript
type ClientA2AEvent =
  | {
      type: 'user_turn_created';
      conversationId: string;
      messageId: string;
      content: string;
    }
  | {
      type: 'pass_offer_ack';
      passId: string;
      status: 'accepted' | 'rejected';
      reason?: string;
    }
  | {
      type: 'agent_starting';
      passId: string;
      agentId: string;
      runId: string;
    }
  | {
      type: 'agent_started';
      passId: string;
      agentId: string;
      runId: string;
      sessionId?: string;
    }
  | {
      type: 'agent_event';
      passId?: string;
      possessionId?: string;
      agentId: string;
      eventType: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
      content?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'agent_completed';
      passId: string;
      possessionId: string;
      agentId: string;
      outcome: 'success' | 'error' | 'timeout' | 'cancelled';
      finalText?: string;
    };
```

### Server to Client

```typescript
type ServerA2AEvent =
  | {
      type: 'pass_offer';
      passId: string;
      conversationId: string;
      targetAgentId: string;
      handoffPacket: A2AHandoffPacket;
    }
  | {
      type: 'pass_blocked';
      passId?: string;
      conversationId: string;
      fromHolderId: string;
      targetAgentId?: string;
      reasonCode: string;
      message: string;
    }
  | {
      type: 'possession_changed';
      chainId: string;
      possessionId: string;
      holderId: string;
      holderType: 'user' | 'agent' | 'system';
    }
  | {
      type: 'chain_completed';
      chainId: string;
      conversationId: string;
      outcome: 'success' | 'aborted' | 'timeout';
    };
```

## Execution Adapter Contract

The client or daemon execution adapter must report each phase truthfully.

It may not:

- mark a pass as accepted if no runtime profile exists
- mark a pass as started before process/session start
- swallow startup errors
- convert startup failures into chain timeouts

It must:

- reject missing account/runtime before `accepted`
- report process spawn failure as `start_error`
- report model/runtime completion as `agent_completed`
- include `runId` and `sessionId` when available

## Possession Buffer

The possession buffer collects:

- holder text output
- tool use summaries
- tool result summaries
- user follow-up messages addressed to the holder
- system block messages relevant to the holder
- task ids and file references touched during possession

The buffer excludes:

- unrelated global chat history
- old completed chain messages
- non-holder agent chatter
- raw terminal noise unless needed as evidence

## Handoff Packet Generation

The first implementation may use deterministic extraction:

- requested action: content after the pass mention
- possession summary: last holder final text plus tool summary
- evidence refs: task ids, files, and links explicitly mentioned
- constraints: TeamPack rules, anti-echo guidance, TASKS.md source-of-truth rule

Later implementations may use a summarizer, but the packet schema must remain stable.

## Loop and Fanout Policy

- One possession can create at most one active pass by default.
- Multi-target pass requires explicit user approval or a TeamPack workflow rule.
- Direct reverse pass is blocked unless the user explicitly allows it.
- A chain cannot visit the same holder more than once unless the pass includes a new concrete action and the loop budget permits it.
- A pass to the current holder is a no-op and should be ignored.

## Team Runtime Integration

Team Runtime remains the source for:

- runtime roster
- display names and mention patterns
- communication policy
- workflow policy
- role cards
- skills
- account and engine resolution

The possession contract consumes Team Runtime decisions; it does not duplicate Team Runtime resolution rules.

## UI Requirements

The UI should show collaboration as a handoff sequence:

```text
User -> Mario -> DK -> done
```

Each handoff should show:

- source holder
- target holder
- requested action
- status
- precise failure reason if blocked or failed

The UI should not expose internal words like `runtime`, `routing`, `worklist`, or `chain` in primary copy.

Recommended user-facing labels:

- `当前负责`
- `交接给`
- `交接被阻止`
- `目标未启动`
- `执行超时`
- `团队没有这个角色`

## Migration From A2A v2

### Control Plane Dependency

System-level delivery semantics are moving to [`specs/system-control-plane/`](../system-control-plane/).

A2A Possession remains responsible for:

- current holder
- pass intent
- holder buffer
- handoff packet
- pass state

System Control Plane is responsible for:

- runtime node identity and health
- agent binding reachability
- deterministic dispatch gates
- execution envelope creation
- directed routing
- lifecycle acknowledgement
- proof timeline

During migration, this spec may still describe compatibility behavior using `a2a:dispatch` and worklist entries. The target architecture is that A2A submits a pass intent to `DispatchGateway` and receives a phase-specific result.

### Keep

- Team Runtime roster resolution
- CommunicationPolicy enforcement
- Audit log concept
- Cursor/incremental context idea
- TASKS.md as project state source
- anti-echo guidance

### Replace

- `@mention` scan as automatic dispatch trigger
- client-side direct dispatch followed by server-side registration
- single `maxDurationMs` chain timeout
- `queued/dispatching/executing` worklist as the main collaboration state
- full response text as pass content

### Compatibility Phase

During migration, the platform may translate obvious actionable `@agent` mentions into pass drafts, but it must still:

- require current holder ownership
- validate roster and policy before offering
- register `started` only after real process/session start
- create handoff packets instead of forwarding raw text

Current implementation status:

- Possession persistence has landed in parallel tables: `a2a_possession_chain`, `a2a_possession`, `a2a_pass`, and `a2a_handoff_packet`.
- The existing `invocation_chain` and `chain_worklist` path remains readable and executable during migration.
- Server dispatch now creates offered passes and handoff packets before emitting compatibility `a2a:dispatch`.
- Client ACK uses `a2a:agent-started`; only then does the server mark the worklist entry executing and transfer possession.
- Agent-originated `@mention` scanning now requires actionable pass intent; ordinary mentions remain diagnostics and do not wake agents.
- Dispatch summary language such as "派发/分配/指派 @agent" is treated as actionable handoff intent, including compact table-like summaries.
- Multiple queued, idle targets created from the same holder response are offered in the same dispatch cycle so a batch handoff can wake parallel agents.
- The UI consumes possession socket events and shows current holder, recent handoff, blocked handoff reasons, and an expandable recent handoff timeline in the chat workspace.
- Full historical debug views and timeout subtype filtering remain future work.

## Acceptance Criteria

- User can start a chain and pass to one agent.
- Only the current holder can pass to the next agent.
- Agent multi-turn output is merged into one handoff packet.
- Mentioning a non-roster agent produces a clear block message, not a timeout.
- Missing runtime/account rejects before pass acceptance.
- Busy targets do not become `executing`; they remain pending or rejected with a clear reason.
- Timeout messages identify the failed phase.
- Chain completion is derived from possession/pass states.
- No old possession can wake an agent after a newer user turn takes over.
