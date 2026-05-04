import type { Server as IOServer, Socket } from 'socket.io';
import { join } from 'path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { TmuxGateway } from './tmux-gateway';
import { AgentPaneRegistry } from './agent-pane-registry';
import { readAccount } from './accounts-file';
import { readCredential } from './credentials';
import { buildProbeEnv } from './cli-probe';
import { generateRuntimeConfig, cleanupRuntimeConfig, makeInvocationId } from './opencode-config';
import type { AccountProvider as RuntimeAccountProvider } from './opencode-config';
import type { CliEngine, DetectedRuntime } from './types';
import { sessionRepo } from './repositories/session-repo';
import type { AgentSessionRow } from './repositories/session-repo';
import { invocationRepo } from './repositories/invocation-repo';
import type { InvocationRow } from './repositories/invocation-repo';
import { messageRepo } from './repositories/message-repo';
import { eventRepo } from './repositories/event-repo';
import { generateSortableId } from './repositories/sortable-id';
import { createBackend } from './agent/factory';
import type { AgentEvent } from './agent/types';

type TerminalStartPayload = {
  projectId?: string;
  taskId?: string;
  agentId: string;
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  conversationId?: string;
  opencodeBridgeUrl?: string;
  engine?: CliEngine;
  runtimeId?: string;
  providerProfileId?: string;
  channel?: string;
  authContextId?: string;
  accountIds?: string[];
  accountId?: string;
  force?: boolean;
};

const ENGINE_COMMAND: Record<CliEngine, string> = {
  opencode: 'opencode',
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  mock: process.execPath,
};

const RUNTIME_ENGINE_MAP: Record<string, CliEngine> = {
  daemon: 'opencode',
  'opencode-local': 'opencode',
  'opencode-bridge': 'opencode',
  'claude-cli': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'gemini',
  'mock-runtime': 'mock',
};

/** Default CLI idle timeout (ms). Configurable via CLI_TIMEOUT_MS env. 0 = disabled. */
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min

type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

async function resolveCredentialEnv(accountId?: string): Promise<Record<string, string>> {
  if (!accountId) return {};
  const account = await readAccount(accountId);
  if (!account || account.authMode !== 'api_key') return {};
  const cred = await readCredential(accountId);
  if (!cred?.apiKey) return {};
  return buildProbeEnv(account.provider as AccountProvider, cred.apiKey, account.baseUrl);
}

const execAsync = promisify(exec);

async function detectAvailableRuntimes(): Promise<DetectedRuntime[]> {
  const results: DetectedRuntime[] = [];
  const engines: CliEngine[] = ['claude', 'codex', 'opencode'];
  for (const engine of engines) {
    const command = ENGINE_COMMAND[engine];
    try {
      await execAsync(`which ${command}`, { timeout: 3_000 });
      let version: string | undefined;
      try {
        const { stdout } = await execAsync(`${command} --version`, { timeout: 5_000 });
        version = stdout.trim().slice(0, 60) || undefined;
      } catch { /* ignore */ }
      results.push({ engine, available: true, version });
    } catch {
      results.push({ engine, available: false });
    }
  }
  return results;
}

