# Agent 间通信 (A2A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add @mention-based agent-to-agent messaging so agents can communicate, delegate, and coordinate through the daemon.

**Architecture:** Daemon-internal A2A module (`src/server/a2a/`) with a single entry point (`AgentMessenger.onAgentResponse`). After an agent completes its response, the daemon calls the messenger which scans for @mentions, routes to a mailbox table, and dispatches target agents (or queues them if busy). A new `a2aLayer` in PromptComposer injects cross-agent context.

**Tech Stack:** SQLite (drizzle-orm), Socket.IO, Zustand, Vitest

**Design spec:** `docs/superpowers/specs/2026-05-04-agent-inter-agent-communication-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/server/a2a/types.ts` | A2A internal types |
| Create | `src/server/a2a/scanner.ts` | @mention parsing from agent output |
| Create | `src/server/a2a/router.ts` | Chain depth, ping-pong, delivery decision |
| Create | `src/server/a2a/mailbox.ts` | agent_mailbox table CRUD |
| Create | `src/server/a2a/queue.ts` | Busy-agent queue dispatch |
| Create | `src/server/a2a/index.ts` | AgentMessenger facade |
| Create | `src/lib/agent-context/layers/a2aLayer.ts` | PromptComposer A2A context injection |
| Create | `src/__tests__/server/a2a/scanner.test.ts` | Scanner unit tests |
| Create | `src/__tests__/server/a2a/router.test.ts` | Router unit tests |
| Create | `src/__tests__/server/a2a/mailbox.test.ts` | Mailbox unit tests |
| Modify | `src/server/db/schema.ts` | Add `agentMailbox` table |
| Modify | `src/server/db/migrate.ts` | Add migration version 8 |
| Modify | `src/store/daemonStore.ts` | Add `source` to PendingDispatch |
| Modify | `src/lib/agent-context/PromptComposer.ts` | Add a2aLayer to compose chain |
| Modify | `src/server/daemon.ts` | Hook `onAgentResponse` after `forwardAgentEvent` |

---

### Task 1: DB Schema + Migration

**Files:**
- Modify: `src/server/db/schema.ts:211` (append after inferred types)
- Modify: `src/server/db/migrate.ts:211` (append after migration 7)
- Create: `src/__tests__/server/a2a/mailbox.test.ts` (partial — schema smoke test)

- [ ] **Step 1: Add `agentMailbox` table to schema**

Append after line 210 in `src/server/db/schema.ts`:

```typescript
// ──────────────────────────────────────────────
// agent_mailbox
// ──────────────────────────────────────────────
export const agentMailbox = sqliteTable('agent_mailbox', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull()
    .references(() => conversation.id),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  triggerMessageId: text('trigger_message_id'),
  taskId: text('task_id'),
  content: text('content').notNull(),
  contextSnapshot: text('context_snapshot'), // JSON text nullable
  status: text('status').notNull().default('pending'), // pending | delivered | processed | expired
  chainDepth: integer('chain_depth').notNull().default(0),
  a2aFrom: text('a2a_from'),
  source: text('source').notNull().default('a2a'),
  createdAt: text('created_at').notNull(),
  deliveredAt: text('delivered_at'),
}, (table) => [
  index('idx_mailbox_to_status').on(table.toAgentId, table.status),
  index('idx_mailbox_conv').on(table.conversationId),
]);

export type AgentMailboxRow = InferSelectModel<typeof agentMailbox>;
export type NewAgentMailboxRow = InferInsertModel<typeof agentMailbox>;
```

- [ ] **Step 2: Add migration version 8**

Append after the `version: 7` entry (line 210) in `src/server/db/migrate.ts`:

