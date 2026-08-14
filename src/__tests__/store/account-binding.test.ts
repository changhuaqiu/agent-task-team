import { describe, it, expect } from 'vitest';
import {
  providerToEngine,
  resolveAgentEngine,
  AGENT_ROSTER,
  PROVIDER_TO_ENGINE,
  type Agent,
  type Account,
  type CliEngine,
} from '../../store/taskHubStore';

// ---------------------------------------------------------------------------
// providerToEngine
// ---------------------------------------------------------------------------
describe('providerToEngine', () => {
  it('maps anthropic → claude', () => {
    expect(providerToEngine('anthropic')).toBe('claude');
  });

  it('maps openai → codex', () => {
    expect(providerToEngine('openai')).toBe('codex');
  });

  it('maps google → gemini', () => {
    expect(providerToEngine('google')).toBe('gemini');
  });

  it('maps kimi → opencode', () => {
    expect(providerToEngine('kimi')).toBe('opencode');
  });

  it('maps opencode → opencode', () => {
    expect(providerToEngine('opencode')).toBe('opencode');
  });

  it('maps other → opencode', () => {
    expect(providerToEngine('other')).toBe('opencode');
  });
});

// ---------------------------------------------------------------------------
// PROVIDER_TO_ENGINE constant
// ---------------------------------------------------------------------------
describe('PROVIDER_TO_ENGINE', () => {
  it('has an entry for every AccountProvider', () => {
    const providers: Array<keyof typeof PROVIDER_TO_ENGINE> = [
      'anthropic',
      'openai',
      'google',
      'kimi',
      'opencode',
      'other',
    ];
    for (const p of providers) {
      expect(PROVIDER_TO_ENGINE[p]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAgentEngine
// ---------------------------------------------------------------------------
describe('resolveAgentEngine', () => {
  const makeAccount = (overrides: Partial<Account> & { id: string }): Account => ({
    name: `Account ${overrides.id}`,
    authMode: 'api_key',
    provider: 'anthropic',
    baseUrl: '',
    models: [],
    enabled: true,
    status: 'valid',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  const makeAgent = (overrides: Partial<Agent> & { id: string }): Agent => ({
    name: `Agent ${overrides.id}`,
    role: 'worker',
    roleLabel: 'Worker',
    theme: 'mario',
    emoji: '⚔️',
    isOnline: true,
    accountIds: [],
    ...overrides,
  });

  it('returns first matching enabled account\'s engine', () => {
    const agent = makeAgent({ id: 'a1', accountIds: ['acc1'] });
    const accounts = [makeAccount({ id: 'acc1', provider: 'openai' })];

    const result = resolveAgentEngine(agent, accounts);
    expect(result).toEqual({ engine: 'codex', accountId: 'acc1' });
  });

  it('skips disabled accounts', () => {
    const agent = makeAgent({ id: 'a1', accountIds: ['acc1', 'acc2'] });
    const accounts = [
      makeAccount({ id: 'acc1', provider: 'anthropic', enabled: false }),
      makeAccount({ id: 'acc2', provider: 'google', enabled: true }),
    ];

    const result = resolveAgentEngine(agent, accounts);
    expect(result).toEqual({ engine: 'gemini', accountId: 'acc2' });
  });

  it('skips non-existent accounts', () => {
    const agent = makeAgent({ id: 'a1', accountIds: ['ghost', 'acc2'] });
    const accounts = [makeAccount({ id: 'acc2', provider: 'google' })];

    const result = resolveAgentEngine(agent, accounts);
    expect(result).toEqual({ engine: 'gemini', accountId: 'acc2' });
  });

  it('falls through to second account if first is disabled', () => {
    const agent = makeAgent({ id: 'a1', accountIds: ['acc1', 'acc2'] });
    const accounts = [
      makeAccount({ id: 'acc1', provider: 'anthropic', enabled: false }),
      makeAccount({ id: 'acc2', provider: 'google', enabled: true }),
    ];

    const result = resolveAgentEngine(agent, accounts);
    expect(result?.engine).toBe('gemini');
    expect(result?.accountId).toBe('acc2');
  });

  it('returns agent.cliEngine fallback when no accountIds', () => {
    const agent = makeAgent({ id: 'a1', accountIds: [], cliEngine: 'codex' });
    const accounts: Account[] = [];

    const result = resolveAgentEngine(agent, accounts);
    expect(result).toEqual({ engine: 'codex', accountId: '' });
  });

  it('returns null when no binding and no cliEngine', () => {
    const agent = makeAgent({ id: 'a1', accountIds: [] });
    const accounts: Account[] = [];

    const result = resolveAgentEngine(agent, accounts);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AGENT_ROSTER has accountIds on every entry
// ---------------------------------------------------------------------------
describe('AGENT_ROSTER accountIds', () => {
  it('every agent in AGENT_ROSTER has accountIds as an empty array', () => {
    for (const agent of AGENT_ROSTER) {
      expect(agent).toHaveProperty('accountIds');
      expect(Array.isArray(agent.accountIds)).toBe(true);
      expect(agent.accountIds).toEqual([]);
    }
  });
});
