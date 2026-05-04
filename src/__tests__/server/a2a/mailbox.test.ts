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
  // Insert a conversation for FK constraint
  db.prepare(`INSERT INTO conversation (id, created_at, updated_at) VALUES (?, ?, ?)`)
    .run('conv-1', new Date().toISOString(), new Date().toISOString());
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
    expect(pending[0].from_agent_id).toBe('mario');
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