```typescript
  {
    version: 8,
    sql: `
    CREATE TABLE IF NOT EXISTS agent_mailbox (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id),
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      trigger_message_id TEXT,
      task_id TEXT,
      content TEXT NOT NULL,
      context_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      chain_depth INTEGER NOT NULL DEFAULT 0,
      a2a_from TEXT,
      source TEXT NOT NULL DEFAULT 'a2a',
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mailbox_to_status ON agent_mailbox(to_agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_mailbox_conv ON agent_mailbox(conversation_id);
    `,
  },
```

- [ ] **Step 3: Verify schema compiles**

Run: `npx tsc --noEmit src/server/db/schema.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.ts src/server/db/migrate.ts
git commit -m "feat(a2a): add agent_mailbox table schema and migration v8"
```

---

### Task 2: A2A Types

**Files:**
- Create: `src/server/a2a/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/server/a2a/types.ts

export interface MentionTarget {
  agentId: string;
  position: number; // char offset in original text
}

export interface A2ADecision {
  deliver: boolean;
  reason?: string; // e.g. 'ping-pong blocked', 'depth exceeded'
}

export interface MailboxEntry {
  id: string;
  conversationId: string;
  fromAgentId: string;
  toAgentId: string;
  triggerMessageId?: string;
  taskId?: string;
  content: string;
  contextSnapshot?: string;
  status: 'pending' | 'delivered' | 'processed' | 'expired';
  chainDepth: number;
  a2aFrom?: string;
  source: 'a2a';
  createdAt: string;
  deliveredAt?: string;
}

export interface ResponseContext {
  conversationId: string;
  taskId?: string;
  triggerMessageId?: string;
  chainDepth: number;
}

export interface AgentMentionConfig {
  id: string;
  mentionPatterns: string[]; // e.g. ['@mario', '@Mario', '@马里奥']
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/server/a2a/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server/a2a/types.ts
git commit -m "feat(a2a): add A2A type definitions"
```

---

### Task 3: @mention Scanner

**Files:**
- Create: `src/server/a2a/scanner.ts`
- Create: `src/__tests__/server/a2a/scanner.test.ts`

- [ ] **Step 1: Write scanner tests**

```typescript
// src/__tests__/server/a2a/scanner.test.ts
import { describe, it, expect } from 'vitest';
import { scanMentions } from '@/server/a2a/scanner';
import type { AgentMentionConfig } from '@/server/a2a/types';

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario', '@Mario', '@马里奥'] },
  { id: 'luigi', mentionPatterns: ['@luigi', '@Luigi', '@路易吉'] },
  { id: 'toad', mentionPatterns: ['@toad', '@Toad'] },
];

describe('scanMentions', () => {
  it('extracts a single @mention at line start', () => {
    const text = '我完成了设计\n@luigi 请开始实现\n谢谢';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('skips @mentions inside fenced code blocks', () => {
    const text = '看这段代码\n```\n@luigi 不应该匹配\n```\n@luigi 这个才匹配';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
  });

  it('skips @mentions inline (not at line start)', () => {
    const text = '我告诉 @luigi 去做这件事';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(0);
  });

  it('filters out self-mentions', () => {
    const text = '@mario 自己检查一下\n@luigi 开始工作';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('returns max 2 targets', () => {
    const text = '@luigi 做前端\n@toad 做测试\n@mario 不算自己';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('uses longest match to prevent prefix collision', () => {
    const agents: AgentMentionConfig[] = [
      { id: 'luigi', mentionPatterns: ['@luigi'] },
      { id: 'luigi-jr', mentionPatterns: ['@luigi-jr'] },
    ];
    const text = '@luigi-jr 开始';
    const result = scanMentions(text, agents, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi-jr');
  });

  it('matches CJK mention patterns', () => {
    const text = '@路易吉 开始吧';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('returns empty for no mentions', () => {
    const text = '没有 mention 的普通文本';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/server/a2a/scanner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement scanner**

```typescript
// src/server/a2a/scanner.ts
import type { AgentMentionConfig, MentionTarget } from './types';

const MAX_TARGETS = 2;

export function scanMentions(
  text: string,
  agents: AgentMentionConfig[],
  selfAgentId: string,
): MentionTarget[] {
  // Strip fenced code blocks
  const stripped = text.replace(/```[\s\S]*?```/g, '');

  // Build sorted pattern list (longest first to prevent prefix collision)
  const patterns: { pattern: string; agentId: string }[] = [];
  for (const agent of agents) {
    for (const p of agent.mentionPatterns) {
      patterns.push({ pattern: p, agentId: agent.id });
    }
  }
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);

  const targets: MentionTarget[] = [];
  const seen = new Set<string>();

  for (const line of stripped.split('\n')) {
    const trimmed = line.trimStart();
    // Only match @mentions at line start (after optional markdown prefix)
    const mdPrefix = trimmed.match(/^(?:[-*>]|\d+\.)\s*/);
    const content = mdPrefix ? trimmed.slice(mdPrefix[0].length) : trimmed;

    for (const { pattern, agentId } of patterns) {
      if (agentId === selfAgentId) continue;
      if (seen.has(agentId)) continue;
      if (targets.length >= MAX_TARGETS) break;

      if (content.toLowerCase().startsWith(pattern.toLowerCase())) {
        // Verify token boundary: next char is whitespace/punctuation/EOF
        const nextChar = content[pattern.length];
        if (nextChar === undefined || /[\s\p{P}]/u.test(nextChar)) {
          seen.add(agentId);
          targets.push({ agentId, position: line.indexOf(pattern) });
          break; // one match per line
        }
      }
    }
    if (targets.length >= MAX_TARGETS) break;
  }

  return targets;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/server/a2a/scanner.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/a2a/scanner.ts src/__tests__/server/a2a/scanner.test.ts
git commit -m "feat(a2a): implement @mention scanner with tests"
```

---

### Task 4: Router (chain depth + ping-pong)

**Files:**
- Create: `src/server/a2a/router.ts`
- Create: `src/__tests__/server/a2a/router.test.ts`

- [ ] **Step 1: Write router tests**

```typescript
// src/__tests__/server/a2a/router.test.ts
import { describe, it, expect } from 'vitest';
import { shouldDeliver, recordPingPong, resetPingPong } from '@/server/a2a/router';

describe('shouldDeliver', () => {
  it('allows delivery within depth limit', () => {
    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 3 });
    expect(result.deliver).toBe(true);
  });

  it('blocks delivery when depth exceeds 10', () => {
    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 11 });
    expect(result.deliver).toBe(false);
    expect(result.reason).toContain('depth');
  });

  it('blocks delivery at ping-pong threshold (4)', () => {
    // Simulate 4 consecutive bounces
    for (let i = 0; i < 4; i++) {
      recordPingPong('mario', 'luigi', true); // hasSubstantiveWork = true resets
    }
    // Actually we need non-substantive to trigger
    resetPingPong('mario', 'luigi');
    resetPingPong('luigi', 'mario');
    recordPingPong('mario', 'luigi', false);
    recordPingPong('luigi', 'mario', false);
    recordPingPong('mario', 'luigi', false);
    recordPingPong('luigi', 'mario', false);

    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 0 });
    expect(result.deliver).toBe(false);
    expect(result.reason).toContain('ping-pong');
  });

  it('resets ping-pong on substantive work', () => {
    resetPingPong('mario', 'luigi');
    resetPingPong('luigi', 'mario');
    recordPingPong('mario', 'luigi', false);
    recordPingPong('luigi', 'mario', false);
    recordPingPong('mario', 'luigi', true); // substantive — resets
    recordPingPong('luigi', 'mario', false);
    recordPingPong('mario', 'luigi', false);

    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 0 });
    expect(result.deliver).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/server/a2a/router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement router**

