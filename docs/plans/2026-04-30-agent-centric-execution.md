# Agent-Centric Execution Architecture Implementation Plan

> **For execution:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the execution model from Task-centric to Agent-centric, ensuring terminal logs and opencode sessions are bound to persistent Agent instances rather than disposable Tasks.

**Architecture:** 
1. The Node.js backend daemon will maintain `child_process` instances keyed by `agentId` instead of `taskId`. 
2. The `opencode run` command will include `--session agent-{agentId}` to maintain context across tasks.
3. The Zustand store will track `terminalLogs` and `agentStatus` keyed by `agentId`.
4. The UI (`TaskDetailPanel`, `AgentTaskGroup`) will be updated to reflect the Agent's status and show the Agent's terminal console instead of the Task's.

**Tech Stack:** Next.js 15, Zustand 5, Node.js (Express + Socket.io), xterm.js

---

### Task 1: Update Node.js Backend Daemon

**Files:**
- Modify: `backend/server.js`

- [ ] **Step 1: Refactor process management from `taskId` to `agentId`**
Update the WebSocket event listeners to manage processes by `agentId`.

```javascript
// backend/server.js
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
    // If this agent is already busy, we shouldn't spawn a new one, but for simplicity, we kill the old one
    if (activeProcesses.has(agentId)) {
      activeProcesses.get(agentId).kill();
    }

    socket.emit('terminal:data', { agentId, data: `\x1b[33m$ ${command}\x1b[0m\r\n` });
    
    // Spawn the real command using a shell
    const [cmd, ...args] = command.split(' ');
    const child = spawn(cmd, args, { shell: true });
    activeProcesses.set(agentId, child);

    child.stdout.on('data', (data) => {
      const str = data.toString();
      
      // Send raw bytes to Terminal (xterm)
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
```

---

### Task 2: Update Zustand Store State

**Files:**
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Update store interface and state for `agentId` indexing**

```typescript
// Update interface TaskHubState in src/store/taskHubStore.ts
  // --- Terminal Store ---
  terminalLogs: Record<string, string[]>; // Key is now agentId
  agentStatus: Record<string, 'idle' | 'busy'>; // Replaces isTerminalRunning

  // Actions
  appendTerminalLog: (agentId: string, log: string) => void;
  simulateCliExecution: (taskId: string, command: string) => void;
```

- [ ] **Step 2: Implement updated store actions**

```typescript
// Inside useTaskHubStore create
  terminalLogs: {},
  agentStatus: {},

  appendTerminalLog: (agentId, log) =>
    set((state) => ({
      terminalLogs: {
        ...state.terminalLogs,
        [agentId]: [...(state.terminalLogs[agentId] || []), log],
      },
    })),

  simulateCliExecution: (taskId, command) => {
    const task = get().tasks.find(t => t.id === taskId);
    const agentId = task ? task.agentId : 'system';

    set((state) => ({
      agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
      terminalLogs: { ...state.terminalLogs, [agentId]: [] }
    }));

    socket.emit('terminal:start', { taskId, agentId, command });
  },
```

- [ ] **Step 3: Update Socket.io listeners at the bottom of the file**

```typescript
// --- Socket.io Event Listeners ---
socket.on('terminal:data', ({ agentId, data }) => {
  useTaskHubStore.getState().appendTerminalLog(agentId, data);
});

socket.on('agent:event', (event) => {
  const { taskId, agentId, type, message } = event;
  
  if (type === 'step_start' || type === 'message') {
    useTaskHubStore.getState().addChatMessage({
      agentId: agentId || 'system',
      content: message || JSON.stringify(event),
      referencedTaskId: taskId,
    });
  }
});

socket.on('terminal:exit', ({ agentId, code }) => {
  useTaskHubStore.getState().appendTerminalLog(agentId, `\r\n\x1b[36m[process exited with code ${code}]\x1b[0m\r\n`);
  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
  }));
});
```

---

### Task 3: Update UI Components

**Files:**
- Modify: `src/components/task-hub/TerminalView.tsx`
- Modify: `src/components/task-hub/TaskDetailPanel.tsx`

- [ ] **Step 1: Update `TerminalView` to use `agentId`**

```tsx
// src/components/task-hub/TerminalView.tsx
export function TerminalView({ agentId }: { agentId: string }) {
  // ...
  const logs = useTaskHubStore((s) => s.terminalLogs[agentId]);
  // ...
```

- [ ] **Step 2: Update `TaskDetailPanel` to read agent status and update command**

```tsx
// src/components/task-hub/TaskDetailPanel.tsx
  const isRunning = useTaskHubStore((s) => agent ? s.agentStatus[agent.id] === 'busy' : false);
  
  // Update the opencode run command to include the session flag
  // In the Action Bar section:
            {task.status === 'in_progress' && (
              <button
                type="button"
                onClick={() => simulateCliExecution(task.id, `opencode run "Task: ${task.title}. Provide a brief status update." --session agent-${agent.id} --format json`)}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-primary))] text-[11px] font-semibold transition-all duration-200 hover:bg-[hsl(var(--bg-card-hover))] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                {isRunning ? 'Agent Busy...' : 'Run Opencode'}
              </button>
            )}

  // Update the Terminal View Header
        {/* Terminal View (Lower Half) */}
        <div className="h-64 shrink-0 flex flex-col bg-[#111111] border-t-2 border-[hsl(var(--border))]">
          <div className="px-3 py-1.5 flex items-center justify-between border-b-2 border-[#333]">
            <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">
              {agent.name}&apos;s Console
            </span>
            {isRunning && (
              <span className="text-[10px] font-bold text-[hsl(var(--status-progress))] uppercase tracking-widest animate-pulse">
                Busy
              </span>
            )}
          </div>
          <div className="flex-1 relative overflow-hidden">
            <TerminalView agentId={agent.id} />
          </div>
        </div>
```
