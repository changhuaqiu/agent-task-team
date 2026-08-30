import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server as IOServer } from 'socket.io';
import type { McpServer } from '@agentclientprotocol/sdk';
import { TASK_MANAGEMENT_SKILL } from '@/data/presetSkills/taskManagement';
import { GIT_COLLABORATION_SKILL } from '@/data/presetSkills/gitCollaboration';
import { BROWSER_VERIFICATION_SKILL } from '@/data/presetSkills/browserVerification';
import { TASK_STATUS_RECEIPT_SKILL } from '@/data/presetSkills/taskStatusReceipt';
import { executeSkillTool, resetRateLimit, type ToolResult } from './skill-tool-executor';
import { isSkillTool } from './skill-tool-router';
import type { AgentOutcomeType, WorkContract } from './work-contract/types';
import { AGENT_OUTCOME_TYPES } from './work-contract/types';
import { workContractRepo } from './work-contract/repository';
import { generateSortableId } from './repositories/sortable-id';
import { workContractRuntimeToolNames } from './work-contract/dispatch-contract';
import { asWorkSubmitOutcomeCommand, commandService } from './command-kernel/service';
import { commandSucceeded } from './command-kernel/types';
import {
  AGENT_OUTCOME_TOOL_BY_TYPE,
  AGENT_OUTCOME_TYPE_BY_TOOL,
} from './work-contract/outcome-tools';
import {
  adaptAcpOutcomePayload,
  outcomePayloadSchema,
  type JsonSchema,
} from './work-contract/outcome-tool-contract';

export { AGENT_OUTCOME_TOOL_BY_TYPE } from './work-contract/outcome-tools';

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
    properties: Record<string, JsonSchema>;
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
  [
    TASK_MANAGEMENT_SKILL,
    TASK_STATUS_RECEIPT_SKILL,
    GIT_COLLABORATION_SKILL,
    BROWSER_VERIFICATION_SKILL,
  ]
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
for (const outcomeType of AGENT_OUTCOME_TYPES) {
  const name = AGENT_OUTCOME_TOOL_BY_TYPE[outcomeType];
  TOOL_DEFINITIONS.set(name, {
    name,
    description: `Submit the ${outcomeType} lifecycle command under the current immutable WorkContract.`,
    inputSchema: {
      type: 'object',
      properties: {
        payload: outcomePayloadSchema(outcomeType),
        evidence_refs: {
          type: 'array',
          description: 'Immutable artifact, test, review, or trace references supporting this command.',
        },
        idempotency_key: {
          type: 'string',
          description: 'Stable key to make a repeated submission harmless.',
        },
      },
      required: ['payload', 'evidence_refs', 'idempotency_key'],
      additionalProperties: false,
    },
  });
}

export function listAcpSkillToolDefinitions(permittedTools: string[]): AcpSkillToolDefinition[] {
  return [...new Set(permittedTools)]
    .map((name) => TOOL_DEFINITIONS.get(name))
    .filter((tool): tool is AcpSkillToolDefinition => Boolean(tool));
}

