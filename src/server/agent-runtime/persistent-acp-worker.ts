import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import spawn from 'cross-spawn';
import treeKill from 'tree-kill';
import { createTurnScopedAcpEventMapper, KNOWN_SESSION_UPDATE_TYPES } from '../agent/acp/agentEventMapper';
import {
  createCorrelatedPlatformMcpPermissionPolicy,
  createPermissionHandler,
  type AcpPermissionPolicy,
} from '../agent/acp/permissionPolicy';
import type { AgentEvent, AgentResult, AgentRun, EngineId, ExecOptions } from '../agent/types';

export interface PersistentAcpWorkerOptions {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  engine: EngineId;
  cancelGraceMs?: number;
  forceKillGraceMs?: number;
  maxTurnTimeoutMs?: number;
  limits?: Partial<PersistentAcpLimits>;
  forwardNativeSubagentText?: boolean;
}

export interface PersistentAcpTurnConfig {
  /** Force the vendor session out of inherited bypass modes before this turn. */
  sessionMode?: 'default' | 'plan';
  permissionPolicy?: AcpPermissionPolicy;
  permissionTimeoutMs?: number;
  onPermissionRequested?: (request: acp.RequestPermissionRequest) => void;
  onPermissionResolved?: (
    request: acp.RequestPermissionRequest,
    response: acp.RequestPermissionResponse,
  ) => void;
  mcpServers?: acp.McpServer[];
  autoApproveMcpToolNames?: string[];
  terminalMcpToolNames?: string[];
  /** A WorkContract turn may end only after a lifecycle command is accepted. */
  requireAcceptedTerminalCommand?: boolean;
}

interface PersistentAcpLimits {
  maxQueuedEvents: number;
  maxEventChars: number;
  maxOutputChars: number;
  maxStderrChars: number;
}

type WorkerFailureReason =
  | 'acp_cancelled'
  | 'acp_connection_failed'
  | 'acp_empty_completion'
  | 'ended_without_outcome'
  | 'acp_event_limit'
  | 'acp_invalid_runtime'
  | 'acp_max_turn_timeout'
  | 'acp_output_limit'
  | 'acp_permission_audit_failed'
  | 'acp_process_exited'
  | 'acp_resume_unsupported'
  | 'acp_session_identity_changed'
  | 'acp_session_load_failed'
  | 'acp_session_mode_failed'
  | 'acp_session_not_found'
  | 'acp_startup_failed'
  | 'acp_timeout'
  | 'acp_tool_completion_missing'
  | 'acp_worker_busy';

interface ActiveTurn {
  sessionId?: string;
  acceptUpdates: boolean;
  handleUpdate(notification: acp.SessionNotification): void;
  handlePermission(request: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse>;
  failTransport(message: string, reasonCode: WorkerFailureReason): void;
}

const DEFAULT_LIMITS: PersistentAcpLimits = {
  maxQueuedEvents: 2_000,
  maxEventChars: 64_000,
  maxOutputChars: 1_000_000,
  maxStderrChars: 4_000,
};

const EMPTY_COMPLETION_RECOVERY_PROMPT =
  'The previous turn finished without a final assistant message. '
  + 'Provide the final answer to the original user request now. '
  + 'Do not repeat any completed actions or tool calls.';

const EMPTY_COMPLETION_FALLBACK =
  '⚠️ Agent runtime 未返回最终文本；本次调用已标记失败，请重试。';

const SAFE_HOST_ENV_KEYS = [
  'APPDATA', 'COMSPEC', 'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'PATH', 'PATHEXT',
  'NODE_ENV', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'SYSTEMDRIVE', 'SYSTEMROOT',
  'TEMP', 'TERM', 'TMP', 'USERPROFILE', 'WINDIR',
] as const;

export function buildAcpSubprocessEnv(
  runtimeEnv: Record<string, string>,
  hostEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const safeHostEnv: Record<string, string | undefined> = {
    NODE_ENV: hostEnv.NODE_ENV ?? 'production',
  };
  for (const key of SAFE_HOST_ENV_KEYS) {
    const value = hostEnv[key];
    if (typeof value === 'string') safeHostEnv[key] = value;
  }
  return { ...safeHostEnv, ...runtimeEnv } as NodeJS.ProcessEnv;
}

function limits(overrides?: Partial<PersistentAcpLimits>): PersistentAcpLimits {
  const merged = { ...DEFAULT_LIMITS, ...overrides };
  const positive = (value: number, fallback: number) => Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
  return {
    maxQueuedEvents: positive(merged.maxQueuedEvents, DEFAULT_LIMITS.maxQueuedEvents),
    maxEventChars: positive(merged.maxEventChars, DEFAULT_LIMITS.maxEventChars),
    maxOutputChars: positive(merged.maxOutputChars, DEFAULT_LIMITS.maxOutputChars),
    maxStderrChars: positive(merged.maxStderrChars, DEFAULT_LIMITS.maxStderrChars),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function sanitize(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|rk|ghp|github_pat|xox[baprs])-[-_a-z0-9]{8,}\b/gi, '[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[REDACTED]');
}

function acceptedTerminalReceipt(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return false;
    try { return acceptedTerminalReceipt(JSON.parse(text), depth + 1); } catch { return false; }
  }
  if (Array.isArray(value)) return value.some((item) => acceptedTerminalReceipt(item, depth + 1));
  if (typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.status === 'applied' || candidate.status === 'duplicate')
    && candidate.result && typeof candidate.result === 'object'
    && (candidate.result as Record<string, unknown>).exitAccepted === true
  ) return true;
  return Object.values(candidate).some((item) => acceptedTerminalReceipt(item, depth + 1));
}

