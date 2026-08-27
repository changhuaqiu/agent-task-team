import { createHash } from 'node:crypto';
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import { buildAcpExecOptions } from '../agent/acp/execOptions';
import { createWorkContractPermissionPolicy } from '../agent/acp/permissionPolicy';
import { loadCatalog, type AgentCatalogEntry } from '../agent/acp/catalog';
import { prepareAcpRuntime } from '../agent/acp/runtimeSetup';
import { resolveAcpSessionContextBudget } from '../agent/acp/sessionBudget';
import type { AgentBackend } from '../agent/types';
import type { WorkContract } from '../work-contract/types';
import { ManagedAcpRuntime, type ManagedAcpRuntimeConfig } from './managed-acp-runtime';
import {
  ManagedAgentRuntimeSupervisor,
  type ManagedAgentRuntimeKey,
  type ManagedRuntimeHandle,
  type ManagedRuntimeSnapshot,
} from './managed-runtime-supervisor';
import type { PersistentAcpTurnConfig } from './persistent-acp-worker';
import { revokeAcpSkillMcpGrants } from '../acp-skill-mcp';

export interface AcpPermissionRequestedProjection {
  requestId: string;
  callId: string;
  options: string[];
}

export interface AcpPermissionResolvedProjection {
  requestId: string;
  decision: 'allowed' | 'denied';
  source: 'policy';
}

export interface PrepareAcpTurnInput {
  agentId: string;
  projectId: string;
  laneId?: string;
  runtimeNodeId?: string;
  engine: RuntimeCliEngine;
  cwd: string;
  env: Record<string, string>;
  systemPrompt?: string;
  resumeSessionId?: string;
  timeoutMs: number;
  workerCount?: number;
  workerNames?: string[];
  workContract?: WorkContract;
  mcpServers?: PersistentAcpTurnConfig['mcpServers'];
  autoApproveMcpToolNames?: PersistentAcpTurnConfig['autoApproveMcpToolNames'];
  terminalMcpToolNames?: PersistentAcpTurnConfig['terminalMcpToolNames'];
  /** Current Invocation grant to preserve while fencing older runtime generations. */
  currentGrantToken?: string;
  onPermissionRequested?(event: AcpPermissionRequestedProjection): void;
  onPermissionResolved?(event: AcpPermissionResolvedProjection): void;
}

interface RuntimeRegistration {
  key: ManagedAgentRuntimeKey;
  fingerprint: string;
  /** False once stop/start cleanup has invalidated temporary auth/config paths. */
  configUsable: boolean;
  entry: AgentCatalogEntry;
  config: ManagedAcpRuntimeConfig;
  launchInput: Pick<PrepareAcpTurnInput, 'engine' | 'cwd' | 'env' | 'workerCount' | 'workerNames'>;
}

interface RuntimeHandleRecord {
  generation: number;
  runtime: ManagedAcpRuntime;
}

function keyId(key: Pick<ManagedAgentRuntimeKey, 'agentId' | 'projectId' | 'runtimeNodeId'>) {
  return [key.agentId, key.projectId, key.runtimeNodeId].join('@');
}

function runtimeFingerprint(
  input: Pick<PrepareAcpTurnInput, 'engine' | 'cwd' | 'env' | 'workerCount' | 'workerNames'>,
  entry: AgentCatalogEntry,
): string {
  const effectiveEnv = { ...(entry.launcher.env ?? {}), ...input.env };
  const sortedEnv = Object.fromEntries(
    Object.entries(effectiveEnv).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256')
    .update(JSON.stringify({
      engine: input.engine,
      cwd: input.cwd,
      env: sortedEnv,
      workerCount: input.workerCount ?? null,
      workerNames: input.workerNames ?? [],
      launcher: entry.launcher,
    }))
    .digest('hex');
}

function configuredWorkerCount() {
  const value = Number.parseInt(process.env.ACP_WORKER_POOL_SIZE ?? '1', 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, value)) : 1;
}

export interface AcpRuntimeDriverOptions {
  catalog?: AgentCatalogEntry[];
  workerCount?: number;
}

/** Owns catalog/setup, supervised persistent ACP workers and turn grants. */
export class AcpRuntimeDriver {
  private readonly registrations = new Map<string, RuntimeRegistration>();
  private readonly handles = new Map<string, RuntimeHandleRecord>();
  private readonly supervisor: ManagedAgentRuntimeSupervisor;
  private readonly catalog: AgentCatalogEntry[];
  private readonly workerCount: number;

  constructor(options: AcpRuntimeDriverOptions = {}) {
    this.catalog = options.catalog ?? [];
    this.workerCount = options.workerCount ?? configuredWorkerCount();
    this.supervisor = new ManagedAgentRuntimeSupervisor({
      starter: { start: (input) => this.startRuntime(input) },
    });
  }

  sessionContextBudget() {
    return resolveAcpSessionContextBudget();
  }

