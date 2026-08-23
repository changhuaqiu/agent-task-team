import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import { buildAcpExecOptions } from '../agent/acp/execOptions';
import { createWorkContractPermissionPolicy } from '../agent/acp/permissionPolicy';
import { createBackend, loadCatalog } from '../agent/acp/catalog';
import { prepareAcpRuntime } from '../agent/acp/runtimeSetup';
import { resolveAcpSessionContextBudget } from '../agent/acp/sessionBudget';
import type { WorkContract } from '../work-contract/types';

type BackendOptions = NonNullable<Parameters<typeof createBackend>[1]>;

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
  engine: RuntimeCliEngine;
  cwd: string;
  env: Record<string, string>;
  systemPrompt?: string;
  resumeSessionId?: string;
  timeoutMs: number;
  workContract?: WorkContract;
  mcpServers?: BackendOptions['mcpServers'];
  autoApproveMcpToolNames?: BackendOptions['autoApproveMcpToolNames'];
  onPermissionRequested?(event: AcpPermissionRequestedProjection): void;
  onPermissionResolved?(event: AcpPermissionResolvedProjection): void;
}

/**
 * Owns vendor-neutral ACP turn preparation. The daemon supplies the adjudicated
 * plan and MCP grants; catalog selection, isolated runtime setup, permission
 * policy, backend creation, resume options and temporary-resource cleanup stay
 * behind this runtime boundary.
 */
export class AcpRuntimeDriver {
  sessionContextBudget() {
    return resolveAcpSessionContextBudget();
  }

  prepareTurn(input: PrepareAcpTurnInput) {
    const entry = loadCatalog().find((candidate) => candidate.id === input.engine);
    if (!entry) {
      throw new Error(`no ACP catalog entry for engine: ${input.engine}`);
    }
    const prepared = prepareAcpRuntime(entry, { cwd: input.cwd, env: input.env });
    try {
      const backend = createBackend(entry, {
      cwd: prepared.cwd,
      env: prepared.env,
      permissionPolicy: input.workContract
        ? createWorkContractPermissionPolicy({
          workContract: input.workContract,
          cwd: prepared.cwd,
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
        const selectedOptionId = response.outcome.outcome === 'selected'
          ? response.outcome.optionId
          : undefined;
        const selected = selectedOptionId
          ? request.options.find((option) => option.optionId === selectedOptionId)
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
      });
      const execOptions = buildAcpExecOptions({
        engine: input.engine,
        cwd: prepared.cwd,
        systemPrompt: input.systemPrompt,
        resumeSessionId: input.resumeSessionId,
        timeoutMs: input.timeoutMs,
        env: prepared.env,
      });
      return {
        backend,
        execOptions,
        cleanup: prepared.cleanup,
        entry,
        cwd: prepared.cwd,
        env: prepared.env,
      };
    } catch (error) {
      prepared.cleanup?.();
      throw error;
    }
  }
}