export function matchesTerminalToolName(
  actualName: string,
  configuredNames: ReadonlySet<string>,
): boolean {
  if (configuredNames.has(actualName)) return true;
  // OpenCode exposes MCP tools as <server-name>_<tool-name>. Keep matching
  // separator-bound so an unrelated tool whose name merely shares a suffix
  // cannot satisfy the WorkContract terminal-command guard.
  return [...configuredNames].some((configuredName) => (
    configuredName.length > 0 && actualName.endsWith(`_${configuredName}`)
  ));
}

function sessionMeta(engine: EngineId, forward?: boolean): Record<string, unknown> | undefined {
  return engine === 'claude' && forward
    ? { claudeCode: { options: { forwardSubagentText: true } } }
    : undefined;
}

function resourceNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === -32002
    || (typeof candidate.message === 'string' && /resource not found/i.test(candidate.message));
}

function failedRun(message: string, reasonCode: WorkerFailureReason): AgentRun {
  const result = Promise.resolve<AgentResult>({
    status: 'failed', output: '', error: message, reasonCode, durationMs: 0,
  });
  async function* events(): AsyncGenerator<AgentEvent> {
    yield { type: 'error', content: message };
    yield { type: 'done', content: '' };
  }
  return {
    started: Promise.resolve({ ok: false, reasonCode, message }),
    events: events(), result, kill: () => {},
  };
}

function processMessage(code: number | null, signal: NodeJS.Signals | null, stderr: string) {
  const suffix = stderr.trim() ? `; stderr: ${sanitize(stderr.trim())}` : '';
  return `ACP process exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})${suffix}`;
}

/**
 * Owns one long-lived ACP subprocess and connection. It accepts one turn at a
 * time; per-turn permission and MCP grants are never retained after the turn.
 */
export class PersistentAcpWorker {
  readonly id: string;
  private readonly resolvedCwd: string;
  private readonly resolvedLimits: PersistentAcpLimits;
  private process?: ReturnType<typeof spawn>;
  private connection?: acp.ClientConnection;
  private initializeResponse?: acp.InitializeResponse;
  private starting?: Promise<void>;
  private active?: ActiveTurn;
  private stderrTail = '';
  private stopped = false;
  private processClosed = false;

  constructor(private readonly options: PersistentAcpWorkerOptions) {
    this.id = options.id;
    this.resolvedCwd = resolve(options.cwd);
    this.resolvedLimits = limits(options.limits);
  }

  ready(): boolean {
    return Boolean(this.connection && this.initializeResponse && !this.processClosed && !this.stopped);
  }

