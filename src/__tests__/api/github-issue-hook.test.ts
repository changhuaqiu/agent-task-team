import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutonomousDeliveryRepository } from '@/server/autonomous-delivery/repository';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { githubIssuePayload } from '@/server/github-issue-hook/test-fixtures';
import type { NextApiRequest, NextApiResponse } from 'next';

const runtime = vi.hoisted(() => ({
  deliveryRuntime: undefined as unknown,
  ensureSocketRuntime: vi.fn(),
}));

vi.mock('@/server/autonomous-delivery/bootstrap', () => ({
  ensureAutonomousDeliveryRuntime: () => runtime.deliveryRuntime,
}));

vi.mock('@/server/socket-runtime', () => ({
  ensureProjectSocketRuntime: runtime.ensureSocketRuntime,
}));

import handler from '@/pages/api/integrations/github/issues';

function signedRequest(body: Buffer, eventName = 'issues', deliveryId = 'delivery-api-42') {
  const secret = process.env.GITHUB_ISSUE_WEBHOOK_SECRET!;
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const request = Readable.from([body]) as Readable & Record<string, unknown>;
  request.method = 'POST';
  request.headers = {
    'content-length': String(body.length),
    'x-hub-signature-256': signature,
    'x-github-event': eventName,
    'x-github-delivery': deliveryId,
  };
  return request as unknown as NextApiRequest;
}

function response() {
  const res: {
    statusCode: number;
    body: Record<string, unknown>;
    headers: Record<string, unknown>;
    socket: { server: { io: Record<string, never> } };
    status?: ReturnType<typeof vi.fn>;
    json?: ReturnType<typeof vi.fn>;
    setHeader?: ReturnType<typeof vi.fn>;
  } = {
    statusCode: 200,
    body: {},
    headers: {},
    socket: { server: { io: {} } },
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn((key: string, value: unknown) => {
    res.headers[key] = value;
    return res;
  });
  return res as unknown as NextApiResponse & {
    statusCode: number;
    body: Record<string, unknown>;
  };
}

describe('POST /api/integrations/github/issues', () => {
  let projectPath: string;
  let advance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setTestDb(createTestDb());
    projectPath = mkdtempSync(join(tmpdir(), 'github-issue-api-'));
    vi.stubEnv('GITHUB_ISSUE_WEBHOOK_SECRET', 'a-secure-test-secret-value');
    vi.stubEnv('GITHUB_ISSUE_WEBHOOK_REPOSITORY', 'acme/widgets');
    vi.stubEnv('GITHUB_ISSUE_WEBHOOK_PROJECT_PATH', projectPath);
    const repository = new AutonomousDeliveryRepository();
    advance = vi.fn().mockResolvedValue(undefined);
    runtime.deliveryRuntime = {
      start: (contract: Parameters<AutonomousDeliveryRepository['createRun']>[0]) =>
        repository.createRun(contract),
      advance,
    };
    runtime.ensureSocketRuntime.mockReset();
    runtime.ensureSocketRuntime.mockReturnValue({ io: {}, created: true });
  });

  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('accepts a signed issue and schedules the Delivery Control Runtime', async () => {
    const raw = Buffer.from(JSON.stringify(githubIssuePayload()));
    const res = response();
    await handler(signedRequest(raw), res);

    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      ok: true,
      disposition: 'accepted',
    });
    expect(res.body.conversationId).toEqual(expect.any(String));
    expect(res.body.deliveryRunId).toEqual(expect.any(String));
    expect(advance).toHaveBeenCalledWith(
      res.body.deliveryRunId,
      { kind: 'started', ref: 'github:delivery-api-42' },
    );
    expect(runtime.ensureSocketRuntime).toHaveBeenCalledTimes(1);
  });

  it('returns the same mapping for a GitHub retry', async () => {
    const raw = Buffer.from(JSON.stringify(githubIssuePayload()));
    const first = response();
    const second = response();
    await handler(signedRequest(raw), first);
    await handler(signedRequest(raw), second);

    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual({
      ok: true,
      disposition: 'duplicate',
      conversationId: first.body.conversationId,
      deliveryRunId: first.body.deliveryRunId,
    });
  });

  it('rejects an invalid signature before creating work', async () => {
    const raw = Buffer.from(JSON.stringify(githubIssuePayload()));
    const request = signedRequest(raw);
    request.headers['x-hub-signature-256'] = `sha256=${'0'.repeat(64)}`;
    const res = response();
    await handler(request, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ reasonCode: 'signature_invalid' });
    expect(advance).not.toHaveBeenCalled();
  });

  it('rejects a missing signature before creating work', async () => {
    const raw = Buffer.from(JSON.stringify(githubIssuePayload()));
    const request = signedRequest(raw);
    delete request.headers['x-hub-signature-256'];
    const res = response();
    await handler(request, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ reasonCode: 'signature_missing' });
    expect(advance).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload at the API boundary', async () => {
    const raw = Buffer.from(JSON.stringify(githubIssuePayload()));
    const request = signedRequest(raw);
    request.headers['content-length'] = String((1024 * 1024) + 1);
    const res = response();
    await handler(request, res);

    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ reasonCode: 'payload_too_large' });
    expect(advance).not.toHaveBeenCalled();
  });

  it('handles GitHub ping without starting a delivery', async () => {
    const raw = Buffer.from(JSON.stringify({ zen: 'Keep it logically awesome.' }));
    const res = response();
    await handler(signedRequest(raw, 'ping', 'delivery-ping'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, disposition: 'ping' });
    expect(advance).not.toHaveBeenCalled();
  });

  it('ignores unsupported Issue actions even when the runtime is offline', async () => {
    const payload = githubIssuePayload({ action: 'edited' });
    const raw = Buffer.from(JSON.stringify(payload));
    const res = response();
    (res.socket as unknown as { server?: unknown }).server = undefined;
    await handler(signedRequest(raw), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      disposition: 'ignored',
      reason: 'action_unsupported',
    });
    expect(advance).not.toHaveBeenCalled();
    expect(runtime.ensureSocketRuntime).not.toHaveBeenCalled();
  });

  it('returns a recoverable error when a valid cold-start request cannot initialize runtime', async () => {
    runtime.ensureSocketRuntime.mockReturnValue(undefined);
    const raw = Buffer.from(JSON.stringify(githubIssuePayload()));
    const res = response();
    await handler(signedRequest(raw, 'issues', 'delivery-runtime-offline'), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ reasonCode: 'runtime_unavailable' });
    expect(advance).not.toHaveBeenCalled();
  });
});
