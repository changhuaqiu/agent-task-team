import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import treeKill from 'tree-kill';
import { spawnCli } from '../cliBridge';
import { withDoneGuarantee } from '../with-done-guarantee';
import {
  createTurnScopedAcpEventMapper,
  KNOWN_SESSION_UPDATE_TYPES,
} from './agentEventMapper';
import {
  CorrelatedPlatformMcpApprovalTracker,
  createCorrelatedPlatformMcpPermissionPolicy,
  createPermissionHandler,
  normalizeAcpMcpToolName,
  type AcpPermissionPolicy,
} from './permissionPolicy';
import type {
  AgentBackend,
  AgentEvent,
  AgentResult,
  AgentRun,
  ExecOptions,
} from '../types';
import type { CapabilitySet, EngineId } from '../capabilities';

export type AcpFailureReasonCode =
  | 'acp_cancelled'
  | 'acp_concurrency_limit'
  | 'acp_connection_failed'
  | 'acp_empty_completion'
  | 'acp_event_limit'
  | 'acp_invalid_runtime'
  | 'acp_max_turn_timeout'
  | 'acp_output_limit'
  | 'acp_process_exited'
  | 'acp_resume_unsupported'
  | 'acp_session_identity_changed'
  | 'acp_session_load_failed'
  | 'acp_session_not_found'
  | 'acp_startup_failed'
  | 'acp_timeout';

export interface AcpRuntimeLimits {
  maxConcurrentRuns: number;
  maxQueuedEvents: number;
  maxEventChars: number;
  maxOutputChars: number;
  maxStderrChars: number;
}

export interface AcpBackendOpts {
  command: string;
  args: string[];
  cwd?: string;
  engine: EngineId;
  timeoutMs?: number;
  env?: Record<string, string>;
  permissionPolicy?: AcpPermissionPolicy;
  hardDenyPermissions?: boolean;
  permissionTimeoutMs?: number;
  cancelGraceMs?: number;
  forceKillGraceMs?: number;
  maxTurnTimeoutMs?: number;
  limits?: Partial<AcpRuntimeLimits>;
  mcpServers?: acp.McpServer[];
  autoApproveMcpToolNames?: string[];
}

const ACP_CAPS_BASE = {
  promptMode: 'stdin-stream-json',
  outputMode: 'events',
  supportsResume: true,
  supportsModel: true,
  supportsSystemPrompt: true,
  systemPromptMode: 'none',
  supportsMaxTurns: false,
  supportsPermissionMode: true,
  requiresPty: false,
} satisfies Omit<CapabilitySet, 'engine'>;

const DEFAULT_LIMITS: AcpRuntimeLimits = {
  maxConcurrentRuns: 10,
  maxQueuedEvents: 2_000,
  maxEventChars: 64_000,
  maxOutputChars: 1_000_000,
  maxStderrChars: 4_000,
};

const EMPTY_COMPLETION_RECOVERY_PROMPT =
  'The previous turn finished after tool execution without a final assistant message. '
  + 'Provide the final answer to the original user request now. Do not repeat completed tool calls.';

const EMPTY_COMPLETION_FALLBACK =
  '⚠️ Agent 已完成工具调用，但 ACP runtime 未返回最终文本；本次调用已标记失败，请重试。';

