# Opencode WebSocket Integration Implementation Plan

> **For execution:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent Express/Socket.io backend to spawn a mock `opencode` CLI, and connect the Next.js frontend to stream raw terminal logs and parsed chat events.

**Architecture:** 
1. `backend/server.js`: Express + Socket.io server that handles `terminal:start`.
2. `backend/mock-opencode.js`: A Node.js script that writes NDJSON events and raw ANSI logs to stdout.
3. `src/store/taskHubStore.ts`: Initialize `socket.io-client` to listen for events and update Zustand.
4. `TerminalView` and `GlobalChatRoom`: React to real-time Zustand updates.

**Tech Stack:** Next.js, Express, Socket.io, Zustand.

---

### Task 1: Create the Backend Service

**Files:**
- Modify: `package.json`
- Create: `backend/package.json`
- Create: `backend/mock-opencode.js`
- Create: `backend/server.js`

- [ ] **Step 1: Setup Backend Workspace**
Create a `backend` directory.
Run `cd backend && npm init -y && npm install express socket.io cors`

- [ ] **Step 2: Create the Mock Opencode Script**
Write `backend/mock-opencode.js` to simulate the NDJSON output of opencode.
```javascript
// backend/mock-opencode.js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  console.log(JSON.stringify({ type: 'step_start' }));
  await sleep(500);
  
  console.log(JSON.stringify({ type: 'text', content: 'I am analyzing the task requirements.' }));
  await sleep(1000);
  
  console.log(JSON.stringify({ 
    type: 'tool_use', 
    part: { tool: 'Read', input: { path: 'package.json' } } 
  }));
  console.log('\x1b[36m[System]\x1b[0m Executing tool Read...');
  await sleep(1500);
  
  console.log(JSON.stringify({ type: 'text', content: 'Dependencies look good. Starting build.' }));
  await sleep(800);
  
  for (let i = 1; i <= 3; i++) {
    console.log(`\x1b[33m[Build]\x1b[0m Compiling module ${i}/3...`);
    await sleep(600);
  }
  
  console.log(JSON.stringify({ type: 'step_finish' }));
  console.log('\x1b[32m[Success]\x1b[0m Task completed.');
}

run().catch(console.error);
```

- [ ] **Step 3: Create the Express/Socket.io Server**
Write `backend/server.js` to handle `terminal:start` by spawning the mock script, capturing stdout, parsing JSON, and emitting `terminal:data` and `agent:event`.
```javascript
// backend/server.js
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
          const event = JSON.parse(line);
          if (event.type === 'text' || event.type === 'tool_use') {
            socket.emit('agent:event', { taskId, agentId, event });
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
```

### Task 2: Connect Frontend to Backend via Socket.io

**Files:**
- Modify: `package.json`
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Install socket.io-client**
Run: `npm install socket.io-client` (in the root directory).

- [ ] **Step 2: Update Zustand Store**
In `taskHubStore.ts`, import `io` from `socket.io-client`. Remove the `setInterval` mock inside `simulateCliExecution`. Instead, emit `terminal:start` via Socket.io.
```typescript
import { io } from 'socket.io-client';

// Outside the store definition
const socket = io('http://localhost:4000');

// Inside store definition
  simulateCliExecution: (taskId, command) => {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task) return;

    set((state) => ({
      isTerminalRunning: { ...state.isTerminalRunning, [taskId]: true },
    }));

    socket.emit('terminal:start', { 
      taskId, 
      agentId: task.agentId, 
      command 
    });
  },
```

- [ ] **Step 3: Setup Socket Listeners in Store**
At the bottom of `taskHubStore.ts`, set up the global socket listeners to update the store when the backend sends data.
```typescript
// Socket Event Listeners
socket.on('terminal:data', ({ taskId, data }) => {
  useTaskHubStore.getState().appendTerminalLog(taskId, data);
});

socket.on('agent:event', ({ taskId, agentId, event }) => {
  const store = useTaskHubStore.getState();
  
  if (event.type === 'text') {
    store.addChatMessage({
      agentId,
      content: event.content,
      referencedTaskId: taskId,
      intent: 'general',
    });
  } else if (event.type === 'tool_use') {
    store.addChatMessage({
      agentId,
      content: `I am using the **${event.part.tool}** tool.`,
      referencedTaskId: taskId,
      intent: 'execute',
    });
  }
});

socket.on('terminal:exit', ({ taskId, code }) => {
  useTaskHubStore.setState((state) => ({
    isTerminalRunning: { ...state.isTerminalRunning, [taskId]: false },
  }));
  
  const task = useTaskHubStore.getState().tasks.find(t => t.id === taskId);
  if (task) {
    useTaskHubStore.getState().addChatMessage({
      agentId: task.agentId,
      content: `Execution finished with exit code ${code}.`,
      referencedTaskId: taskId,
      intent: 'general',
    });
  }
});
```

### Task 3: Run and Test

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update Root Scripts**
Add a script to easily start both frontend and backend.
```json
  "scripts": {
    "dev:frontend": "next dev --webpack",
    "dev:backend": "node backend/server.js",
    "dev": "npm-run-all --parallel dev:frontend dev:backend"
  }
```
*(Need to `npm install -D npm-run-all` if using this)*