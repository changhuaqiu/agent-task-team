import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/agent-outcomes';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { WorkContractRepository } from '@/server/work-contract/repository';

function response() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
}

describe('/api/agent-outcomes', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = '2026-07-28T08:00:00.000Z';
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-api-outcome', 'Outcome API', 'active', now, now);
  });

  afterEach(() => resetDb());

  it('accepts the current fenced contract and deduplicates retries', () => {
    const contract = new WorkContractRepository().issue({
      workId: 'work-api',
      attemptId: 'attempt-api',
      projectId: 'project-api-outcome',
      agentId: 'builder',
      goal: 'Build',
      acceptanceCriteria: ['done'],
      role: {},
      permissions: {},
      authoritativeRefs: ['task:1'],
      authoritativeRevisions: { task: 1 },
      contextSnapshotRef: 'ctx-api',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-api',
      causationId: 'trigger-api',
    });
    const body = {
      outcomeId: 'outcome-api',
      idempotencyKey: 'outcome-api-key',
      contractId: contract.contractId,
      outcomeType: 'submit_task_result',
      payload: { summary: 'done' },
      evidenceRefs: ['artifact:sha'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: '2026-07-28T08:01:00.000Z',
    };
    const accepted = response();
    handler(
      { method: 'POST', body } as NextApiRequest,
      accepted as unknown as NextApiResponse,
    );
    expect(accepted).toMatchObject({
      statusCode: 202,
      body: { ok: true, status: 'accepted', outcomeId: 'outcome-api' },
    });

    const duplicate = response();
    handler(
      { method: 'POST', body } as NextApiRequest,
      duplicate as unknown as NextApiResponse,
    );
    expect(duplicate).toMatchObject({
      statusCode: 200,
      body: { ok: true, status: 'duplicate', outcomeId: 'outcome-api' },
    });
  });

  it('returns a stable validation error for malformed envelopes', () => {
    const res = response();
    handler(
      { method: 'POST', body: { outcomeType: 'made_up' } } as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res).toMatchObject({
      statusCode: 400,
      body: { ok: false, reasonCode: 'invalid_agent_outcome_input' },
    });
  });
});
