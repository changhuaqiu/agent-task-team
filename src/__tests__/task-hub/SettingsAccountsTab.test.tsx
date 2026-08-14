// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsAccountsTab } from '@/components/task-hub/SettingsAccountsTab';
import { useTaskHubStore } from '@/store/taskHubStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsAccountsTab verification reconciliation', () => {
  it('reloads the canonical account projection after verify without PATCHing the verified account', async () => {
    const upsertAccount = vi.fn();
    const loadAccounts = vi.fn().mockResolvedValue(undefined);
    useTaskHubStore.setState({
      accounts: [{
        id: 'acct-google', name: 'Google', provider: 'google', authMode: 'api_key',
        models: ['gemini-2.5-pro'], enabled: true, status: 'pending', hasApiKey: true,
        createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
      }],
      upsertAccount: upsertAccount as never,
      loadAccounts: loadAccounts as never,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsAccountsTab />);
    fireEvent.click(screen.getByLabelText('测试连接'));

    await waitFor(() => expect(loadAccounts).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/accounts/verify', expect.objectContaining({ method: 'POST' }));
    expect(upsertAccount).not.toHaveBeenCalled();
  });
});
