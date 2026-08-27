import type { Server as IOServer } from 'socket.io';
import type { AcpRuntimeDriver } from './acp-runtime-driver';
import type { AgentProcessRegistry } from './agent-process-registry';
import { revokeAcpSkillMcpGrants } from '../acp-skill-mcp';

export interface AgentRuntimeControl {
  list(agentId?: string): ReturnType<AcpRuntimeDriver['listRuntimes']>;
  invalidate(runtimeId: string): Promise<number>;
  stop(agentId: string, projectId?: string): Promise<{
    cancelledInvocations: number;
    runtimes: Awaited<ReturnType<AcpRuntimeDriver['stopAgent']>>;
  }>;
  restart(agentId: string, projectId?: string): Promise<Awaited<ReturnType<AcpRuntimeDriver['restartAgent']>>>;
}

const controls = new WeakMap<IOServer, AgentRuntimeControl>();
const CONTROL_KEY = Symbol.for('agent-task-hub.agent-runtime.control');

export function registerAgentRuntimeControl(
  io: IOServer,
  driver: AcpRuntimeDriver,
  processes: AgentProcessRegistry,
): AgentRuntimeControl {
  const control: AgentRuntimeControl = {
    list: (agentId) => driver.listRuntimes(agentId),
    invalidate: (runtimeId) => driver.invalidateRuntime(runtimeId),
    async stop(agentId, projectId) {
      revokeAcpSkillMcpGrants(agentId, projectId);
      const cancelledInvocations = processes.cancel(agentId, projectId);
      const runtimes = await driver.stopAgent(agentId, projectId);
      return { cancelledInvocations, runtimes };
    },
    async restart(agentId, projectId) {
      revokeAcpSkillMcpGrants(agentId, projectId);
      processes.cancel(agentId, projectId);
      return driver.restartAgent(agentId, projectId);
    },
  };
  controls.set(io, control);
  (io as unknown as Record<symbol, unknown>)[CONTROL_KEY] = control;
  return control;
}

export function getAgentRuntimeControl(io: IOServer): AgentRuntimeControl | undefined {
  return controls.get(io)
    ?? ((io as unknown as Record<symbol, unknown>)[CONTROL_KEY] as AgentRuntimeControl | undefined);
}
