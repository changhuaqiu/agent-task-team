import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { Server as IOServer, Socket } from 'socket.io';
import { join } from 'path';
import { TmuxGateway } from './tmux-gateway';
import { AgentPaneRegistry } from './agent-pane-registry';
import { readAccount } from './accounts-file';
import { readCredential } from './credentials';
import { buildProbeEnv } from './cli-probe';
import { generateRuntimeConfig, cleanupRuntimeConfig, makeInvocationId } from './opencode-config';
import type { AccountProvider as RuntimeAccountProvider } from './opencode-config';
import { sessionRepo } from './repositories/session-repo';
import type { AgentSessionRow } from './repositories/session-repo';
import { invocationRepo } from './repositories/invocation-repo';
import type { InvocationRow } from './repositories/invocation-repo';
import { messageRepo } from './repositories/message-repo';
import { eventRepo } from './repositories/event-repo';
import { generateSortableId } from './repositories/sortable-id';

type CliEngine = 'opencode' | 'claude' | 'codex' | 'gemini' | 'mock';

type TerminalStartPayload = {
  projectId?: string;
  taskId?: string;
  agentId: string;
  prompt: string;
  sessionId?: string;
  allowMockRunner?: boolean;
  opencodeBridgeUrl?: string;
  engine?: CliEngine;
  runtimeId?: string;
  providerProfileId?: string;
  channel?: string;
  authContextId?: string;
  accountIds?: string[];
  accountId?: string;
};

type EngineDef = {
  command: string;
  buildArgs: (prompt: string, sessionId?: string) => string[];
};

const ENGINE_MAP: Record<CliEngine, EngineDef> = {
  opencode: {
    command: 'opencode',
    buildArgs: (p, s) => ['run', p, '--format', 'json', ...(s ? ['--session', s] : [])],
  },
  claude: {
    command: 'claude',
    buildArgs: (p, s) => ['-p', p, '--output-format', 'stream-json', ...(s ? ['--resume', s] : [])],
  },
  codex: {
    command: 'codex',
    buildArgs: (p) => ['-q', p, '--full-auto'],
  },
  gemini: {
    command: 'gemini',
    buildArgs: (p) => ['-p', p],
  },
  mock: {
    command: process.execPath,
    buildArgs: () => [join(process.cwd(), 'backend', 'mock-opencode.js')],
  },
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

/** Grace period between SIGTERM and SIGKILL */
const KILL_GRACE_MS = 3_000;

/** Default CLI idle timeout (ms). Configurable via CLI_TIMEOUT_MS env. 0 = disabled. */
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min

function gracefulKill(child: ReturnType<typeof spawn>): void {
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }, KILL_GRACE_MS);
  timer.unref();
  child.on('exit', () => clearTimeout(timer));
}

type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

async function resolveCredentialEnv(accountId?: string): Promise<Record<string, string>> {
  if (!accountId) return {};
  const account = await readAccount(accountId);
  if (!account || account.authMode !== 'api_key') return {};
  const cred = await readCredential(accountId);
  if (!cred?.apiKey) return {};
  return buildProbeEnv(account.provider as AccountProvider, cred.apiKey, account.baseUrl);
}

