import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { generateSortableId, resetSeq } from '@/server/repositories/sortable-id';
import { dispatchRepo } from '@/server/repositories/dispatch-repo';
import { invocationRepo } from '@/server/repositories/invocation-repo';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO conversation (id,title,status,created_at,updated_at)
    VALUES ('conv-1','Dispatch queue','active',?,?)`).run(now, now);
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('dispatchRepo', () => {
  function seedInvocation(agentId = 'mario', _status = 'queued') {
    return invocationRepo.create({
      id: generateSortableId('inv'),
      conversation_id: 'conv-1',
      agent_id: agentId,
      task_id: 'TASK-001',
      engine: 'claude',
    });
  }

  describe('claimNext', () => {
    it('claims the oldest queued invocation for an agent', () => {
      seedInvocation('mario', 'queued');
      const claimed = dispatchRepo.claimNext('mario', 300);
      expect(claimed).toBeDefined();
      expect(claimed!.dispatch_status).toBe('claimed');
      expect(claimed!.lease_expiry).toBeDefined();
    });

    it('returns undefined when no queued invocations exist', () => {
      const claimed = dispatchRepo.claimNext('mario', 300);
      expect(claimed).toBeUndefined();
    });

    it('returns undefined when invocation is already claimed', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', 300);
      const second = dispatchRepo.claimNext('mario', 300);
      expect(second).toBeUndefined();
    });

    it('claims by oldest first (FIFO)', () => {
      const first = seedInvocation('mario', 'queued');
      seedInvocation('mario', 'queued');
      const claimed = dispatchRepo.claimNext('mario', 300);
      expect(claimed!.id).toBe(first.id);
    });
  });

  describe('findStaleDispatches', () => {
    it('returns claimed invocations past their lease', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', -1);
      const stale = dispatchRepo.findStaleDispatches();
      expect(stale).toHaveLength(1);
    });

    it('does not return non-expired dispatches', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', 3600);
      const stale = dispatchRepo.findStaleDispatches();
      expect(stale).toHaveLength(0);
    });
  });

  describe('resetStaleToQueued', () => {
    it('resets stale dispatches back to queued', () => {
      seedInvocation('mario', 'queued');
      dispatchRepo.claimNext('mario', -1);
      dispatchRepo.resetStaleToQueued();
      const stale = dispatchRepo.findStaleDispatches();
      expect(stale).toHaveLength(0);
      const reclaimed = dispatchRepo.claimNext('mario', 300);
      expect(reclaimed).toBeDefined();
    });
  });

  describe('findPendingForAgent', () => {
    it('returns queued invocations for a specific agent', () => {
      seedInvocation('mario', 'queued');
      seedInvocation('luigi', 'queued');
      const marioPending = dispatchRepo.findPendingForAgent('mario');
      expect(marioPending).toHaveLength(1);
      expect(marioPending[0].agent_id).toBe('mario');
    });
  });
});