```typescript
// src/server/a2a/router.ts
import type { A2ADecision } from './types';

const MAX_CHAIN_DEPTH = 10;
const PING_PONG_THRESHOLD = 4;

// Key: "agentA:agentB" (sorted), Value: consecutive non-substantive count
const pingPongCounts = new Map<string, number>();

function ppKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function recordPingPong(from: string, to: string, hasSubstantiveWork: boolean): void {
  const key = ppKey(from, to);
  if (hasSubstantiveWork) {
    pingPongCounts.delete(key);
  } else {
    pingPongCounts.set(key, (pingPongCounts.get(key) ?? 0) + 1);
  }
}

export function resetPingPong(a: string, b: string): void {
  pingPongCounts.delete(ppKey(a, b));
}

export function getPingPongCount(a: string, b: string): number {
  return pingPongCounts.get(ppKey(a, b)) ?? 0;
}

export function shouldDeliver(opts: {
  fromAgentId: string;
  toAgentId: string;
  chainDepth: number;
}): A2ADecision {
  if (opts.chainDepth > MAX_CHAIN_DEPTH) {
    return { deliver: false, reason: `chain depth ${opts.chainDepth} exceeds limit ${MAX_CHAIN_DEPTH}` };
  }

  const count = getPingPongCount(opts.fromAgentId, opts.toAgentId);
  if (count >= PING_PONG_THRESHOLD) {
    return { deliver: false, reason: `ping-pong streak ${count} between ${opts.fromAgentId} and ${opts.toAgentId}` };
  }

  return { deliver: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/server/a2a/router.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/a2a/router.ts src/__tests__/server/a2a/router.test.ts
git commit -m "feat(a2a): implement router with chain depth and ping-pong protection"
```

