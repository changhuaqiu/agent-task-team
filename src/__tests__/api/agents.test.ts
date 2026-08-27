import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/agents';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { agentDefinitionRepo } from '@/server/agents/agent-definition-repo';
import { PlatformEventLog } from '@/server/platform-events';

function response() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
}

describe('/api/agents Agent Definition ownership', () => {
  beforeEach(() => setTestDb(createTestDb()));
  afterEach(() => resetDb());

  it('persists execution preferences, accounts, skills, and permissions on the Agent', async () => {
    const res = response();
    await handler({
      method: 'POST',
      body: {
        id: 'agent-owned-profile',
        name: 'Owned Agent',
        roleCardId: 'preset-planner',
        theme: 'mario',
        emoji: '🤖',
        instructions: 'Own the complete execution profile.',
        runtimeId: 'codex',
        accountIds: ['account-primary'],
        skillIds: [],
        model: 'gpt-owned',
        permissions: { canModifyCode: true, canReview: false },
      },
    } as NextApiRequest, res as unknown as NextApiResponse);

    expect(res.statusCode).toBe(200);
    const body = res.body as { agent: { id: string }; receipt: { status: string } };
    expect(body.receipt.status).toBe('applied');
    expect(agentDefinitionRepo.get(body.agent.id)).toMatchObject({
      runtime_id: 'codex',
      account_ids: ['account-primary'],
      model: 'gpt-owned',
      can_modify_code: 1,
      can_review: 0,
    });
    expect(new PlatformEventLog().listStream(`agent:${body.agent.id}`).map((event) => event.type))
      .toEqual(['agent.created']);
  });

  it('routes compatibility updates through revision-fenced agent.update', async () => {
    const created = response();
    await handler({ method: 'POST', body: {
      id: 'agent-update-through-kernel', name: 'Builder', roleCardId: 'preset-builder',
      theme: 'mario', emoji: '🤖', instructions: 'Build.', runtimeId: 'codex',
      accountIds: [], skillIds: [], permissions: { canModifyCode: true, canReview: false },
    } } as NextApiRequest, created as unknown as NextApiResponse);
    const agentId = (created.body as { agent: { id: string } }).agent.id;
    const updated = response();
    await handler({ method: 'PATCH', body: {
      id: agentId, expectedRevision: 1, name: 'Principal Builder', parallelism: 2,
    } } as NextApiRequest, updated as unknown as NextApiResponse);

    expect(updated.statusCode).toBe(200);
    expect(updated.body).toMatchObject({ receipt: { status: 'applied', revision: 2 }, agent: { name: 'Principal Builder' } });
    expect(new PlatformEventLog().listStream(`agent:${agentId}`).map((event) => event.type))
      .toEqual(['agent.created', 'agent.updated']);
  });

  it('does not allow the compatibility endpoint to bypass the kernel for deletion', async () => {
    const res = response();
    await handler({ method: 'DELETE', query: { id: 'mario' }, body: {} } as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(410);
  });
});
