import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { existsSync, realpathSync } from 'fs';
import { dirname, join } from 'path';
import type { AgentBackend, AgentRun, AgentEvent, ExecOptions, BackendConfig, AgentResult } from './types';

/** Strip ANSI escape sequences and stray CR from PTY output. */
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()>]|\r$/g;

const IS_WINDOWS = process.platform === 'win32';

/**
 * Resolve the native Go binary (`.opencode` / `opencode.exe`) from the Node.js wrapper path.
 * Bypassing the wrapper avoids the `spawnSync({ stdio: "inherit" })` indirection
 * which loses piped stdout on some platforms.
 */
function resolveGoBinary(wrapperPath: string): string | null {
  try {
    const real = realpathSync(wrapperPath);
    const dir = dirname(real);
    // Unix: `.opencode`, Windows: `opencode.exe` or `.opencode.exe`
    const candidates = IS_WINDOWS
      ? [join(dir, 'opencode.exe'), join(dir, '.opencode.exe')]
      : [join(dir, '.opencode')];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } catch { /* not found */ }
  return null;
}

/** Check if `script` command is available (Unix only). */
function hasScriptCommand(): boolean {
  if (IS_WINDOWS) return false;
  try {
    const { execSync } = require('child_process');
    execSync('which script', { timeout: 2000, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

const _hasScript = hasScriptCommand();

export class OpenCodeBackend implements AgentBackend {
  constructor(private config: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): AgentRun {
    const args = ['run', '--format', 'json'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.resumeSessionId) args.push('--session', opts.resumeSessionId);
    if (opts.customArgs) args.push(...opts.customArgs);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      OPENCODE_PERMISSION: '{"*":"allow"}',
      ...opts.env,
      ...this.config.env,
    };

    // System prompt is also injected via OPENCODE_CONFIG instructions file (by daemon.ts).
    // Additionally, we frame it as a user directive here so it overrides the default
    // agent identity (Sisyphus). The default agent's own rules say:
    // "User instructions override these defaults." — we leverage that.
    const effectivePrompt = opts.systemPrompt
      ? `<user-directive priority="override">\nIDENTITY OVERRIDE — per your own rule "User instructions override these defaults":\n${opts.systemPrompt}\n</user-directive>\n\n${prompt}`
      : prompt;

    args.push(effectivePrompt);

    const startTime = Date.now();

    // --- Spawn strategy ---
    // OpenCode's Go binary suppresses stdout output when it detects a non-TTY.
    // We try strategies in order:
    // 1. Spawn the Go binary directly (bypasses Node.js wrapper's spawnSync)
    // 2. Wrap with `script -q /dev/null` for a real PTY (Unix where available)
    // 3. Last resort: direct pipe through the Node.js wrapper
    const goBinary = resolveGoBinary(this.config.executablePath);
    let child: ChildProcess;

    if (goBinary) {
      // Strategy 1: spawn Go binary directly with piped stdio
      child = spawn(goBinary, args, {
        env: env as any,
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else if (_hasScript) {
      // Strategy 2: wrap in `script` for PTY (macOS / Linux)
      child = spawn('script', ['-q', '/dev/null', this.config.executablePath, ...args], {
        env: env as any,
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      // Strategy 3: direct pipe fallback (Windows or no script available)
      child = spawn(this.config.executablePath, args, {
        env: env as any,
        cwd: opts.cwd,
      });
    }

    let resultResolve!: (r: AgentResult) => void;
    const resultPromise = new Promise<AgentResult>((resolve) => { resultResolve = resolve; });

    const { generator, push, setFinished } = this.createEventQueue(child, startTime, resultResolve);

    return {
      events: generator,
      result: resultPromise,
      kill: () => { try { child.kill(); } catch {} },
    };
  }

  private createEventQueue(
    child: ChildProcess,
    startTime: number,
    done: (r: AgentResult) => void,
  ) {
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

    const setFinished = () => { finished = true; };

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on('line', (rawLine) => {
      // Strip ANSI escape sequences from PTY output
      const line = rawLine.replace(STRIP_ANSI_RE, '');
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: any;
      try { parsed = JSON.parse(trimmed); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;

      const obj = parsed as Record<string, unknown>;
      const part = (obj.part && typeof obj.part === 'object') ? (obj.part as Record<string, unknown>) : undefined;
      const type = typeof obj.type === 'string' ? obj.type : undefined;

      // Session ID extraction: check multiple possible field names, first non-empty wins
      if (!sessionId) {
        sessionId =
          (typeof obj.sessionID === 'string' ? obj.sessionID : undefined) ||
          (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) ||
          (typeof obj.session_id === 'string' ? obj.session_id : undefined) ||
          (typeof part?.sessionID === 'string' ? part.sessionID : undefined) ||
          (typeof part?.sessionId === 'string' ? part.sessionId : undefined);
      }

      if (type === 'text') {
        const text =
          (typeof part?.text === 'string' ? part.text : undefined) ||
          (typeof obj.content === 'string' ? obj.content : undefined);
        if (text) {
          output += text;
          push({ type: 'text', content: text, sessionId });
        }
      } else if (type === 'tool_use') {
        const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
        const toolInput = typeof part?.input === 'object' ? JSON.stringify(part.input).slice(0, 200) : undefined;
        const callId = typeof obj.id === 'string' ? obj.id : undefined;
        if (toolName) {
          push({ type: 'tool_use', content: '', tool: { name: toolName, callId, input: toolInput }, sessionId });
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
        push({ type: 'error', content: errorName, sessionId });
      }
    });

    // Capture stderr for diagnostics
    const stderrChunks: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    child.on('error', (err) => {
      finished = true;
      push({ type: 'error', content: `Spawn error: ${err.message}`, sessionId });
      done({ status: 'failed', output, error: err.message, durationMs: Date.now() - startTime, sessionId });
      if (resolveNext) {
        resolveNext({ value: undefined, done: true } as any);
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
        usage: inputTokens > 0
          ? { default: { inputTokens, outputTokens } }
          : undefined,
      });
      if (resolveNext) {
        resolveNext({ value: undefined, done: true } as any);
      }
    });

    async function* generator(): AsyncGenerator<AgentEvent> {
      try {
        while (!finished) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            const event = await new Promise<AgentEvent | undefined>((resolve) => {
              resolveNext = (r) => {
                if (r.done) { resolve(undefined); return; }
                resolve(r.value!);
              };
            });
            if (event === undefined) break; // process exited
            yield event;
          }
        }
        while (queue.length > 0) yield queue.shift()!;
      } finally {
        try { child.kill(); } catch {}
      }
    }

    return { generator: generator(), push, setFinished };
  }
}