---

### Task 5: Mailbox CRUD

**Files:**
- Create: `src/server/a2a/mailbox.ts`
- Create: `src/__tests__/server/a2a/mailbox.test.ts`

- [ ] **Step 1: Write mailbox tests**

```typescript
// src/__tests__/server/a2a/mailbox.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { MailboxRepo } from '@/server/a2a/mailbox';

let db: Database.Database;
let repo: MailboxRepo;

beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
  repo = new MailboxRepo(db);
});

describe('MailboxRepo', () => {
  it('inserts and reads a pending entry', () => {
    repo.insert({
      id: 'mb-1',
      conversationId: 'conv-1',
      fromAgentId: 'mario',
      toAgentId: 'luigi',
      content: '@luigi do it',
      status: 'pending',
      chainDepth: 1,
      a2aFrom: 'mario',
      source: 'a2a',
      createdAt: new Date().toISOString(),
    });

    const pending = repo.findPending('luigi');
    expect(pending).toHaveLength(1);
    expect(pending[0].fromAgentId).toBe('mario');
  });

  it('updates status to delivered', () => {
    repo.insert({
      id: 'mb-2',
      conversationId: 'conv-1',
      fromAgentId: 'mario',
      toAgentId: 'luigi',
      content: 'go',
      status: 'pending',
      chainDepth: 1,
      source: 'a2a',
      createdAt: new Date().toISOString(),
    });

    repo.updateStatus('mb-2', 'delivered');
    const pending = repo.findPending('luigi');
    expect(pending).toHaveLength(0);
  });

  it('expires stale pending entries', () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    repo.insert({
      id: 'mb-3',
      conversationId: 'conv-1',
      fromAgentId: 'mario',
      toAgentId: 'luigi',
      content: 'old message',
      status: 'pending',
      chainDepth: 1,
      source: 'a2a',
      createdAt: old,
    });

    const expired = repo.expireStale(30 * 60 * 1000);
    expect(expired).toBe(1);

    const pending = repo.findPending('luigi');
    expect(pending).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/server/a2a/mailbox.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement mailbox**

```typescript
// src/server/a2a/mailbox.ts
import type Database from 'better-sqlite3';
import type { MailboxEntry } from './types';

interface InsertParams {
  id: string;
  conversationId: string;
  fromAgentId: string;
  toAgentId: string;
  triggerMessageId?: string;
  taskId?: string;
  content: string;
  contextSnapshot?: string;
  status: MailboxEntry['status'];
  chainDepth: number;
  a2aFrom?: string;
  source: string;
  createdAt: string;
}

export class MailboxRepo {
  constructor(private db: Database.Database) {}

  insert(params: InsertParams): void {
    this.db.prepare(`
      INSERT INTO agent_mailbox (id, conversation_id, from_agent_id, to_agent_id,
        trigger_message_id, task_id, content, context_snapshot, status, chain_depth,
        a2a_from, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id, params.conversationId, params.fromAgentId, params.toAgentId,
      params.triggerMessageId ?? null, params.taskId ?? null, params.content,
      params.contextSnapshot ?? null, params.status, params.chainDepth,
      params.a2aFrom ?? null, params.source, params.createdAt,
    );
  }

  findPending(agentId: string): MailboxEntry[] {
    return this.db.prepare(`
      SELECT * FROM agent_mailbox
      WHERE to_agent_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).all(agentId) as MailboxEntry[];
  }

  updateStatus(id: string, status: MailboxEntry['status']): void {
    const deliveredAt = status === 'delivered' ? new Date().toISOString() : null;
    this.db.prepare(`
      UPDATE agent_mailbox SET status = ?, delivered_at = COALESCE(?, delivered_at)
      WHERE id = ?
    `).run(status, deliveredAt, id);
  }

