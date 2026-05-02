import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReq, mockRes } from '../../../test-helpers/mock-api';

vi.mock('../../../server/credentials', () => ({
  readCredential: vi.fn(),
}));

vi.mock('../../../server/accounts-file', () => ({
  readAccount: vi.fn(),
  writeAccount: vi.fn(),
}));

vi.mock('../../../server/cli-probe', () => ({
  tryCliProbe: vi.fn(),
  buildProbeEnv: vi.fn(),
}));

import handler from '../../../pages/api/accounts/verify';
import { readCredential } from '../../../server/credentials';
import { readAccount, writeAccount } from '../../../server/accounts-file';
import { tryCliProbe, buildProbeEnv } from '../../../server/cli-probe';

const mockReadAccount = vi.mocked(readAccount);
const mockReadCredential = vi.mocked(readCredential);
const mockWriteAccount = vi.mocked(writeAccount);
const mockTryCliProbe = vi.mocked(tryCliProbe);
const mockBuildProbeEnv = vi.mocked(buildProbeEnv);

describe('POST /api/accounts/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildProbeEnv.mockReturnValue({ SOME_KEY: 'value' });
  });

  it('returns ok:true for valid account with working CLI', async () => {
    mockReadAccount.mockResolvedValue({
      id: 'acct-1',
      name: 'Test',
      provider: 'anthropic',
      authMode: 'api_key',
      models: ['claude-sonnet-4-6'],
      enabled: true,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as any);
    mockReadCredential.mockResolvedValue({ apiKey: 'sk-test' });
    mockTryCliProbe.mockResolvedValue({ ok: true });
    mockWriteAccount.mockResolvedValue(undefined);

    const req = mockReq('POST', { accountId: 'acct-1' });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
  });

  it('returns ok:false for account with bad API key', async () => {
    mockReadAccount.mockResolvedValue({
      id: 'acct-1',
      name: 'Test',
      provider: 'anthropic',
      authMode: 'api_key',
      models: ['claude-sonnet-4-6'],
      enabled: true,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as any);
    mockReadCredential.mockResolvedValue({ apiKey: 'sk-bad' });
    mockTryCliProbe.mockResolvedValue({ ok: false, error: 'invalid api key' });
    mockWriteAccount.mockResolvedValue(undefined);

    const req = mockReq('POST', { accountId: 'acct-1' });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(false);
    expect(res._json.error).toMatch(/invalid api key/i);
  });

  it('returns ok:false for account with no API key (api_key auth mode)', async () => {
    mockReadAccount.mockResolvedValue({
      id: 'acct-1',
      name: 'Test',
      provider: 'anthropic',
      authMode: 'api_key',
      models: ['claude-sonnet-4-6'],
      enabled: true,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as any);
    mockReadCredential.mockResolvedValue(null);
    mockWriteAccount.mockResolvedValue(undefined);

    const req = mockReq('POST', { accountId: 'acct-1' });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(false);
    expect(res._json.error).toBeTruthy();
  });

  it('returns 404 for missing account', async () => {
    mockReadAccount.mockResolvedValue(undefined);

    const req = mockReq('POST', { accountId: 'acct-missing' });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('updates account status to valid on success', async () => {
    mockReadAccount.mockResolvedValue({
      id: 'acct-1',
      name: 'Test',
      provider: 'anthropic',
      authMode: 'api_key',
      models: ['claude-sonnet-4-6'],
      enabled: true,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as any);
    mockReadCredential.mockResolvedValue({ apiKey: 'sk-test' });
    mockTryCliProbe.mockResolvedValue({ ok: true });
    mockWriteAccount.mockResolvedValue(undefined);

    const req = mockReq('POST', { accountId: 'acct-1' });
    const res = mockRes();
    await handler(req, res);

    expect(mockWriteAccount).toHaveBeenCalledTimes(1);
    const written = mockWriteAccount.mock.calls[0][0] as any;
    expect(written.status).toBe('valid');
    expect(written.verifyError).toBeUndefined();
  });

  it('updates account status to error on failure', async () => {
    mockReadAccount.mockResolvedValue({
      id: 'acct-1',
      name: 'Test',
      provider: 'anthropic',
      authMode: 'api_key',
      models: ['claude-sonnet-4-6'],
      enabled: true,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as any);
    mockReadCredential.mockResolvedValue({ apiKey: 'sk-bad' });
    mockTryCliProbe.mockResolvedValue({ ok: false, error: 'authentication failed' });
    mockWriteAccount.mockResolvedValue(undefined);

    const req = mockReq('POST', { accountId: 'acct-1' });
    const res = mockRes();
    await handler(req, res);

    expect(mockWriteAccount).toHaveBeenCalledTimes(1);
    const written = mockWriteAccount.mock.calls[0][0] as any;
    expect(written.status).toBe('error');
    expect(written.verifyError).toBe('authentication failed');
  });

  it('sets lastVerifiedAt timestamp', async () => {
    mockReadAccount.mockResolvedValue({
      id: 'acct-1',
      name: 'Test',
      provider: 'anthropic',
      authMode: 'api_key',
      models: ['claude-sonnet-4-6'],
      enabled: true,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as any);
    mockReadCredential.mockResolvedValue({ apiKey: 'sk-test' });
    mockTryCliProbe.mockResolvedValue({ ok: true });
    mockWriteAccount.mockResolvedValue(undefined);

    const before = new Date().toISOString();
    const req = mockReq('POST', { accountId: 'acct-1' });
    const res = mockRes();
    await handler(req, res);
    const after = new Date().toISOString();

    const written = mockWriteAccount.mock.calls[0][0] as any;
    expect(written.lastVerifiedAt).toBeTruthy();
    expect(new Date(written.lastVerifiedAt).toISOString()).not.toBeNaN();
    expect(written.lastVerifiedAt >= before).toBe(true);
    expect(written.lastVerifiedAt <= after).toBe(true);
  });

  it('rejects GET method', async () => {
    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects missing accountId', async () => {
    const req = mockReq('POST', {});
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});
