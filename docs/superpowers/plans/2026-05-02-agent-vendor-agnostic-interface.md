# Agent 厂商无关接口 — 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 agent 引擎逻辑从 daemon.ts 抽出为独立 Backend 类，统一事件模型，使新增引擎只需新增一个文件。

**Architecture:** 定义 AgentEvent 统一类型 → 每个引擎实现 AgentBackend 接口（AsyncGenerator 产出事件流）→ daemon 变成薄编排层，只负责创建 Backend、消费事件流、转发到 socket。

**Tech Stack:** Node.js child_process, AsyncGenerator, Socket.io, TypeScript

---

## File Structure

| 操作 | 文件 | 职责 |
|---|---|---|
| Create | `src/server/agent/types.ts` | AgentEvent, AgentResult, ExecOptions, AgentBackend 接口定义 |
| Create | `src/server/agent/opencode.ts` | OpenCodeBackend 实现 |
| Create | `src/server/agent/claude.ts` | ClaudeBackend 实现 |
| Create | `src/server/agent/codex.ts` | CodexBackend 实现 |
| Create | `src/server/agent/factory.ts` | createBackend 工厂函数 |
| Modify | `src/server/daemon.ts:46-77` | 删除 ENGINE_MAP / RUNTIME_ENGINE_MAP |
| Modify | `src/server/daemon.ts:135-473` | terminal:start handler 改用 Backend |
| Modify | `src/store/taskHubStore.ts:97-103` | ToolEvent 增加 tool_result 类型 |
| Modify | `src/store/taskHubStore.ts:1882-1929` | agent:event handler 适配新事件格式 |
| Modify | `src/components/task-hub/CliOutputBlock.tsx` | 渲染 tool_result 事件 |

---

### Task 1: 创建统一类型定义 `types.ts`

**Files:**
- Create: `src/server/agent/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// src/server/agent/types.ts

// --- 统一事件类型 ---
export type AgentEventType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  content: string;
  tool?: {
    name: string;
    callId?: string;
    input?: string;
    output?: string;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  sessionId?: string;
}

export interface AgentResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  output: string;
  error?: string;
  durationMs: number;
  sessionId?: string;
}

// --- Backend 接口 ---
export interface ExecOptions {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeout?: number;
  resumeSessionId?: string;
  customArgs?: string[];
  env?: Record<string, string>;
}

export interface AgentRun {
  events: AsyncGenerator<AgentEvent>;
  result: Promise<AgentResult>;
}

export interface BackendConfig {
  executablePath: string;
  env?: Record<string, string>;
}

export interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AgentRun;
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS（纯类型定义，无运行时代码）

- [ ] **Step 3: Commit**

```bash
git add src/server/agent/types.ts
git commit -m "feat: add AgentBackend interface and unified AgentEvent types"
```

---

### Task 2: 实现 OpenCodeBackend

**Files:**
- Create: `src/server/agent/opencode.ts`

- [ ] **Step 1: 实现 OpenCodeBackend**

从 daemon.ts lines 366-414 搬运 OpenCode 的 stdout 解析逻辑，归一化为 AgentEvent：

```typescript
// src/server/agent/opencode.ts
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { AgentBackend, AgentRun, AgentEvent, AgentResult, ExecOptions, BackendConfig } from './types';

export class OpenCodeBackend implements AgentBackend {
  constructor(private config: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): AgentRun {
    const args = ['run', '--format', 'json'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.systemPrompt) args.push('--prompt', opts.systemPrompt);
    if (opts.resumeSessionId) args.push('--session', opts.resumeSessionId);
    if (opts.customArgs) args.push(...opts.customArgs);
    args.push(prompt);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      OPENCODE_PERMISSION: '{"*":"allow"}',
      ...opts.env,
      ...this.config.env,
    };
    const startTime = Date.now();
    const child = spawn(this.config.executablePath, args, { env, cwd: opts.cwd });

    let resultResolve: (r: AgentResult) => void;
    const resultPromise = new Promise<AgentResult>((resolve) => { resultResolve = resolve; });

    const events = this.parseStdout(child, startTime, resultResolve!);