function resolveLimits(overrides?: Partial<AcpRuntimeLimits>): AcpRuntimeLimits {
  const merged = { ...DEFAULT_LIMITS, ...overrides };
  const positiveInt = (value: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
  return {
    maxConcurrentRuns: positiveInt(merged.maxConcurrentRuns, DEFAULT_LIMITS.maxConcurrentRuns),
    maxQueuedEvents: positiveInt(merged.maxQueuedEvents, DEFAULT_LIMITS.maxQueuedEvents),
    maxEventChars: positiveInt(merged.maxEventChars, DEFAULT_LIMITS.maxEventChars),
    maxOutputChars: positiveInt(merged.maxOutputChars, DEFAULT_LIMITS.maxOutputChars),
    maxStderrChars: positiveInt(merged.maxStderrChars, DEFAULT_LIMITS.maxStderrChars),
  };
}

let activeAcpRuns = 0;

export function getActiveAcpRunCount(): number {
  return activeAcpRuns;
}

function stopReasonToStatus(stopReason: acp.StopReason): AgentResult['status'] {
  return stopReason === 'end_turn'
    ? 'completed'
    : stopReason === 'cancelled'
      ? 'cancelled'
      : 'failed';
}

function failedRun(
  message: string,
  reasonCode: AcpFailureReasonCode,
  startedAt = Date.now(),
): AgentRun {
  const result: AgentResult = {
    status: 'failed',
    output: '',
    error: message,
    reasonCode,
    durationMs: Date.now() - startedAt,
  };
  const resultPromise = Promise.resolve(result);
  async function* failureEvents(): AsyncGenerator<AgentEvent> {
    yield { type: 'error', content: message };
  }
  return {
    events: withDoneGuarantee(failureEvents(), resultPromise),
    result: resultPromise,
    kill: () => {},
  };
}

export function sanitizeAcpDiagnostic(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|rk|ghp|github_pat|xox[baprs])-[-_a-z0-9]{8,}\b/gi, '[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[REDACTED]');
}

export function isAcpResourceNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === -32002
    || (typeof candidate.message === 'string' && /resource not found/i.test(candidate.message));
}

function processExitMessage(code: number | null, signal: NodeJS.Signals | null, stderr: string): string {
  const suffix = stderr.trim() ? `; stderr: ${sanitizeAcpDiagnostic(stderr.trim())}` : '';
  return `ACP process exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})${suffix}`;
}

export class AcpBackend implements AgentBackend {
  readonly capabilities: CapabilitySet;

  constructor(private o: AcpBackendOpts) {
    this.capabilities = { ...ACP_CAPS_BASE, engine: this.o.engine };
  }

