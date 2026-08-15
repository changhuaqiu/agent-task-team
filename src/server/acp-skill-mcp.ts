import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server as IOServer } from 'socket.io';
import type { McpServer } from '@agentclientprotocol/sdk';
import { TASK_MANAGEMENT_SKILL } from '@/data/presetSkills/taskManagement';
import { GIT_COLLABORATION_SKILL } from '@/data/presetSkills/gitCollaboration';
import { executeSkillTool, resetRateLimit, type ToolResult } from './skill-tool-executor';
import { isSkillTool } from './skill-tool-router';
import type { AgentOutcomeType, WorkContract } from './work-contract/types';
import { AGENT_OUTCOME_TYPES } from './work-contract/types';
import {
  AgentOutcomeIdempotencyConflictError,
  workContractRepo,
  type OutcomeAdmission,
} from './work-contract/repository';
import { generateSortableId } from './repositories/sortable-id';

type SkillParameter = {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
};

type SkillToolConfig = {
  name: string;
  description?: string;
  parameters?: SkillParameter[];
};

type AcpSkillToolDefinition = {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
    additionalProperties: boolean;
  };
};

type AcpSkillMcpScope = {
  agentId: string;
  conversationId: string;
  projectId?: string;
  taskId?: string;
  taskProjectDir?: string;
  correlationId?: string;
  causationId?: string;
  permittedTools: string[];
  workContract?: WorkContract;
  io?: IOServer;
};

type StoredGrant = AcpSkillMcpScope & {
  expiresAt: number;
  rateLimitKey: string;
};

const REGISTRY_KEY = Symbol.for('agent-task-team.acp-skill-mcp-grants');
const DEFAULT_GRANT_TTL_MS = 45 * 60_000;
export const AGENT_SUBMIT_OUTCOME_TOOL = 'agent_submit_outcome';

function grantRegistry(): Map<string, StoredGrant> {
  const root = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Map<string, StoredGrant> };
  root[REGISTRY_KEY] ??= new Map();
  return root[REGISTRY_KEY];
}

function parseTools(config: string): SkillToolConfig[] {
  const parsed = JSON.parse(config) as { tools?: SkillToolConfig[] };
  return Array.isArray(parsed.tools) ? parsed.tools : [];
}

function jsonSchemaType(type: string): string {
  return ['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(type)
    ? type
    : 'string';
}

const TOOL_DEFINITIONS = new Map<string, AcpSkillToolDefinition>(
  [TASK_MANAGEMENT_SKILL, GIT_COLLABORATION_SKILL]
    .flatMap((skill) => parseTools(skill.config ?? '{}'))
    .filter((tool) => isSkillTool(tool.name))
    .map((tool) => {
      const parameters = tool.parameters ?? [];
      const required = parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name);
      return [tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object' as const,
          properties: Object.fromEntries(parameters.map((parameter) => [parameter.name, {
            type: jsonSchemaType(parameter.type),
            ...(parameter.description ? { description: parameter.description } : {}),
          }])),
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: false,
        },
      }];
    }),
);
TOOL_DEFINITIONS.set(AGENT_SUBMIT_OUTCOME_TOOL, {
  name: AGENT_SUBMIT_OUTCOME_TOOL,
  description: 'Submit a structured candidate outcome under the current immutable WorkContract.',
  inputSchema: {
    type: 'object',
    properties: {
      outcome_type: {
        type: 'string',
        description: `One of: ${AGENT_OUTCOME_TYPES.join(', ')}`,
      },
      payload: { type: 'object', description: 'Structured outcome payload.' },
      evidence_refs: {
        type: 'array',
        description: 'Immutable artifact, test, review, or trace references supporting the outcome.',
      },
      idempotency_key: {
        type: 'string',
        description: 'Stable key to make a repeated submission harmless.',
      },
    },
    required: ['outcome_type', 'payload', 'evidence_refs', 'idempotency_key'],
    additionalProperties: false,
  },
});

export function listAcpSkillToolDefinitions(permittedTools: string[]): AcpSkillToolDefinition[] {
  return [...new Set(permittedTools)]
    .map((name) => TOOL_DEFINITIONS.get(name))
    .filter((tool): tool is AcpSkillToolDefinition => Boolean(tool));
}