    return {
      events,
      result: resultPromise,
    };
  }

  private async *parseStdout(
    child: ReturnType<typeof spawn>,
    startTime: number,
    done: (r: AgentResult) => void,
  ): AsyncGenerator<AgentEvent> {
    let output = '';
    let sessionId: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    const queue: AgentEvent[] = [];
    let resolveNext: ((v: IteratorResult<AgentEvent>) => void) | null = null;
    let finished = false;

    const push = (event: AgentEvent) => {
      if (resolveNext) {
        resolveNext({ value: event, done: false });
        resolveNext = null;
      } else {
        queue.push(event);
      }
    };

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: any;
      try { parsed = JSON.parse(trimmed); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;

      const obj = parsed as Record<string, unknown>;
      const part = (obj.part && typeof obj.part === 'object') ? (obj.part as Record<string, unknown>) : undefined;
      const type = typeof obj.type === 'string' ? obj.type : undefined;

      // Session ID extraction
      if (!sessionId) {
        sessionId =
          (typeof obj.sessionID === 'string' ? obj.sessionID : undefined) ||
          (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) ||
          (typeof obj.session_id === 'string' ? obj.session_id : undefined) ||
          (typeof part?.sessionID === 'string' ? part.sessionID : undefined) ||
          (typeof part?.sessionId === 'string' ? part.sessionId : undefined);
        if (sessionId) push({ type: 'done', content: '', sessionId });
      }

      if (type === 'text') {
        const text =
          (typeof part?.text === 'string' ? part.text : undefined) ||
          (typeof obj.content === 'string' ? obj.content : undefined);
        if (text) {
          output += text;
          push({ type: 'text', content: text });
        }
      } else if (type === 'tool_use') {
        const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
        const toolInput = typeof part?.input === 'object' ? JSON.stringify(part.input).slice(0, 200) : undefined;
        const callId = typeof obj.id === 'string' ? obj.id : undefined;
        if (toolName) {
          push({ type: 'tool_use', content: '', tool: { name: toolName, callId, input: toolInput } });
        }
      } else if (type === 'step_finish') {
        if (part?.tokens && typeof part.tokens === 'object') {
          const t = part.tokens as Record<string, number>;
          inputTokens += t.input || 0;
          outputTokens += t.output || 0;
        }
      } else if (type === 'error') {
        const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
        const errorName = typeof errorObj?.name === 'string' ? errorObj.name : '未知错误';
        push({ type: 'error', content: errorName });
      }
    });

    child.on('close', (code) => {
      finished = true;
      const durationMs = Date.now() - startTime;
      done({
        status: code === 0 ? 'completed' : 'failed',
        output,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
        durationMs,
        sessionId,
        usage: { default: { inputTokens, outputTokens } },
      });
      if (resolveNext) {
        resolveNext({ value: undefined, done: true });
      }
    });

    // AsyncGenerator loop
    try {
      while (!finished) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<AgentEvent>((resolve) => {
            resolveNext = (r) => {
              if (r.done) return;
              resolve(r.value);
            };
          });
        }
      }
      // Drain remaining
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      try { child.kill(); } catch {}
    }
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/agent/opencode.ts
git commit -m "feat: implement OpenCodeBackend with unified AgentEvent output"
```

---

### Task 3: 实现 ClaudeBackend

**Files:**
- Create: `src/server/agent/claude.ts`

- [ ] **Step 1: 实现 ClaudeBackend**

从 daemon.ts lines 318-364 搬运 Claude 的 stream-json 解析逻辑：

```typescript
// src/server/agent/claude.ts
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { AgentBackend, AgentRun, AgentEvent, AgentResult, ExecOptions, BackendConfig } from './types';