export default function registerDaemon(io: IOServer) {
  const activeProcesses = new Map<string, { kill: () => void }>();
  const processKey = (agentId: string, projectId?: string) => `${agentId}@${projectId || 'default'}`;
  const broadcast = (event: string, data: any) => io.emit(event, data);

  const tmuxEnabled = process.env.ATH_TMUX_ENABLED === '1';
  let tmuxGateway: TmuxGateway | undefined;
  let agentPaneRegistry: AgentPaneRegistry | undefined;

  if (tmuxEnabled) {
    try {
      tmuxGateway = new TmuxGateway();
      agentPaneRegistry = new AgentPaneRegistry();
      console.log('[daemon] tmux integration enabled');
    } catch (err) {
      console.error('[daemon] tmux not available, falling back to direct spawn:', (err as Error).message);
      tmuxGateway = undefined;
    }
  }

  // Agent pane listing endpoint
  io.on('connection', (socket: Socket) => {
    socket.on('agent-panes:list', (callback) => {
      if (!agentPaneRegistry) {
        callback?.({ panes: [] });
        return;
      }
      callback?.({ panes: agentPaneRegistry.listAll() });
    });

    socket.on('runtimes:list', async (callback) => {
      const runtimes = await detectAvailableRuntimes();
      callback?.({ runtimes });
    });

    // Push runtimes on connect
    (async () => {
      const runtimes = await detectAvailableRuntimes();
      broadcast('runtimes:update', { runtimes });
    })();
  });

  io.on('connection', (socket: Socket) => {
    socket.on(
      'terminal:start',
      async ({
        projectId,
        taskId,
        agentId,
        prompt,
        systemPrompt,
        sessionId,
        conversationId,
        opencodeBridgeUrl,
        engine: rawEngine,
        runtimeId,
        providerProfileId,
        channel,
        authContextId,
        accountIds,
        accountId,
        force,
      }: TerminalStartPayload) => {
      console.log(`[daemon] terminal:start agent=${agentId}, engine=${rawEngine}, accountId=${accountId ?? '(none)'}, force=${force}, busy=${activeProcesses.has(processKey(agentId, projectId))}`);
      console.log(`[daemon] systemPrompt=${systemPrompt ? `${systemPrompt.length} chars` : '(none)'}, prompt=${prompt ? `${prompt.length} chars` : '(none)'}`);
      let primaryCommand = 'unknown';
      let runtimeConfigDir: string | undefined;
      try {
      // Only kill existing process on explicit force send
      if (force && activeProcesses.has(processKey(agentId, projectId))) {
        activeProcesses.get(processKey(agentId, projectId))?.kill();
      }
      // If agent is busy and not forcing, reject silently — client should have queued
      if (!force && activeProcesses.has(processKey(agentId, projectId))) {
        socket.emit('agent:error', { agentId, message: 'Agent is busy, message queued' });
        return;
      }

      const engineFromRuntime =
        runtimeId && runtimeId in RUNTIME_ENGINE_MAP ? RUNTIME_ENGINE_MAP[runtimeId] : undefined;
      const engine: CliEngine =
        engineFromRuntime || (rawEngine && rawEngine in ENGINE_COMMAND ? rawEngine : 'opencode');
      primaryCommand = ENGINE_COMMAND[engine];

      const credentialEnv = await resolveCredentialEnv(accountId);

      // --- Session & Invocation tracking (SQLite) ---
      // Use conversationId for session scoping (project-level session per agent)
      const sessionConvId = conversationId || projectId || 'default';
      let agentSession: AgentSessionRow | undefined;
      let invocation: InvocationRow | undefined;

      if (accountId) {
        agentSession = sessionRepo.findActiveByConversation(agentId, sessionConvId);

        if (!agentSession) {
          // Seal any stale sessions for this agent+conversation to avoid UNIQUE constraint collision
          try { sessionRepo.sealByConversation(agentId, sessionConvId, 'replaced'); } catch { /* ignore */ }

          // Compute next seq to avoid UNIQUE(agent_id, task_id, seq) conflict
          const nextSeq = sessionRepo.nextSeqForAgent(agentId, taskId || '');

          const newSessionId = generateSortableId('ses');
          agentSession = sessionRepo.create({
            id: newSessionId,
            conversationId: sessionConvId,
            agentId,
            taskId: taskId || undefined,
            seq: nextSeq,
          });
        }

        const invocationId = generateSortableId('inv');
        invocation = invocationRepo.create({
          id: invocationId,
          conversation_id: sessionConvId,
          task_id: taskId || '',
          agent_id: agentId,
          session_id: agentSession.id,
          engine,
          account_id: accountId,
          prompt: prompt || '',
        });
      }

      // Use DB-tracked cli_session_id if available, otherwise fall back to payload sessionId
      const effectiveSessionId = agentSession?.cli_session_id ?? sessionId;

      // Build CLI args for non-Backend paths (tmux, bridge)
      const primaryArgs = (() => {
        switch (engine) {
          case 'opencode': {
            const a = ['run', '--format', 'json'];
            if (effectiveSessionId) a.push('--session', effectiveSessionId);
            if (systemPrompt) a.push('--agent', 'ath-agent');
            a.push(prompt || '');
            return a;
          }
          case 'claude': {
            const a = ['-p', prompt || '', '--output-format', 'stream-json'];
            if (systemPrompt) a.push('--append-system-prompt', systemPrompt);
            if (effectiveSessionId) a.push('--resume', effectiveSessionId);
            return a;
          }
          case 'codex': {
            const merged = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt || ''}` : (prompt || '');
            return ['-q', merged, '--full-auto'];
          }
          case 'gemini': {
            const merged = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt || ''}` : (prompt || '');
            return ['-p', merged];
          }
          case 'mock': return [join(process.cwd(), 'backend', 'mock-opencode.js')];
          default: return [];
        }
      })();

      runtimeConfigDir = undefined;
      let runtimeConfigEnv: Record<string, string> = {};

      if (engine === 'opencode' && accountId) {
        const account = await readAccount(accountId);
        const cred = await readCredential(accountId);
        if (account && cred?.apiKey) {
          const invocationId = makeInvocationId(agentId);
          const result = generateRuntimeConfig(invocationId, {
            provider: account.provider as RuntimeAccountProvider,
            apiKey: cred.apiKey,
            baseUrl: account.baseUrl,
            models: account.models,
            defaultModel: account.models[0],
          });
          if (result.generated) {
            runtimeConfigDir = result.configDir;
            runtimeConfigEnv = result.env;
          }
        }
      }

      const mergedEnv: Record<string, string> = { ...process.env, ...credentialEnv, ...runtimeConfigEnv } as Record<string, string>;

      // Inject system prompt via opencode's custom agent config (for tmux path; backend path handles it internally)
      if (systemPrompt && engine === 'opencode') {
        mergedEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({
          agent: {
            'ath-agent': {
              description: 'Agent Task Hub runtime agent',
              prompt: systemPrompt,
              mode: 'primary',
            },
          },
          default_agent: 'ath-agent',
        });
      }

      let sessionEmitted = false;

      // --- Timeout control ---
      const timeoutMs = Number(process.env.CLI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const resetTimeout = () => {
        if (timeoutMs === 0) return;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          const active = activeProcesses.get(processKey(agentId, projectId));
          if (active) {
            active.kill();
            broadcast('agent:error', {
              agentId,
              message: `CLI 响应超时 (${Math.round(timeoutMs / 1000)}s)，已自动终止。`,
              reasonCode: 'timeout' as const,
            });
          }
        }, timeoutMs);
        if (timeoutTimer) timeoutTimer.unref();
      };

      const clearProcessTimeout = () => {
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      };

      // --- Heartbeat: keep client watchdog alive while process is running ---
      const HEARTBEAT_INTERVAL_MS = 30_000;
      const heartbeatTimer = setInterval(() => {
        if (activeProcesses.has(processKey(agentId, projectId))) {
          broadcast('agent:event', {
            agentId,
            sessionId: agentSession?.cli_session_id,
            event: { type: 'heartbeat' },
          });
        } else {
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();

      // Start initial timeout
      if (timeoutMs > 0) resetTimeout();

      // --- Bridge NDJSON line parser (OpenCode format) ---
      const parseAndForwardBridgeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed: unknown;
        try { parsed = JSON.parse(trimmed); } catch { return; }
        if (!parsed || typeof parsed !== 'object') return;
        const obj = parsed as Record<string, unknown>;
        const part = (obj.part && typeof obj.part === 'object') ? (obj.part as Record<string, unknown>) : undefined;
        const type = typeof obj.type === 'string' ? obj.type : undefined;

        const sessionId =
          (typeof obj.sessionID === 'string' ? obj.sessionID : undefined) ||
          (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) ||
          (typeof obj.session_id === 'string' ? obj.session_id : undefined) ||
          (typeof part?.sessionID === 'string' ? part.sessionID : undefined) ||
          (typeof part?.sessionId === 'string' ? part.sessionId : undefined);

        if (type === 'text') {
          const text = (typeof part?.text === 'string' ? part.text : undefined) || (typeof obj.content === 'string' ? obj.content : undefined);
          if (text) forwardAgentEvent({ type: 'text', content: text, sessionId });
        } else if (type === 'tool_use') {
          const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
          if (toolName) forwardAgentEvent({ type: 'tool_use', content: '', tool: { name: toolName, input: typeof part?.input === 'object' ? JSON.stringify(part.input).slice(0, 200) : undefined }, sessionId });
        } else if (type === 'error') {
          const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
          const errorName = typeof errorObj?.name === 'string' ? errorObj.name : '未知错误';
          forwardAgentEvent({ type: 'error', content: errorName, sessionId });
        }

        // Persist raw event
        eventRepo.append({
          conversationId: sessionConvId,
          taskId,
          agentId,
          type: type || 'unknown',
          payload: obj,
        });
      };

      // --- Shared agent event forwarder ---
      const forwardAgentEvent = (event: AgentEvent) => {
        try {
        // Register session ID
        if (event.sessionId && !sessionEmitted) {
          sessionEmitted = true;
          broadcast('agent:session', { projectId: projectId || 'default', agentId, sessionId: event.sessionId });
          if (agentSession && !agentSession.cli_session_id) {
            sessionRepo.updateCliSessionId(agentSession.id, event.sessionId);
          }
          if (invocation) {
            invocationRepo.updateStatus(invocation.id, 'running', { cli_session_id: event.sessionId });
          }
        }

        // Forward to client
        broadcast('agent:event', {
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
          try {
          messageRepo.append({
            conversationId: sessionConvId,
            taskId,
            senderType: 'agent',
            senderId: agentId,
            content: event.content,
            contentType: 'text',
          });
          if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
          } catch (dbErr) {
            console.error(`[daemon] Failed to persist text message for ${agentId}:`, dbErr);
          }
        } else if (event.type === 'tool_use' && event.tool) {
          try {
          messageRepo.append({
            conversationId: sessionConvId,
            taskId,
            senderType: 'agent',
            senderId: agentId,
            content: `🔧 使用工具：${event.tool.name}`,
            contentType: 'tool_use',
            metadata: { toolEvent: { type: 'tool_use', name: event.tool.name, input: event.tool.input?.slice(0, 500) } },
          });
          if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
          } catch (dbErr) {
            console.error(`[daemon] Failed to persist tool_use message for ${agentId}:`, dbErr);
          }
        }
        } catch (err) {
          console.error(`[daemon] forwardAgentEvent error for ${agentId}:`, err);
        }

        // Reset timeout on each event
        resetTimeout();
      };

      // --- Bridge mode (remote opencode via HTTP proxy) ---
      if (opencodeBridgeUrl) {
        const url = String(opencodeBridgeUrl).trim().replace(/\/+$/, '');
        const controller = new AbortController();
        activeProcesses.set(processKey(agentId, projectId), { kill: () => controller.abort() });

        broadcast('terminal:data', {
          agentId,
          data: `\x1b[33m$ opencode-bridge ${url}\x1b[0m\r\n`,
        });

        try {
          const r = await fetch(`${url}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: prompt || '',
              systemPrompt: systemPrompt || undefined,
              sessionId,
              engine,
              runtimeId,
              providerProfileId,
              channel,
              authContextId,
            }),
            signal: controller.signal,
          });

          if (!r.ok || !r.body) {
            broadcast('agent:error', {
              agentId,
              message: `Bridge 连接失败 (HTTP ${r.status})`,
              reasonCode: 'spawn_failed' as const,
            });
            if (agentSession) {
              sessionRepo.seal(agentSession.id, 'failed');
            }
            broadcast('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
            activeProcesses.delete(processKey(agentId, projectId));
            if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
            return;
          }

          const decoder = new TextDecoder();
          const reader = r.body.getReader();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const str = decoder.decode(value, { stream: true });
            broadcast('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
            resetTimeout();
            buffer += str;
            let idx = buffer.indexOf('\n');
            while (idx !== -1) {
              const line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              parseAndForwardBridgeLine(line);
              idx = buffer.indexOf('\n');
            }
          }
          if (buffer.trim()) parseAndForwardBridgeLine(buffer);

          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          // Don't seal on successful completion — session stays active for --resume reuse
          broadcast('terminal:exit', { agentId, code: 0, command: 'bridge' });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          return;
        } catch (e) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          const msg = String((e as Error)?.message || e);
          broadcast('agent:error', {
            agentId,
            message: `Bridge 错误：${msg}`,
            reasonCode: 'spawn_failed' as const,
          });
          if (agentSession) {
            sessionRepo.seal(agentSession.id, 'failed');
          }
          broadcast('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          return;
        }
      }

      // --- Local spawn mode ---
      if (tmuxGateway && agentPaneRegistry) {
        // tmux pane mode: agent runs inside a tmux pane with remain-on-exit
        try {
          const worktreeId = projectId || 'default';
          await tmuxGateway.ensureServer(worktreeId);
          const paneId = await tmuxGateway.createAgentPane(worktreeId);
          const invocationId = `${agentId}-${Date.now()}`;
          agentPaneRegistry.register(invocationId, worktreeId, paneId, 'daemon');

          const envExports = Object.entries(mergedEnv).filter(([k]) => k !== 'PATH' && k !== 'HOME' && k !== 'USER').map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`).join(' ');
          const shellCmd = `${envExports ? envExports + ' ' : ''}${[primaryCommand, ...primaryArgs].map((s) => `'${s.replace(/'/g, "'\\''")}'`).join(' ')}`;
          await tmuxGateway.execInPane(worktreeId, paneId, shellCmd);
          await tmuxGateway.setPaneReadOnly(worktreeId, paneId, true);

          broadcast('terminal:data', {
            agentId,
            data: `\x1b[33m$ [tmux:${paneId}] ${primaryCommand} ${primaryArgs.join(' ')}\x1b[0m\r\n`,
          });

          // Poll pane output for terminal:data events
          const pollInterval = setInterval(async () => {
            if (!activeProcesses.has(processKey(agentId, projectId))) {
              clearInterval(pollInterval);
              return;
            }
            try {
              const content = await tmuxGateway.capturePane(worktreeId, paneId);
              broadcast('terminal:data', { agentId, data: content.replace(/\n/g, '\r\n') });
            } catch { /* pane gone */ }
          }, 2000);

          activeProcesses.set(processKey(agentId, projectId), {
            kill: async () => {
              clearInterval(pollInterval);
              try {
                await tmuxGateway.execInPane(worktreeId, paneId, 'C-c');
                await new Promise((r) => setTimeout(r, 3000));
              } catch { /* pane dead */ }
              try {
                await tmuxGateway.killPane(worktreeId, paneId);
              } catch { /* already dead */ }
              agentPaneRegistry.remove(invocationId);
            },
          });
          return;
        } catch (err) {
          console.error('[daemon] tmux pane creation failed, falling back to direct spawn:', (err as Error).message);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        }
      }

      // --- Execute via Backend abstraction ---
      const command = ENGINE_COMMAND[engine] || 'opencode';
      const backend = createBackend(engine, { executablePath: command });

      const { events, result, kill } = backend.execute(prompt || '', {
        cwd: process.cwd(),
        systemPrompt: systemPrompt || undefined,
        resumeSessionId: effectiveSessionId || undefined,
        timeout: timeoutMs > 0 ? timeoutMs : undefined,
        env: {
          ...credentialEnv,
          ...(runtimeConfigEnv || {}),
        },
      });

      activeProcesses.set(processKey(agentId, projectId), { kill });

      // Consume events and forward to socket
      (async () => {
        try {
          for await (const event of events) {
            forwardAgentEvent(event);
          }

          // Wait for final result
          const final = await result;
          clearProcessTimeout();
          clearInterval(heartbeatTimer);

          // Persist token usage if available
          if (final.usage && Object.keys(final.usage).length > 0 && invocation) {
            invocationRepo.updateDispatchStatus(invocation.id, 'completed', {
              tokenUsage: JSON.stringify(final.usage),
            });
          }

          if (invocation) {
            invocationRepo.updateStatus(invocation.id, final.status === 'completed' ? 'succeeded' : 'failed', {
              exit_code: final.status === 'completed' ? 0 : 1,
              reason_code: final.status === 'timeout' ? 'timeout' : undefined,
            });
          }

          if (agentSession && final.status !== 'completed') {
            sessionRepo.seal(agentSession.id, 'failed');
          }

          broadcast('terminal:exit', {
            agentId,
            code: final.status === 'completed' ? 0 : 1,
            command,
            reasonCode: final.status === 'timeout' ? 'timeout' : undefined,
          });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        } catch (err) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          console.error(`[daemon][${agentId}] backend error:`, err);
          if (agentSession) {
            sessionRepo.seal(agentSession.id, 'failed');
          }
          broadcast('terminal:exit', { agentId, code: 1, command, reasonCode: 'spawn_failed' });
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        }
      })();
      } catch (err) {
        console.error(`[daemon] terminal:start error for agent=${agentId}:`, err);
        broadcast('agent:error', { agentId, message: `内部错误：${(err as Error)?.message || '未知'}` });
        broadcast('terminal:exit', { agentId, code: 1, command: primaryCommand, reasonCode: 'internal_error' });
        activeProcesses.delete(processKey(agentId, projectId));
        if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
      }
    });

    // Force-kill a running agent process
    socket.on('terminal:kill', ({ agentId, projectId: killProjectId, force }: { agentId: string; projectId?: string; force?: boolean }) => {
      const key = processKey(agentId, killProjectId);
      if (activeProcesses.has(key)) {
        activeProcesses.get(key)?.kill();
        activeProcesses.delete(key);
        socket.emit('terminal:exit', { agentId, code: 0, command: 'kill', reasonCode: force ? 'force_killed' : 'killed' });
      }
    });

    socket.on('daemon:status', (callback) => {
      const activeAgents: Record<string, { taskId?: string; conversationId?: string }> = {};
      for (const [key] of activeProcesses) {
        const agentId = key.split('@')[0];
        const session = sessionRepo.findLatestActiveByAgent(agentId);
        if (session) {
          activeAgents[agentId] = {
            taskId: session.task_id || undefined,
            conversationId: session.conversation_id || undefined,
          };
        } else {
          activeAgents[agentId] = {};
        }
      }
      callback?.({ activeAgents });
    });
  });
}
