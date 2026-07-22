export interface TmuxPaneLifecycleGateway {
  killPaneStrict(worktreeId: string, paneId: string): Promise<void>;
  listPanesStrict(worktreeId: string): Promise<Array<{ paneId: string }>>;
  destroyServerStrict?(worktreeId: string): Promise<void>;
}

export interface TmuxPaneLifecycleRegistry {
  remove(invocationId: string): void;
}

export interface RestartedTmuxExecution {
  envelopeId: string;
  invocationId: string;
  worktreeId: string;
  tmuxServerId: string;
  paneId?: string;
}

export function parseRestartedTmuxExecution(
  envelope: { id: string; payload: string },
  ownerNodeId: string,
): RestartedTmuxExecution | undefined {
  try {
    const payload = JSON.parse(envelope.payload) as {
      executorOwnerNodeId?: unknown;
      executorRef?: Record<string, unknown>;
    };
    const ref = payload.executorRef;
    if (
      payload.executorOwnerNodeId !== ownerNodeId
      || typeof ref?.invocationId !== 'string'
      || typeof ref.worktreeId !== 'string'
      || (
        typeof ref.tmuxServerId !== 'string'
        && !(typeof ref.paneId === 'string' && typeof ref.worktreeId === 'string')
      )
    ) return undefined;
    return {
      envelopeId: envelope.id,
      invocationId: ref.invocationId,
      worktreeId: ref.worktreeId,
      tmuxServerId: typeof ref.tmuxServerId === 'string' ? ref.tmuxServerId : ref.worktreeId,
      ...(typeof ref.paneId === 'string' ? { paneId: ref.paneId } : {}),
    };
  } catch {
    return undefined;
  }
}

export class RestartedTmuxRecoveryTracker {
  private startupObserved = false;
  private executions: RestartedTmuxExecution[] | undefined;

  constructor(private readonly load: () => RestartedTmuxExecution[]) {}

  observeStartup(): void {
    this.startupObserved = true;
  }

  async reconcile(
    reason: 'startup' | 'periodic',
    recover: (executions: RestartedTmuxExecution[]) => Promise<RestartedTmuxExecution[]>,
  ): Promise<void> {
    if (reason === 'startup') this.observeStartup();
    if (!this.startupObserved) return;
    if (this.executions === undefined) this.executions = this.load();
    if (!this.executions.length) return;
    this.executions = await recover(this.executions);
  }

  isReady(): boolean {
    return this.startupObserved && this.executions?.length === 0;
  }
}

export async function terminateTmuxPaneBeforeRecovery(input: {
  gateway: TmuxPaneLifecycleGateway;
  registry: TmuxPaneLifecycleRegistry;
  worktreeId: string;
  tmuxServerId?: string;
  paneId?: string;
  invocationId: string;
}): Promise<boolean> {
  const serverId = input.tmuxServerId ?? input.worktreeId;
  try {
    if (input.paneId) {
      await input.gateway.killPaneStrict(serverId, input.paneId);
    } else if (input.gateway.destroyServerStrict) {
      await input.gateway.destroyServerStrict(serverId);
    } else {
      return false;
    }
  } catch { /* absence is confirmed by the independent query below */ }
  try {
    const panes = await input.gateway.listPanesStrict(serverId);
    if (input.paneId ? panes.some((pane) => pane.paneId === input.paneId) : panes.length > 0) return false;
    input.registry.remove(input.invocationId);
    return true;
  } catch {
    // Query uncertainty always fails closed.
    return false;
  }
}

export async function recoverRestartedTmuxExecutions(input: {
  executions: RestartedTmuxExecution[];
  gateway: TmuxPaneLifecycleGateway;
  registry: TmuxPaneLifecycleRegistry;
  expire(envelopeId: string): boolean;
}): Promise<RestartedTmuxExecution[]> {
  const retry: RestartedTmuxExecution[] = [];
  for (const execution of input.executions) {
    const stopped = await terminateTmuxPaneBeforeRecovery({
      gateway: input.gateway,
      registry: input.registry,
      worktreeId: execution.worktreeId,
      tmuxServerId: execution.tmuxServerId,
      paneId: execution.paneId,
      invocationId: execution.invocationId,
    });
    if (!stopped) {
      retry.push(execution);
      continue;
    }
    input.expire(execution.envelopeId);
  }
  return retry;
}