export class ClaudeBackend implements AgentBackend {
  constructor(private config: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): AgentRun {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'bypassPermissions',
    ];
    if (opts.model) args.push('--model', opts.model);
    if (opts.maxTurns && opts.maxTurns > 0) args.push('--max-turns', String(opts.maxTurns));
    if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt);
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    if (opts.customArgs) args.push(...opts.customArgs);

    const env: Record<string, string> = { ...process.env as Record<string, string>, ...opts.env, ...this.config.env };
    // Filter out nested Claude Code env to prevent pollution
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDECODE') || key.startsWith('CLAUDE_CODE')) {
        delete env[key];
      }
    }

    const startTime = Date.now();
    const child = spawn(this.config.executablePath, args, {
      env,
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt to stdin
    const stdinPayload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    });
    child.stdin!.write(stdinPayload);
    child.stdin!.end();

    let resultResolve: (r: AgentResult) => void;
    const resultPromise = new Promise<AgentResult>((resolve) => { resultResolve = resolve; });
    const events = this.parseStreamJson(child, startTime, resultResolve!);

    return { events, result: resultPromise };
  }

  private async *parseStreamJson(
    child: ReturnType<typeof spawn>,
    startTime: number,
    done: (r: AgentResult) => void,
  ): AsyncGenerator<AgentEvent> {
    let output = '';
    let sessionId: string | undefined;
    const queue: AgentEvent[] = [];
    let resolveNext: ((v: IteratorResult<AgentEvent>) => void) | null = null;
    let finished = false;

    const push = (event: AgentEvent) => {
      if (resolveNext) {
        resolveNext({ value: event, done: false });
        resolveNext = null;
      } else {
        queue.push(event);
      }
    };

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: any;
      try { parsed = JSON.parse(trimmed); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;

      const obj = parsed as Record<string, unknown>;
      const type = typeof obj.type === 'string' ? obj.type : undefined;

      // Extract session ID from system event
      if (type === 'system' && typeof obj.session_id === 'string' && !sessionId) {
        sessionId = obj.session_id;
      }

      if (type === 'content_block_delta') {
        const delta = typeof obj.delta === 'object' ? obj.delta as Record<string, unknown> : undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          output += delta.text;
          push({ type: 'text', content: delta.text, sessionId });
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          push({ type: 'thinking', content: delta.thinking, sessionId });
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          // Tool call input streaming — we report the tool name from content_block_start
        }
      } else if (type === 'content_block_start') {
        const contentBlock = typeof obj.content_block === 'object' ? obj.content_block as Record<string, unknown> : undefined;
        if (contentBlock?.type === 'tool_use' && typeof contentBlock.name === 'string') {
          const callId = typeof obj.index === 'number' ? String(obj.index) : undefined;
          push({ type: 'tool_use', content: '', tool: { name: contentBlock.name, callId }, sessionId });
        }
      } else if (type === 'content_block_stop') {
        // Tool input complete — could emit tool_result if we track it
      } else if (type === 'result') {
        const resultText = typeof obj.result === 'string' ? obj.result : undefined;
        if (resultText) {
          output += resultText;
        }
        const isError = obj.is_error === true;
        if (typeof obj.session_id === 'string') sessionId = obj.session_id;
        push({ type: 'done', content: resultText || '', sessionId });
      }
    });

    child.on('close', (code) => {
      finished = true;
      const durationMs = Date.now() - startTime;
      done({
        status: code === 0 ? 'completed' : 'failed',
        output,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
        durationMs,
        sessionId,
      });
      if (resolveNext) {
        resolveNext({ value: undefined, done: true });
      }
    });

    try {
      while (!finished) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<AgentEvent>((resolve) => {
            resolveNext = (r) => {
              if (r.done) return;
              resolve(r.value);
            };
          });
        }
      }
      while (queue.length > 0) yield queue.shift()!;
    } finally {
      try { child.kill(); } catch {}
    }
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/agent/claude.ts
git commit -m "feat: implement ClaudeBackend with stream-json protocol"
```

---

### Task 4: 实现 CodexBackend + 工厂函数

**Files:**
- Create: `src/server/agent/codex.ts`
- Create: `src/server/agent/factory.ts`

- [ ] **Step 1: 实现 CodexBackend**

最简实现，Codex 当前不支持 resume：

```typescript
// src/server/agent/codex.ts
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { AgentBackend, AgentRun, AgentEvent, AgentResult, ExecOptions, BackendConfig } from './types';

export class CodexBackend implements AgentBackend {
  constructor(private config: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): AgentRun {
    const args = ['-q', prompt, '--full-auto'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.customArgs) args.push(...opts.customArgs);

    const env: Record<string, string> = { ...process.env as Record<string, string>, ...opts.env, ...this.config.env };
    const startTime = Date.now();
    const child = spawn(this.config.executablePath, args, { env, cwd: opts.cwd });

    let resultResolve: (r: AgentResult) => void;
    const resultPromise = new Promise<AgentResult>((resolve) => { resultResolve = resolve; });
    const events = this.parseStdout(child, startTime, resultResolve!);

    return { events, result: resultPromise };
  }

