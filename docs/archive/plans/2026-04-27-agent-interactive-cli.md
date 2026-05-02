# Agent Interactive CLI Bridge Implementation Plan

> **For execution:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide MCP tools that allow LLM Agents to spawn, communicate with, and read output from native interactive CLI processes (like `opencode`) using stdin/stdout pipes, fully compatible with Windows.

**Architecture:** We will create an `InteractiveCliManager` to manage `child_process.spawn` instances and buffer their stdout/stderr. Then we will expose this manager via MCP tools (`cli_start_session`, `cli_send_input`, `cli_read_output`, `cli_stop_session`) so that agents can interact with long-running CLI sessions.

**Tech Stack:** Node.js `child_process`, Zod (for MCP schemas), Typescript.

---

### Task 1: Create the InteractiveCliManager

**Files:**
- Create: `packages/api/src/domains/terminal/interactive-cli-manager.ts`

- [ ] **Step 1: Write the InteractiveCliManager class**

Create `packages/api/src/domains/terminal/interactive-cli-manager.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveCliCommand } from '../../utils/cli-resolve.js';

export interface CliSession {
  id: string;
  process: ChildProcess;
  outputBuffer: string;
  lastActive: number;
}

export class InteractiveCliManager {
  private static instance: InteractiveCliManager;
  private sessions = new Map<string, CliSession>();

  private constructor() {}

  static getInstance(): InteractiveCliManager {
    if (!this.instance) {
      this.instance = new InteractiveCliManager();
    }
    return this.instance;
  }

  startSession(command: string, args: string[] = []): string {
    const resolvedPath = resolveCliCommand(command);
    if (!resolvedPath) {
      throw new Error(`Command not found: ${command}`);
    }

    const child = spawn(resolvedPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    const sessionId = randomUUID();
    const session: CliSession = {
      id: sessionId,
      process: child,
      outputBuffer: '',
      lastActive: Date.now(),
    };

    const handleData = (data: Buffer) => {
      session.outputBuffer += data.toString('utf8');
      session.lastActive = Date.now();
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('exit', () => {
      session.outputBuffer += '\n[Process exited]';
    });

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  sendInput(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.process.killed || session.process.exitCode !== null) {
      throw new Error('Process is no longer running');
    }
    session.process.stdin?.write(input);
    session.lastActive = Date.now();
  }

  readOutput(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const output = session.outputBuffer;
    session.outputBuffer = ''; // Clear buffer after reading
    return output;
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.process.kill();
      this.sessions.delete(sessionId);
    }
  }
}
```

### Task 2: Create the MCP Tools

**Files:**
- Create: `packages/api/src/mcp-server/src/tools/interactive-cli-tools.ts`

- [ ] **Step 1: Write the MCP Tools definition**

Create `packages/api/src/mcp-server/src/tools/interactive-cli-tools.ts`:

```typescript
import { z } from 'zod';
import { InteractiveCliManager } from '../../../../domains/terminal/interactive-cli-manager.js';
import { errorResult, successResult, type ToolResult } from './file-tools.js';

const ALLOWED_CLIS = (process.env.CAT_CAFE_ALLOWED_INTERACTIVE_CLIS || 'opencode,python,node,cmd,powershell')
  .split(',')
  .map((s) => s.trim().toLowerCase());

export const cliStartSessionInputSchema = {
  command: z.string().min(1).describe('The CLI command to start (e.g. "opencode" or "python")'),
  args: z.array(z.string()).optional().describe('Arguments to pass to the command'),
};

export const cliSendInputSchema = {
  sessionId: z.string().uuid().describe('The session ID returned by cli_start_session'),
  input: z.string().describe('The text to send to the CLI. Must include \\n if you want to press Enter.'),
};

export const cliReadOutputSchema = {
  sessionId: z.string().uuid().describe('The session ID'),
};

export const cliStopSessionSchema = {
  sessionId: z.string().uuid().describe('The session ID'),
};

export async function handleCliStartSession(input: { command: string; args?: string[] }): Promise<ToolResult> {
  const cmd = input.command.trim().toLowerCase();
  if (!ALLOWED_CLIS.includes(cmd)) {
    return errorResult(`Command "${input.command}" is not allowed. Allowed commands: ${ALLOWED_CLIS.join(', ')}`);
  }

  try {
    const manager = InteractiveCliManager.getInstance();
    const sessionId = manager.startSession(input.command, input.args ?? []);
    return successResult(`Session started successfully. Session ID: ${sessionId}`);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleCliSendInput(input: { sessionId: string; input: string }): Promise<ToolResult> {
  try {
    const manager = InteractiveCliManager.getInstance();
    manager.sendInput(input.sessionId, input.input);
    return successResult('Input sent successfully.');
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleCliReadOutput(input: { sessionId: string }): Promise<ToolResult> {
  try {
    const manager = InteractiveCliManager.getInstance();
    const output = manager.readOutput(input.sessionId);
    return successResult(output || '[No new output]');
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export async function handleCliStopSession(input: { sessionId: string }): Promise<ToolResult> {
  try {
    const manager = InteractiveCliManager.getInstance();
    manager.stopSession(input.sessionId);
    return successResult('Session stopped successfully.');
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export const interactiveCliTools = [
  {
    name: 'cli_start_session',
    description: 'Start a new interactive CLI session (e.g., opencode) in the background. Returns a sessionId.',
    inputSchema: cliStartSessionInputSchema,
    handler: handleCliStartSession,
  },
  {
    name: 'cli_send_input',
    description: 'Send text input to an active CLI session. Remember to include \\n to simulate pressing Enter.',
    inputSchema: cliSendInputSchema,
    handler: handleCliSendInput,
  },
  {
    name: 'cli_read_output',
    description: 'Read the accumulated stdout/stderr output from the CLI session. Clears the buffer after reading.',
    inputSchema: cliReadOutputSchema,
    handler: handleCliReadOutput,
  },
  {
    name: 'cli_stop_session',
    description: 'Stop and kill the active CLI session.',
    inputSchema: cliStopSessionSchema,
    handler: handleCliStopSession,
  },
] as const;
```

### Task 3: Export and Register the Tools

**Files:**
- Modify: `packages/api/src/mcp-server/src/tools/index.ts`
- Modify: `packages/api/src/mcp-server/src/server-toolsets.ts`

- [ ] **Step 1: Export tools in `index.ts`**

Add to `packages/api/src/mcp-server/src/tools/index.ts`:

```typescript
export {
  cliReadOutputSchema,
  cliSendInputSchema,
  cliStartSessionInputSchema,
  cliStopSessionSchema,
  handleCliReadOutput,
  handleCliSendInput,
  handleCliStartSession,
  handleCliStopSession,
  interactiveCliTools,
} from './interactive-cli-tools.js';
```

- [ ] **Step 2: Register tools in `server-toolsets.ts`**

Add `interactiveCliTools` to the `workspaceToolset` array in `packages/api/src/mcp-server/src/server-toolsets.ts`. 

Find:
```typescript
import {
  ...
  shellTools,
  ...
} from './tools/index.js';
```

Update to:
```typescript
import {
  ...
  shellTools,
  interactiveCliTools,
  ...
} from './tools/index.js';
```

And in the `workspaceToolset` array:
```typescript
export const workspaceToolset: McpToolDefinition[] = [
  ...fileTools,
  ...shellTools,
  ...interactiveCliTools,
  ...
];
```
*(Exact location depends on existing array contents, just append it alongside `shellTools`)*
