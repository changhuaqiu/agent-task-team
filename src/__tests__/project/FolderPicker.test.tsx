// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FolderPicker, folderBreadcrumbs } from '@/components/ui/FolderPicker';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('folder selection', () => {
  it('keeps drive and POSIX roots intact', () => {
    expect(folderBreadcrumbs('C:\\Users\\me').map((item) => item.path)).toEqual(['C:/', 'C:/Users', 'C:/Users/me']);
    expect(folderBreadcrumbs('/home/me').map((item) => item.path)).toEqual(['/home', '/home/me']);
  });
  it('exposes named keyboard buttons instead of clickable spans', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ path: 'C:/Users/me', children: [{ name: 'project', path: 'C:/Users/me/project', hasChildren: false }] }) }));
    const onChange = vi.fn();
    render(<FolderPicker value="" onChange={onChange} />);
    const select = await screen.findByRole('button', { name: '选择目录：project' });
    expect(select.tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: '浏览目录：project' })).toBeTruthy();
    fireEvent.click(select);
    expect(onChange).toHaveBeenCalledWith('C:/Users/me/project');
  });
  it('does not allow selecting an invalid path after load fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(<FolderPicker value="" onChange={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '使用当前目录' }).hasAttribute('disabled')).toBe(true);
  });
});
