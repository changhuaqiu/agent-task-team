import { type ChildProcess } from 'child_process';
import { spawnCli } from './cliBridge';
import { CODEX_CAPS } from './capabilities';
import { createInterface } from 'readline';
import type { AgentBackend, AgentRun, AgentEvent, ExecOptions, BackendConfig, AgentResult } from './types';

export class CodexBackend implements AgentBackend {
  readonly capabilities = CODEX_CAPS;

  constructor(private config: BackendConfig) {}

  execute(prompt: string, opts: ExecOptions): AgentRun {
    const args = ['-q', prompt, '--full-auto'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.customArgs) args.push(...opts.customArgs);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      ...this.config.env,
    };
    const startTime = Date.now();
    const child = spawnCli(this.config.executablePath, args, { env: env as any, cwd: opts.cwd });

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

    return { generator: generator() };
  }
}