  private async *parseStdout(
    child: ReturnType<typeof spawn>,
    startTime: number,
    done: (r: AgentResult) => void,
  ): AsyncGenerator<AgentEvent> {
    let output = '';
    const queue: AgentEvent[] = [];
    let resolveNext: ((v: IteratorResult<AgentEvent>) => void) | null = null;
    let finished = false;

    const push = (event: AgentEvent) => {
      if (resolveNext) {
        resolveNext({ value: event, done: false });
        resolveNext = null;
      } else {
        queue.push(event);
      }
    };

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Codex outputs plain text or JSON — try JSON first
      let parsed: any;
      try { parsed = JSON.parse(trimmed); } catch {
        // Plain text line
        output += trimmed + '\n';
        push({ type: 'text', content: trimmed });
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const type = typeof parsed.type === 'string' ? parsed.type : undefined;
      if (type === 'text' || type === 'message') {
        const content = parsed.content || parsed.text || trimmed;
        output += content;
        push({ type: 'text', content });
      } else if (type === 'error') {
        push({ type: 'error', content: parsed.message || parsed.error || 'Unknown error' });
      }
    });

    child.on('close', (code) => {
      finished = true;
      done({
        status: code === 0 ? 'completed' : 'failed',
        output,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
        durationMs: Date.now() - startTime,
      });
      if (resolveNext) resolveNext({ value: undefined, done: true });
    });

    try {
      while (!finished) {
        if (queue.length > 0) yield queue.shift()!;
        else {
          yield await new Promise<AgentEvent>((resolve) => {
            resolveNext = (r) => { if (!r.done) resolve(r.value); };
          });
        }
      }
      while (queue.length > 0) yield queue.shift()!;
    } finally {
      try { child.kill(); } catch {}
    }
  }
}
```

- [ ] **Step 2: 实现工厂函数**

```typescript
// src/server/agent/factory.ts
import type { AgentBackend, BackendConfig } from './types';
import { OpenCodeBackend } from './opencode';
import { ClaudeBackend } from './claude';
import { CodexBackend } from './codex';