export default function registerDaemon(io: IOServer) {
  const activeProcesses = new Map<string, { kill: () => void }>();

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
  });

  io.on('connection', (socket: Socket) => {
    socket.on(
      'terminal:start',
      async ({
        projectId,
        taskId,
        agentId,
        prompt,
        sessionId,
        allowMockRunner,
        opencodeBridgeUrl,
        engine: rawEngine,
        runtimeId,
        providerProfileId,
        channel,
        authContextId,
        accountIds,
        accountId,
      }: TerminalStartPayload) => {
      if (activeProcesses.has(agentId)) {
        activeProcesses.get(agentId)?.kill();
      }

      const engineFromRuntime =
        runtimeId && runtimeId in RUNTIME_ENGINE_MAP ? RUNTIME_ENGINE_MAP[runtimeId] : undefined;
      const engine: CliEngine =
        engineFromRuntime || (rawEngine && rawEngine in ENGINE_MAP ? rawEngine : 'opencode');
      const engineDef = ENGINE_MAP[engine];
      const primaryCommand = engineDef.command;

      const credentialEnv = await resolveCredentialEnv(accountId);

      // --- Session & Invocation tracking (SQLite) ---
      let agentSession: AgentSessionRow | undefined;
      let invocation: InvocationRow | undefined;

      if (taskId && accountId) {
        agentSession = sessionRepo.findActive(agentId, taskId);

        if (!agentSession) {
          const newSessionId = generateSortableId('ses');
          agentSession = sessionRepo.create({
            id: newSessionId,
            conversationId: projectId || 'default',
            agentId,
            taskId,
            seq: 0,
          });
        }

        const invocationId = generateSortableId('inv');
        invocation = invocationRepo.create({
          id: invocationId,
          conversation_id: projectId || 'default',
          task_id: taskId,
          agent_id: agentId,
          session_id: agentSession.id,
          engine,
          account_id: accountId,
          prompt: prompt || '',
        });
      }

      // Use DB-tracked cli_session_id if available, otherwise fall back to payload sessionId
      const effectiveSessionId = agentSession?.cli_session_id ?? sessionId;
      const primaryArgs = engineDef.buildArgs(prompt || '', effectiveSessionId);

      let runtimeConfigDir: string | undefined;
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

      const mergedEnv = { ...process.env, ...credentialEnv, ...runtimeConfigEnv };

      let sessionEmitted = false;

      // --- Timeout control ---
      const timeoutMs = Number(process.env.CLI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;

      const resetTimeout = () => {
        if (timeoutMs === 0) return;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          const active = activeProcesses.get(agentId);
          if (active) {
            active.kill();
            socket.emit('agent:error', {
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

      // Start initial timeout
      if (timeoutMs > 0) resetTimeout();

      const handleJsonLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (!parsed || typeof parsed !== 'object') return;
        const obj = parsed as Record<string, unknown>;
        const part = (obj.part && typeof obj.part === 'object') ? (obj.part as Record<string, unknown>) : undefined;
        const parsedSessionId =
          (typeof obj.sessionID === 'string' ? obj.sessionID : undefined) ||
          (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) ||
          (typeof part?.sessionID === 'string' ? part.sessionID : undefined) ||
          (typeof part?.sessionId === 'string' ? part.sessionId : undefined);

        if (!sessionEmitted && parsedSessionId) {
          sessionEmitted = true;
          socket.emit('agent:session', { projectId: projectId || 'default', agentId, sessionId: parsedSessionId });

          if (agentSession && !agentSession.cli_session_id) {
            sessionRepo.updateCliSessionId(agentSession.id, parsedSessionId);
          }

          if (invocation) {
            invocationRepo.updateStatus(invocation.id, 'running', { cli_session_id: parsedSessionId });
          }
        }

        const type = typeof obj.type === 'string' ? obj.type : undefined;

        // Reset timeout on valid NDJSON event
        resetTimeout();

        if (type === 'text') {
          const text =
            (typeof part?.text === 'string' ? part.text : undefined) ||
            (typeof obj.content === 'string' ? obj.content : undefined);
          if (text) {
            socket.emit('agent:event', { taskId, agentId, type: 'message', message: text });
            if (projectId) {
              messageRepo.append({
                conversationId: projectId,
                taskId,
                senderType: 'agent',
                senderId: agentId,
                content: text,
                contentType: 'text',
              });
              if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
            }
          }
        } else if (type === 'tool_use') {
          const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
          const toolContent = `🔧 使用工具：${toolName}`;
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: toolContent });
          if (projectId) {
            messageRepo.append({
              conversationId: projectId,
              taskId,
              senderType: 'agent',
              senderId: agentId,
              content: toolContent,
              contentType: 'tool_use',
            });
            if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
          }
        } else if (type === 'step_start') {
          socket.emit('agent:event', { taskId, agentId, type: 'step_start', message: `🚀 开始执行任务。` });
        } else if (type === 'step_finish') {
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: `✅ 任务执行完成。` });
        } else if (type === 'error') {
          const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
          const errorName = typeof errorObj?.name === 'string' ? errorObj.name : undefined;
          const errorContent = `❌ 错误：${errorName || '未知错误'}`;
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: errorContent });
          if (projectId) {
            messageRepo.append({
              conversationId: projectId,
              taskId,
              senderType: 'agent',
              senderId: agentId,
              content: errorContent,
              contentType: 'error',
            });
            if (agentSession) sessionRepo.incrementMessageCount(agentSession.id);
          }
        }

        if (projectId) {
          eventRepo.append({
            conversationId: projectId,
            taskId,
            agentId,
            type: type || 'unknown',
            payload: obj as Record<string, unknown>,
          });
        }
      };

      const wireChild = (child: ReturnType<typeof spawn>) => {
        if (child.stdout) {
          child.stdout.on('data', (data) => {
            const str = data.toString();
            socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
            resetTimeout();
          });

          const rl = createInterface({ input: child.stdout });
          rl.on('line', (line) => handleJsonLine(line));

          child.on('close', () => rl.close());
        }

        // stderr: server-side log only, NOT forwarded to frontend
        if (child.stderr) {
          child.stderr.on('data', (data) => {
            console.error(`[cli:stderr][${agentId}]`, data.toString().trimEnd());
            resetTimeout();
          });
        }

        child.on('close', (code) => {
          clearProcessTimeout();

          let reasonCode: string | undefined;
          if (timedOut) {
            reasonCode = 'timeout';
          }

          if (invocation) {
            const status = code === 0 ? 'succeeded' : 'failed';
            invocationRepo.updateStatus(invocation.id, status, {
              exit_code: code ?? 1,
              reason_code: reasonCode,
            });
          }

          socket.emit('terminal:exit', {
            agentId,
            code,
            command: primaryCommand,
            reasonCode,
          });
          activeProcesses.delete(agentId);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        });
      };

      // --- Bridge mode (remote opencode via HTTP proxy) ---
      if (opencodeBridgeUrl) {
        const url = String(opencodeBridgeUrl).trim().replace(/\/+$/, '');
        const controller = new AbortController();
        activeProcesses.set(agentId, { kill: () => controller.abort() });

        socket.emit('terminal:data', {
          agentId,
          data: `\x1b[33m$ opencode-bridge ${url}\x1b[0m\r\n`,
        });

        try {
          const r = await fetch(`${url}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: prompt || '',
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
            socket.emit('agent:error', {
              agentId,
              message: `Bridge 连接失败 (HTTP ${r.status})`,
              reasonCode: 'spawn_failed' as const,
            });
            socket.emit('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
            activeProcesses.delete(agentId);
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
            socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
            resetTimeout();
            buffer += str;
            let idx = buffer.indexOf('\n');
            while (idx !== -1) {
              const line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              handleJsonLine(line);
              idx = buffer.indexOf('\n');
            }
          }
          if (buffer.trim()) handleJsonLine(buffer);

          clearProcessTimeout();
          socket.emit('terminal:exit', { agentId, code: 0, command: 'bridge' });
          activeProcesses.delete(agentId);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          return;
        } catch (e) {
          clearProcessTimeout();
          const msg = String((e as Error)?.message || e);
          socket.emit('agent:error', {
            agentId,
            message: `Bridge 错误：${msg}`,
            reasonCode: 'spawn_failed' as const,
          });
          socket.emit('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
          activeProcesses.delete(agentId);
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

          socket.emit('terminal:data', {
            agentId,
            data: `\x1b[33m$ [tmux:${paneId}] ${primaryCommand} ${primaryArgs.join(' ')}\x1b[0m\r\n`,
          });

          // Poll pane output for terminal:data events
          const pollInterval = setInterval(async () => {
            if (!activeProcesses.has(agentId)) {
              clearInterval(pollInterval);
              return;
            }
            try {
              const content = await tmuxGateway.capturePane(worktreeId, paneId);
              socket.emit('terminal:data', { agentId, data: content.replace(/\n/g, '\r\n') });
            } catch { /* pane gone */ }
          }, 2000);

          activeProcesses.set(agentId, {
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

      socket.emit('terminal:data', {
        agentId,
        data: `\x1b[33m$ ${primaryCommand} ${primaryArgs.join(' ')}\x1b[0m\r\n`,
      });

      const child = spawn(primaryCommand, primaryArgs, {
        env: mergedEnv,
      });
      activeProcesses.set(agentId, { kill: () => gracefulKill(child) });

      child.on('error', (err) => {
        const code = (err as unknown as { code?: string }).code;
        if (code === 'ENOENT') {
          if (!allowMockRunner && process.env.ENABLE_MOCK_RUNNER !== '1') {
            if (invocation) {
              invocationRepo.updateStatus(invocation.id, 'failed', {
                exit_code: 127,
                reason_code: 'not_found',
              });
            }
            socket.emit('agent:error', {
              agentId,
              message: 'CLI 工具未找到，请检查安装。',
              reasonCode: 'not_found' as const,
            });
            socket.emit('terminal:exit', { agentId, code: 127, command: primaryCommand, reasonCode: 'not_found' });
            activeProcesses.delete(agentId);
            if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
            return;
          }

          const mockDef = ENGINE_MAP.mock;
          const fallbackCommand = mockDef.command;
          const fallbackArgs = mockDef.buildArgs(prompt || '');

          socket.emit('terminal:data', {
            agentId,
            data: `\r\n\x1b[33m[未找到 ${primaryCommand}]\x1b[0m 已切换到内置模拟执行器。\r\n`,
          });
          socket.emit('terminal:data', {
            agentId,
            data: `\x1b[33m$ ${fallbackCommand} ${fallbackArgs.join(' ')}\x1b[0m\r\n`,
          });

          const fallback = spawn(fallbackCommand, fallbackArgs, { env: { ...mergedEnv, OPENCODE_PROMPT: prompt } });
          activeProcesses.set(agentId, { kill: () => gracefulKill(fallback) });
          wireChild(fallback);
          return;
        }

        if (invocation) {
          invocationRepo.updateStatus(invocation.id, 'failed', {
            error_message: (err as Error)?.message || 'Unknown error',
            reason_code: code === 'ENOENT' ? 'not_found' : 'spawn_failed',
          });
        }
        socket.emit('agent:error', {
          agentId,
          message: `进程启动失败：${(err as Error)?.message || '未知错误'}`,
          reasonCode: 'spawn_failed' as const,
        });
        socket.emit('terminal:exit', { agentId, code: 127, command: primaryCommand, reasonCode: 'spawn_failed' });
        activeProcesses.delete(agentId);
        if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
      });

      wireChild(child);
    });
  });
}
