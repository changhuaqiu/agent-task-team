/* eslint-disable */
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const { createInterface } = require('readline');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const activeProcesses = new Map(); // Key: agentId

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('terminal:start', ({ taskId, agentId, prompt, sessionId }) => {
    if (activeProcesses.has(agentId)) {
      activeProcesses.get(agentId).kill();
    }

    const resolvedSessionId = sessionId || `agent-${agentId}`;

    const useMock = String(process.env.USE_MOCK_CLI || '').toLowerCase() === 'true';
    const command = useMock ? 'node' : 'opencode';
    const args = useMock
      ? ['backend/mock-opencode.js']
      : ['run', prompt || '', '--session', resolvedSessionId, '--format', 'json'];

    socket.emit('terminal:data', { agentId, data: `\x1b[33m$ ${command} ${args.join(' ')}\x1b[0m\r\n` });

    const child = spawn(command, args);
    activeProcesses.set(agentId, child);

    child.on('error', (err) => {
      socket.emit('terminal:data', { agentId, data: `\r\n\x1b[31m[spawn error]\x1b[0m ${String(err?.message || err)}\r\n` });
      socket.emit('terminal:exit', { agentId, code: 127 });
      activeProcesses.delete(agentId);
    });

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const str = data.toString();
        socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
      });

      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (parsed.type === 'text') {
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: parsed.content });
        } else if (parsed.type === 'tool_use') {
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: `🔧 Used tool: ${parsed.part?.tool}` });
        } else if (parsed.type === 'step_start') {
          socket.emit('agent:event', { taskId, agentId, type: 'step_start', message: `🚀 Started task execution.` });
        } else if (parsed.type === 'step_finish') {
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: `✅ Finished task execution.` });
        } else if (parsed.type === 'error') {
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: `❌ Error: ${parsed.error?.name || 'Unknown Error'}` });
        }
      });

      child.on('close', () => rl.close());
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const str = data.toString();
        socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
      });
    }

    child.on('close', (code) => {
      socket.emit('terminal:exit', { agentId, code });
      activeProcesses.delete(agentId);
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

httpServer.listen(4000, () => {
  console.log('Agent Daemon listening on port 4000');
});