export function createBackend(engine: string, config: BackendConfig): AgentBackend {
  switch (engine) {
    case 'opencode': return new OpenCodeBackend(config);
    case 'claude':   return new ClaudeBackend(config);
    case 'codex':    return new CodexBackend(config);
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/agent/codex.ts src/server/agent/factory.ts
git commit -m "feat: implement CodexBackend and createBackend factory"
```

---

### Task 5: 改造 daemon handler 使用 Backend

**Files:**
- Modify: `src/server/daemon.ts:46-77` (删除 ENGINE_MAP / RUNTIME_ENGINE_MAP)
- Modify: `src/server/daemon.ts:135-473` (重写 terminal:start handler)

这是主线改动。当前 daemon 的 `terminal:start` handler 用 ENGINE_MAP 构建 CLI 命令，用 `handleJsonLine` + `wireChild` 解析输出。改为用 `createBackend` + `for await` 循环。

- [ ] **Step 1: 添加 import，保留 ENGINE_MAP 仅用于命令路径查找**

在 daemon.ts 顶部添加：

```typescript
import { createBackend } from './agent/factory';
import type { AgentEvent, AgentResult } from './agent/types';
```

保留 `ENGINE_MAP` 但只用于 `command` 字段查找（Backend 自己构建完整 args）。删除 `buildArgs` 字段：

```typescript
const ENGINE_COMMAND: Record<string, string> = {
  opencode: 'opencode',
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  mock: process.execPath,
};
```

- [ ] **Step 2: 重写 terminal:start handler 的执行部分**

替换 daemon.ts 中 `handleJsonLine` 函数定义（line 277）到 `wireChild(child)` 调用（line 473）之间的整个代码块。新代码：

```typescript
      // --- Execute via Backend abstraction ---
      const command = ENGINE_COMMAND[engine] || 'opencode';
      const backend = createBackend(engine, { executablePath: command, env: credentialEnv });

      activeProcesses.set(agentId, { kill: () => gracefulKill(child) });

      const { events, result } = backend.execute(effectivePrompt, {
        cwd: process.cwd(),
        model: undefined,
        systemPrompt: undefined,
        resumeSessionId: effectiveSessionId || undefined,
        timeout: timeoutMs > 0 ? timeoutMs : undefined,
        env: {
          ...credentialEnv,
          ...(runtimeConfigEnv || {}),
        },
      });

      // Forward events to socket
      (async () => {
        for await (const event of events) {
          // Register session ID
          if (event.sessionId && !sessionEmitted) {
            sessionEmitted = true;
            socket.emit('agent:session', { projectId: projectId || 'default', agentId, sessionId: event.sessionId });
            if (agentSession && !agentSession.cli_session_id) {
              sessionRepo.updateCliSessionId(agentSession.id, event.sessionId);
            }
            if (invocation) {
              invocationRepo.updateStatus(invocation.id, 'running', { cli_session_id: event.sessionId });
            }
          }

          // Forward normalized event
          socket.emit('agent:event', {
            taskId,
            agentId,
            type: event.type,
            content: event.content,
            tool: event.tool,
            usage: event.usage,
            sessionId: event.sessionId,
            conversationId: sessionConvId,
          });

          // Persist to message repo
          if (event.type === 'text' && event.content) {
            messageRepo.append({
              conversationId: sessionConvId,
              taskId,
              senderType: 'agent',
              senderId: agentId,
              content: event.content,
              contentType: 'text',
            });
            if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
          } else if (event.type === 'tool_use' && event.tool) {
            messageRepo.append({
              conversationId: sessionConvId,
              taskId,
              senderType: 'agent',
              senderId: agentId,
              content: `🔧 使用工具：${event.tool.name}`,
              contentType: 'tool_use',
            });
            if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
          }
        }

        // Wait for final result
        const final = await result;

        if (invocation) {
          invocationRepo.updateStatus(invocation.id, final.status === 'completed' ? 'succeeded' : 'failed', {
            exit_code: final.status === 'completed' ? 0 : 1,
          });
        }

        socket.emit('terminal:exit', {
          agentId,
          code: final.status === 'completed' ? 0 : 1,
          command,
          reasonCode: final.status === 'timeout' ? 'timeout' : undefined,
        });
        activeProcesses.delete(agentId);
        if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
      })();
```

注意：`effectivePrompt` 需要在 backend.execute 之前构建好（role card 注入等逻辑保持在 daemon 中）。`child` 变量不再显式创建——backend.execute 内部 spawn。

- [ ] **Step 3: 调整 activeProcesses 注册**

由于 Backend 内部管理 child process，需要让 Backend 暴露 kill 能力。修改 `AgentBackend` 接口添加可选的 `kill` 方法，或在 `AgentRun` 中返回 kill 句柄：

```typescript
// types.ts 补充
export interface AgentRun {
  events: AsyncGenerator<AgentEvent>;
  result: Promise<AgentResult>;
  kill: () => void;  // 终止底层进程
}
```

每个 Backend 的 execute 返回 `{ events, result, kill: () => child.kill() }`。

daemon 中注册：

```typescript
activeProcesses.set(agentId, { kill: () => run.kill() });
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/daemon.ts src/server/agent/types.ts
git commit -m "feat: rewrite daemon handler to use Backend abstraction"
```

---

### Task 6: 更新 store agent:event handler 适配新事件格式

**Files:**
- Modify: `src/store/taskHubStore.ts:97-103` (ToolEvent 增加 tool_result)
- Modify: `src/store/taskHubStore.ts:1882-1929` (agent:event handler 重写)

- [ ] **Step 1: 更新 ToolEvent 类型**

```typescript
// src/store/taskHubStore.ts:97
export interface ToolEvent {
  id: string;
  type: 'tool_use' | 'tool_result' | 'error';
  label: string;
  detail?: string;
  timestamp: string;
}
```

移除 `step_start` 和 `step_finish`（不再使用），增加 `tool_result`。

- [ ] **Step 2: 重写 agent:event handler**

```typescript
socket.on('agent:event', (event) => {
  const { agentId, type, content, tool, usage, sessionId, conversationId: eventConvId } = event;
  const state = useTaskHubStore.getState();
  const conversationId = eventConvId || state.selectedConversationId;
  if (!conversationId) return;

  // Register session ID
  if (sessionId) {
    const projectId = state.selectedProjectId;
    state.upsertAgentSession(projectId, agentId, sessionId);
  }

  // Ensure stream message exists
  const activeId = state.activeStreamMessageId[agentId];
  if (!activeId) {
    state.ensureStreamMessage(agentId, conversationId);
  }

  const msgId = state.activeStreamMessageId[agentId];
  if (!msgId) return;

  switch (type) {
    case 'text':
      state.appendToStreamMessage(msgId, { content });
      break;
    case 'thinking':
      state.appendToStreamMessage(msgId, { content: `💭 ${content}` });
      break;
    case 'tool_use':
      state.appendToStreamMessage(msgId, {
        toolEvent: {
          id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'tool_use',
          label: tool?.name || 'unknown',
          detail: tool?.input,
          timestamp: new Date().toISOString(),
        },
      });
      break;
    case 'tool_result':
      state.appendToStreamMessage(msgId, {
        toolEvent: {
          id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'tool_result',
          label: tool?.name || 'unknown',
          detail: tool?.output,
          timestamp: new Date().toISOString(),
        },
      });
      break;
    case 'error':
      state.appendToStreamMessage(msgId, {
        toolEvent: {
          id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'error',
          label: '错误',
          detail: content,
          timestamp: new Date().toISOString(),
        },
      });
      break;
    case 'done':
      // Session ID registration handled above; completion handled by terminal:exit
      break;
  }
});
```

- [ ] **Step 3: 更新 ChatMessageItem 中 hasToolEvents 判断**

```typescript
// src/components/task-hub/ChatMessageItem.tsx
// 更新 hasToolEvents 过滤，增加 tool_result
const hasToolEvents = (message.toolEvents?.filter((e) => e.type === 'tool_use' || e.type === 'tool_result' || e.type === 'error').length ?? 0) > 0;
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/taskHubStore.ts src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: update store handler for unified AgentEvent format"
```

---

### Task 7: 更新 CliOutputBlock 渲染 tool_result

**Files:**
- Modify: `src/components/task-hub/CliOutputBlock.tsx:13-74` (ToolRow component)

- [ ] **Step 1: 更新 ToolRow 支持 tool_result**

在 `ToolRow` 组件中，`tool_result` 类型显示为绿色结果行：

```typescript
function ToolRow({ event, isLast }: { event: ToolEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (event.type === 'tool_result') {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-2 py-[3px] text-left font-mono text-[11px]"
          style={{ color: '#4ADE80' }}
        >
          <Check className="w-3 h-3 shrink-0" />
          <span className="truncate">{event.label} → 结果</span>
          {event.detail && (
            <ChevronRight
              className="w-3 h-3 shrink-0 transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : undefined, color: '#64748B' }}
            />
          )}
        </button>
        {expanded && event.detail && (
          <pre className="px-6 py-1 text-[10px] text-[#94A3B8] whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto">
            {event.detail.length > 500 ? event.detail.slice(0, 500) + '…' : event.detail}
          </pre>
        )}
      </>
    );
  }

  if (event.type === 'error') {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-px" />
        <span className="text-[11px] text-red-400 break-all font-mono">{event.detail || event.label}</span>
      </div>
    );
  }

  // ... existing tool_use rendering unchanged ...
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/task-hub/CliOutputBlock.tsx
git commit -m "feat: render tool_result events in CliOutputBlock"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 启动 dev server**

Run: `pnpm dev`

- [ ] **Step 2: 测试 OpenCode 引擎**

1. 创建项目
2. @Jean 触发拆解 → 验证 CLI Output 面板显示工具调用和结果
3. 验证文本输出正常显示在气泡中
4. 验证 session ID 被正确注册

- [ ] **Step 3: 验证向后兼容**

1. 旧消息（无 toolEvents）仍正常渲染
2. 人类消息不受影响
3. 排队机制正常工作
