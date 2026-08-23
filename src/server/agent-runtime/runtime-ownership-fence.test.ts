import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { conversationRepo } from '../repositories/conversation-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { RuntimeOwnershipFence, RuntimeOwnershipLostError } from './runtime-ownership-fence';

describe('RuntimeOwnershipFence', () => {
  beforeEach(() => {
    setTestDb(createTestDb());
    conversationRepo.create({ id: 'project-1', title: 'Project' });
  });
  afterEach(() => resetDb());

  it('atomically rejects a durable callback after owner lease takeover', () => {
    const invocation = invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'project-1',
      agent_id: 'agent-1',
      runtime_owner_id: 'daemon-1',
      runtime_owner_token: 'owner-1',
      runtime_lease_ms: 45_000,
    });
    const onOwnershipLost = vi.fn();
    const fence = new RuntimeOwnershipFence({
      invocationId: invocation.id,
      runtimeOwnerToken: 'owner-1',
      onOwnershipLost,
    });
    const log = new PlatformEventLog();
    const appendPermission = () => log.append({
      type: 'runtime.permission.requested',
      category: 'runtime_lifecycle',
      projectId: 'project-1',
      streamKey: 'runtime:inv-1',
      aggregate: { type: 'invocation', id: 'inv-1' },
      actor: { type: 'runtime', id: 'daemon-1' },
      correlationId: 'trace-1',
      payload: { requestId: 'permission-1' },
    });

    fence.commit(appendPermission);
    getDb().prepare(`UPDATE invocation SET lease_expiry=? WHERE id=?`)
      .run('2026-01-01T00:00:00.000Z', invocation.id);

    expect(() => fence.commit(appendPermission)).toThrow(RuntimeOwnershipLostError);
    expect(onOwnershipLost).toHaveBeenCalledOnce();
    expect(log.listStream('runtime:inv-1')).toHaveLength(1);
  });
});
