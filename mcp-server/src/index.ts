#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { io as socketIO } from 'socket.io-client';
import { z } from 'zod';

const DAEMON_URL = process.env.ATH_DAEMON_URL || 'http://localhost:4000';

function connectDaemon() {
  const socket = socketIO(DAEMON_URL, {
    path: '/api/socketio',
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });
  return socket;
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'agent-task-hub-mcp',
    version: '0.1.0',
  });

  server.tool(
    'dispatch_to_agent',
    'Dispatch a prompt to a specific agent in Agent Task Hub. The agent will execute the prompt using its configured CLI engine (opencode, claude, codex, or mock). Returns the run ID for tracking.',
    {
      agentId: z.string().describe('Agent ID to dispatch to (e.g. "mario", "luigi", "toad", "peach", "dk", "yoshi")'),
      prompt: z.string().describe('The prompt/instruction to send to the agent'),
      sessionId: z.string().optional().describe('Optional session ID to resume a previous session'),
      taskId: z.string().optional().describe('Optional task ID to associate the run with'),
    },
    async ({ agentId, prompt, sessionId, taskId }) => {
      const socket = connectDaemon();

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          socket.disconnect();
          resolve({
            content: [{ type: 'text' as const, text: `Error: Connection to daemon at ${DAEMON_URL} timed out. Ensure the Hub daemon is running.` }],
            isError: true,
          });
        }, 15_000);

        socket.on('connect', () => {
          clearTimeout(timeout);
          socket.emit('terminal:start', {
            projectId: 'default',
            taskId,
            agentId,
            prompt,
            sessionId,
            allowMockRunner: true,
          });

          setTimeout(() => {
            socket.disconnect();
            resolve({
              content: [{ type: 'text' as const, text: `Dispatched to agent "${agentId}": ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}` }],
            });
          }, 500);
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          resolve({
            content: [{ type: 'text' as const, text: `Error: Cannot connect to daemon at ${DAEMON_URL}: ${err.message}` }],
            isError: true,
          });
        });

        socket.connect();
      });
    },
  );

  server.tool(
    'list_agents',
    'List all available agents in Agent Task Hub with their roles and configured CLI engines.',
    {},
    async () => {
      const agents = [
        { id: 'mario', name: 'Mario', role: 'planner', roleLabel: '项目统筹', cliEngine: 'opencode', emoji: '⭐' },
        { id: 'luigi', name: 'Luigi', role: 'worker', roleLabel: '前端负责人', cliEngine: 'opencode', emoji: '🟢' },
        { id: 'toad', name: 'Toad', role: 'worker', roleLabel: '后端负责人', cliEngine: 'opencode', emoji: '🍄' },
        { id: 'peach', name: 'Peach', role: 'reviewer', roleLabel: '代码评审', cliEngine: 'opencode', emoji: '👑' },
        { id: 'dk', name: 'DK', role: 'worker', roleLabel: '算法工程', cliEngine: 'opencode', emoji: '🦍' },
        { id: 'yoshi', name: 'Yoshi', role: 'reviewer', roleLabel: 'QA 测试', cliEngine: 'opencode', emoji: '🦖' },
      ];
      const lines = agents.map((a) => `${a.emoji} ${a.id} (${a.name}) — ${a.roleLabel} [${a.role}] engine: ${a.cliEngine}`);
      return {
        content: [{ type: 'text' as const, text: `Available Agents:\n${lines.join('\n')}` }],
      };
    },
  );

  server.tool(
    'check_daemon',
    'Check if the Agent Task Hub daemon is reachable and get connection status.',
    {},
    async () => {
      const socket = connectDaemon();

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          socket.disconnect();
          resolve({
            content: [{ type: 'text' as const, text: `Daemon at ${DAEMON_URL}: unreachable (timeout)` }],
            isError: true,
          });
        }, 5_000);

        socket.on('connect', () => {
          clearTimeout(timeout);
          socket.disconnect();
          resolve({
            content: [{ type: 'text' as const, text: `Daemon at ${DAEMON_URL}: connected ✓` }],
          });
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          resolve({
            content: [{ type: 'text' as const, text: `Daemon at ${DAEMON_URL}: error — ${err.message}` }],
            isError: true,
          });
        });

        socket.connect();
      });
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  console.error(`[ath-mcp] Starting... daemon URL: ${DAEMON_URL}`);
  await server.connect(transport);
  console.error('[ath-mcp] Running on stdio');
}

main().catch((err) => {
  console.error('[ath-mcp] Fatal error:', err);
  process.exit(1);
});
