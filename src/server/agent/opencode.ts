import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { AgentBackend, AgentRun, AgentEvent, ExecOptions, BackendConfig, AgentResult } from './types';

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
      ...(process.env as Record<string, string>),
      OPENCODE_PERMISSION: '{"*":"allow"}',
      ...opts.env,
      ...this.config.env,
    };
    const startTime = Date.now();
    const child = spawn(this.config.executablePath, args, { env: env as any, cwd: opts.cwd });

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

    return { generator: generator(), push, setFinished };
  }
}
