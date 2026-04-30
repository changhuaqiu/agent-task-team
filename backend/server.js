/* eslint-disable */
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const activeProcesses = new Map(); // Key: agentId

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('terminal:start', ({ taskId, agentId, command }) => {
    if (activeProcesses.has(agentId)) {
      activeProcesses.get(agentId).kill();
    }

    // 1. Emit initial terminal message indicating attachment
    const attachUrl = 'http://localhost:4096';
    socket.emit('terminal:data', { agentId, data: `\x1b[33m$ opencode attach ${attachUrl}\x1b[0m\r\n` });
    
    // 2. Spawn opencode attach instead of running a new instance
    // Note: We don't use shell: true here because we are explicitly calling the opencode binary.
    const child = spawn('opencode', ['attach', attachUrl]);
    activeProcesses.set(agentId, child);

    // 3. Pass the user's prompt to the running instance via stdin
    if (child.stdin) {
      socket.emit('terminal:data', { agentId, data: `\x1b[90m> Sending prompt to session...\x1b[0m\r\n` });
      child.stdin.write(command + '\n');
    }

    child.stdout.on('data', (data) => {
      const str = data.toString();
      
      // Send raw bytes to Terminal (xterm)
      // Note: In a real PTY, we send raw bytes. Here we just replace newlines for xterm.
      socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });

      // Try to parse NDJSON lines for the Chat Room
      const lines = str.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'text') {
            socket.emit('agent:event', { taskId, agentId, type: 'message', message: parsed.content });
          } else if (parsed.type === 'tool_use') {
            socket.emit('agent:event', { taskId, agentId, type: 'message', message: `🔧 Used tool: ${parsed.part.tool}` });
          } else if (parsed.type === 'step_start') {
            socket.emit('agent:event', { taskId, agentId, type: 'message', message: `🚀 Started task execution.` });
          } else if (parsed.type === 'step_finish') {
            socket.emit('agent:event', { taskId, agentId, type: 'message', message: `✅ Finished task execution.` });
          } else if (parsed.type === 'error') {
            socket.emit('agent:event', { taskId, agentId, type: 'message', message: `❌ Error: ${parsed.error?.name || 'Unknown Error'}` });
          }
        } catch (e) {
          // Not a JSON line, just normal terminal output, ignore for chat
        }
      }
    });

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