  async prepareTurn(input: PrepareAcpTurnInput) {
    const entry = this.catalog.find((candidate) => candidate.id === input.engine)
      ?? (this.catalog.length === 0
        ? loadCatalog().find((candidate) => candidate.id === input.engine)
        : undefined);
    if (!entry) throw new Error(`no ACP catalog entry for engine: ${input.engine}`);
    const key: ManagedAgentRuntimeKey = {
      agentId: input.agentId,
      projectId: input.projectId,
      runtimeNodeId: input.runtimeNodeId ?? 'local',
      runtimeId: input.engine,
    };
    const id = keyId(key);
    const fingerprint = runtimeFingerprint(input, entry);
    const current = this.registrations.get(id);
    let registration = current;
    let snapshot: ManagedRuntimeSnapshot;

    if (!current || current.fingerprint !== fingerprint || !current.configUsable) {
      if (current) revokeAcpSkillMcpGrants(input.agentId, input.projectId, input.currentGrantToken);
      const prepared = prepareAcpRuntime(entry, {
        cwd: input.cwd,
        env: { ...(entry.launcher.env ?? {}), ...input.env },
      });
      registration = {
        key,
        fingerprint,
        configUsable: true,
        entry,
        launchInput: { engine: input.engine, cwd: input.cwd, env: { ...input.env }, workerCount: input.workerCount, workerNames: input.workerNames },
        config: {
          entry,
          cwd: prepared.cwd,
          env: prepared.env,
          cleanup: prepared.cleanup,
          workerCount: input.workerCount ?? this.workerCount,
          workerNames: input.workerNames,
        },
      };
      this.registrations.set(id, registration);
      snapshot = current
        ? await this.supervisor.reconfigure(key)
        : await this.supervisor.ensureReady(key);
    } else {
      snapshot = await this.supervisor.ensureReady(key);
    }

    if (!registration) throw new Error('runtime_registration_missing');

    if (!snapshot.acceptingWork) {
      registration.configUsable = false;
      throw new Error(snapshot.reasonCode ?? `runtime_not_ready:${snapshot.lifecycle}`);
    }
    const handle = this.handles.get(id);
    if (!handle || handle.generation !== snapshot.generation) {
      throw new Error('runtime_handle_generation_mismatch');
    }
    const turn = handle.runtime.claim(input.laneId ?? input.projectId);
    if (!turn) throw new Error('runtime_worker_busy');

    const turnConfig: PersistentAcpTurnConfig = {
      sessionMode: input.engine === 'claude'
        ? (() => {
            const permissions = input.workContract?.permissions;
            const envelope = permissions && typeof permissions === 'object'
              ? permissions as { executionProfile?: { stage?: unknown } }
              : undefined;
            return envelope?.executionProfile?.stage === 'plan' ? 'plan' : 'default';
          })()
        : undefined,
      permissionPolicy: input.workContract
        ? createWorkContractPermissionPolicy({
          workContract: input.workContract,
          cwd: registration.config.cwd,
          engine: entry.id,
        })
        : (process.env.ACP_PERMISSION_MODE === 'allow_once' ? 'allow_once' : 'deny'),
      onPermissionRequested: (request) => {
        input.onPermissionRequested?.({
          requestId: `${request.sessionId}:${request.toolCall.toolCallId}`,
          callId: request.toolCall.toolCallId,
          options: request.options.map((option) => option.kind),
        });
      },
      onPermissionResolved: (request, response) => {
        const selectedId = response.outcome.outcome === 'selected'
          ? response.outcome.optionId
          : undefined;
        const selected = selectedId
          ? request.options.find((option) => option.optionId === selectedId)
          : undefined;
        input.onPermissionResolved?.({
          requestId: `${request.sessionId}:${request.toolCall.toolCallId}`,
          decision: selected?.kind === 'allow_once' || selected?.kind === 'allow_always'
            ? 'allowed'
            : 'denied',
          source: 'policy',
        });
      },
      mcpServers: input.mcpServers ?? [],
      autoApproveMcpToolNames: input.autoApproveMcpToolNames ?? [],
      terminalMcpToolNames: input.terminalMcpToolNames ?? [],
      requireAcceptedTerminalCommand: Boolean(input.workContract),
    };
    const execOptions = buildAcpExecOptions({
      engine: input.engine,
      cwd: registration.config.cwd,
      systemPrompt: input.systemPrompt,
      resumeSessionId: input.resumeSessionId,
      timeoutMs: input.timeoutMs,
      env: registration.config.env,
    });
    let consumed = false;
    const backend: AgentBackend = {
      execute: (prompt, options) => {
        consumed = true;
        return turn.execute(prompt, options, turnConfig);
      },
    };
    return {
      backend,
      execOptions,
      cleanup: () => { if (!consumed) turn.abandon(); },
      entry,
      cwd: registration.config.cwd,
      env: registration.config.env,
      runtime: snapshot,
    };
  }

