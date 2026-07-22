import { describe, expect, it, vi } from 'vitest';
import {
  parseRestartedTmuxExecution,
  recoverRestartedTmuxExecutions,
  RestartedTmuxRecoveryTracker,
  terminateTmuxPaneBeforeRecovery,
} from './tmux-dispatch-lifecycle';

describe('tmux dispatch lifecycle', () => {
  it('confirms the pane is gone before a post-launch setup failure can recover', async () => {
    const killPaneStrict = vi.fn(async () => undefined);
    const listPanesStrict = vi.fn(async () => [{ paneId: '%other' }]);
    const remove = vi.fn();

    await expect(terminateTmuxPaneBeforeRecovery({
      gateway: { killPaneStrict, listPanesStrict },
      registry: { remove },
      worktreeId: 'project-1',
      paneId: '%agent',
      invocationId: 'invocation-1',
    })).resolves.toBe(true);
    expect(killPaneStrict).toHaveBeenCalledWith('project-1', '%agent');
    expect(remove).toHaveBeenCalledWith('invocation-1');
  });

  it('blocks recovery when the old pane still exists after cleanup', async () => {
    await expect(terminateTmuxPaneBeforeRecovery({
      gateway: {
        killPaneStrict: vi.fn(async () => undefined),
        listPanesStrict: vi.fn(async () => [{ paneId: '%agent' }]),
      },
      registry: { remove: vi.fn() },
      worktreeId: 'project-1',
      paneId: '%agent',
      invocationId: 'invocation-1',
    })).resolves.toBe(false);
  });

  it('accepts an already absent pane even when kill reports it missing', async () => {
    const remove = vi.fn();
    await expect(terminateTmuxPaneBeforeRecovery({
      gateway: {
        killPaneStrict: vi.fn(async () => { throw new Error('pane missing'); }),
        listPanesStrict: vi.fn(async () => []),
      },
      registry: { remove },
      worktreeId: 'project-1',
      paneId: '%agent',
      invocationId: 'invocation-1',
    })).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith('invocation-1');
  });

  it('fails closed when the independent pane query fails', async () => {
    const remove = vi.fn();
    await expect(terminateTmuxPaneBeforeRecovery({
      gateway: {
        killPaneStrict: vi.fn(async () => undefined),
        listPanesStrict: vi.fn(async () => { throw new Error('query failed'); }),
      },
      registry: { remove },
      worktreeId: 'project-1',
      paneId: '%agent',
      invocationId: 'invocation-1',
    })).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('parses only complete tmux references owned by the restarted daemon', () => {
    const payload = JSON.stringify({
      executorOwnerNodeId: 'daemon:local',
      executorRef: { invocationId: 'inv-1', worktreeId: 'worktree-1', paneId: '%1' },
    });
    expect(parseRestartedTmuxExecution({ id: 'env-1', payload }, 'daemon:local')).toEqual({
      envelopeId: 'env-1',
      invocationId: 'inv-1',
      worktreeId: 'worktree-1',
      tmuxServerId: 'worktree-1',
      paneId: '%1',
    });
    expect(parseRestartedTmuxExecution({ id: 'env-1', payload }, 'daemon:remote')).toBeUndefined();
    expect(parseRestartedTmuxExecution({ id: 'env-2', payload: '{}' }, 'daemon:local')).toBeUndefined();
  });

  it('recovers a pre-start pane from its dedicated tmux server without a pane id', async () => {
    const payload = JSON.stringify({
      executorOwnerNodeId: 'daemon:local',
      executorRef: {
        invocationId: 'inv-prestart',
        scopeId: 'conv-1',
        worktreeId: 'worktree-1',
        tmuxServerId: 'worktree-1--env-prestart',
      },
    });
    const execution = parseRestartedTmuxExecution(
      { id: 'env-prestart', payload },
      'daemon:local',
    );
    expect(execution).toEqual({
      envelopeId: 'env-prestart',
      invocationId: 'inv-prestart',
      worktreeId: 'worktree-1',
      tmuxServerId: 'worktree-1--env-prestart',
    });
    const destroyServerStrict = vi.fn(async () => undefined);
    const listPanesStrict = vi.fn(async () => []);
    const remove = vi.fn();

    await expect(terminateTmuxPaneBeforeRecovery({
      gateway: {
        killPaneStrict: vi.fn(async () => undefined),
        destroyServerStrict,
        listPanesStrict,
      },
      registry: { remove },
      worktreeId: 'worktree-1',
      tmuxServerId: 'worktree-1--env-prestart',
      invocationId: 'inv-prestart',
    })).resolves.toBe(true);
    expect(destroyServerStrict).toHaveBeenCalledWith('worktree-1--env-prestart');
    expect(listPanesStrict).toHaveBeenCalledWith('worktree-1--env-prestart');
    expect(remove).toHaveBeenCalledWith('inv-prestart');
  });

  it('terminalizes confirmed restarted panes and retries uncertain ones', async () => {
    const expire = vi.fn((envelopeId: string) => envelopeId === 'env-gone');
    const retries = await recoverRestartedTmuxExecutions({
      executions: [
        { envelopeId: 'env-gone', invocationId: 'inv-gone', worktreeId: 'worktree-1', tmuxServerId: 'server-gone', paneId: '%gone' },
        { envelopeId: 'env-live', invocationId: 'inv-live', worktreeId: 'worktree-1', tmuxServerId: 'server-live', paneId: '%live' },
      ],
      gateway: {
        killPaneStrict: vi.fn(async () => undefined),
        listPanesStrict: vi.fn(async () => [{ paneId: '%live' }]),
      },
      registry: { remove: vi.fn() },
      expire,
    });

    expect(retries).toEqual([
      { envelopeId: 'env-live', invocationId: 'inv-live', worktreeId: 'worktree-1', tmuxServerId: 'server-live', paneId: '%live' },
    ]);
    expect(expire).toHaveBeenCalledWith('env-gone');
  });

  it('keeps startup dispatch blocked and retries enumeration on a periodic pass', async () => {
    const execution = {
      envelopeId: 'env-1',
      invocationId: 'inv-1',
      worktreeId: 'worktree-1',
      tmuxServerId: 'server-1',
      paneId: '%1',
    };
    const load = vi.fn<() => typeof execution[]>()
      .mockImplementationOnce(() => { throw new Error('database temporarily unavailable'); })
      .mockReturnValueOnce([execution]);
    const tracker = new RestartedTmuxRecoveryTracker(load);

    await expect(tracker.reconcile('startup', vi.fn())).rejects.toThrow('database temporarily unavailable');
    expect(tracker.isReady()).toBe(false);

    const recover = vi.fn(async () => []);
    await tracker.reconcile('periodic', recover);

    expect(load).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledWith([execution]);
    expect(tracker.isReady()).toBe(true);
  });

  it('does not report startup readiness while old pane cleanup is still pending', async () => {
    const execution = {
      envelopeId: 'env-1',
      invocationId: 'inv-1',
      worktreeId: 'worktree-1',
      tmuxServerId: 'server-1',
      paneId: '%1',
    };
    let finishRecovery: ((executions: typeof execution[]) => void) | undefined;
    const tracker = new RestartedTmuxRecoveryTracker(() => [execution]);
    const pending = tracker.reconcile('startup', () => new Promise((resolve) => {
      finishRecovery = resolve;
    }));

    expect(tracker.isReady()).toBe(false);
    finishRecovery?.([]);
    await pending;
    expect(tracker.isReady()).toBe(true);
  });

  it('can initialize during a periodic retry after gateway startup was unavailable', async () => {
    const execution = {
      envelopeId: 'env-delayed-gateway',
      invocationId: 'inv-delayed-gateway',
      worktreeId: 'worktree-1',
      tmuxServerId: 'server-delayed-gateway',
    };
    const tracker = new RestartedTmuxRecoveryTracker(() => [execution]);
    tracker.observeStartup();
    const recover = vi.fn(async () => []);

    await tracker.reconcile('periodic', recover);

    expect(recover).toHaveBeenCalledWith([execution]);
    expect(tracker.isReady()).toBe(true);
  });
});
