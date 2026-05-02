import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReq, mockRes } from '../../../test-helpers/mock-api';

vi.mock('../../../server/credentials', () => ({
  readCredential: vi.fn(),
  writeCredential: vi.fn(),
  deleteCredential: vi.fn(),
  hasCredential: vi.fn(),
}));

vi.mock('../../../server/accounts-file', () => ({
  readAccount: vi.fn(),
  writeAccount: vi.fn(),
  deleteAccount: vi.fn(),
  listAccounts: vi.fn(),
  hasAccount: vi.fn(),
}));

import handler from '../../../pages/api/accounts/[id]';
import { hasCredential, writeCredential, deleteCredential } from '../../../server/credentials';
import { readAccount, writeAccount, deleteAccount } from '../../../server/accounts-file';

const sampleAccount = {
  id: 'acct-123',
  name: 'Test Account',
  authMode: 'api_key' as const,
  provider: 'openai' as const,
  models: ['gpt-4'],
  enabled: true,
  status: 'valid' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/accounts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns single account with hasApiKey', async () => {
    vi.mocked(readAccount).mockResolvedValue(sampleAccount as any);
    vi.mocked(hasCredential).mockResolvedValue(true);

    const req = mockReq('GET', {}, { id: 'acct-123' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json).toEqual({ account: sampleAccount, hasApiKey: true });
  });

  it('returns 404 for missing account', async () => {
    vi.mocked(readAccount).mockResolvedValue(undefined);

    const req = mockReq('GET', {}, { id: 'acct-nonexistent' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/accounts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates name', async () => {
    vi.mocked(readAccount).mockResolvedValue(sampleAccount as any);
    vi.mocked(writeAccount).mockResolvedValue(undefined);

    const req = mockReq('PATCH', { name: 'Updated Name' }, { id: 'acct-123' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.account.name).toBe('Updated Name');
    expect(writeAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated Name' }),
    );
  });

  it('updates apiKey in credential store', async () => {
    vi.mocked(readAccount).mockResolvedValue(sampleAccount as any);
    vi.mocked(writeAccount).mockResolvedValue(undefined);
    vi.mocked(writeCredential).mockResolvedValue(undefined);

    const req = mockReq('PATCH', { apiKey: 'sk-new-key' }, { id: 'acct-123' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(writeCredential).toHaveBeenCalledWith(
      'acct-123',
      expect.objectContaining({ apiKey: 'sk-new-key' }),
    );
  });

  it('rejects authMode change (400)', async () => {
    vi.mocked(readAccount).mockResolvedValue(sampleAccount as any);

    const req = mockReq('PATCH', { authMode: 'oauth' }, { id: 'acct-123' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/authMode/i);
  });

  it('returns 404 for missing account', async () => {
    vi.mocked(readAccount).mockResolvedValue(undefined);

    const req = mockReq('PATCH', { name: 'New' }, { id: 'acct-nonexistent' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/accounts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes from both stores', async () => {
    vi.mocked(readAccount).mockResolvedValue(sampleAccount as any);
    vi.mocked(deleteAccount).mockResolvedValue(undefined);
    vi.mocked(deleteCredential).mockResolvedValue(undefined);

    const req = mockReq('DELETE', {}, { id: 'acct-123' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json).toEqual({ ok: true });
    expect(deleteAccount).toHaveBeenCalledWith('acct-123');
    expect(deleteCredential).toHaveBeenCalledWith('acct-123');
  });

  it('returns 404 for missing account', async () => {
    vi.mocked(readAccount).mockResolvedValue(undefined);

    const req = mockReq('DELETE', {}, { id: 'acct-nonexistent' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });
});