export function registerAcpSkillMcpGrant(
  scope: AcpSkillMcpScope,
  origin: string,
  ttlMs = DEFAULT_GRANT_TTL_MS,
): {
  mcpServer: McpServer;
  autoApproveToolNames: string[];
  terminalToolNames: string[];
  /** Internal fencing identity; never serialize this value into events or diagnostics. */
  grantToken: string;
  revoke: () => void;
} | undefined {
  const requestedTools = scope.workContract
    ? workContractRuntimeToolNames(
        scope.permittedTools,
        scope.workContract.allowedOutcomeTypes,
      )
    : scope.permittedTools;
  const permittedTools = [...new Set([
    ...requestedTools.filter(isSkillTool),
    ...(scope.workContract
      ? scope.workContract.allowedOutcomeTypes.map((type) => AGENT_OUTCOME_TOOL_BY_TYPE[type])
      : []),
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
    grantToken: token,
    mcpServer: {
      name: serverName,
      type: 'http',
      url: `${origin.replace(/\/$/, '')}/api/acp-tools`,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    },
    autoApproveToolNames: permittedTools.flatMap((toolName) => [
      `mcp.${serverName}.${toolName}`,
      `mcp__${serverName}__${toolName}`,
      `${serverName}_${toolName}`,
    ]),
    terminalToolNames: permittedTools
      .filter((toolName) => AGENT_OUTCOME_TYPE_BY_TOOL.has(toolName))
      .flatMap((toolName) => [
        toolName,
        `mcp.${serverName}.${toolName}`,
        `mcp__${serverName}__${toolName}`,
        `${serverName}_${toolName}`,
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

/** Fences every invocation grant owned by an Agent runtime before a generation change. */
export function revokeAcpSkillMcpGrants(
  agentId: string,
  projectId?: string,
  preserveToken?: string,
): number {
  const registry = grantRegistry();
  let revoked = 0;
  for (const [token, grant] of [...registry.entries()]) {
    if (token === preserveToken) continue;
    if (grant.agentId !== agentId) continue;
    if (projectId && grant.projectId !== projectId && grant.conversationId !== projectId) continue;
    registry.delete(token);
    resetRateLimit(grant.rateLimitKey);
    revoked += 1;
  }
  return revoked;
}

export async function executeAcpSkillMcpTool(
  grant: StoredGrant,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (!grant.permittedTools.includes(toolName)) {
    return { success: false, error: `Tool is not permitted for this invocation: ${toolName}` };
  }
  const structuredOutcomeType = AGENT_OUTCOME_TYPE_BY_TOOL.get(toolName);
  if (structuredOutcomeType) {
    const contract = grant.workContract;
    if (!contract) {
      return { success: false, error: 'work_contract_missing_for_invocation' };
    }
    const outcomeType = structuredOutcomeType;
    const evidenceRefs = input.evidence_refs;
    const idempotencyKey = input.idempotency_key;
    const invalidField = typeof idempotencyKey !== 'string' || !idempotencyKey.trim()
      ? 'idempotency_key'
      : !Array.isArray(evidenceRefs)
        || evidenceRefs.some((item) => typeof item !== 'string' || !item.trim())
        ? 'evidence_refs'
        : undefined;
    if (
      typeof outcomeType !== 'string'
      || !AGENT_OUTCOME_TYPES.includes(outcomeType as AgentOutcomeType)
      || invalidField
    ) {
      return {
        success: false,
        error: 'invalid_agent_outcome_input',
        data: { field: invalidField ?? 'outcome_type' },
      };
    }
    const acceptedIdempotencyKey = (idempotencyKey as string).trim();
    const acceptedEvidenceRefs = (evidenceRefs as string[]).map((item) => item.trim());
    const receipt = commandService.execute(asWorkSubmitOutcomeCommand({
        outcomeId: generateSortableId('outcome'),
        idempotencyKey: acceptedIdempotencyKey,
        contractId: contract.contractId,
        outcomeType: outcomeType as AgentOutcomeType,
        payload: adaptAcpOutcomePayload(
          outcomeType as AgentOutcomeType,
          input.payload,
          acceptedIdempotencyKey,
          contract.authoritativeRevisions,
        ),
        evidenceRefs: acceptedEvidenceRefs,
        projectId: contract.projectId,
        workId: contract.workId,
        workEpoch: contract.workEpoch,
        attemptId: contract.attemptId,
        fencingToken: contract.fencingToken,
        authoritativeRevisions: contract.authoritativeRevisions,
        correlationId: contract.correlationId,
        causationId: contract.contractId,
        occurredAt: new Date().toISOString(),
      }));
    return !commandSucceeded(receipt)
      ? { success: false, error: receipt.reasonCode ?? receipt.status, data: receipt }
      : {
          success: true,
          data: {
            ...receipt,
            instruction: 'The WorkContract exit is accepted. End this turn now; do not call another tool.',
          },
        };
  }
  if (grant.workContract && workContractRepo.hasAcceptedOutcome(grant.workContract.contractId)) {
    return { success: false, error: 'work_exit_already_accepted' };
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
