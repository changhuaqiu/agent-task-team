# Task System Enhancement Design

**Status**: Implemented
**Date**: 2026-05-04
**Inspired by**: Multica task system analysis

## Background

Our current task system has three infrastructure gaps:

1. **No workdir isolation** — all agents share `process.cwd()`, risking file conflicts
2. **In-memory dispatch queue** — `pendingDispatches` is lost on process crash
3. **Agents can't manage tasks** — they can only output text; task creation/assignment is human-only

This design addresses all three by studying Multica's task orchestration patterns and adapting them to our architecture.

## Key Differences from Multica

| Dimension | Multica | Agent Task Hub |
|-----------|---------|---------------|
| Assignment | Human-specified assignee | DispatchAdvisor intelligent matching |
| Trigger | Event-driven (assign/comment/mention) | User-initiated dispatch |
| Execution | Daemon poll → claim → run | Socket.io push → immediate run |
| Task granularity | 1 task = 1 CLI execution | 1 task = multiple dispatches possible |
| Routing | Deterministic (no scoring) | Domain+skill scoring (CapabilityProfile) |

Our one-task-multiple-dispatches model requires workdir reuse at a different granularity than Multica's per-(agent, issue) approach.

## Module 1: Task State Machine + Dispatch Persistence

### User-visible task status (unchanged)

```
pending → in_progress → in_review → done
                       → blocked
                       → rejected
```

### Internal dispatch tracking (new)

```
queued → claimed → running → completed/failed
```

Each task may have multiple dispatches over its lifetime (user sends follow-up messages). Each dispatch is tracked independently.

### Schema changes

**`task` table** — add columns:

| Column | Type | Purpose |
|--------|------|---------|
| `claimed_at` | TEXT | When dispatch was claimed |
| `started_at` | TEXT | When CLI process started |
| `completed_at` | TEXT | When CLI process exited |
| `lease_expiry` | TEXT | Claim timeout for zombie recovery |
| `work_dir` | TEXT | Absolute path to agent's working directory |

**`invocation` table** — add column:

| Column | Type | Purpose |
|--------|------|---------|
| `token_usage` | TEXT | JSON: `{model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens}` |
| `dispatch_status` | TEXT | `queued` / `claimed` / `running` / `completed` / `failed` |

### Atomic claim

SQLite `BEGIN IMMEDIATE` transaction for safe concurrent claiming:

```sql
BEGIN IMMEDIATE;
UPDATE invocation
SET dispatch_status = 'claimed', claimed_at = ?, lease_expiry = ?
WHERE id = (
  SELECT id FROM invocation
  WHERE agent_id = ? AND dispatch_status = 'queued'
  ORDER BY created_at ASC LIMIT 1
);
COMMIT;
```

### Zombie recovery

On daemon startup, scan for `dispatch_status = 'claimed'` where `lease_expiry < NOW()` and reset to `queued`.

### Dispatch coalescing

Before enqueuing a new dispatch, check if a pending dispatch already exists for the same (agent, task). If so, merge the new message into the existing dispatch's prompt rather than creating a duplicate.

---

## Module 2: Workdir Isolation and Reuse

### Directory structure

```
.ath/workspaces/
  {projectId}/
    {agentId}/
      base/                     ← shared across tasks (node_modules, git)
      task-{taskId}/
        workdir/                ← agent's cwd for this task
        .session.json           ← { sessionId, updatedAt }
        .gc_meta.json           ← { taskId, completedAt }
```

