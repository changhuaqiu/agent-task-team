// src/__tests__/server/a2a/integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import { AgentMessenger } from '@/server/a2a';
import type { AgentMentionConfig } from '@/server/a2a/types';

// Minimal mock IO that captures emit calls
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
    const rows = db.prepare(
      "SELECT * FROM agent_mailbox WHERE to_agent_id = 'luigi' AND status = 'delivered'"
    ).all();
    expect(rows).toHaveLength(1);
  });

  it('No @mention → no dispatch', async () => {
    await messenger.onAgentResponse('mario', 'Just a regular message', {
      conversationId: 'conv-1',
      chainDepth: 0,
    });

    expect(io.emitted()).toHaveLength(0);
  });
});
