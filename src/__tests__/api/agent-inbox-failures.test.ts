import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/agent-inbox-failures';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { upsertAgent } from '@/server/db/agentQueries';
import { AgentInbox } from '@/server/platform-events/agent-inbox';

function response() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string | string[]>,
    setHeader(name: string, value: string | string[]) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
}

function request(itemId: string) {
  return { method: 'POST', body: { action: 'retry', itemId } } as NextApiRequest;
}

describe('/api/agent-inbox-failures', () => {
  let inbox: AgentInbox;

  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-retry-api','Retry API','active',?,?)
    `).run(now, now);
    upsertAgent({
      id: 'mario', name: 'Mario', roleCardId: 'planner', theme: 'red', emoji: '🍄',
      isPreset: true,
    });
    inbox = new AgentInbox({ db });
  });

  afterEach(() => resetDb());

  function failedHuman(targetAgentId = 'mario') {
    const item = inbox.enqueue({
      projectId: 'project-retry-api', projectAgentId: targetAgentId,
      idempotencyKey: `failed-human-${targetAgentId}`,
      command: {
        source: 'a2a', prompt: 'Plan this work', fromAgentId: 'human',
        a2aHandoff: {
          title: 'Human request', requestedAction: 'Plan this work',
          possessionSummary: 'Plan this work', relevantDecisions: [], evidenceRefs: [],
          constraints: [], openQuestions: [], forbiddenBehaviors: [],
          sourceMessageIds: ['message-api'],
        },
      },
    });
    const claim = inbox.claimNext()!;
    inbox.expire(item.id, claim.leaseToken!, 'runtime_start_failed');
    return item;
  }

  it('returns the same replacement for a repeated successful retry', () => {
    const failed = failedHuman();
    const first = response();
    const duplicate = response();

    handler(request(failed.id), first as unknown as NextApiResponse);
    handler(request(failed.id), duplicate as unknown as NextApiResponse);

    expect(first).toMatchObject({
      statusCode: 200,
      body: { item: { id: expect.any(String), status: 'enqueued' }, reissued: true },
    });
    expect(duplicate.body).toEqual(first.body);
  });

  it('returns 422 when the original target is no longer in the Project roster', () => {
    const failed = failedHuman('removed-agent');
    const res = response();

    handler(request(failed.id), res as unknown as NextApiResponse);

    expect(res).toMatchObject({
      statusCode: 422,
      body: { reasonCode: 'a2a_target_not_in_roster' },
    });
    expect(inbox.get(failed.id)?.status).toBe('expired');
  });

  it('returns 409 instead of replaying an Agent-owned A2A pass as a user turn', () => {
    const failed = inbox.enqueue({
      projectId: 'project-retry-api', projectAgentId: 'mario',
      idempotencyKey: 'failed-agent-owned',
      command: { source: 'a2a', prompt: 'Review', fromAgentId: 'luigi' },
    });
    const claim = inbox.claimNext()!;
    inbox.expire(failed.id, claim.leaseToken!, 'runtime_start_failed');
    const res = response();

    handler(request(failed.id), res as unknown as NextApiResponse);

    expect(res).toMatchObject({
      statusCode: 409,
      body: { reasonCode: 'a2a_retry_requires_source_recovery' },
    });
  });
});
