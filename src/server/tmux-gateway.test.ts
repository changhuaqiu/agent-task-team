import { describe, expect, it, vi } from 'vitest';
import { TmuxGateway, TmuxPaneSetupError } from './tmux-gateway';

function result(stdout = '') {
  return { stdout, stderr: '' };
}

describe('TmuxGateway pane creation', () => {
  it('gets the pane id atomically from the create command', async () => {
    const run = vi.fn(async () => result('%7\n'));
    const gateway = new TmuxGateway('/test/tmux', run as never);

    await expect(gateway.createPane('worktree-1', { cwd: '/project' })).resolves.toBe('%7');

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      'new-session', '-P', '-F', '#{pane_id}', '-c', '/project',
    ]));
    expect(run.mock.calls.flatMap((call) => call[1] as string[])).not.toContain('display-message');
  });

  it('strictly removes a created pane when post-create setup fails', async () => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      const command = args[2];
      if (command === 'new-session') return result('%3\n');
      if (command === 'set-option') throw new Error('set-option failed');
      if (command === 'kill-pane') return result();
      if (command === 'list-panes') return result();
      throw new Error(`unexpected tmux command: ${command}`);
    });
    const gateway = new TmuxGateway('/test/tmux', run as never);

    const error = await gateway.createAgentPane('worktree-1').catch((caught) => caught);

    expect(error).toBeInstanceOf(TmuxPaneSetupError);
    expect(error).toMatchObject({
      worktreeId: 'worktree-1',
      paneId: '%3',
      cleanupConfirmed: true,
    });
    expect(run.mock.calls.map((call) => (call[1] as string[])[2])).toEqual([
      'new-session', 'set-option', 'kill-pane', 'list-panes',
    ]);
  });

  it('returns the pane reference to the daemon when cleanup cannot be confirmed', async () => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      const command = args[2];
      if (command === 'new-session') return result('%4\n');
      if (command === 'set-option') throw new Error('set-option failed');
      if (command === 'kill-pane') throw new Error('kill failed');
      if (command === 'list-panes') throw new Error('query failed');
      throw new Error(`unexpected tmux command: ${command}`);
    });
    const gateway = new TmuxGateway('/test/tmux', run as never);

    const error = await gateway.createAgentPane('worktree-1').catch((caught) => caught);

    expect(error).toBeInstanceOf(TmuxPaneSetupError);
    expect(error).toMatchObject({ paneId: '%4', cleanupConfirmed: false });
  });
});
