import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReq, mockRes } from '../../../test-helpers/mock-api';

// Mock storage modules before importing handler
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

import handler from '../../../pages/api/accounts/index';
import { hasCredential, writeCredential } from '../../../server/credentials';
import { listAccounts, writeAccount, hasAccount } from '../../../server/accounts-file';

describe('GET /api/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty list when no accounts', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);

    const req = mockReq('GET');
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json).toEqual({ accounts: [] });
  });

  it('returns accounts with hasApiKey derived from credentials', async () => {
    const accounts = [
      { id: 'acct-1', name: 'A1', authMode: 'api_key', provider: 'openai', models: [], enabled: true, status: 'valid', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'acct-2', name: 'A2', authMode: 'api_key', provider: 'anthropic', models: [], enabled: true, status: 'valid', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];
    vi.mocked(listAccounts).mockResolvedValue(accounts as any[]);
    vi.mocked(hasCredential).mockReturnValue(true);
    (hasCredential as any).mockImplementation((id: string) => id === 'acct-1');

    const req = mockReq('GET');
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.accounts).toHaveLength(2);
    expect(res._json.accounts[0]).toMatchObject({ id: 'acct-1', hasApiKey: true });
    expect(res._json.accounts[1]).toMatchObject({ id: 'acct-2', hasApiKey: false });
  });
});

describe('POST /api/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates account with api_key auth', async () => {
    vi.mocked(hasAccount).mockResolvedValue(false);
    vi.mocked(writeAccount).mockResolvedValue(undefined);
    vi.mocked(writeCredential).mockResolvedValue(undefined);

    const req = mockReq('POST', {
      name: 'My OpenAI',
      authMode: 'api_key',
      provider: 'openai',
      apiKey: 'sk-123',
      models: ['gpt-4'],
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res._json.account).toBeDefined();
    expect(res._json.account.name).toBe('My OpenAI');
    expect(res._json.account.authMode).toBe('api_key');
    expect(res._json.account.provider).toBe('openai');
    expect(res._json.account.models).toEqual(['gpt-4']);
    expect(res._json.account.id).toMatch(/^acct-/);
    expect(res._json.account.status).toBe('pending');
  });

  it('creates a supported account with oauth auth', async () => {
    vi.mocked(hasAccount).mockResolvedValue(false);
    vi.mocked(writeAccount).mockResolvedValue(undefined);

    const req = mockReq('POST', {
      name: 'My Claude',
      authMode: 'oauth',
      provider: 'anthropic',
      models: ['claude-sonnet-4-6'],
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res._json.account.authMode).toBe('oauth');
    expect(res._json.account.status).toBe('unknown');
  });

  it.each(['google', 'kimi', 'opencode', 'other'] as const)(
    'rejects %s OAuth because OpenCode requires an API key',
    async (provider) => {
    const req = mockReq('POST', {
      name: `My ${provider}`,
      authMode: 'oauth',
      provider,
      models: ['model-1'],
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/requires API Key/);
    expect(writeAccount).not.toHaveBeenCalled();
    },
  );

  it('creates a Google API Key account without requiring a custom baseUrl', async () => {
    vi.mocked(hasAccount).mockResolvedValue(false);
    const req = mockReq('POST', {
      name: 'Google API Key',
      authMode: 'api_key',
      provider: 'google',
      apiKey: 'google-key',
      models: ['gemini-2.5-pro'],
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res._json.account).toMatchObject({
      authMode: 'api_key',
      provider: 'google',
      models: ['gemini-2.5-pro'],
    });
  });

  it('requires a Base URL for OpenCode-compatible providers', async () => {
    const res = mockRes();
    await handler(mockReq('POST', {
      name: 'Kimi API Key',
      authMode: 'api_key',
      provider: 'kimi',
      apiKey: 'kimi-key',
      models: ['moonshot-v2'],
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/Base URL/);
    expect(writeAccount).not.toHaveBeenCalled();
  });

  it('does not create an API Key account without a key or model', async () => {
    const noKey = mockRes();
    await handler(mockReq('POST', {
      name: 'No key', authMode: 'api_key', provider: 'google', models: ['gemini-2.5-pro'],
    }), noKey);
    expect(noKey.statusCode).toBe(400);
    expect(noKey._json.error).toMatch(/API Key is required/);

    const noModel = mockRes();
    await handler(mockReq('POST', {
      name: 'No model', authMode: 'api_key', provider: 'google', apiKey: 'google-key', models: [],
    }), noModel);
    expect(noModel.statusCode).toBe(400);
    expect(noModel._json.error).toMatch(/model/);
    expect(writeAccount).not.toHaveBeenCalled();
  });

  it('rejects missing required fields (400)', async () => {
    const req = mockReq('POST', { provider: 'openai' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it.each([
    { provider: 'fake-provider', authMode: 'api_key' },
    { provider: 'openai', authMode: 'magic-login' },
  ])('rejects unsupported account discriminants: $provider/$authMode', async ({ provider, authMode }) => {
    const res = mockRes();
    await handler(mockReq('POST', {
      name: 'Invalid account', provider, authMode, apiKey: 'key', models: ['model'],
    }), res);
    expect(res.statusCode).toBe(400);
    expect(writeAccount).not.toHaveBeenCalled();
  });

  it('rejects duplicate name (409)', async () => {
    vi.mocked(hasAccount).mockResolvedValue(true);

    const req = mockReq('POST', {
      name: 'Existing',
      authMode: 'api_key',
      provider: 'openai',
      apiKey: 'sk-existing',
      models: ['gpt-4'],
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
  });

  it('writes apiKey to credential store', async () => {
    vi.mocked(hasAccount).mockResolvedValue(false);
    vi.mocked(writeAccount).mockResolvedValue(undefined);
    vi.mocked(writeCredential).mockResolvedValue(undefined);

    const req = mockReq('POST', {
      name: 'With Key',
      authMode: 'api_key',
      provider: 'openai',
      apiKey: 'sk-test-key',
      models: ['gpt-4'],
    });
    const res = mockRes();

    await handler(req, res);

    expect(writeCredential).toHaveBeenCalledTimes(1);
    expect(writeCredential).toHaveBeenCalledWith(
      expect.stringMatching(/^acct-/),
      expect.objectContaining({ apiKey: 'sk-test-key' }),
    );
  });

  it('generates unique id', async () => {
    vi.mocked(hasAccount).mockResolvedValue(false);
    vi.mocked(writeAccount).mockResolvedValue(undefined);
    vi.mocked(writeCredential).mockResolvedValue(undefined);

    const ids = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const req = mockReq('POST', {
        name: `Account ${i}`,
        authMode: 'api_key',
        provider: 'openai',
        apiKey: `key-${i}`,
        models: ['gpt-4'],
      });
      const res = mockRes();
      await handler(req, res);
      ids.add(res._json.account.id);
    }

    expect(ids.size).toBe(10);
  });
});
