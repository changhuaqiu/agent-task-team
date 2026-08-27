// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SettingsDrawer } from '@/components/task-hub/SettingsDrawer';
import { useTaskHubStore } from '@/store/taskHubStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useTaskHubStore.setState({ isSettingsOpen: false });
});

describe('SettingsDrawer information architecture', () => {
  it('only exposes infrastructure resources and does not model team capabilities or role materials', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    useTaskHubStore.setState({ isSettingsOpen: true, accounts: [], skillsMap: {} });

    render(<SettingsDrawer />);

    expect(screen.getByRole('navigation', { name: '设置导航' })).toBeDefined();
    expect(screen.getByRole('button', { name: '模型账号' })).toBeDefined();
    expect(screen.getByRole('button', { name: '运行环境' })).toBeDefined();
    expect(screen.getByRole('button', { name: '技能' })).toBeDefined();
    expect(screen.queryByText('团队能力')).toBeNull();
    expect(screen.queryByText('角色素材')).toBeNull();
  });
});
