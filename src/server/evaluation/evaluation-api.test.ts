import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import datasetsHandler from '@/pages/api/eval/datasets';
import annotationsHandler from '@/pages/api/eval/annotations';
import experimentsHandler from '@/pages/api/eval/experiments';
import pairwiseHandler from '@/pages/api/eval/pairwise';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';

const now = '2026-07-19T00:00:00.000Z';

type ApiResult = { statusCode: number; body: unknown };

function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  input: { method: string; query?: Record<string, string>; body?: Record<string, unknown> },
): ApiResult {
  const result: ApiResult = { statusCode: 200, body: undefined };
  const response = {
    status(code: number) { result.statusCode = code; return this; },
    json(body: unknown) { result.body = body; return this; },
  } as unknown as NextApiResponse;
  handler({
    method: input.method, query: input.query ?? {}, body: input.body ?? {},
  } as unknown as NextApiRequest, response);
  return result;
}

beforeEach(() => {
  setTestDb(createTestDb());
  const insert = getDb().prepare(`INSERT INTO conversation
    (id,title,status,participants,created_at,updated_at) VALUES (?,?,?,?,?,?)`);
  insert.run('conv-api', 'API 项目', 'active', '[]', now, now);
  insert.run('conv-foreign', '其他项目', 'active', '[]', now, now);
});
afterEach(() => resetDb());

describe('evaluation Pages APIs', () => {
  it('derives audit identity on the server instead of trusting client actor fields', () => {
    const created = call(datasetsHandler, {
      method: 'POST',
      body: {
        conversationId: 'conv-api', name: 'API 数据集', description: '测试服务端身份',
        createdBy: 'forged-admin',
        cases: [{ caseKey: 'case-1', split: 'tune', input: { prompt: 'redacted' } }],
      },
    });
    expect(created.statusCode).toBe(201);
    const dataset = (created.body as { dataset: Record<string, unknown> }).dataset;
    expect(dataset.created_by).toBe('platform-user');
    const item = getDb().prepare('SELECT id FROM eval_case WHERE dataset_id=?').get(dataset.id) as { id: string };
    const annotated = call(annotationsHandler, {
      method: 'POST',
      body: {
        conversationId: 'conv-api', caseId: item.id, reviewerId: 'forged-reviewer', reviewerName: 'Alice',
        dimensionKey: 'correctness', label: 'partial', rationale: '需要补充证据',
      },
    });
    expect(annotated.statusCode).toBe(201);
    expect((annotated.body as { annotation: Record<string, unknown> }).annotation.reviewer_id)
      .toBe('local-reviewer:alice');
    const agreement = call(annotationsHandler, {
      method: 'GET',
      query: { conversationId: 'conv-api', datasetId: String(dataset.id) },
    });
    expect(agreement.body).toMatchObject({
      identityVerification: 'unverified',
      status: 'identity_unverified',
    });
  });

  it('rejects an experiment dataset owned by another project', () => {
    const foreign = call(datasetsHandler, {
      method: 'POST',
      body: { conversationId: 'conv-foreign', name: '外部数据集', description: '不可跨项目使用' },
    });
    const datasetId = String((foreign.body as { dataset: Record<string, unknown> }).dataset.id);
    const result = call(experimentsHandler, {
      method: 'POST',
      body: {
        conversationId: 'conv-api', datasetId, name: '越权实验',
        baselineManifest: {}, candidateManifest: {}, pairs: [],
      },
    });
    expect(result).toMatchObject({ statusCode: 400 });
    expect(result.body).toEqual({ error: 'Dataset not found in project' });
  });

  it('exports a versioned dataset in the same shape accepted by import', () => {
    const created = call(datasetsHandler, {
      method: 'POST',
      body: {
        conversationId: 'conv-api',
        name: 'Portable set',
        description: 'export/import contract',
        cases: [{
          caseKey: 'portable-1',
          split: 'held_out',
          input: { redactedText: 'Implement the change' },
          expected: { correctness: 'pass' },
          metadata: { language: 'en' },
        }],
      },
    });
    const id = String((created.body as { dataset: Record<string, unknown> }).dataset.id);
    const exported = call(datasetsHandler, {
      method: 'GET',
      query: { conversationId: 'conv-api', id },
    });
    expect(exported.body).toMatchObject({
      dataset: {
        schemaVersion: 'agent-eval-dataset/1',
        name: 'Portable set',
        revision: 1,
        cases: [{
          caseKey: 'portable-1',
          split: 'held_out',
          input: { redactedText: expect.any(String) },
          expected: { correctness: 'pass' },
          metadata: { language: 'en' },
        }],
      },
    });
    const foreign = call(datasetsHandler, {
      method: 'GET',
      query: { conversationId: 'conv-foreign', id },
    });
    expect(foreign).toMatchObject({ statusCode: 400, body: { error: 'Dataset not found in project' } });
  });

  it('fails closed instead of claiming blind pairwise integrity without platform identity', () => {
    const result = call(pairwiseHandler, {
      method: 'GET',
      query: { conversationId: 'conv-api', id: 'pairwise-any' },
    });
    expect(result).toMatchObject({ statusCode: 409 });
    expect(result.body).toMatchObject({ code: 'pairwise_blind_integrity_unavailable' });
  });
});