  busy(): boolean {
    return Boolean(this.active);
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.ready()) return;
    if (this.starting) return this.starting;
    if (this.stopped) throw new Error('acp_worker_stopped');
    this.starting = this.startConnection(signal).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startConnection(signal?: AbortSignal): Promise<void> {
    if (!this.options.command.trim() || !Array.isArray(this.options.args)) {
      throw new Error('acp_invalid_runtime');
    }
    let validCwd = false;
    try {
      validCwd = isAbsolute(this.resolvedCwd)
        && existsSync(this.resolvedCwd)
        && statSync(this.resolvedCwd).isDirectory();
    } catch { validCwd = false; }
    if (!validCwd) throw new Error('acp_invalid_runtime');
    if (signal?.aborted) throw new Error('runtime_start_cancelled');

    const proc = spawn(this.options.command, this.options.args, {
      cwd: this.resolvedCwd,
      env: buildAcpSubprocessEnv(this.options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = proc;
    this.processClosed = false;
    this.stderrTail = '';
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-this.resolvedLimits.maxStderrChars);
    });

    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const onAbort = () => rejectSpawn(new Error('runtime_start_cancelled'));
      proc.once('spawn', resolveSpawn);
      proc.once('error', rejectSpawn);
      signal?.addEventListener('abort', onAbort, { once: true });
    }).catch(async (error) => {
      await this.stopProcess();
      throw error;
    });
    if (!proc.stdin || !proc.stdout) {
      await this.stopProcess();
      throw new Error('acp_startup_failed');
    }

    const deny = createPermissionHandler('deny');
    const app = acp.client({ name: 'agent-task-team' })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        const active = this.active;
        return active ? active.handlePermission(ctx.params) : deny(ctx.params);
      })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        this.active?.handleUpdate(ctx.params);
      });
    const stream = acp.ndJsonStream(
      Writable.toWeb(proc.stdin),
      Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    this.connection = connection;
    proc.once('close', (code, closeSignal) => {
      this.processClosed = true;
      this.initializeResponse = undefined;
      this.connection = undefined;
      this.active?.failTransport(
        processMessage(code, closeSignal, this.stderrTail),
        'acp_process_exited',
      );
    });
    connection.closed.then(() => {
      if (this.stopped || this.processClosed) return;
      this.active?.failTransport('ACP connection closed', 'acp_connection_failed');
    }).catch(() => {});

    try {
      this.initializeResponse = await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
    } catch (error) {
      await this.stopProcess();
      throw new Error(`acp_startup_failed:${sanitize(error instanceof Error ? error.message : String(error))}`);
    }
  }

  execute(prompt: string, execOptions: ExecOptions, config: PersistentAcpTurnConfig): AgentRun {
    if (this.active) return failedRun('ACP worker is already running a turn', 'acp_worker_busy');
    const startedAt = Date.now();
    const startedDeferred = deferred<Awaited<AgentRun['started']>>();
    const resultDeferred = deferred<AgentResult>();
    const queue: AgentEvent[] = [];
    let resolveNext: ((event?: AgentEvent) => void) | undefined;
    let streamDone = false;
    let finalized = false;
    let output = '';
    let projectedChars = 0;
    let startSettled = false;
    let sawTool = false;
    let textAfterTool = false;
    let acceptedTerminalCommand = false;
    let visibleActivity = false;
    let idleTimer: NodeJS.Timeout | undefined;
    let permissionAuditFailed = false;
    let pendingPermissions = 0;
    let deferredFinal: [
      AgentResult['status'],
      WorkerFailureReason?,
      string?,
      AgentResult['usage']?,
    ] | undefined;
    const mapper = createTurnScopedAcpEventMapper();
    const approvedCallIds = new Set<string>();
    const approvedToolNames = new Set(config.autoApproveMcpToolNames ?? []);
    const terminalToolNames = new Set(config.terminalMcpToolNames ?? []);
    const promptText = execOptions.systemPrompt ? `${execOptions.systemPrompt}\n\n${prompt}` : prompt;
    const idleMs = Math.max(1, execOptions.timeout ?? 120_000);
    const hardMs = this.options.maxTurnTimeoutMs ?? Math.max(idleMs * 6, 30 * 60_000);

    const closeStream = () => {
      streamDone = true;
      resolveNext?.();
      resolveNext = undefined;
    };
    const settleStarted = (value: Awaited<AgentRun['started']>) => {
      if (startSettled) return;
      startSettled = true;
      startedDeferred.resolve(value);
    };
    const emit = (event: AgentEvent, force = false): boolean => {
      if (finalized && event.type !== 'done') return false;
      const content = event.content.length > this.resolvedLimits.maxEventChars
        ? `${event.content.slice(0, this.resolvedLimits.maxEventChars)}\n[truncated]`
        : event.content;
      const bounded = content === event.content ? event : { ...event, content };
      if (bounded.type === 'text') {
        if (output.length + bounded.content.length > this.resolvedLimits.maxOutputChars) return false;
        output += bounded.content;
        if (sawTool && bounded.content.trim()) textAfterTool = true;
      } else if (bounded.type === 'tool_use' || bounded.type === 'tool_result') {
        sawTool = true;
        textAfterTool = false;
        if (
          bounded.type === 'tool_result'
          && bounded.tool?.status === 'completed'
          && matchesTerminalToolName(bounded.tool.name, terminalToolNames)
          && acceptedTerminalReceipt(bounded.content)
        ) acceptedTerminalCommand = true;
      }
      if (resolveNext) {
        const next = resolveNext;
        resolveNext = undefined;
        next(bounded);
      } else {
        if (!force && queue.length >= this.resolvedLimits.maxQueuedEvents) return false;
        queue.push(bounded);
      }
      return true;
    };
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        invalidate('timeout', 'acp_timeout', `ACP turn idle timed out after ${idleMs}ms`);
      }, idleMs);
      idleTimer.unref?.();
    };
    const finish = (
      status: AgentResult['status'],
      reasonCode?: WorkerFailureReason,
      error?: string,
      usage?: AgentResult['usage'],
    ) => {
      if (finalized) return;
      if (pendingPermissions > 0) {
        deferredFinal = [status, reasonCode, error, usage];
        return;
      }
      if (permissionAuditFailed) {
        status = 'failed';
        reasonCode = 'acp_permission_audit_failed';
        error = 'ACP permission decision could not be persisted for audit';
      }
      if (!startSettled) {
        settleStarted({
          ok: false,
          reasonCode: reasonCode ?? 'acp_startup_failed',
          message: error ?? `ACP ended before Runtime readiness (${status})`,
        });
      }
      finalized = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      if (this.active === activeTurn) this.active = undefined;
      resultDeferred.resolve({
        status, output, durationMs: Date.now() - startedAt,
        ...(error ? { error } : {}),
        ...(reasonCode ? { reasonCode } : {}),
        ...(activeTurn.sessionId ? { sessionId: activeTurn.sessionId } : {}),
        ...(usage ? { usage } : {}),
      });
      closeStream();
    };
    const invalidate = (
      status: AgentResult['status'],
      reasonCode: WorkerFailureReason,
      message: string,
    ) => {
      emit({ type: 'error', content: sanitize(message), sessionId: activeTurn.sessionId }, true);
      finish(status, reasonCode, sanitize(message));
      void this.stopProcess();
    };
    const activeTurn: ActiveTurn = {
      acceptUpdates: false,
      handleUpdate: (notification) => {
        if (finalized || !activeTurn.acceptUpdates) return;
        armIdle();
        if (!activeTurn.sessionId || notification.sessionId !== activeTurn.sessionId) {
          invalidate(
            'failed', 'acp_session_identity_changed',
            `ACP session identity changed: expected ${activeTurn.sessionId ?? 'unbound'}, received ${notification.sessionId}`,
          );
          return;
        }
        const event = mapper(notification.update);
        if (event) {
          visibleActivity = true;
          if (event.type === 'tool_use' && event.tool?.callId && approvedToolNames.has(event.tool.name)) {
            approvedCallIds.add(event.tool.callId);
          }
          const chars = event.content.length > this.resolvedLimits.maxEventChars
            ? this.resolvedLimits.maxEventChars
            : event.content.length;
          if (projectedChars + chars > this.resolvedLimits.maxOutputChars) {
            invalidate('failed', 'acp_output_limit', 'ACP projected output exceeded its limit');
            return;
          }
          if (!emit(event)) {
            invalidate('failed', 'acp_event_limit', 'ACP event stream exceeded its limit');
            return;
          }
          projectedChars += chars;
        } else if (!KNOWN_SESSION_UPDATE_TYPES.has(notification.update.sessionUpdate)) {
          console.warn('[acp] unknown session update ignored:', notification.update.sessionUpdate);
        }
      },
      handlePermission: async (request) => {
        const deny = () => createPermissionHandler('deny')(request);
        if (finalized) return deny();
        pendingPermissions += 1;
        visibleActivity = true;
        armIdle();
        try {
          try { config.onPermissionRequested?.(request); } catch {
            permissionAuditFailed = true;
            const denied = await deny();
            try { config.onPermissionResolved?.(request, denied); } catch { /* fail below */ }
            return denied;
          }
          const handler = createPermissionHandler(
            createCorrelatedPlatformMcpPermissionPolicy(
              config.permissionPolicy ?? 'deny', approvedCallIds, approvedToolNames,
            ),
            config.permissionTimeoutMs,
          );
          let response = await handler(request);
          if (finalized) response = await deny();
          try { config.onPermissionResolved?.(request, response); } catch {
            permissionAuditFailed = true;
            response = await deny();
          }
          return response;
        } finally {
          pendingPermissions = Math.max(0, pendingPermissions - 1);
          if (pendingPermissions === 0 && deferredFinal && !finalized) {
            const pending = deferredFinal;
            deferredFinal = undefined;
            finish(...pending);
          }
        }
      },
      failTransport: (message, reasonCode) => invalidate('failed', reasonCode, message),
    };

    this.active = activeTurn;
    armIdle();
    const hardTimer = setTimeout(() => {
      invalidate('timeout', 'acp_max_turn_timeout', `ACP turn exceeded hard limit of ${hardMs}ms`);
    }, hardMs);
    hardTimer.unref?.();

    void (async () => {
      try {
        await this.start();
        if (finalized) return;
        const connection = this.connection;
        const initialized = this.initializeResponse;
        if (!connection || !initialized) throw new Error('acp_connection_failed');
        const meta = sessionMeta(this.options.engine, this.options.forwardNativeSubagentText);
        const applySessionMode = async (): Promise<boolean> => {
          if (!config.sessionMode || !activeTurn.sessionId) return true;
          try {
            await connection.agent.request(acp.methods.agent.session.setMode, {
              sessionId: activeTurn.sessionId,
              modeId: config.sessionMode,
            });
            return true;
          } catch (error) {
            const message = `ACP session mode failed: ${sanitize(error instanceof Error ? error.message : String(error))}`;
            emit({ type: 'error', content: message, sessionId: activeTurn.sessionId }, true);
            settleStarted({ ok: false, reasonCode: 'acp_session_mode_failed', message });
            finish('failed', 'acp_session_mode_failed', message);
            return false;
          }
        };
        if (execOptions.resumeSessionId) {
          activeTurn.sessionId = execOptions.resumeSessionId;
          if (!initialized.agentCapabilities?.loadSession) {
            const message = `ACP runtime does not support loading session ${activeTurn.sessionId}`;
            emit({ type: 'error', content: message, sessionId: activeTurn.sessionId }, true);
            settleStarted({ ok: false, reasonCode: 'acp_resume_unsupported', message });
            finish('failed', 'acp_resume_unsupported', message);
            return;
          }
          try {
            await connection.agent.request(acp.methods.agent.session.load, {
              sessionId: activeTurn.sessionId,
              cwd: this.resolvedCwd,
              mcpServers: config.mcpServers ?? [],
              ...(meta ? { _meta: meta } : {}),
            });
          } catch (error) {
            const missing = resourceNotFound(error);
            const message = missing
              ? '之前的 Agent 会话已失效，系统已重置会话。请重新发送本条消息。'
              : `ACP session load failed: ${sanitize(error instanceof Error ? error.message : String(error))}`;
            const reasonCode = missing ? 'acp_session_not_found' : 'acp_session_load_failed';
            emit({ type: 'error', content: message, sessionId: activeTurn.sessionId }, true);
            settleStarted({ ok: false, reasonCode, message });
            finish('failed', reasonCode, message);
            return;
          }
        } else {
          const created = await connection.agent.request(acp.methods.agent.session.new, {
            cwd: this.resolvedCwd,
            mcpServers: config.mcpServers ?? [],
            ...(meta ? { _meta: meta } : {}),
          });
          activeTurn.sessionId = created.sessionId;
        }
        if (finalized) return;
        if (!await applySessionMode()) return;
        activeTurn.acceptUpdates = true;
        settleStarted({ ok: true, sessionId: activeTurn.sessionId });
        armIdle();
        let response = await connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: activeTurn.sessionId!,
          prompt: [{ type: 'text', text: promptText }],
        });
        armIdle();
        if (finalized) return;
        let usage = response.usage;
        if (
          response.stopReason === 'end_turn'
          && !acceptedTerminalCommand
          && (!output.trim() || (sawTool && !textAfterTool))
        ) {
          const canReplace = !execOptions.resumeSessionId && !output.trim() && !sawTool && !visibleActivity;
          if (canReplace) {
            activeTurn.acceptUpdates = false;
            const replacement = await connection.agent.request(acp.methods.agent.session.new, {
              cwd: this.resolvedCwd,
              mcpServers: config.mcpServers ?? [],
              ...(meta ? { _meta: meta } : {}),
            });
            activeTurn.sessionId = replacement.sessionId;
            if (!await applySessionMode()) return;
            activeTurn.acceptUpdates = true;
          }
          const recovery = await connection.agent.request(acp.methods.agent.session.prompt, {
            sessionId: activeTurn.sessionId!,
            prompt: [{ type: 'text', text: canReplace ? promptText : EMPTY_COMPLETION_RECOVERY_PROMPT }],
          });
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
          && !acceptedTerminalCommand
          && (!output.trim() || (sawTool && !textAfterTool))
        ) {
          emit({ type: 'text', content: EMPTY_COMPLETION_FALLBACK, sessionId: activeTurn.sessionId }, true);
          finish(
            'failed', sawTool ? 'acp_tool_completion_missing' : 'acp_empty_completion',
            'ACP ended without a final assistant message',
          );
          return;
        }
        if (
          response.stopReason === 'end_turn'
          && config.requireAcceptedTerminalCommand
          && !acceptedTerminalCommand
        ) {
          finish(
            'failed', 'ended_without_outcome',
            'ACP turn ended without an accepted lifecycle command',
            usage ? { default: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } } : undefined,
          );
          return;
        }
        finish(
          response.stopReason === 'end_turn' ? 'completed' : response.stopReason === 'cancelled' ? 'cancelled' : 'failed',
          response.stopReason === 'cancelled' ? 'acp_cancelled' : undefined,
          response.stopReason === 'end_turn' ? undefined : `ACP stopped: ${response.stopReason}`,
          usage ? { default: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } } : undefined,
        );
      } catch (error) {
        const message = sanitize(error instanceof Error ? error.message : String(error));
        if (!finalized) {
          settleStarted({ ok: false, reasonCode: 'acp_connection_failed', message });
          invalidate('failed', this.ready() ? 'acp_connection_failed' : 'acp_startup_failed', message);
        }
      }
    })();

    async function* events(): AsyncGenerator<AgentEvent> {
      try {
        while (!streamDone) {
          if (queue.length) { yield queue.shift()!; continue; }
          const next = await new Promise<AgentEvent | undefined>((resolveEvent) => { resolveNext = resolveEvent; });
          if (!next) break;
          yield next;
        }
        while (queue.length) yield queue.shift()!;
        const result = await resultDeferred.promise;
        yield { type: 'done', content: result.output, sessionId: result.sessionId };
      } finally {
        if (!finalized) invalidate('cancelled', 'acp_cancelled', 'ACP event consumer stopped early');
      }
    }

    return {
      started: startedDeferred.promise,
      events: events(),
      result: resultDeferred.promise,
      kill: () => {
        if (finalized) return;
        if (this.connection && activeTurn.sessionId) {
          void this.connection.agent.notify(acp.methods.agent.session.cancel, {
            sessionId: activeTurn.sessionId,
          }).catch(() => {});
        }
        invalidate('cancelled', 'acp_cancelled', 'killed by caller');
      },
    };
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.active?.failTransport('ACP worker stopped', 'acp_cancelled');
    await this.stopProcess();
  }

  private async stopProcess(): Promise<void> {
    const proc = this.process;
    this.process = undefined;
    this.initializeResponse = undefined;
    const connection = this.connection;
    this.connection = undefined;
    connection?.close();
    if (!proc || this.processClosed) return;
    await new Promise<void>((done) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; done(); } };
      proc.once('close', finish);
      const direct = (signal: NodeJS.Signals) => {
        try { proc.kill(signal); } catch { /* best effort */ }
      };
      if (typeof proc.pid === 'number') {
        try { treeKill(proc.pid, 'SIGTERM', (error) => { if (error) direct('SIGTERM'); }); }
        catch { direct('SIGTERM'); }
      } else direct('SIGTERM');
      const forceAfter = Math.max(1, this.options.forceKillGraceMs ?? 1_000);
      const force = setTimeout(() => {
        if (typeof proc.pid === 'number') {
          try { treeKill(proc.pid, 'SIGKILL', () => finish()); } catch { direct('SIGKILL'); finish(); }
        } else { direct('SIGKILL'); finish(); }
      }, forceAfter);
      force.unref?.();
    });
    this.processClosed = true;
  }
}