  execute(prompt: string, opts: ExecOptions): AgentRun {
    const startTime = Date.now();
    const cwd = resolve(opts.cwd ?? this.o.cwd ?? process.cwd());
    const limits = resolveLimits(this.o.limits);

    if (!this.o.command.trim() || !Array.isArray(this.o.args)) {
      return failedRun('Invalid ACP launcher configuration', 'acp_invalid_runtime', startTime);
    }
    let cwdIsDirectory = false;
    try {
      cwdIsDirectory = isAbsolute(cwd) && existsSync(cwd) && statSync(cwd).isDirectory();
    } catch {
      cwdIsDirectory = false;
    }
    if (!cwdIsDirectory) {
      return failedRun(`Invalid ACP working directory: ${cwd}`, 'acp_invalid_runtime', startTime);
    }
    if (activeAcpRuns >= limits.maxConcurrentRuns) {
      return failedRun(
        `ACP concurrency limit reached (${limits.maxConcurrentRuns})`,
        'acp_concurrency_limit',
        startTime,
      );
    }

    activeAcpRuns += 1;
    let slotReleased = false;
    const releaseSlot = () => {
      if (slotReleased) return;
      slotReleased = true;
      activeAcpRuns = Math.max(0, activeAcpRuns - 1);
    };

    const promptText = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;
    const env = {
      ...(process.env as Record<string, string>),
      ...this.o.env,
      ...opts.env,
    };

    let proc: ReturnType<typeof spawnCli>;
    try {
      proc = spawnCli(this.o.command, this.o.args, {
        cwd,
        env: env as typeof process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      releaseSlot();
      return failedRun(
        `ACP spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        'acp_startup_failed',
        startTime,
      );
    }

    const queue: AgentEvent[] = [];
    let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;
    let streamFinished = false;
    let output = '';
    let sawToolCall = false;
    let hasTextAfterLastTool = false;
    let projectedChars = 0;
    let sessionId: string | undefined;
    let clientContext: acp.ClientContext | undefined;
    let acceptSessionUpdates = false;
    const mapTurnUpdate = createTurnScopedAcpEventMapper();
    const platformMcpApprovals = new CorrelatedPlatformMcpApprovalTracker();
    const autoApprovedMcpToolNames = new Set(
      (this.o.autoApproveMcpToolNames ?? []).map(normalizeAcpMcpToolName),
    );
    let stderrTail = '';
    let initialized = false;
    let resultResolved = false;
    let processClosed = false;
    let terminationStarted = false;
    let termTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let cleanupReleaseTimer: NodeJS.Timeout | undefined;
    let idleTimeoutTimer: NodeJS.Timeout | undefined;
    let maxTurnTimeoutTimer: NodeJS.Timeout | undefined;

    let resultResolve!: (result: AgentResult) => void;
    const resultPromise = new Promise<AgentResult>((resolveResult) => {
      resultResolve = resolveResult;
    });

    const wakeGenerator = () => {
      streamFinished = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true });
        resolveNext = null;
      }
    };

    const emit = (event: AgentEvent, bypassQueueLimit = false): boolean => {
      if (resultResolved && event.type !== 'done') return false;
      const content = event.content.length > limits.maxEventChars
        ? `${event.content.slice(0, limits.maxEventChars)}\n[truncated]`
        : event.content;
      const boundedEvent = content === event.content ? event : { ...event, content };

      if (boundedEvent.type === 'text') {
        const remaining = limits.maxOutputChars - output.length;
        if (remaining <= 0 || boundedEvent.content.length > remaining) return false;
        output += boundedEvent.content;
        if (sawToolCall && boundedEvent.content.trim()) hasTextAfterLastTool = true;
      } else if (boundedEvent.type === 'tool_use') {
        sawToolCall = true;
        hasTextAfterLastTool = false;
      }
      if (resolveNext) {
        resolveNext({ value: boundedEvent, done: false });
        resolveNext = null;
        return true;
      }
      if (!bypassQueueLimit && queue.length >= limits.maxQueuedEvents) return false;
      queue.push(boundedEvent);
      return true;
    };

    const signalTree = (signal: NodeJS.Signals) => {
      if (processClosed) return;
      const signalDirectChild = () => {
        try {
          proc.kill(signal);
        } catch {
          // Best effort. Finalization never waits on `close`.
        }
      };
      if (typeof proc.pid === 'number') {
        try {
          // tree-kill is asynchronous. Killing the launcher immediately after
          // starting it races tree discovery on Windows: `npx` may disappear
          // before taskkill can enumerate its descendants. Only fall back to
          // the direct child when tree signalling itself fails.
          treeKill(proc.pid, signal, (error) => {
            if (error) signalDirectChild();
          });
          return;
        } catch {
          // Fall through to direct child signalling.
        }
      }
      signalDirectChild();
    };

    const stopProcess = (graceful: boolean) => {
      if (terminationStarted) return;
      terminationStarted = true;
      if (graceful && clientContext && sessionId) {
        void clientContext
          .notify(acp.methods.agent.session.cancel, { sessionId })
          .catch(() => {});
      }
      const cancelGraceMs = graceful ? Math.max(0, this.o.cancelGraceMs ?? 250) : 0;
      const terminate = () => {
        signalTree('SIGTERM');
        const forceKillGraceMs = Math.max(1, this.o.forceKillGraceMs ?? 1_000);
        forceKillTimer = setTimeout(() => signalTree('SIGKILL'), forceKillGraceMs);
        forceKillTimer.unref?.();
        cleanupReleaseTimer = setTimeout(releaseSlot, forceKillGraceMs + 250);
        cleanupReleaseTimer.unref?.();
      };
      if (cancelGraceMs === 0) {
        terminate();
      } else {
        termTimer = setTimeout(terminate, cancelGraceMs);
        termTimer.unref?.();
      }
    };

    const finalize = (
      status: AgentResult['status'],
      reasonCode?: AcpFailureReasonCode,
      error?: string,
      usage?: AgentResult['usage'],
      gracefulCancel = false,
    ) => {
      if (resultResolved) return;
      resultResolved = true;
      clearTimeout(idleTimeoutTimer);
      clearTimeout(maxTurnTimeoutTimer);
      resultResolve({
        status,
        output,
        ...(error ? { error } : {}),
        ...(reasonCode ? { reasonCode } : {}),
        durationMs: Date.now() - startTime,
        sessionId,
        usage,
      });
      wakeGenerator();
      stopProcess(gracefulCancel);
    };

    const failForLimit = (reasonCode: 'acp_output_limit' | 'acp_event_limit', message: string) => {
      if (resultResolved) return;
      if (queue.length >= limits.maxQueuedEvents) queue.shift();
      emit({ type: 'error', content: message, sessionId }, true);
      finalize('failed', reasonCode, message, undefined, true);
    };

    const idleTimeoutMs = Math.max(1, opts.timeout ?? this.o.timeoutMs ?? 120_000);
    const maxTurnTimeoutMs = this.o.maxTurnTimeoutMs
      ?? Math.max(idleTimeoutMs * 6, 30 * 60_000);
    const armIdleTimeout = () => {
      clearTimeout(idleTimeoutTimer);
      idleTimeoutTimer = setTimeout(() => {
        const message = `ACP turn idle timed out after ${idleTimeoutMs}ms without protocol activity`;
        emit({ type: 'error', content: message, sessionId }, true);
        finalize('timeout', 'acp_timeout', message, undefined, true);
      }, idleTimeoutMs);
      idleTimeoutTimer.unref?.();
    };
    const markProtocolActivity = () => {
      if (!resultResolved) armIdleTimeout();
    };
    armIdleTimeout();
    if (maxTurnTimeoutMs > 0) {
      maxTurnTimeoutTimer = setTimeout(() => {
        const message = `ACP turn exceeded hard limit of ${maxTurnTimeoutMs}ms`;
        emit({ type: 'error', content: message, sessionId }, true);
        finalize('timeout', 'acp_max_turn_timeout', message, undefined, true);
      }, maxTurnTimeoutMs);
      maxTurnTimeoutTimer.unref?.();
    }

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-limits.maxStderrChars);
    });

    proc.on('error', (error) => {
      const message = `ACP spawn failed: ${error.message}`;
      emit({ type: 'error', content: message, sessionId }, true);
      finalize('failed', 'acp_startup_failed', message);
    });

    proc.on('close', (code, signal) => {
      processClosed = true;
      clearTimeout(termTimer);
      clearTimeout(forceKillTimer);
      clearTimeout(cleanupReleaseTimer);
      releaseSlot();
      if (resultResolved) return;
      const message = processExitMessage(code, signal, stderrTail);
      emit({ type: 'error', content: message, sessionId }, true);
      finalize('failed', 'acp_process_exited', message);
    });

    const handleSessionUpdate = (notification: acp.SessionNotification) => {
      markProtocolActivity();
      if (resultResolved || !acceptSessionUpdates) return;
      if (!sessionId || notification.sessionId !== sessionId) {
        const message = `ACP session identity changed: expected ${sessionId ?? 'unbound'}, received ${notification.sessionId}`;
        emit({ type: 'error', content: message, sessionId }, true);
        finalize('failed', 'acp_session_identity_changed', message);
        return;
      }

      const event = mapTurnUpdate(notification.update);
      if (event) {
        if (event.type === 'tool_use' && event.tool?.callId) {
          platformMcpApprovals.observe(
            sessionId,
            event.tool.callId,
            autoApprovedMcpToolNames.has(normalizeAcpMcpToolName(event.tool.name)),
          );
        }
        if (event.sessionId === undefined) event.sessionId = sessionId;
        if (event.content.length > limits.maxEventChars) {
          failForLimit(
            'acp_event_limit',
            `ACP event exceeded ${limits.maxEventChars} characters`,
          );
          return;
        }
        if (projectedChars + event.content.length > limits.maxOutputChars) {
          failForLimit(
            'acp_output_limit',
            `ACP output exceeded ${limits.maxOutputChars} characters`,
          );
          return;
        }
        if (!resolveNext && queue.length >= limits.maxQueuedEvents) {
          failForLimit(
            'acp_event_limit',
            `ACP event queue exceeded ${limits.maxQueuedEvents} events`,
          );
          return;
        }
        if (!emit(event)) {
          failForLimit('acp_event_limit', 'ACP event stream rejected an update');
          return;
        }
        projectedChars += event.content.length;
      } else if (!KNOWN_SESSION_UPDATE_TYPES.has(notification.update.sessionUpdate)) {
        console.warn('[acp] unknown session update ignored:', notification.update.sessionUpdate);
      }
    };

    const startConnection = () => {
      if (resultResolved) return;
      if (!proc.stdin || !proc.stdout) {
        const message = 'ACP subprocess stdio is unavailable';
        emit({ type: 'error', content: message }, true);
        finalize('failed', 'acp_startup_failed', message);
        return;
      }

      try {
        const stream = acp.ndJsonStream(
          Writable.toWeb(proc.stdin),
          Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
        );
        const permissionHandler = createPermissionHandler(
          createCorrelatedPlatformMcpPermissionPolicy(
            this.o.permissionPolicy ?? 'deny',
            platformMcpApprovals,
            { hardDeny: this.o.hardDenyPermissions },
          ),
          this.o.permissionTimeoutMs,
        );
        const clientApp = acp
          .client({ name: 'agent-task-team' })
          .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
            markProtocolActivity();
            const response = await permissionHandler(ctx.params);
            markProtocolActivity();
            return response;
          })
          .onNotification(acp.methods.client.session.update, (ctx) =>
            handleSessionUpdate(ctx.params),
          );

        void clientApp
          .connectWith(stream, async (ctx) => {
            if (resultResolved) return;
            clientContext = ctx;
            const initializeResponse = await ctx.request(acp.methods.agent.initialize, {
              protocolVersion: acp.PROTOCOL_VERSION,
              clientCapabilities: {},
            });
            markProtocolActivity();
            initialized = true;
            if (resultResolved) return;

            if (opts.resumeSessionId) {
              sessionId = opts.resumeSessionId;
              if (!initializeResponse.agentCapabilities?.loadSession) {
                const message = `ACP runtime does not support loading session ${sessionId}`;
                emit({ type: 'error', content: message, sessionId }, true);
                finalize('failed', 'acp_resume_unsupported', message);
                return;
              }
              try {
                // ACP agents replay historical updates while session/load is in
                // progress. Keep forwarding disabled until the load response so
                // old conversation content is not appended to the current turn.
                await ctx.request(acp.methods.agent.session.load, {
                  sessionId,
                  cwd,
                  mcpServers: this.o.mcpServers ?? [],
                });
                markProtocolActivity();
              } catch (error) {
                const message = `ACP session load failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`;
                emit({ type: 'error', content: message, sessionId }, true);
                finalize(
                  'failed',
                  isAcpResourceNotFound(error) ? 'acp_session_not_found' : 'acp_session_load_failed',
                  message,
                );
                return;
              }
            } else {
              const newSession = await ctx.request(acp.methods.agent.session.new, {
                cwd,
                mcpServers: this.o.mcpServers ?? [],
              });
              markProtocolActivity();
              sessionId = newSession.sessionId;
            }
            if (resultResolved) return;
            acceptSessionUpdates = true;

            let response = await ctx.request(acp.methods.agent.session.prompt, {
              sessionId,
              prompt: [{ type: 'text', text: promptText }],
            });
            markProtocolActivity();
            if (resultResolved) return;
            let usage = response.usage;

            if (
              response.stopReason === 'end_turn'
              && sawToolCall
              && !hasTextAfterLastTool
            ) {
              const recovery = await ctx.request(acp.methods.agent.session.prompt, {
                sessionId,
                prompt: [{ type: 'text', text: EMPTY_COMPLETION_RECOVERY_PROMPT }],
              });
              markProtocolActivity();
              if (resultResolved) return;
              response = recovery;
              if (usage || recovery.usage) {
                usage = {
                  inputTokens: (usage?.inputTokens ?? 0) + (recovery.usage?.inputTokens ?? 0),
                  outputTokens: (usage?.outputTokens ?? 0) + (recovery.usage?.outputTokens ?? 0),
                  totalTokens: (usage?.totalTokens ?? 0) + (recovery.usage?.totalTokens ?? 0),
                };
              }
            }

            if (
              response.stopReason === 'end_turn'
              && sawToolCall
              && !hasTextAfterLastTool
            ) {
              emit({ type: 'text', content: EMPTY_COMPLETION_FALLBACK, sessionId }, true);
              finalize(
                'failed',
                'acp_empty_completion',
                'ACP ended after tool execution without a final assistant message',
                usage
                  ? {
                      default: {
                        inputTokens: usage.inputTokens ?? 0,
                        outputTokens: usage.outputTokens ?? 0,
                      },
                    }
                  : undefined,
              );
              return;
            }

            finalize(
              stopReasonToStatus(response.stopReason),
              response.stopReason === 'cancelled' ? 'acp_cancelled' : undefined,
              response.stopReason === 'end_turn' ? undefined : `ACP stopped: ${response.stopReason}`,
              usage
                ? {
                    default: {
                      inputTokens: usage.inputTokens ?? 0,
                      outputTokens: usage.outputTokens ?? 0,
                    },
                  }
                : undefined,
            );
          })
          .catch((error: unknown) => {
            if (resultResolved) return;
            const message = `ACP connection failed: ${error instanceof Error ? error.message : String(error)}`;
            emit({ type: 'error', content: message, sessionId }, true);
            finalize(
              'failed',
              initialized ? 'acp_connection_failed' : 'acp_startup_failed',
              message,
            );
          })
          .finally(() => {
            if (!resultResolved) {
              const message = 'ACP connection closed before the turn completed';
              emit({ type: 'error', content: message, sessionId }, true);
              finalize('failed', 'acp_connection_failed', message);
            }
          });
      } catch (error) {
        const message = `ACP connection setup failed: ${error instanceof Error ? error.message : String(error)}`;
        emit({ type: 'error', content: message }, true);
        finalize('failed', 'acp_connection_failed', message);
      }
    };

    // Wait for the child `spawn` event before binding stdio. A missing command
    // emits `error` without `spawn`; starting the JSON-RPC client earlier races
    // that event and misclassifies a launcher failure as a connection failure.
    proc.once('spawn', startConnection);

    async function* generator(): AsyncGenerator<AgentEvent> {
      try {
        while (!streamFinished) {
          if (queue.length > 0) {
            yield queue.shift()!;
            continue;
          }
          const event = await new Promise<AgentEvent | undefined>((resolveEvent) => {
            resolveNext = (result) => resolveEvent(result.done ? undefined : result.value);
          });
          if (!event) break;
          yield event;
        }
        while (queue.length > 0) yield queue.shift()!;
      } finally {
        if (!resultResolved) {
          finalize('cancelled', 'acp_cancelled', 'ACP event consumer stopped early', undefined, true);
        }
      }
    }

    return {
      events: withDoneGuarantee(generator(), resultPromise),
      result: resultPromise,
      kill: () => {
        if (resultResolved) return;
        finalize('cancelled', 'acp_cancelled', 'killed by caller', undefined, true);
      },
    };
  }
}