export function registerAcpSkillMcpGrant(
  scope: AcpSkillMcpScope,
  origin: string,
  ttlMs = DEFAULT_GRANT_TTL_MS,
): { mcpServer: McpServer; autoApproveToolNames: string[]; revoke: () => void } | undefined {
  const permittedTools = [...new Set([
    ...scope.permittedTools.filter(isSkillTool),
    ...(scope.workContract ? [AGENT_SUBMIT_OUTCOME_TOOL] : []),
  ])];
  if (permittedTools.length === 0) return undefined;

  const token = randomBytes(32).toString('base64url');
  const serverName = `agent-task-team-${randomBytes(8).toString('hex')}`;
  const rateLimitKey = `acp-grant:${serverName}`;
  grantRegistry().set(token, {
    ...scope,
    permittedTools,
    rateLimitKey,
    expiresAt: Date.now() + Math.max(1, ttlMs),
  });
  return {
    mcpServer: {
      name: serverName,
      type: 'http',
      url: `${origin.replace(/\/$/, '')}/api/acp-tools`,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    },
    autoApproveToolNames: permittedTools.flatMap((toolName) => [
      `mcp.${serverName}.${toolName}`,
      `mcp__${serverName}__${toolName}`,
    ]),
    revoke: () => {
      grantRegistry().delete(token);
      resetRateLimit(rateLimitKey);
    },
  };
}

export function resolveAcpSkillMcpGrant(authorization: string | undefined): StoredGrant | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? '');
  if (!match) return undefined;
  const registry = grantRegistry();
  const grant = registry.get(match[1]);
  if (!grant) return undefined;
  if (grant.expiresAt <= Date.now()) {
    registry.delete(match[1]);
    resetRateLimit(grant.rateLimitKey);
    return undefined;
  }
  return grant;
}

export async function executeAcpSkillMcpTool(
  grant: StoredGrant,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (!grant.permittedTools.includes(toolName)) {
    return { success: false, error: `Tool is not permitted for this invocation: ${toolName}` };
  }
  if (toolName === AGENT_SUBMIT_OUTCOME_TOOL) {
    const contract = grant.workContract;
    if (!contract) {
      return { success: false, error: 'work_contract_missing_for_invocation' };
    }
    const outcomeType = input.outcome_type;
    const evidenceRefs = input.evidence_refs;
    const idempotencyKey = input.idempotency_key;
    if (
      typeof outcomeType !== 'string'
      || !AGENT_OUTCOME_TYPES.includes(outcomeType as AgentOutcomeType)
      || typeof idempotencyKey !== 'string'
      || !idempotencyKey.trim()
      || !Array.isArray(evidenceRefs)
      || evidenceRefs.some((item) => typeof item !== 'string' || !item.trim())
    ) {
      return { success: false, error: 'invalid_agent_outcome_input' };
    }
    let admission: OutcomeAdmission;
    try {
      admission = workContractRepo.admitOutcome({
        outcomeId: generateSortableId('outcome'),
        idempotencyKey: idempotencyKey.trim(),
        contractId: contract.contractId,
        outcomeType: outcomeType as AgentOutcomeType,
        payload: input.payload ?? {},
        evidenceRefs: evidenceRefs.map((item) => String(item).trim()),
        projectId: contract.projectId,
        workId: contract.workId,
        workEpoch: contract.workEpoch,
        attemptId: contract.attemptId,
        fencingToken: contract.fencingToken,
        authoritativeRevisions: contract.authoritativeRevisions,
        correlationId: contract.correlationId,
        causationId: contract.contractId,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof AgentOutcomeIdempotencyConflictError) {
        return { success: false, error: error.reasonCode };
      }
      throw error;
    }
    return admission.status === 'rejected'
      ? { success: false, error: admission.reasonCode, data: admission }
      : { success: true, data: admission };
  }
  return executeSkillTool({
    toolName,
    input,
    agentId: grant.agentId,
    conversationId: grant.conversationId,
    projectId: grant.projectId,
    taskId: grant.taskId,
    taskProjectDir: grant.taskProjectDir,
    correlationId: grant.correlationId,
    causationId: grant.causationId,
    rateLimitKey: grant.rateLimitKey,
    io: grant.io,
  });
}

export function resolveAcpMcpLoopbackOrigin(io: IOServer): string | undefined {
  const address = io.httpServer.address();
  if (!address || typeof address === 'string') return undefined;
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

export function clearAcpSkillMcpGrantsForTests(): void {
  const registry = grantRegistry();
  for (const grant of registry.values()) resetRateLimit(grant.rateLimitKey);
  registry.clear();
}
