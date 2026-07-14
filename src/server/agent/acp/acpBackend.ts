// src/server/agent/acp/acpBackend.ts
//
// AcpBackend — the single AgentBackend implementation that drives ACP agents
// (opencode / claude / codex) over stdio JSON-RPC.
//
// Spec: specs/acp-runtime-integration/spec.md §5.2 (AcpBackend responsibilities).
//
// Architecture (corrections to task-5-brief pseudocode applied):
//  - execute() returns an AgentRun ({ events, result, kill }) synchronously —
//    NOT an async generator. Mirrors OpenCodeBackend's queue/resolve/kill shape.
//  - Spawns via spawnCli (cross-spawn; resolves Windows .cmd/.bat).
//  - Uses the MODERN SDK client API: client().connectWith(stream, cb) +
//    ActiveSession.nextUpdate(). NOT the deprecated ClientSideConnection.
//  - Auto-approves permissions inline (no permissionPolicy.ts this iteration).
//  - Tree-kills the process on kill/finally/timeout (npx → adapter → runtime
//    spawns 2+ layers; bare child.kill() only kills the top).
//  - Wraps the events generator with withDoneGuarantee so a `done` event always
//    emits even if the agent doesn't send one.

import { Writable, Readable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import treeKill from 'tree-kill';
import { spawnCli } from '../cliBridge';
import { withDoneGuarantee } from '../with-done-guarantee';
import { mapAcpUpdate } from './agentEventMapper';
import type {
  AgentBackend,
  AgentRun,
  AgentEvent,
  AgentResult,
  ExecOptions,
} from '../types';
import type { CapabilitySet, EngineId } from '../capabilities';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AcpBackendOpts {
  /** Executable to spawn (e.g. 'npx', 'opencode', 'node'). */
  command: string;
  /** Args passed to command (e.g. ['tsx', path] or ['acp']). */
  args: string[];
  /** Working directory for the agent process + ACP session cwd. */
  cwd?: string;
  /** Engine identity for the CapabilitySet (which runtime this backend drives). */
  engine: EngineId;
  /** Per-turn timeout in ms (fallback if opts.timeout not set). Default 120s. */
  timeoutMs?: number;
  /** Extra env vars merged on top of process.env. */
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Capabilities — ACP's key advantage: no PTY required.
// ---------------------------------------------------------------------------

const ACP_CAPS_BASE = {
  promptMode: 'stdin-stream-json',
  outputMode: 'events',
  supportsResume: false, // Task 9 wires resume
  supportsModel: true,
  supportsSystemPrompt: true,
  systemPromptMode: 'none', // prepended to prompt text in execute()
  supportsMaxTurns: false,
  supportsPermissionMode: true,
  requiresPty: false,
} satisfies Omit<CapabilitySet, 'engine'>;

// ---------------------------------------------------------------------------
// Permission auto-approve (inline — Task 4 overridden, folded into Task 5).
// ---------------------------------------------------------------------------

/**
 * Auto-approve a permission request by selecting the first allow option.
 *
 * TODO: real permission policy (approve-all / deny / confirm profile) per
 * spec §6 — deferred this iteration (plan "更新" #1).
 */
function autoApprovePermission(
  req: acp.RequestPermissionRequest,
): acp.RequestPermissionResponse {
  const allow = req.options.find(
    (o) => o.kind === 'allow_once' || o.kind === 'allow_always',
  );
  return allow
    ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

// ---------------------------------------------------------------------------
// StopReason → AgentResult.status
// ---------------------------------------------------------------------------

function stopReasonToStatus(
  stopReason: acp.StopReason,
): AgentResult['status'] {
  switch (stopReason) {
    case 'end_turn':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'max_tokens':
    case 'refusal':
    case 'max_turn_requests':
      return 'failed';
    default:
      return 'failed';
  }
}

// ---------------------------------------------------------------------------
// AcpBackend
// ---------------------------------------------------------------------------

export class AcpBackend implements AgentBackend {
  readonly capabilities: CapabilitySet;

  constructor(private o: AcpBackendOpts) {
    this.capabilities = { ...ACP_CAPS_BASE, engine: this.o.engine };
  }

  execute(prompt: string, opts: ExecOptions): AgentRun {
    const startTime = Date.now();
    const cwd = opts.cwd ?? this.o.cwd ?? process.cwd();

    // Since supportsSystemPrompt is true and systemPromptMode is 'none', we
    // handle the system prompt ourselves by prepending it to the prompt text.
    const promptText = opts.systemPrompt
      ? `${opts.systemPrompt}\n\n${prompt}`
      : prompt;

    const env = {
      ...(process.env as Record<string, string>),
      ...this.o.env,
      ...opts.env,
    };

    // --- Spawn the ACP agent subprocess (via cross-spawn) ---
    const proc = spawnCli(this.o.command, this.o.args, {
      cwd,
      env: env as typeof process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // --- Event queue (mirrors OpenCodeBackend.createEventQueue) ---
    const queue: AgentEvent[] = [];
    let resolveNext: ((v: IteratorResult<AgentEvent>) => void) | null = null;
    let finished = false;
    let output = '';
    let sessionId: string | undefined;

    // Cause flags for the abnormal-exit path. In ACP, turn completion is
    // signaled by the PromptResponse/`stop` message, NOT process exit — so
    // reaching the `close` handler with !resultResolved is always abnormal.
    // These flags let the close handler resolve with the correct status:
    // kill() → cancelled, timeout → timeout, otherwise → failed (never
    // 'completed' for a bare process exit). Scoped per execute() call.
    let killed = false;
    let timedOut = false;

    const push = (event: AgentEvent) => {
      if (event.type === 'text') output += event.content;
      if (resolveNext) {
        resolveNext({ value: event, done: false });
        resolveNext = null;
      } else {
        queue.push(event);
      }
    };

    /** Wake a waiting generator consumer so it can drain + terminate. */
    const wakeGenerator = () => {
      finished = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true } as IteratorResult<AgentEvent>);
        resolveNext = null;
      }
    };

    // --- Result promise (resolved once on turn completion / error / kill) ---
    let resultResolve!: (r: AgentResult) => void;
    const resultPromise = new Promise<AgentResult>((resolve) => {
      resultResolve = resolve;
    });
    let resultResolved = false;

    const resolveResult = (r: AgentResult) => {
      if (resultResolved) return;
      resultResolved = true;
      resultResolve(r);
    };

    // --- Process cleanup (tree-kill for npx → adapter → runtime layers) ---
    const killProcess = () => {
      try {
        treeKill(proc.pid!, () => {});
      } catch {
        /* best-effort */
      }
      try {
        proc.kill();
      } catch {
        /* best-effort */
      }
    };

    // --- Timeout ---
    const timeoutMs = opts.timeout ?? this.o.timeoutMs ?? 120000;
    const timer = setTimeout(() => {
      if (resultResolved || timedOut) return;
      timedOut = true;
      const msg = `ACP agent timed out after ${timeoutMs}ms`;
      push({ type: 'error', content: msg, sessionId });
      // Do NOT resolveResult here — killProcess() triggers `close`, whose
      // handler resolves with the cause-based status (timeout).
      killProcess();
      wakeGenerator();
    }, timeoutMs);

    // --- Build the ACP client app with permission handler ---
    const stream = acp.ndJsonStream(
      Writable.toWeb(proc.stdin!),
      Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
    );

    const clientApp = acp
      .client({ name: 'agent-task-team' })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
        autoApprovePermission(ctx.params),
      );

    // --- Drive the turn (non-blocking; connectWith resolves when cb returns) ---
    clientApp
      .connectWith(stream, async (ctx) => {
        const session = await ctx.buildSession(cwd).start();
        sessionId = session.sessionId;

        // Start the prompt without awaiting so we can drain updates concurrently.
        const promptP = session.prompt(promptText);

        // Drain session/update notifications until the stop message.
        for (;;) {
          const msg = await session.nextUpdate();
          if (msg.kind === 'session_update') {
            const e = mapAcpUpdate(msg.update);
            if (e) {
              if (e.sessionId === undefined) e.sessionId = sessionId;
              push(e);
            } else {
              // Spec §5.3: unknown/unmapped updates must be logged + ignored.
              console.warn(
                '[acp] unmapped session update:',
                msg.update.sessionUpdate,
              );
            }
          } else {
            // kind === "stop" — turn complete.
            break;
          }
        }

        const resp = await promptP;

        resolveResult({
          status: stopReasonToStatus(resp.stopReason),
          output,
          durationMs: Date.now() - startTime,
          sessionId,
          usage: resp.usage
            ? {
                default: {
                  inputTokens: resp.usage.inputTokens ?? 0,
                  outputTokens: resp.usage.outputTokens ?? 0,
                },
              }
            : undefined,
        });

        session.dispose();
      })
      .catch((err: unknown) => {
        // connectWith rejects on stream error or if the cb throws.
        if (resultResolved) return;
        // If kill()/timeout broke the stream (process killed mid-turn), the
        // `close` handler will resolve with the correct cause-based status.
        // Do not clobber it with a 'failed' here.
        if (killed || timedOut) return;
        const errMsg = `ACP connection error: ${
          err instanceof Error ? err.message : String(err)
        }`;
        push({ type: 'error', content: errMsg, sessionId });
        resolveResult({
          status: 'failed',
          output,
          error: errMsg,
          durationMs: Date.now() - startTime,
          sessionId,
        });
      })
      .finally(() => {
        // The turn callback completed (success or failure). Wake the generator
        // so it drains remaining queued events and terminates.
        wakeGenerator();
      });

    // --- Drain stderr (prevent OS pipe-buffer deadlock) ---
    // stdio is piped on all three channels, but without a 'data' listener on
    // stderr the OS pipe buffer (~64KB) can fill: real ACP agents (opencode
    // acp) write diagnostics to stderr, and once the buffer fills the child's
    // stderr writes block → deadlock (the mock writes nothing, so this only
    // bites with real agents). Drain + log trimmed lines for debuggability.
    // Best-effort: never throw. Mirrors OpenCodeBackend's pattern.
    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.warn('[acp] stderr:', line.slice(-500));
    });

    // --- Process error / exit handlers ---
    proc.on('error', (err) => {
      if (resultResolved) return;
      const errMsg = `Spawn error: ${err.message}`;
      push({ type: 'error', content: errMsg, sessionId });
      resolveResult({
        status: 'failed',
        output,
        error: errMsg,
        durationMs: Date.now() - startTime,
        sessionId,
      });
      wakeGenerator();
    });

    proc.on('close', (code) => {
      // If the turn already completed, the result is resolved — nothing to do.
      if (resultResolved) return;
      // Abnormal exit: the turn did NOT complete via PromptResponse/`stop`.
      // Resolve cause-based — process exit is never a successful ACP turn
      // completion, so 'completed' is never used here.
      const status: AgentResult['status'] = killed
        ? 'cancelled'
        : timedOut
          ? 'timeout'
          : 'failed';
      const error = killed
        ? 'killed by caller'
        : timedOut
          ? 'timeout'
          : `process exited (code ${code})`;
      resolveResult({
        status,
        output,
        error,
        durationMs: Date.now() - startTime,
        sessionId,
      });
      wakeGenerator();
    });

    // --- Events generator (mirrors OpenCodeBackend) ---
    async function* generator(): AsyncGenerator<AgentEvent> {
      try {
        while (!finished) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            const event = await new Promise<AgentEvent | undefined>((resolve) => {
              resolveNext = (r) => {
                if (r.done) {
                  resolve(undefined);
                  return;
                }
                resolve(r.value!);
              };
            });
            if (event === undefined) break; // turn complete / process exited
            yield event;
          }
        }
        // Drain any remaining queued events.
        while (queue.length > 0) yield queue.shift()!;
      } finally {
        clearTimeout(timer);
        killProcess();
      }
    }

    // Wrap with withDoneGuarantee so a `done` event always emits.
    const events = withDoneGuarantee(generator(), resultPromise);

    return {
      events,
      result: resultPromise,
      kill: () => {
        // Idempotent: a second call (or one after the turn completed) is a
        // no-op. Sets the cause flag so the `close` handler resolves as
        // 'cancelled'; does NOT resolveResult directly (close is the single
        // abnormal-exit resolver).
        if (resultResolved || killed) return;
        killed = true;
        clearTimeout(timer);
        killProcess();
        wakeGenerator();
      },
    };
  }
}
