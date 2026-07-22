import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server as IOServer } from 'socket.io';
import type { McpServer } from '@agentclientprotocol/sdk';
import { TASK_MANAGEMENT_SKILL } from '@/data/presetSkills/taskManagement';
import { GIT_COLLABORATION_SKILL } from '@/data/presetSkills/gitCollaboration';
import { executeSkillTool, resetRateLimit, type ToolResult } from './skill-tool-executor';
import { isSkillTool } from './skill-tool-router';

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

export type AcpSkillToolDefinition = {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
    additionalProperties: boolean;
  };
};

export type AcpSkillMcpScope = {
  agentId: string;
  conversationId: string;
  invocationId?: string;
  deliveryRunId?: string;
  projectId?: string;
  taskId?: string;
  taskProjectDir?: string;
  permittedTools: string[];
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

export function listAcpSkillToolDefinitions(permittedTools: string[]): AcpSkillToolDefinition[] {
  return [...new Set(permittedTools)]
    .map((name) => TOOL_DEFINITIONS.get(name))
    .filter((tool): tool is AcpSkillToolDefinition => Boolean(tool));
}

export function buildAcpSkillMcpTurnInstruction(
  serverName: string,
  permittedTools: string[],
): string {
  const logicalTools = [...new Set(permittedTools.filter(isSkillTool))];
  return [
    `[系统] 本轮平台 MCP server name: ${serverName}。`,
    '恢复会话历史中其他 agent-task-team-* server/tool 名称均已撤销，禁止复用。',
    `仅使用当前工具面板中 server name 完全匹配 ${serverName} 的平台工具；本轮逻辑工具白名单: ${logicalTools.join(', ')}。`,
    `OpenCode 常见显示名: ${logicalTools.map((tool) => `${serverName}_${tool}`).join(', ')}。`,
    `其他 ACP 运行时可能显示为 mcp__${serverName}__<tool>；以当前工具面板为准。`,
  ].join('\n');
}

export function registerAcpSkillMcpGrant(
  scope: AcpSkillMcpScope,
  origin: string,
  ttlMs = DEFAULT_GRANT_TTL_MS,
): {
  mcpServer: McpServer;
  autoApproveToolNames: string[];
  promptInstruction: string;
  revoke: () => void;
} | undefined {
  const permittedTools = [...new Set(scope.permittedTools.filter(isSkillTool))];
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
    autoApproveToolNames: permittedTools.map((toolName) => `mcp.${serverName}.${toolName}`),
    promptInstruction: buildAcpSkillMcpTurnInstruction(serverName, permittedTools),
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
  return executeSkillTool({
    toolName,
    input,
    agentId: grant.agentId,
    conversationId: grant.conversationId,
    invocationId: grant.invocationId,
    deliveryRunId: grant.deliveryRunId,
    projectId: grant.projectId,
    taskId: grant.taskId,
    taskProjectDir: grant.taskProjectDir,
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