  getRuntime(key: ManagedAgentRuntimeKey): ManagedRuntimeSnapshot | undefined {
    return this.supervisor.get(key);
  }

  listRuntimes(agentId?: string): ManagedRuntimeSnapshot[] {
    return [...this.registrations.values()]
      .filter((registration) => !agentId || registration.key.agentId === agentId)
      .map((registration) => this.supervisor.get(registration.key))
      .filter((snapshot): snapshot is ManagedRuntimeSnapshot => Boolean(snapshot));
  }

  async stopAgent(agentId: string, projectId?: string): Promise<ManagedRuntimeSnapshot[]> {
    revokeAcpSkillMcpGrants(agentId, projectId);
    const registrations = [...this.registrations.values()].filter((registration) => (
      registration.key.agentId === agentId
      && (!projectId || registration.key.projectId === projectId)
    ));
    return Promise.all(registrations.map(async (registration) => {
      // Fence configuration reuse before awaiting the serialized Supervisor
      // transition. A concurrent prepareTurn must never capture paths that the
      // stopping Runtime is about to clean up.
      registration.configUsable = false;
      const snapshot = await this.supervisor.stop(registration.key);
      return snapshot;
    }));
  }

  async restartAgent(agentId: string, projectId?: string): Promise<ManagedRuntimeSnapshot[]> {
    revokeAcpSkillMcpGrants(agentId, projectId);
    const registrations = [...this.registrations.values()].filter((registration) => (
      registration.key.agentId === agentId
      && (!projectId || registration.key.projectId === projectId)
    ));
    return Promise.all(registrations.map(async (registration) => {
      registration.configUsable = false;
      const freshEntry = this.currentCatalog().find((entry) => entry.id === registration.key.runtimeId);
      if (!freshEntry) {
        const snapshot = await this.supervisor.stop(registration.key);
        registration.config.cleanup?.();
        this.registrations.delete(keyId(registration.key));
        return snapshot;
      }
      // stop() owns and cleans the previous Runtime's temporary auth/config
      // directory. Every restart must therefore prepare a fresh directory even
      // when the launcher fingerprint itself did not change.
      const prepared = prepareAcpRuntime(freshEntry, {
        cwd: registration.launchInput.cwd,
        env: { ...(freshEntry.launcher.env ?? {}), ...registration.launchInput.env },
      });
      const nextConfig: ManagedAcpRuntimeConfig = {
        entry: freshEntry,
        cwd: prepared.cwd,
        env: prepared.env,
        cleanup: prepared.cleanup,
        workerCount: registration.launchInput.workerCount ?? this.workerCount,
        workerNames: registration.launchInput.workerNames,
      };
      registration.entry = freshEntry;
      registration.fingerprint = runtimeFingerprint(registration.launchInput, freshEntry);
      registration.config = nextConfig;
      registration.configUsable = true;
      try {
        const snapshot = await this.supervisor.reconfigure(registration.key);
        if (!snapshot.acceptingWork) registration.configUsable = false;
        return snapshot;
      } catch (error) {
        nextConfig.cleanup?.();
        registration.configUsable = false;
        throw error;
      }
    }));
  }

  async invalidateRuntime(runtimeId: string): Promise<number> {
    const registrations = [...this.registrations.values()].filter(
      (registration) => registration.key.runtimeId === runtimeId,
    );
    await Promise.all(registrations.map(async (registration) => {
      revokeAcpSkillMcpGrants(registration.key.agentId, registration.key.projectId);
      await this.supervisor.stop(registration.key);
      registration.config.cleanup?.();
      const id = keyId(registration.key);
      this.registrations.delete(id);
      this.handles.delete(id);
    }));
    return registrations.length;
  }

  async shutdown(): Promise<void> {
    await this.supervisor.shutdown();
    for (const registration of this.registrations.values()) registration.config.cleanup?.();
    this.registrations.clear();
    this.handles.clear();
  }

  private async startRuntime(input: {
    key: ManagedAgentRuntimeKey;
    generation: number;
    signal: AbortSignal;
  }): Promise<ManagedRuntimeHandle> {
    const id = keyId(input.key);
    const registration = this.registrations.get(id);
    if (!registration) throw new Error('runtime_registration_missing');
    const runtime = await ManagedAcpRuntime.start(registration.config, input.signal);
    this.handles.set(id, { generation: input.generation, runtime });
    return {
      capacity: () => runtime.capacity(),
      subscriptionsReady: () => runtime.subscriptionsReady(),
      stop: async () => {
        const current = this.handles.get(id);
        if (current?.generation === input.generation) this.handles.delete(id);
        await runtime.stop();
      },
    };
  }

  private currentCatalog(): AgentCatalogEntry[] {
    return this.catalog.length > 0 ? this.catalog : loadCatalog();
  }
}
