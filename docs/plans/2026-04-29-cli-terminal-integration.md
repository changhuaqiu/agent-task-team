# CLI Terminal Integration Implementation Plan

> **For execution:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a pixel-themed `xterm.js` terminal emulator into the TaskDetailPanel to simulate AionUi's CLI observation capabilities.

**Architecture:** 
1. Expand Zustand to hold `terminalLogs` per task and provide a mock execution function.
2. Build a `TerminalView` component using `@xterm/xterm` and `@xterm/addon-fit`.
3. Embed `TerminalView` in the lower half of `TaskDetailPanel` and style it with the Genshin Pixel theme.

**Tech Stack:** Next.js, Zustand, xterm.js, Tailwind CSS.

---

### Task 1: Install Dependencies & Update Store

**Files:**
- Modify: `package.json`
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Install xterm packages**
Run: `npm install @xterm/xterm @xterm/addon-fit`

- [ ] **Step 2: Define Terminal State Types**
In `taskHubStore.ts`, add `terminalLogs` to `TaskHubState`.
```typescript
interface TaskHubState {
  // ... existing state
  terminalLogs: Record<string, string[]>;
  isTerminalRunning: Record<string, boolean>;
  
  // Actions
  appendTerminalLog: (taskId: string, log: string) => void;
  simulateCliExecution: (taskId: string, command: string) => void;
}
```

- [ ] **Step 3: Implement Store Logic**
Initialize `terminalLogs: {}` and `isTerminalRunning: {}`. Implement the mock execution function to push ANSI-colored strings over time.
```typescript
  terminalLogs: {},
  isTerminalRunning: {},

  appendTerminalLog: (taskId, log) =>
    set((state) => ({
      terminalLogs: {
        ...state.terminalLogs,
        [taskId]: [...(state.terminalLogs[taskId] || []), log],
      },
    })),

  simulateCliExecution: (taskId, command) => {
    set((state) => ({
      isTerminalRunning: { ...state.isTerminalRunning, [taskId]: true },
    }));
    
    const logs = [
      `\x1b[33m$ ${command}\x1b[0m`,
      `\x1b[90m> Starting execution environment...\x1b[0m`,
      `\x1b[36m[info]\x1b[0m Resolving dependencies...`,
      `\x1b[32m[success]\x1b[0m Execution completed in 2.3s`,
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < logs.length) {
        get().appendTerminalLog(taskId, logs[i] + '\r\n');
        i++;
      } else {
        clearInterval(interval);
        set((state) => ({
          isTerminalRunning: { ...state.isTerminalRunning, [taskId]: false },
        }));
      }
    }, 800);
  },
```

### Task 2: Build Terminal Component

**Files:**
- Create: `src/components/task-hub/TerminalView.tsx`

- [ ] **Step 1: Create xterm wrapper**
Build a component that initializes `Terminal` and `FitAddon`, attaches to a `div` ref, and watches `terminalLogs[taskId]` to write new lines.
```tsx
'use client';
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTaskHubStore } from '@/store/taskHubStore';
import '@xterm/xterm/css/xterm.css';

export function TerminalView({ taskId }: { taskId: string }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  
  const logs = useTaskHubStore((s) => s.terminalLogs[taskId] || []);
  const isRunning = useTaskHubStore((s) => s.isTerminalRunning[taskId]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#111111',
        foreground: '#D3BC8E',
        cursor: '#D3BC8E',
      },
      fontFamily: 'var(--font-geist-mono), monospace',
      fontSize: 12,
      cursorBlink: true,
      cursorStyle: 'block',
    });
    
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    fit.fit();

    termInstance.current = term;
    fitAddon.current = fit;

    const handleResize = () => fit.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  // Write new logs
  useEffect(() => {
    if (termInstance.current && logs.length > 0) {
      // Clear and rewrite to simplify sync for mock (or track last written index)
      termInstance.current.clear();
      logs.forEach(log => termInstance.current?.write(log));
    }
  }, [logs]);

  return (
    <div className="w-full h-full p-2 bg-[#111111] border-t-2 border-[hsl(var(--border))]">
      <div ref={terminalRef} className="w-full h-full" />
    </div>
  );
}
```

### Task 3: Embed in Task Detail Panel

**Files:**
- Modify: `src/components/task-hub/TaskDetailPanel.tsx`

- [ ] **Step 1: Adjust layout**
Make the `TaskDetailPanel` a flex-col container. Keep the existing task metadata in the upper half (`flex-1 overflow-y-auto`), and add the `TerminalView` to the bottom half (fixed height, e.g., `h-64`).

- [ ] **Step 2: Add Run Trigger**
Add a button in the Task actions area to trigger `simulateCliExecution(task.id, 'npm run build')`.
```tsx
import { TerminalView } from './TerminalView';
import { Terminal as TerminalIcon } from 'lucide-react';

// Inside component:
const simulateCliExecution = useTaskHubStore((s) => s.simulateCliExecution);
const isRunning = useTaskHubStore((s) => s.isTerminalRunning[task.id]);

// Add button next to existing actions:
<button
  onClick={() => simulateCliExecution(task.id, 'npm run build')}
  disabled={isRunning}
  className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(var(--bg-card))] border-2 border-[hsl(var(--border))] rounded-[4px] text-[12px] font-bold hover:text-[hsl(var(--accent))] hover:border-[hsl(var(--accent))] transition-colors disabled:opacity-50"
>
  <TerminalIcon className="w-4 h-4" />
  {isRunning ? 'Running...' : 'Run Build'}
</button>

// At the bottom of the panel:
<div className="h-64 shrink-0">
  <TerminalView taskId={task.id} />
</div>
```