**Two-layer model**:
- **base/**: Cross-task shared environment. Created on first agent+project interaction. Accumulates node_modules, git clones, installed tools. Not cleaned between tasks.
- **task-{taskId}/workdir/**: Per-task isolated working directory. Created fresh for each task. Agents see only their own task's workdir.

### Reuse flow

```
dispatchToAgent(agentId, taskId, projectId):
  1. Look up prior invocation for (agentId, projectId) → get work_dir
  2. base/ exists?
     → yes: reuse (no-op)
     → no: create base/
  3. task-{taskId}/workdir/ exists?
     → yes: reuse + session resume (if sessionId available)
     → no: create task-{taskId}/workdir/, optionally symlink shared resources from base/
  4. Refresh context files in workdir/ (role card, team info, task context)
  5. Set agent's cwd = task-{taskId}/workdir/
```

### Session resume enhancement

- Track `sessionId` per (agent, task) in `.session.json`
- On dispatch, if session exists: pass `--resume sessionId` to CLI
- If resume fails (CLI returns no session): retry with fresh session, keep same workdir
- Mid-flight pinning: persist sessionId to server as soon as agent reveals it

### GC strategy

| Condition | Action | TTL |
|-----------|--------|-----|
| Task completed/failed | Clean entire task directory | 24h |
| Task completed, project still active with pending tasks | Clean regenerable artifacts only (node_modules, .next, .turbo) | 12h |
| Orphan directory (no .gc_meta.json) | Clean entire directory | 72h |
| Agent removed from project | Clean base/ + all task dirs | immediate |

**Active-root protection**: Directories currently in use are reference-counted and excluded from GC. Marks are set before environment preparation and released after process exit.

---

## Module 3: Skill Config Tools

### Concept

Extend the existing `skill.config` JSON field to define tools that agents can invoke. Instead of hardcoding task management in the daemon, define it as a skill that agents can be equipped with.

### Type definitions

```typescript
interface SkillConfig {
  tools?: ToolDefinition[];
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParamDef[];
  handler: string;  // routing identifier: "api://tasks/create"
}

interface ParamDef {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
}
```

### Preset "task-management" skill

Injected into agents that need task coordination capability (primarily Mario/planner, optionally others).

```json
{
  "tools": [
    {
      "name": "task_list",
      "description": "List tasks in current project, optionally filtered by status or agent",
      "parameters": [
        { "name": "status", "type": "string", "required": false, "description": "Filter by status" },
        { "name": "agent_id", "type": "string", "required": false, "description": "Filter by assignee" }
      ],
      "handler": "api://tasks/list"
    },
    {
      "name": "task_create",
      "description": "Create a new task and optionally assign to an agent",
      "parameters": [
        { "name": "title", "type": "string", "required": true },
        { "name": "description", "type": "string", "required": false },
        { "name": "agent_id", "type": "string", "required": false, "description": "Agent to assign" },
        { "name": "priority", "type": "string", "required": false }
      ],
      "handler": "api://tasks/create"
    },
    {
      "name": "task_update_status",
      "description": "Update a task's status",
      "parameters": [
        { "name": "task_id", "type": "string", "required": true },
        { "name": "status", "type": "string", "required": true }
      ],
      "handler": "api://tasks/update"
    },
    {
      "name": "task_assign",
      "description": "Assign or reassign a task to an agent",
      "parameters": [
        { "name": "task_id", "type": "string", "required": true },
        { "name": "agent_id", "type": "string", "required": true }
      ],
      "handler": "api://tasks/assign"
    }
  ]
}
```

### Execution flow

```
1. PromptComposer builds system prompt:
   - SkillLayer reads skill.config.tools
   - Generates function/tool definitions (Claude function calling format)
   - Injects into system prompt alongside skill text content

2. Agent decides to call a tool:
   - CLI outputs tool_use event: tool_use("task_create", {title: "...", agent_id: "luigi"})

3. Daemon intercepts:
   - Recognizes custom tool (not a native file-edit/shell tool)
   - Looks up handler URL from skill config
   - Routes to internal API: POST /api/mutations { type: "task.create", payload: {...} }

4. Returns result:
   - tool_result event with success/failure + created task info
   - Agent continues working with the result
```

### Handler routing

| Scheme | Route | Example |
|--------|-------|---------|
| `api://` | Internal API mutation | `api://tasks/create` → `POST /api/mutations` |
| `http://` | External HTTP call (future) | `http://webhook.example.com/notify` |

### Safety constraints

- Only agents with the task-management skill assigned can invoke task tools
- Tool invocations are logged as agent_events for audit
- Rate limiting: max 10 task operations per dispatch to prevent runaway agents
- Agent cannot assign tasks to itself (prevent self-dispatch loops)
- Agent cannot modify tasks outside its current project scope

---

## Module 4: Token Usage Tracking

### Extraction from CLI output

**Claude backend**: Parse stream JSON `usage` field from result events:
```json
{ "type": "result", "usage": { "input_tokens": 12345, "output_tokens": 678, "cache_read_input_tokens": 8000 } }
```

**Codex backend**: Parse JSON-RPC notification with token counts, fallback to JSONL session log scanning.

### Storage

`invocation.token_usage` JSON column:
```json
[
  { "model": "claude-sonnet-4-20250514", "input_tokens": 12345, "output_tokens": 678, "cache_read_tokens": 8000, "cache_write_tokens": 2000 },
  { "model": "claude-haiku-4-20251001", "input_tokens": 500, "output_tokens": 100 }
]
```

Array format supports multi-model invocations (e.g., agent switches models mid-session).

### UI

Display token usage summary at the bottom of completed agent stream messages. Aggregate per-project and per-agent stats in settings panel.

---

## Implementation Order

```
Phase 1 (parallel):
  ├── Module 1: Task state machine + dispatch persistence
  └── Module 4: Token usage tracking

Phase 2:
  └── Module 2: Workdir isolation and reuse (depends on Module 1)

Phase 3:
  └── Module 3: Skill config tools (depends on Module 1 + Module 2)
```

### Estimated effort

| Module | Effort | Key files |
|--------|--------|-----------|
| Module 1 | 2-3 days | schema.ts, task-repo.ts, taskHubStore.ts, mutations.ts |
| Module 2 | 3-4 days | daemon.ts, new workdir-manager.ts, all backends |
| Module 3 | 2-3 days | skillLayer.ts, PromptComposer.ts, daemon.ts, presetSkills.ts |
| Module 4 | 1-2 days | claude.ts, codex.ts, schema.ts, stream message UI |

---

## What We're NOT Doing (YAGNI)

- Multi-machine distributed execution (single-machine is fine for now)
- Daemon registration + heartbeat protocol (we use Socket.io, not polling)
- Event-driven auto-triggers (user-initiated dispatch works well)
- Full Autopilot mode (like Multica's cron-based automation)
- Complex priority scoring (FIFO within same priority is sufficient)
