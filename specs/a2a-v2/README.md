# A2A v2: Chain-Orchestrated Dispatch

> Status: Draft  
> Author: kk + claude  
> Date: 2026-05-05

## Problem Statement

Current A2A system uses a persistent mailbox pattern for what should be ephemeral chain-of-invocation dispatch. This causes:
1. Message echo (old messages circulate indefinitely)
2. Status confirmation loops (agents can't distinguish new from stale)
3. No deduplication (fire-and-forget, insert-always)
4. Session isolation failure (epochId carried but never validated)
5. Coordination overhead explosion (unbounded queues, weak loop detection)

Root cause: architectural mismatch — using a persistent async mailbox for synchronous chain dispatch, and using a message pipe for state synchronization.

## Design Principles

1. **TASKS.md is the single source of truth** — A2A never does status sync. Agents read the kanban file for state. A2A only dispatches work.
2. **Chains are ephemeral** — An invocation chain lives for one user trigger. When the chain completes, all its state is dead. No "old chain leaks into new chain."
3. **Platform is the sole coordinator** — Agents don't decide whether to dispatch to others. The Orchestrator decides. Agents request, platform approves.
4. **Incremental delivery only** — An agent never sees a message it already processed. Cursor guarantees monotonic progress.
5. **Five-layer dedup** — Defense in depth. Each layer catches a different failure mode.
6. **Fail silent over fail loud** — Stale/duplicate messages are discarded silently (logged for debug), not surfaced to agents.

## Architecture Overview

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────────┐
│                   Orchestrator                        │
│  - Creates InvocationChain                           │
│  - Manages Worklist                                  │
│  - Applies 5-layer dedup                             │
│  - Controls context injection                        │
│  - Makes all dispatch decisions                      │
└──────────┬───────────────────────────────────────────┘
           │ dispatch (Socket.IO)
           ▼
┌─────────────────────┐      ┌─────────────────────┐
│   Agent A (CLI)     │      │   Agent B (CLI)     │
│   - Executes task   │      │   - Executes task   │
│   - May @mention    │      │   - May @mention    │
│   - Reads TASKS.md  │      │   - Reads TASKS.md  │
└──────────┬──────────┘      └─────────────────────┘
           │ response (done event)
           ▼
┌─────────────────────────────────────────────────────┐
│                   Orchestrator                        │
│  - Scans for @mentions                               │
│  - Validates against chain state                     │
│  - Appends to worklist or rejects                    │
│  - Advances cursor                                   │
│  - If worklist empty → chain complete                │
└─────────────────────────────────────────────────────┘
           │
           ▼
      AuditLog (SQLite) — write-only, for debug/replay
```

## Core Concepts

### 1. InvocationChain

Replaces the mailbox as the primary coordination primitive.

```typescript
interface InvocationChain {
  id: string;                    // chain-{timestamp}-{random}
  conversationId: string;
  rootTrigger: {
    type: 'user_message' | 'scheduled';
    messageId: string;
  };
  worklist: WorklistEntry[];     // ordered queue of pending dispatches
  executed: ExecutedEntry[];     // completed invocations (for audit)
  status: 'active' | 'completed' | 'aborted' | 'timeout';
  config: {
    maxDepth: number;            // default 5 (not 10)
    maxBreadth: number;          // max agents in one chain, default 4
    maxDurationMs: number;       // chain auto-aborts after this, default 120_000
    allowedAgents?: string[];    // whitelist, if set
  };
  createdAt: string;
  completedAt?: string;
}

interface WorklistEntry {
  id: string;                    // wl-{seq}
  agentId: string;
  prompt: string;
  requestedBy: string;           // agent who @mentioned
  depth: number;                 // current chain depth
  status: 'queued' | 'dispatching' | 'executing';
  queuedAt: string;
}

interface ExecutedEntry {
  agentId: string;
  startedAt: string;
  completedAt: string;
  outcome: 'success' | 'error' | 'timeout';
  mentionsGenerated: string[];   // agent IDs this execution tried to @mention
}
```

**Lifecycle:**
1. User sends message → Orchestrator creates chain
2. Message contains @mention or platform routes to agent → first WorklistEntry added
3. Agent completes → entry moves to `executed`, cursor advances
4. If agent's response contains @mention → Orchestrator validates and may append to worklist
5. Worklist empty → chain.status = 'completed'
6. Timeout or depth exceeded → chain.status = 'aborted'

**Key invariant:** A chain CANNOT survive across user messages. New user message = new chain. Period.

### 2. Orchestrator

The single decision-making authority for all cross-agent dispatch.

```typescript
interface Orchestrator {
  // Chain lifecycle
  createChain(trigger: ChainTrigger): InvocationChain;
  abortChain(chainId: string, reason: string): void;
  
  // Dispatch decisions
  requestDispatch(req: DispatchRequest): DispatchDecision;
  onAgentComplete(chainId: string, agentId: string, response: string): void;
  
  // State queries
  getActiveChain(conversationId: string): InvocationChain | null;
  getAgentState(agentId: string): AgentState;
  
  // Dedup layers
  private checkContentDedup(req: DispatchRequest): boolean;
  private checkChainDedup(chain: InvocationChain, agentId: string): boolean;
  private checkRateLimit(agentId: string): boolean;
  private checkRippleDetection(chain: InvocationChain): boolean;
  private checkGlobalBudget(): boolean;
}

type DispatchDecision = 
  | { allow: true; entry: WorklistEntry }
  | { allow: false; reason: string; silent: boolean };

interface AgentState {
  status: 'idle' | 'executing' | 'queued';
  currentChainId?: string;
  lastCompletedAt?: string;
}
```

**Orchestrator replaces:** `router.ts` (absorbed), dispatch logic in `daemon.ts`, queue management in `daemonStore.ts`.

### 3. DeliveryCursor

Per (agent, conversation) monotonic pointer.

```typescript
interface DeliveryCursor {
  agentId: string;
  conversationId: string;
  lastProcessedChainId: string;  // last chain this agent was part of
  lastProcessedEntryId: string;  // last worklist entry completed
  updatedAt: string;
}
```

**Rules:**
- Cursor only advances on successful completion (outcome = 'success')
- When building agent context, only inject messages AFTER cursor position
- Failed/timed-out invocations do NOT advance cursor
- Cursor is persisted in SQLite (survives restart)

### 4. Message Types (Semantic Classification)

```typescript
type A2AIntent =
  | 'dispatch'      // "Do this work" — enters worklist
  | 'inform'        // "FYI" — updates cursor, no worklist entry, no agent execution
  | 'query'         // "What's your status?" — enters worklist but with response-only flag

// REMOVED concepts:
// - 'broadcast' → agents read TASKS.md instead
// - 'ack' → eliminated entirely, no confirmation needed
```

**Critical decision:** There is NO "broadcast" or "status sync" message type. TASKS.md is the single source of truth. If an agent needs to know state, it reads the file. A2A only carries work instructions.

### 5. Five-Layer Dedup

```
Layer 1: Content Hash
  - sha256(fromAgent + toAgent + normalize(content)).slice(0,16)
  - Checked against chain-scoped seen-set (in-memory, dies with chain)
  - Prevents: exact duplicate messages within one chain

Layer 2: Chain-Scoped Agent Dedup  
  - Each agent can appear in a chain's worklist at most once
  - Exception: explicit re-dispatch with different content (hash differs)
  - Prevents: A→B→A→B ping-pong

Layer 3: Ripple Detection
  - If 3+ agents in the same chain all try to @mention the same target → block
  - "Everyone piling on one agent" is always a coordination failure
  - Prevents: N-to-1 broadcast storms

Layer 4: Rate Limit
  - Per-agent: max 1 dispatch received per 5 seconds
  - Per-chain: max 8 total dispatches
  - Prevents: rapid-fire accumulation, unbounded chains

Layer 5: Chain Lifetime
  - Hard timeout: 120 seconds from chain creation
  - After timeout: chain aborted, all pending worklist entries discarded
  - Prevents: zombie chains, resource leaks
```

### 6. Context Injection (replaces a2aLayer.ts)

When dispatching to an agent, the Orchestrator builds its context:

```typescript
interface AgentDispatchContext {
  // What this agent needs to do
  instruction: string;           // extracted @mention content
  requestedBy: string;           // who asked

  // Chain awareness (minimal)
  chainId: string;
  depth: number;
  remainingBudget: number;       // how many more dispatches allowed

  // Task context (from TASKS.md, NOT from message history)
  relevantTasks: TaskSummary[];  // only tasks assigned to this agent or related

  // Incremental messages (cursor-based)
  newMessages: MessageSummary[]; // only messages since this agent's cursor
  
  // Constraints
  responseGuidance: string;      // "Do not broadcast status. Do not confirm receipt."
}
```

**What is NOT injected:**
- Full conversation history (use cursor)
- Other agents' full responses (only relevant excerpts)
- State that can be read from TASKS.md

## Database Schema Changes

### New Tables

```sql
-- Replaces agent_mailbox as the coordination primitive
CREATE TABLE invocation_chain (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  root_trigger_type TEXT NOT NULL,  -- 'user_message' | 'scheduled'
  root_trigger_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | completed | aborted | timeout
  config TEXT NOT NULL,  -- JSON: {maxDepth, maxBreadth, maxDurationMs}
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_chain_conv ON invocation_chain(conversation_id);
CREATE INDEX idx_chain_status ON invocation_chain(status);

-- Ordered work queue within a chain
CREATE TABLE chain_worklist (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES invocation_chain(id),
  agent_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  prompt TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | dispatching | executing | done | aborted
  outcome TEXT,  -- success | error | timeout (set when done)
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_worklist_chain ON chain_worklist(chain_id);
CREATE INDEX idx_worklist_agent ON chain_worklist(agent_id, status);
CREATE UNIQUE INDEX uq_worklist_hash ON chain_worklist(chain_id, content_hash);

-- Monotonic delivery cursor per agent per conversation
CREATE TABLE delivery_cursor (
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_chain_id TEXT,
  last_entry_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, conversation_id)
);

-- Audit log (write-only, replaces agent_mailbox for debugging)
CREATE TABLE a2a_audit_log (
  id TEXT PRIMARY KEY,
  chain_id TEXT,
  conversation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'dispatch_requested' | 'dispatch_allowed' | 'dispatch_blocked' | 'chain_created' | 'chain_completed' | 'chain_aborted'
  from_agent_id TEXT,
  to_agent_id TEXT,
  content_hash TEXT,
  reason TEXT,  -- why blocked, why aborted, etc.
  metadata TEXT,  -- JSON, additional context
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_chain ON a2a_audit_log(chain_id);
CREATE INDEX idx_audit_conv ON a2a_audit_log(conversation_id);
```

### Deprecated (to be dropped after migration)

```sql
-- agent_mailbox → replaced by chain_worklist + a2a_audit_log
-- Keep table for 1 release cycle, then DROP
```

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/server/a2a/orchestrator.ts` | Central coordinator, all dispatch decisions |
| `src/server/a2a/chain.ts` | InvocationChain CRUD + worklist management |
| `src/server/a2a/cursor.ts` | DeliveryCursor store |
| `src/server/a2a/dedup.ts` | Five-layer dedup implementation |
| `src/server/a2a/context-builder.ts` | Agent context composition (replaces queue.ts + a2aLayer.ts) |
| `src/server/a2a/types-v2.ts` | New type definitions (replace types.ts after migration) |

### Modified Files

| File | Change |
|------|--------|
| `src/server/a2a/index.ts` | Gut current logic, become thin facade that delegates to Orchestrator |
| `src/server/a2a/scanner.ts` | Keep @mention scanning, but output goes to Orchestrator not mailbox |
| `src/server/daemon.ts` | Remove dispatch logic (~L506-516), replace with `orchestrator.onAgentComplete()` |
| `src/store/daemonStore.ts` | Simplify `enqueueDispatch`/`dequeueNextPending` — Orchestrator owns the queue |
| `src/store/taskHubStore.ts` | `a2a:dispatch` handler delegates to Orchestrator |
| `src/server/db/schema.ts` | Add new tables, deprecate agent_mailbox |
| `src/server/db/migrate.ts` | Migration for new schema |
| `src/lib/agent-context/layers/a2aLayer.ts` | Rewrite to use context-builder |

### Deleted Files (after migration)

| File | Reason |
|------|--------|
| `src/server/a2a/router.ts` | Logic absorbed into Orchestrator |
| `src/server/a2a/mailbox.ts` | Replaced by chain.ts + audit log |
| `src/server/a2a/queue.ts` | Replaced by context-builder.ts |

## Behavioral Contracts

### What agents MUST do:
- Read TASKS.md for current state (not rely on injected snapshots)
- Execute the dispatched instruction
- Use @mention ONLY to request another agent to DO work

### What agents MUST NOT do:
- Broadcast status via @mention (read TASKS.md)
- Confirm receipt of messages ("收到，待命")
- Reply to inform/query messages with @mentions back

### What the Orchestrator guarantees:
- An agent is never dispatched the same content twice within a chain
- An agent never sees messages it already processed (cursor)
- A chain always terminates (timeout guarantee)
- Stale chains from old sessions are dead on arrival (chain lifecycle = one user trigger)
- Rate limiting prevents any agent from being overwhelmed

### What the Orchestrator enforces:
- responseGuidance in every dispatch: "不要广播状态。不要确认收到。只做实际工作或报告无法执行的原因。"
- If an agent's response is < 50 chars and contains no tool_use → don't scan for @mentions at all (it's an ack, discard)
- If an agent @mentions the agent who just @mentioned it → auto-block (direct ping-pong, no threshold needed)

## Migration Strategy

1. Add new tables alongside old ones
2. Implement Orchestrator reading/writing new tables
3. Wire daemon.ts to use Orchestrator instead of direct mailbox
4. Run both paths in parallel for 1 day (new path active, old path logging only)
5. Remove old path (router.ts, mailbox.ts, queue.ts)
6. Drop agent_mailbox table after confirming no regressions

## Anti-Patterns to Prevent

| Pattern | Why it's bad | How we prevent it |
|---------|-------------|-------------------|
| Mario broadcasts state | Uses A2A pipe for sync, which has no last-write-wins | No 'broadcast' type exists. TASKS.md is truth. |
| "收到，待命" loops | Ack generates new message, new message triggers scan | Responses < 50 chars → no @mention scan |
| Old chain echo | Delivered message from 2 mins ago re-enters context | Chain is dead when user sends new message. Cursor-based delivery. |
| N-to-1 pile-on | 3 agents all @mention same target | Ripple detection: 3+ sources to same target → block |
| Zombie chain | Agent crashes mid-chain, worklist never drains | maxDurationMs timeout auto-aborts |
| Ping-pong | A @mentions B, B @mentions A | Direct reverse @mention → instant block (no threshold) |

## Success Criteria

After implementation:
- [ ] Zero "收到，待命" messages in any agent conversation
- [ ] Zero duplicate dispatch to same agent with same content
- [ ] All chains terminate within 120s
- [ ] No message from a previous user trigger appears in current agent context
- [ ] Agent context contains only cursor-incremental messages
- [ ] TASKS.md is the only place agents look for project state
