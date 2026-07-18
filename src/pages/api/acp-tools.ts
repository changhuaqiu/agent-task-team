import type { NextApiRequest, NextApiResponse } from 'next';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  executeAcpSkillMcpTool,
  listAcpSkillToolDefinitions,
  resolveAcpSkillMcpGrant,
} from '@/server/acp-skill-mcp';

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!isLoopback(req.socket.remoteAddress ?? '')) {
    res.status(404).end();
    return;
  }

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const grant = resolveAcpSkillMcpGrant(authorization);
  if (!grant) {
    res.status(401).json({ error: 'invalid_or_expired_invocation_token' });
    return;
  }

  const server = new Server(
    { name: 'agent-task-team', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listAcpSkillToolDefinitions(grant.permittedTools),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await executeAcpSkillMcpTool(
      grant,
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
    );
    return {
      isError: !result.success,
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result.success ? result.data ?? { success: true } : { error: result.error }),
      }],
    };
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[acp-tools] MCP request failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}
