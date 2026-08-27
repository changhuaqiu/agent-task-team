import { describe, expect, it, vi } from 'vitest';
import type { Server as IOServer } from 'socket.io';
import type { AcpRuntimeDriver } from './acp-runtime-driver';
import type { AgentProcessRegistry } from './agent-process-registry';
import { registerAgentRuntimeControl } from './runtime-control-registry';

describe('Agent runtime control', () => {
  it('cancels the old invocation before restarting its runtime generation', async () => {
    const order: string[] = [];
    const driver = {
      listRuntimes: vi.fn(() => []),
      stopAgent: vi.fn(async () => []),
      restartAgent: vi.fn(async () => { order.push('restart'); return []; }),
    } as unknown as AcpRuntimeDriver;
    const processes = {
      cancel: vi.fn(() => { order.push('cancel'); return 1; }),
    } as unknown as AgentProcessRegistry;
    const control = registerAgentRuntimeControl({} as IOServer, driver, processes);

    await control.restart('mario', 'project-a');

    expect(order).toEqual(['cancel', 'restart']);
    expect(processes.cancel).toHaveBeenCalledWith('mario', 'project-a');
  });
});
