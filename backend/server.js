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

const activeProcesses = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('terminal:start', ({ taskId, agentId, command }) => {
    if (activeProcesses.has(taskId)) {
      activeProcesses.get(taskId).kill();
    }

    // Emit initial terminal message
    socket.emit('terminal:data', { taskId, data: `\x1b[33m$ ${command}\x1b[0m\r\n` });
    
    // Spawn the mock script (in a real app, this would be `spawn('opencode', ...)`)
    const child = spawn('node', [path.join(__dirname, 'mock-opencode.js')]);
    activeProcesses.set(taskId, child);

    child.stdout.on('data', (data) => {
      const str = data.toString();
      
      // Send raw bytes to Terminal (xterm)
      // Note: In a real PTY, we send raw bytes. Here we just replace newlines for xterm.
      socket.emit('terminal:data', { taskId, data: str.replace(/\n/g, '\r\n') });

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
          }
        } catch (e) {
          // Not a JSON line, just normal terminal output, ignore for chat
        }
      }
    });

    child.on('close', (code) => {
      socket.emit('terminal:exit', { taskId, code });
      activeProcesses.delete(taskId);
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

httpServer.listen(4000, () => {
  console.log('Agent Daemon listening on port 4000');
});