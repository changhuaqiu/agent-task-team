// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsRuntimesTab } from '@/components/task-hub/SettingsRuntimesTab';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsRuntimesTab', () => {
  it('creates a custom ACP harness and shows it in the unified catalog', async () => {
    const custom = {
      id: 'custom:my-agent', label: 'My ACP Agent', delivery: 'native', available: false,
      capabilities: [], status: 'needs_setup', custom: true,
    };
    let created = false;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') created = true;
      return { ok: true, json: async () => ({ runtimes: created ? [custom] : [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsRuntimesTab />);
    fireEvent.click(await screen.findByRole('button', { name: '添加自定义 ACP' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'My ACP Agent' } });
    fireEvent.change(screen.getByRole('textbox', { name: '标识' }), { target: { value: 'my-agent' } });
    fireEvent.change(screen.getByRole('textbox', { name: '启动命令' }), { target: { value: 'my-agent-acp' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并检查' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('My ACP Agent')).toBeDefined();
    expect(screen.getByText('自定义')).toBeDefined();
  });
});