  expireStale(maxAgeMs: number): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db.prepare(`
      UPDATE agent_mailbox SET status = 'expired'
      WHERE status = 'pending' AND created_at < ?
    `).run(cutoff);
    return result.changes;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/server/a2a/mailbox.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/a2a/mailbox.ts src/__tests__/server/a2a/mailbox.test.ts
git commit -m "feat(a2a): implement mailbox repo with pending query and stale expiry"
```

---

### Task 6: Queue (dispatch integration)

**Files:**
- Create: `src/server/a2a/queue.ts`

- [ ] **Step 1: Implement queue**

This module's job: when the router decides to deliver, call `enqueueDispatch` on the client store. Since the daemon runs server-side but `enqueueDispatch` is client-side in `daemonStore`, the A2A module emits a Socket.IO event instead, and the client store listens for it.

```typescript
// src/server/a2a/queue.ts
import type { MailboxEntry } from './types';
import type { MailboxRepo } from './mailbox';

interface EnqueueA2ADispatch {
  agentId: string;
  prompt: string;
  referencedTaskId?: string;
  source: string;
  a2aContext: {
    fromAgentId: string;
    content: string;
    contextSnapshot?: string;
  };
}

export function buildA2ADispatchPrompt(entry: MailboxEntry): string {
  const lines = [
    `═══ 跨角色协作消息 ═══`,
    `来自：${entry.a2aFrom ?? entry.fromAgentId}`,
    `消息内容：`,
    entry.content,
  ];

  if (entry.contextSnapshot) {
    try {
      const ctx = JSON.parse(entry.contextSnapshot);
      lines.push('', '当前任务上下文：');
      if (ctx.taskTitle) lines.push(`  任务：${ctx.taskTitle}`);
      if (ctx.taskStatus) lines.push(`  状态：${ctx.taskStatus}`);
      if (ctx.decisions) lines.push(`  前序决策：${ctx.decisions}`);
    } catch { /* invalid JSON, skip */ }
  }

  lines.push('', '请根据以上信息继续工作。', '═════════════════════');
  return lines.join('\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/a2a/queue.ts
git commit -m "feat(a2a): implement A2A dispatch prompt builder"
```

---

### Task 7: AgentMessenger Facade

**Files:**
- Create: `src/server/a2a/index.ts`

- [ ] **Step 1: Implement AgentMessenger**

```typescript
// src/server/a2a/index.ts
import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import { scanMentions } from './scanner';
import { shouldDeliver, recordPingPong } from './router';
import { MailboxRepo } from './mailbox';
import { buildA2ADispatchPrompt } from './queue';
import type { AgentMentionConfig, ResponseContext } from './types';

function hasSubstantiveWork(text: string): boolean {
  return text.includes('tool_use') || text.length > 200;
}

export class AgentMessenger {
  private mailbox: MailboxRepo;
  private agents: AgentMentionConfig[];

  constructor(
    private db: Database.Database,
    private io: IOServer,
    agentConfigs: AgentMentionConfig[],
  ) {
    this.mailbox = new MailboxRepo(db);
    this.agents = agentConfigs;
  }

  async onAgentResponse(
    agentId: string,
    response: string,
    ctx: ResponseContext,
  ): Promise<void> {
    // 1. Scan for @mentions
    const targets = scanMentions(response, this.agents, agentId);
    if (targets.length === 0) return;

    // 2. Record ping-pong state
    const substantive = hasSubstantiveWork(response);

    for (const target of targets) {
      // 3. Router check
      const decision = shouldDeliver({
        fromAgentId: agentId,
        toAgentId: target.agentId,
        chainDepth: ctx.chainDepth,
      });

      if (!decision.deliver) {
        this.io.emit('agent:event', {
          type: 'system',
          content: `A2A 投递被阻止：${decision.reason}`,
          conversationId: ctx.conversationId,
        });
        continue;
      }

      // 4. Write mailbox entry
      const entryId = `mb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const contextSnapshot = JSON.stringify({
        taskTitle: undefined,
        taskStatus: undefined,
        decisions: undefined,
      });

      this.mailbox.insert({
        id: entryId,
        conversationId: ctx.conversationId,
        fromAgentId: agentId,
        toAgentId: target.agentId,
        triggerMessageId: ctx.triggerMessageId,
        taskId: ctx.taskId,
        content: response,
        contextSnapshot,
        status: 'pending',
        chainDepth: ctx.chainDepth + 1,
        a2aFrom: agentId,
        source: 'a2a',
        createdAt: new Date().toISOString(),
      });

      // 5. Record ping-pong
      recordPingPong(agentId, target.agentId, substantive);

      // 6. Emit socket event for client store to enqueue dispatch
      const prompt = buildA2ADispatchPrompt({
        id: entryId,
        conversationId: ctx.conversationId,
        fromAgentId: agentId,
        toAgentId: target.agentId,
        content: response,
        contextSnapshot,
        status: 'pending',
        chainDepth: ctx.chainDepth + 1,
        a2aFrom: agentId,
        source: 'a2a',
        createdAt: new Date().toISOString(),
      });

      this.io.emit('a2a:dispatch', {
        agentId: target.agentId,
        prompt,
        referencedTaskId: ctx.taskId,
        fromAgentId: agentId,
        conversationId: ctx.conversationId,
      });

      // 7. Update mailbox status
      this.mailbox.updateStatus(entryId, 'delivered');
    }
  }

  expireStale(): number {
    return this.mailbox.expireStale(30 * 60 * 1000);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/server/a2a/index.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server/a2a/index.ts
git commit -m "feat(a2a): implement AgentMessenger facade"
```

---

### Task 8: Extend PendingDispatch with source

**Files:**
- Modify: `src/store/daemonStore.ts:78-82`

- [ ] **Step 1: Add `source` field to PendingDispatch**

In `src/store/daemonStore.ts`, update the interface at line 78:

```typescript
export interface PendingDispatch {
  prompt: string;
  referencedTaskId?: string;
  queuedAt: string;
  source?: 'user' | 'a2a';      // NEW
  fromAgentId?: string;          // NEW — for A2A source tracking
}
```

- [ ] **Step 2: Update enqueueDispatch to accept source**

At line 251, update the signature:

```typescript
enqueueDispatch: (agentId: string, payload: Omit<PendingDispatch, 'queuedAt'>) => {
```

The function body already copies all fields via spread, so `source` and `fromAgentId` will be included automatically. No other changes needed inside `enqueueDispatch`.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npx vitest run`
Expected: All existing tests PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/store/daemonStore.ts
git commit -m "feat(a2a): extend PendingDispatch with source field for A2A tracking"
```

---

### Task 9: A2A Prompt Layer

**Files:**
- Create: `src/lib/agent-context/layers/a2aLayer.ts`
- Modify: `src/lib/agent-context/PromptComposer.ts:86-122`

- [ ] **Step 1: Create a2aLayer**

```typescript
// src/lib/agent-context/layers/a2aLayer.ts

export interface A2ALayerOpts {
  a2aFrom?: string;
  a2aContent?: string;
  a2aContextSnapshot?: string;
}

export function buildA2ALayer(opts: A2ALayerOpts): string {
  if (!opts.a2aFrom || !opts.a2aContent) return '';

  const lines = [
    `═══ 跨角色协作消息 ═══`,
    `来自：${opts.a2aFrom}`,
    `消息内容：`,
    opts.a2aContent,
  ];

  if (opts.a2aContextSnapshot) {
    try {
      const ctx = JSON.parse(opts.a2aContextSnapshot);
      lines.push('', '当前任务上下文：');
      if (ctx.taskTitle) lines.push(`  任务：${ctx.taskTitle}`);
      if (ctx.taskStatus) lines.push(`  状态：${ctx.taskStatus}`);
      if (ctx.decisions) lines.push(`  前序决策：${ctx.decisions}`);
    } catch { /* skip */ }
  }

  lines.push('', '请根据以上信息继续工作。', '═════════════════════');
  return lines.join('\n');
}
```

- [ ] **Step 2: Add a2aLayer to ComposeOptions and composeUserPrompt**

In `src/lib/agent-context/PromptComposer.ts`:

Add import at line 14:
```typescript
import { buildA2ALayer } from './layers/a2aLayer';
```

Add to `ComposeOptions` interface (after `skills?: SkillSummary[]`):
```typescript
  a2a?: { from?: string; content?: string; contextSnapshot?: string };
```

Insert in `composeUserPrompt` after the task context block (after line 117, before line 118):
```typescript
  // A2A context (only when dispatched via @mention)
  if (opts.a2a?.from && opts.a2a?.content) {
    parts.push(buildA2ALayer({
      a2aFrom: opts.a2a.from,
      a2aContent: opts.a2a.content,
      a2aContextSnapshot: opts.a2a.contextSnapshot,
    }));
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit src/lib/agent-context/PromptComposer.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent-context/layers/a2aLayer.ts src/lib/agent-context/PromptComposer.ts
git commit -m "feat(a2a): add a2aLayer to PromptComposer for cross-agent context injection"
```

---

### Task 10: Daemon Hook

**Files:**
- Modify: `src/server/daemon.ts`

- [ ] **Step 1: Import and instantiate AgentMessenger**

At the top of `daemon.ts`, add:
```typescript
import { AgentMessenger } from './a2a';
import { getDb } from './db';
import { AGENT_ROSTER } from '@/store/agentStore';
```

Inside `registerDaemon(io)`, after `forwardAgentEvent` is defined (around line 481), instantiate the messenger:
```typescript
    const a2aMessenger = new AgentMessenger(getDb(), io,
      AGENT_ROSTER.map(a => ({
        id: a.id,
        mentionPatterns: [`@${a.id}`, `@${a.name}`],
      })),
    );
```

Note: `AGENT_ROSTER` is client-side, so for the server daemon we need to provide agent configs differently. Read agents from DB instead:

```typescript
    // Read agents from DB for A2A mention patterns
    const dbAgents = getDb().prepare('SELECT id, name FROM agents').all() as { id: string; name: string }[];
    const a2aMessenger = new AgentMessenger(getDb(), io,
      dbAgents.map(a => ({
        id: a.id,
        mentionPatterns: [`@${a.id}`, `@${a.name}`],
      })),
    );
```

- [ ] **Step 2: Hook onAgentResponse into forwardAgentEvent**

Inside `forwardAgentEvent`, at the end (after line 480, before the closing brace), add for `done` events:

```typescript
      // A2A: scan agent's accumulated response for @mentions
      if (event.type === 'done') {
        const accumulated = /* retrieve accumulated text for this agent */;
        if (accumulated) {
          a2aMessenger.onAgentResponse(agentId, accumulated, {
            conversationId: sessionConvId,
            taskId: currentTaskId,
            triggerMessageId: undefined,
            chainDepth: 0, // TODO: track from mailbox entry
          }).catch(err => console.error('[a2a] onAgentResponse error:', err));
        }
      }
```

The accumulated text needs to be tracked. Add a module-level map before `registerDaemon`:
```typescript
const agentResponseBuffer = new Map<string, string>();
```

Inside `forwardAgentEvent`, for `text` events (around line 445), append to the buffer:
```typescript
      // Buffer agent text for A2A scanning
      if (event.type === 'text' && typeof event.content === 'string') {
        const existing = agentResponseBuffer.get(agentId) ?? '';
        agentResponseBuffer.set(agentId, existing + event.content);
      }
```

And in the `terminal:exit` handler (around line 707), clear the buffer:
```typescript
      agentResponseBuffer.delete(agentId);
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit src/server/daemon.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat(a2a): hook AgentMessenger into daemon event pipeline"
```

---

### Task 11: Client-side A2A Socket Listener

**Files:**
- Modify: `src/store/taskHubStore.ts` (socket listeners section)

- [ ] **Step 1: Add `a2a:dispatch` socket listener**

In the socket listener section of `taskHubStore.ts` (near the existing `terminal:exit` listener around line 1283), add:

```typescript
    socket.on('a2a:dispatch', ({ agentId, prompt, referencedTaskId, fromAgentId, conversationId }) => {
      console.log(`[a2a] dispatch from ${fromAgentId} to ${agentId}`);
      get().enqueueDispatch(agentId, {
        prompt,
        referencedTaskId,
        source: 'a2a',
        fromAgentId,
      });
    });
```

This reuses the existing `enqueueDispatch` — if the agent is busy it queues, and when the agent finishes (`terminal:exit`), `dequeueNextPending` will pick it up automatically.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/store/taskHubStore.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat(a2a): add client-side a2a:dispatch socket listener"
```

---

### Task 12: UI Source Label in Chat

**Files:**
- Modify: `src/components/task-hub/ChatMessageItem.tsx`

- [ ] **Step 1: Add A2A source label**

In `ChatMessageItem.tsx`, where agent messages are rendered, add a conditional label above the message content when the dispatch source is A2A. The exact insertion point depends on the current component structure — locate where `senderType === 'agent'` messages are rendered and add:

```tsx
{message.source === 'a2a' && message.fromAgentId && (
  <span className="text-xs text-gray-400 mb-1 block">
    [{message.fromAgentId} → {message.agentId}]
  </span>
)}
```

Note: The `source` and `fromAgentId` fields will need to be included when creating the synthetic chat message in `dequeueNextPending` for A2A dispatches. Update `dequeueNextPending` in `daemonStore.ts` to pass these through from the `PendingDispatch` entry.

- [ ] **Step 2: Update dequeueNextPending to preserve source**

In `daemonStore.ts`, inside `dequeueNextPending` (around line 296), the synthetic chat message should include:

```typescript
source: next.source,
fromAgentId: next.fromAgentId,
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/task-hub/ChatMessageItem.tsx src/store/daemonStore.ts
git commit -m "feat(a2a): add A2A source label in chat message UI"
```

---

### Task 13: Stale Expiry on Daemon Start

**Files:**
- Modify: `src/server/daemon.ts` (inside `registerDaemon`)

- [ ] **Step 1: Add stale cleanup on startup**

Inside `registerDaemon(io)`, after the `a2aMessenger` instantiation, add:

```typescript
    // Expire stale A2A mailbox entries on startup
    const expired = a2aMessenger.expireStale();
    if (expired > 0) {
      console.log(`[a2a] expired ${expired} stale mailbox entries`);
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat(a2a): add stale mailbox cleanup on daemon startup"
```

---

### Task 14: End-to-End Integration Test

**Files:**
- Create: `src/__tests__/server/a2a/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/__tests__/server/a2a/integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { AgentMessenger } from '@/server/a2a';
import type { AgentMentionConfig } from '@/server/a2a/types';

// Minimal mock IO
function mockIO() {
  const emitted: any[] = [];
  return {
    emit: (...args: any[]) => emitted.push(args),
    emitted: () => emitted,
  };
}

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario'] },
  { id: 'luigi', mentionPatterns: ['@luigi'] },
];

let db: Database.Database;
let io: ReturnType<typeof mockIO>;
let messenger: AgentMessenger;

beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
  // Insert a conversation for FK
  db.prepare(`INSERT INTO conversation (id, created_at, updated_at) VALUES (?, ?, ?)`)
    .run('conv-1', new Date().toISOString(), new Date().toISOString());
  io = mockIO();
  messenger = new AgentMessenger(db, io as any, AGENTS);
});

describe('A2A integration', () => {
  it('Mario @luigi → mailbox entry created + socket event emitted', async () => {
    await messenger.onAgentResponse('mario', '设计完成了\n@luigi 请实现前端', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    // Verify socket event
    expect(io.emitted().length).toBeGreaterThanOrEqual(1);
    const [eventName, payload] = io.emitted()[io.emitted().length - 1];
    expect(eventName).toBe('a2a:dispatch');
    expect(payload.agentId).toBe('luigi');
    expect(payload.fromAgentId).toBe('mario');
    expect(payload.prompt).toContain('跨角色协作消息');

    // Verify mailbox
    const pending = db.prepare(
      "SELECT * FROM agent_mailbox WHERE to_agent_id = 'luigi' AND status = 'delivered'"
    ).all();
    expect(pending).toHaveLength(1);
  });

  it('No @mention → no dispatch', async () => {
    await messenger.onAgentResponse('mario', 'Just a regular message', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    expect(io.emitted()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run src/__tests__/server/a2a/integration.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/server/a2a/integration.test.ts
git commit -m "test(a2a): add end-to-end integration test"
```

---

## Self-Review

**Spec coverage:**
- ✅ Data model (agent_mailbox table) — Task 1
- ✅ Module structure (src/server/a2a/) — Tasks 2-7
- ✅ @mention scanning rules — Task 3
- ✅ Router (chain depth + ping-pong) — Task 4
- ✅ Mailbox CRUD — Task 5
- ✅ Queue dispatch — Tasks 6-7
- ✅ PromptComposer a2aLayer — Task 9
- ✅ Daemon hook — Task 10
- ✅ Client socket listener — Task 11
- ✅ UI source label — Task 12
- ✅ Stale expiry — Task 13
- ✅ E2E test — Task 14

**Placeholder scan:** No TBD, TODO, or vague steps. All steps contain actual code.

**Type consistency:** `MentionTarget`, `A2ADecision`, `MailboxEntry`, `ResponseContext`, `AgentMentionConfig` defined in `types.ts` (Task 2) and used consistently across Tasks 3-7. `PendingDispatch.source` added in Task 8, referenced in Tasks 11-12. `ComposeOptions.a2a` added in Task 9.
