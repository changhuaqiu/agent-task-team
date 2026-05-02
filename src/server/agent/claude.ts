import { spawn, type SpawnOptions } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { AgentBackend, AgentRun, AgentEvent, ExecOptions, BackendConfig, AgentResult } from './types';

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

    const env: Record<string, string | undefined> = { ...process.env, ...opts.env, ...this.config.env };
    // Filter out nested Claude Code env to prevent child sessions from inheriting parent state
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDECODE') || key.startsWith('CLAUDE_CODE')) {
        delete env[key];
      }
    }

    const startTime = Date.now();
    const spawnOpts: SpawnOptions = {
      env: env as SpawnOptions['env'],
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    const child = spawn(this.config.executablePath, args, spawnOpts);

    // Write prompt to stdin as stream-json user message, then close
    const stdinPayload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    });
    child.stdin!.write(stdinPayload);
    child.stdin!.end();

    let resultResolve!: (r: AgentResult) => void;
    const resultPromise = new Promise<AgentResult>((resolve) => { resultResolve = resolve; });

    const { generator } = this.createEventQueue(child, startTime, resultResolve);

    return {
      events: generator,
      result: resultPromise,
      kill: () => { try { child.kill(); } catch {} },
    };
  }

  private createEventQueue(child: ChildProcess, startTime: number, done: (r: AgentResult) => void) {
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
        }
        // input_json_delta ignored — tool name comes from content_block_start
      } else if (type === 'content_block_start') {
        const contentBlock = typeof obj.content_block === 'object' ? obj.content_block as Record<string, unknown> : undefined;
        if (contentBlock?.type === 'tool_use' && typeof contentBlock.name === 'string') {
          const callId = typeof obj.index === 'number' ? String(obj.index) : undefined;
          push({ type: 'tool_use', content: '', tool: { name: contentBlock.name, callId }, sessionId });
        }
      } else if (type === 'result') {
        const resultText = typeof obj.result === 'string' ? obj.result : undefined;
        if (resultText) output += resultText;
        if (typeof obj.session_id === 'string') sessionId = obj.session_id;
        push({ type: 'done', content: resultText || '', sessionId });
      }
      // content_block_stop, system — ignored
    });

    child.on('close', (code) => {
      finished = true;
      done({
        status: code === 0 ? 'completed' : 'failed',
        output,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
        durationMs: Date.now() - startTime,
        sessionId,
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
            yield await new Promise<AgentEvent>((resolve) => {
              resolveNext = (r) => {
                if (r.done) return;
                resolve(r.value!);
              };
            });
          }
        }
        while (queue.length > 0) yield queue.shift()!;
      } finally {
        try { child.kill(); } catch {}
      }
    }

    return { generator: generator() };
  }
}
