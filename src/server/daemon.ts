import type { Server as IOServer, Socket } from 'socket.io';
import { join } from 'path';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { TmuxGateway } from './tmux-gateway';
import { AgentPaneRegistry } from './agent-pane-registry';
import { readAccount } from './accounts-file';
import { readCredential } from './credentials';
import { buildProbeEnv } from './cli-probe';
import { generateRuntimeConfig, cleanupRuntimeConfig, makeInvocationId } from './opencode-config';
import { startTaskWatcher, syncTasksToDb } from './task-file-watcher';
import type { AccountProvider as RuntimeAccountProvider } from './opencode-config';
import type { CliEngine, DetectedRuntime } from './types';
import { sessionRepo } from './repositories/session-repo';
import type { AgentSessionRow } from './repositories/session-repo';
import { invocationRepo } from './repositories/invocation-repo';
import type { InvocationRow } from './repositories/invocation-repo';
import { messageRepo } from './repositories/message-repo';
import { eventRepo } from './repositories/event-repo';
import { generateSortableId } from './repositories/sortable-id';
import { loadCatalog } from './agent/acp/catalog';
import {
  prepareAcpRuntime,
} from './agent/acp/runtimeSetup';
import { createBackend as createAcpBackend } from './agent/acp/catalog';
import { checkCapabilities } from './agent/capabilityRouter';
import type { AgentEvent, AgentBackend } from './agent/types';
import { withDoneGuarantee } from './agent/with-done-guarantee';
import { WorkdirManager } from './workdir-manager';
import { AgentMessenger } from './a2a';
import { createRuntimeSnapshotProvider } from './a2a/runtime-snapshot-provider';
import { getDb } from './db';
import { DispatchGateway } from './control-plane/dispatch-gateway';
import { runtimeNodeRepo } from './repositories/runtime-node-repo';
import type { DispatchIntent, DispatchSource, RuntimeNodeKind } from './repositories/control-plane-types';
import { taskRepo } from './repositories/task-repo';
import { executionEnvelopeRepo } from './repositories/execution-envelope-repo';
import { proofLogRepo } from './repositories/proof-log-repo';
import { resolveTaskNotificationAudience } from './task-flow/task-notification-publisher';
import { resolveAutonomyGuardWakeups } from './task-flow/autonomy-guard';
import { startWorktreeGCScheduler, stopWorktreeGCScheduler } from './worktree-gc';
import {
  HarnessCoordinator,
  RepositoryHarnessPlanner,
  registerHarnessCoordinator,
  submitTaskWakeupToHarness,
  type HarnessDispatchPlan,
  type HarnessOutcome,
} from './harness';

type TerminalStartPayload = {
  projectId?: string;
  taskId?: string;
  agentId: string;
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  conversationId?: string;
  sourceNodeId?: string;
  dispatchSource?: DispatchSource;
  dispatchIntent?: DispatchIntent;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  opencodeBridgeUrl?: string;
  engine?: CliEngine;
  runtimeId?: string;
  providerProfileId?: string;
  channel?: string;
  authContextId?: string;
  accountIds?: string[];
  accountId?: string;
  force?: boolean;
  projectSlug?: string;
  projectPath?: string;
  useWorktree?: boolean;
};

type AgentActivityStatus = 'running' | 'awaiting_children' | 'idle';

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
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()>]|\r/g;
const LOCAL_DAEMON_NODE_ID = 'daemon:local';
const RUNTIME_HEARTBEAT_INTERVAL_MS = 5_000;
const OPENCODE_PROJECT_SKILLS_DIR = join('.opencode', 'skills');

function resolveAcpPermissionPolicy(): 'deny' | 'allow_once' {
  return process.env.ACP_PERMISSION_MODE === 'allow_once' ? 'allow_once' : 'deny';
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

function resolveOpenCodeProjectSkillPaths(projectPath?: string): string[] {
  const candidates = [projectPath, /*turbopackIgnore: true*/ process.cwd()]
    .filter((candidate): candidate is string => !!candidate?.trim());

  const paths = new Set<string>();
  for (const candidate of candidates) {
    const skillDir = path.resolve(/*turbopackIgnore: true*/ candidate, OPENCODE_PROJECT_SKILLS_DIR);
    if (
      fs.existsSync(/*turbopackIgnore: true*/ skillDir)
      && fs.statSync(/*turbopackIgnore: true*/ skillDir).isDirectory()
    ) {
      paths.add(skillDir);
    }
  }

  return Array.from(paths);
}

export default function registerDaemon(io: IOServer) {
  const activeProcesses = new Map<string, { kill: () => void }>();
  const processKey = (agentId: string, projectId?: string) => `${agentId}@${projectId || 'default'}`;
  const broadcast = (event: string, data: any) => io.emit(event, data);
  const agentResponseBuffer = new Map<string, string>();
  const dispatchGateway = new DispatchGateway();
  let handleTerminalStart: ((payload: TerminalStartPayload, emitToRequester?: (event: string, data: unknown) => void) => Promise<void>) | undefined;

  const harnessCoordinator = new HarnessCoordinator({
    planner: new RepositoryHarnessPlanner(),
    runtime: {
      isBusy(agentId, conversationId) {
        return activeProcesses.has(processKey(agentId, conversationId));
      },
      async execute(plan: HarnessDispatchPlan): Promise<HarnessOutcome> {
        if (!handleTerminalStart) {
          return { status: 'failed', reasonCode: 'internal_error', message: 'daemon runtime port is not ready' };
        }
        await handleTerminalStart({
          projectId: plan.trigger.conversationId,
          conversationId: plan.trigger.conversationId,
          taskId: plan.trigger.taskId,
          agentId: plan.trigger.agentId,
          prompt: plan.prompt,
          systemPrompt: plan.systemPrompt,
          sourceNodeId: LOCAL_DAEMON_NODE_ID,
          dispatchSource: plan.trigger.source,
          dispatchIntent: plan.trigger.source === 'review_gate'
            ? 'review'
            : plan.trigger.source === 'test_gate'
              ? 'verify'
              : plan.trigger.source === 'a2a'
                ? 'delegate'
                : 'implement',
          fromAgentId: plan.trigger.fromAgentId,
          chainId: plan.trigger.chainId,
          passId: plan.trigger.passId,
          engine: plan.engine,
          runtimeId: plan.runtimeId,
          accountId: plan.accountId,
          projectPath: plan.projectPath,
          useWorktree: plan.useWorktree,
        }, (event, data) => io.to(plan.trigger.conversationId).emit(event, data));
        return { status: 'accepted' };
      },
    },
  });
  registerHarnessCoordinator(io, harnessCoordinator);

  dispatchGateway.ensureRuntimeNode({
    id: LOCAL_DAEMON_NODE_ID,
    kind: 'daemon',
    label: 'Local daemon',
    capabilities: ['execute', 'heartbeat', 'socket-transport'],
    trustLevel: 'local',
  });

  const runtimeHealthTimer = setInterval(() => {
    dispatchGateway.heartbeat(LOCAL_DAEMON_NODE_ID);
    const now = Date.now();
    for (const node of runtimeNodeRepo.list()) {
      if (node.id === LOCAL_DAEMON_NODE_ID || node.status === 'suspended') continue;
      const last = node.last_heartbeat_at ? new Date(node.last_heartbeat_at).getTime() : 0;
      if (!last || now - last > RUNTIME_HEARTBEAT_INTERVAL_MS) {
        dispatchGateway.markMissedHeartbeat(node.id);
      }
    }
  }, RUNTIME_HEARTBEAT_INTERVAL_MS);
  runtimeHealthTimer.unref();

  const autonomyWakeupPublishedAt = new Map<string, number>();
  const autonomyGuardTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of autonomyWakeupPublishedAt) {
      if (now - timestamp > 2 * 60 * 1000) autonomyWakeupPublishedAt.delete(key);
    }

    const tasks = taskRepo.list();
    const conversationIds = Array.from(new Set(tasks.map((task) => task.conversation_id)));
    for (const conversationId of conversationIds) {
      const conversationTasks = tasks.filter((task) => task.conversation_id === conversationId);
      const audience = resolveTaskNotificationAudience(conversationId);
      const wakeups = resolveAutonomyGuardWakeups({
        tasks: conversationTasks,
        envelopes: executionEnvelopeRepo.listByConversation(conversationId),
        coordinatorAgentIds: audience.coordinatorAgentIds,
        reviewAgentIds: audience.reviewAgentIds,
        qaAgentIds: audience.qaAgentIds,
      });
      for (const wakeup of wakeups) {
        const key = wakeup.metadata.idempotencyKey;
        if (autonomyWakeupPublishedAt.has(key)) continue;
        autonomyWakeupPublishedAt.set(key, now);
        proofLogRepo.append({
          eventType: 'autonomy_guard.wakeup',
          conversationId: wakeup.conversationId,
          taskId: wakeup.taskId,
          agentId: wakeup.agentId,
          reasonCode: wakeup.reasonCode,
          metadata: {
            dispatchSource: wakeup.dispatchSource,
            idempotencyKey: key,
          },
        });
        const submission = submitTaskWakeupToHarness(io, wakeup);
        io.to(wakeup.conversationId).emit('task.wakeup', {
          ...wakeup,
          id: `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          handledByHarness: submission?.handled ?? false,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }, Number(process.env.AUTONOMY_GUARD_INTERVAL_MS || 60_000));
  autonomyGuardTimer.unref();

  const workspacesRoot = process.env.ATH_WORKSPACES_ROOT || join(/*turbopackIgnore: true*/ process.cwd(), '.ath', 'workspaces');
  const workdirManager = new WorkdirManager(workspacesRoot);
  workdirManager.gc(24 * 3600 * 1000);
  startWorktreeGCScheduler(workdirManager);

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

  // Read agents from DB for A2A mention patterns
  const db = getDb();
  const dbAgents = db.prepare('SELECT id, name FROM agents').all() as { id: string; name: string }[];
  const a2aMessenger = new AgentMessenger(db, io,
    dbAgents.map(a => ({
      id: a.id,
      mentionPatterns: [`@${a.id}`, `@${a.name}`],
    })),
    createRuntimeSnapshotProvider(),
    (input) => {
      const submission = harnessCoordinator.submit({
        id: `a2a:${input.entryId}`,
        source: 'a2a',
        conversationId: input.conversationId,
        taskId: input.referencedTaskId,
        agentId: input.agentId,
        prompt: input.prompt,
        fromAgentId: input.fromAgentId,
        chainId: input.chainId,
        passId: input.passId,
        idempotencyKey: `a2a:${input.chainId}:${input.entryId}:${input.agentId}`,
      });
      return { handled: submission.handled, completion: submission.completion };
    },
  );

  // Expire stale A2A chains on startup
  const expired = a2aMessenger.expireStale();
  if (expired > 0) {
    console.log(`[a2a] expired ${expired} stale chains`);
  }

  // Agent pane listing endpoint
  io.on('connection', (socket: Socket) => {
    let connectedRuntimeNodeId: string | undefined;
    const joinedConversationIds = new Set<string>();

    socket.on('conversation:join', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) return;
      socket.join(conversationId);
      joinedConversationIds.add(conversationId);
      a2aMessenger.orchestrator.resendPendingDeliveries(conversationId);
    });

    socket.on('conversation:leave', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId?.trim();
      if (!conversationId) return;
      socket.leave(conversationId);
      joinedConversationIds.delete(conversationId);
    });

    socket.on('runtime:hello', (payload: {
      nodeId?: string;
      kind?: RuntimeNodeKind;
      label?: string;
      endpoint?: string;
      capabilities?: string[];
    }) => {
      if (!payload?.nodeId) return;
      connectedRuntimeNodeId = payload.nodeId;
      dispatchGateway.ensureRuntimeNode({
        id: payload.nodeId,
        kind: payload.kind ?? 'browser',
        label: payload.label ?? payload.nodeId,
        endpoint: payload.endpoint,
        capabilities: payload.capabilities ?? ['socket-transport'],
        trustLevel: payload.kind === 'browser' ? 'paired' : 'local',
      });
      dispatchGateway.heartbeat(payload.nodeId);
      socket.emit('runtime:registered', { nodeId: payload.nodeId });
    });

    socket.on('runtime:heartbeat', (payload: { nodeId?: string }) => {
      if (!payload?.nodeId) return;
      connectedRuntimeNodeId = payload.nodeId;
      dispatchGateway.heartbeat(payload.nodeId);
    });

    socket.on('disconnect', () => {
      if (connectedRuntimeNodeId) {
        runtimeNodeRepo.setStatus(connectedRuntimeNodeId, 'stale');
      }
      joinedConversationIds.clear();
    });

    socket.on('agent-panes:list', (callback) => {
      if (!agentPaneRegistry) {
        callback?.({ panes: [] });
        return;
      }
      callback?.({ panes: agentPaneRegistry.listAll() });
    });

    socket.on('a2a:user-message', (payload: {
      conversationId?: string;
      messageId?: string;
      targetAgentIds?: string[];
      prompt?: string;
      taskId?: string;
    }) => {
      const conversationId = payload?.conversationId;
      const messageId = payload?.messageId;
      if (!conversationId || !messageId) return;

      if (payload.targetAgentIds?.length) {
        // Direct user-to-agent dispatch remains client-driven; register it as
        // executing so the agent's later @mentions continue in the same chain.
        a2aMessenger.registerExternalUserDispatch(
          conversationId,
          messageId,
          payload.targetAgentIds,
          payload.prompt ?? '',
          payload.taskId,
        );
      } else {
        a2aMessenger.abortConversationChains(conversationId, 'new_user_message_without_a2a_target');
      }
    });

    socket.on('a2a:user-turn-created', (payload: {
      conversationId?: string;
      messageId?: string;
      targetAgentIds?: string[];
      prompt?: string;
      taskId?: string;
    }) => {
      const conversationId = payload?.conversationId;
      const messageId = payload?.messageId;
      if (!conversationId || !messageId) return;

      if (payload.targetAgentIds?.length) {
        a2aMessenger.registerExternalUserDispatch(
          conversationId,
          messageId,
          payload.targetAgentIds,
          payload.prompt ?? '',
          payload.taskId,
        );
      } else {
        a2aMessenger.abortConversationChains(conversationId, 'new_user_turn_without_pass');
      }
    });

    socket.on('a2a:agent-started', (payload: {
      chainId?: string;
      entryId?: string;
      conversationId?: string;
      agentId?: string;
      passId?: string;
    }) => {
      if (!payload.chainId || !payload.entryId || !payload.conversationId || !payload.agentId) return;
      a2aMessenger.orchestrator.markDispatchStarted(
        payload.chainId,
        payload.entryId,
        payload.conversationId,
        payload.agentId,
        payload.passId,
      );
    });

    socket.on('a2a:dispatch-failed', (payload: {
      chainId?: string;
      entryId?: string;
      conversationId?: string;
      agentId?: string;
      reason?: string;
    }) => {
      if (!payload.chainId || !payload.entryId || !payload.conversationId || !payload.agentId) return;
      a2aMessenger.orchestrator.markDispatchFailed(
        payload.chainId,
        payload.entryId,
        payload.conversationId,
        payload.agentId,
        payload.reason ?? 'client dispatch failed',
      );
    });

    socket.on('a2a:dispatch-deferred', (payload: {
      chainId?: string;
      entryId?: string;
      conversationId?: string;
      agentId?: string;
      passId?: string;
      reason?: string;
    }) => {
      if (!payload.chainId || !payload.entryId || !payload.conversationId || !payload.agentId) return;
      a2aMessenger.orchestrator.markDispatchDeferred(
        payload.chainId,
        payload.entryId,
        payload.conversationId,
        payload.agentId,
        payload.reason ?? 'target agent is busy',
        payload.passId,
      );
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

  handleTerminalStart = async ({
        projectId,
        taskId,
        agentId,
        prompt,
        systemPrompt,
        conversationId,
        sourceNodeId,
        dispatchSource,
        dispatchIntent,
        fromAgentId,
        chainId,
        passId,
        opencodeBridgeUrl,
        engine: rawEngine,
        runtimeId,
        providerProfileId,
        channel,
        authContextId,
        accountIds,
        accountId,
        force,
        projectSlug,
        projectPath,
        useWorktree,
      }: TerminalStartPayload, emitToRequester = broadcast) => {
      console.log(`[daemon] terminal:start agent=${agentId}, engine=${rawEngine}, accountId=${accountId ?? '(none)'}, force=${force}, busy=${activeProcesses.has(processKey(agentId, projectId))}`);
      console.log(`[daemon] systemPrompt=${systemPrompt ? `${systemPrompt.length} chars` : '(none)'}, prompt=${prompt ? `${prompt.length} chars` : '(none)'}`);
      let primaryCommand = 'unknown';
      let runtimeConfigDir: string | undefined;
      let controlEnvelopeId: string | undefined;
      // ACP per-runtime cleanup (e.g. codex temp CODEX_HOME). Declared here so
      // the outer catch (terminal:start error) can clean up if setup succeeds
      // but a later step throws before the execute IIFE takes over.
      let acpCleanup: (() => void) | undefined;
      try {
      if (!conversationId && !projectId) {
        throw new Error('session_scope_missing: terminal:start requires conversationId or projectId');
      }
      const sessionConvId = conversationId || projectId!;
      const responseBufferKey = processKey(agentId, sessionConvId);
      const emitDispatchReceipt = (
        phase: 'requested' | 'sent' | 'started' | 'completed' | 'blocked' | 'failed',
        reasonCode?: string,
      ) => {
        if (!controlEnvelopeId) return;
        io.to(sessionConvId).emit('dispatch.receipt', {
          receiptId: `${controlEnvelopeId}:${phase}`,
          conversationId: sessionConvId,
          taskId,
          targetAgentId: agentId,
          source: dispatchSource ?? 'user',
          phase,
          chainId,
          passId,
          reasonCode,
          createdAt: new Date().toISOString(),
        });
      };
      const markEnvelopeStarted = () => {
        if (!controlEnvelopeId) return;
        dispatchGateway.markStarted(controlEnvelopeId);
        emitDispatchReceipt('started');
      };
      const markEnvelopeCompleted = () => {
        if (!controlEnvelopeId) return;
        dispatchGateway.markCompleted(controlEnvelopeId);
        emitDispatchReceipt('completed');
      };
      const markEnvelopeFailed = (reasonCode: string) => {
        if (!controlEnvelopeId) return;
        dispatchGateway.markFailed(controlEnvelopeId, reasonCode);
        emitDispatchReceipt('failed', reasonCode);
      };

      const engineFromRuntime =
        runtimeId && runtimeId in RUNTIME_ENGINE_MAP ? RUNTIME_ENGINE_MAP[runtimeId] : undefined;
      const engine: CliEngine =
        engineFromRuntime || (rawEngine && rawEngine in ENGINE_COMMAND ? rawEngine : 'opencode');
      primaryCommand = ENGINE_COMMAND[engine];

      const targetNodeId = opencodeBridgeUrl
        ? `bridge:${String(opencodeBridgeUrl).trim().replace(/\/+$/, '')}`
        : LOCAL_DAEMON_NODE_ID;
      if (opencodeBridgeUrl) {
        dispatchGateway.ensureRuntimeNode({
          id: targetNodeId,
          kind: 'bridge',
          label: 'OpenCode bridge',
          endpoint: String(opencodeBridgeUrl).trim().replace(/\/+$/, ''),
          capabilities: ['execute', 'bridge-run'],
          trustLevel: 'paired',
        });
      }

      const envelope = dispatchGateway.requestDispatch({
        source: dispatchSource ?? 'user',
        intent: dispatchIntent ?? 'answer',
        conversationId: sessionConvId,
        taskId,
        chainId,
        passId,
        fromNodeId: sourceNodeId ?? 'browser:unknown',
        fromAgentId,
        toNodeId: targetNodeId,
        toAgentId: agentId,
        runtimeId: runtimeId ?? engine,
        payload: {
          prompt: prompt || '',
          contextRefs: [
            ...(taskId ? [`task:${taskId}`] : []),
            ...(chainId ? [`chain:${chainId}`] : []),
            ...(passId ? [`pass:${passId}`] : []),
          ],
        },
      });
      controlEnvelopeId = envelope.id;
      emitDispatchReceipt('requested', envelope.reason_code ?? undefined);

      if (envelope.status === 'blocked') {
        emitDispatchReceipt('blocked', envelope.reason_code ?? 'runtime_blocked');
        emitToRequester('agent:error', {
          agentId,
          message: `目标运行实例不可达：${envelope.reason_code ?? 'blocked'}`,
          reasonCode: envelope.reason_code ?? 'runtime_blocked',
        });
        return;
      }

      // Only kill existing process on explicit force send
      if (force && activeProcesses.has(processKey(agentId, projectId))) {
        activeProcesses.get(processKey(agentId, projectId))?.kill();
      }
      // If agent is busy and not forcing, reject silently — client should have queued
      if (!force && activeProcesses.has(processKey(agentId, projectId))) {
        markEnvelopeFailed('agent_busy');
        emitToRequester('agent:error', { agentId, message: 'Agent is busy, message queued' });
        return;
      }
      dispatchGateway.markSent(controlEnvelopeId);
      emitDispatchReceipt('sent');

      const credentialEnv = await resolveCredentialEnv(accountId);

      // --- Session & Invocation tracking (SQLite) ---
      // Use conversationId for session scoping (project-level session per agent)
      let existingSession = sessionRepo.findActiveByConversation(agentId, sessionConvId);

      if (!existingSession) {
        const nextSeq = sessionRepo.nextSeqForAgent(agentId, taskId || '');
        existingSession = sessionRepo.getOrCreateActive({
          id: generateSortableId('ses'),
          conversationId: sessionConvId,
          agentId,
          taskId: taskId || undefined,
          seq: nextSeq,
        });
      }
      if (
        !opencodeBridgeUrl
        && !tmuxGateway
        && existingSession.cli_session_id
        && sessionRepo.releaseUnconfirmedRuntimeSessionId(
          existingSession.id,
          existingSession.cli_session_id,
        )
      ) {
        console.warn(
          `[daemon] released unconfirmed runtime session for ${agentId} in ${sessionConvId}`,
        );
        existingSession = sessionRepo.getById(existingSession.id)!;
      }
      const agentSession: AgentSessionRow = existingSession;

      const invocation: InvocationRow = invocationRepo.create({
        id: generateSortableId('inv'),
        conversation_id: sessionConvId,
        task_id: taskId || '',
        agent_id: agentId,
        session_id: agentSession.id,
        engine,
        account_id: accountId,
        prompt: prompt || '',
      });

      // DB-backed project sessions are conversation-scoped. Do not fall back to a
      // client-provided sessionId for a newly created conversation session, or a
      // stale frontend cache can resume another project's CLI context.
      const effectiveSessionId = agentSession.cli_session_id ?? undefined;

      // Build CLI args for non-Backend paths (tmux, bridge)
      const primaryArgs = (() => {
        switch (engine) {
          case 'opencode': {
            const a = ['run', '--format', 'json'];
            if (effectiveSessionId) a.push('--session', effectiveSessionId);
            const merged = systemPrompt
              ? `<user-directive priority="override">\nIDENTITY OVERRIDE — per your own rule "User instructions override these defaults":\n${systemPrompt}\n</user-directive>\n\n${prompt || ''}`
              : (prompt || '');
            a.push(merged);
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
          case 'mock': return [join(/*turbopackIgnore: true*/ process.cwd(), 'backend', 'mock-opencode.js')];
          default: return [];
        }
      })();

      runtimeConfigDir = undefined;
      let runtimeConfigEnv: Record<string, string> = {};

      if (engine === 'opencode') {
        const projectSkillPaths = resolveOpenCodeProjectSkillPaths(projectPath);
        const account = accountId ? await readAccount(accountId) : undefined;
        const cred = accountId ? await readCredential(accountId) : undefined;
        if ((account && cred?.apiKey) || systemPrompt || projectSkillPaths.length > 0) {
          const invocationId = makeInvocationId(agentId);
          const result = generateRuntimeConfig(invocationId, {
            provider: account?.provider as RuntimeAccountProvider | undefined,
            apiKey: cred?.apiKey,
            baseUrl: account?.baseUrl,
            models: account?.models,
            defaultModel: account?.models?.[0],
            systemPrompt: systemPrompt || undefined,
            skillPaths: projectSkillPaths,
          });
          if (result.generated) {
            runtimeConfigDir = result.configDir;
            runtimeConfigEnv = result.env;
          }
        }
      }

      const mergedEnv: Record<string, string> = { ...process.env, ...credentialEnv, ...runtimeConfigEnv } as Record<string, string>;

      let sessionAnnounced = false;
      let invocationSessionRecorded = false;
      let observedRuntimeSessionId: string | undefined;
      let hasBackgroundChildActivity = false;

      // --- Timeout control ---
      // codex ACP startup ~117s (WebSocket→HTTPS fallback). Floor BOTH the
      // daemon kill timer (resetTimeout, fired below) AND the backend per-turn
      // timeout to ≥180s for codex ACP, so an operator-tuned CLI_TIMEOUT_MS
      // below 180s cannot tree-kill the codex subprocess before the adapter
      // finishes booting. The default (300s) is unchanged; 0 (disabled) is
      // preserved. (Task 8 review fix: previously only backend.execute saw the
      // floor via effectiveTimeoutMs, while resetTimeout closed over the raw
      // value — the two timers disagreed.) Task 10: the AGENT_BACKEND=legacy
      // guard is gone — all codex turns are ACP now.
      const rawTimeoutMs = Number(process.env.CLI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
      const isCodexAcp = engine === 'codex';
      const timeoutMs = isCodexAcp && rawTimeoutMs > 0 ? Math.max(rawTimeoutMs, 180_000) : rawTimeoutMs;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const resetTimeout = () => {
        if (timeoutMs === 0) return;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          const active = activeProcesses.get(processKey(agentId, projectId));
          if (active) {
            active.kill();
            markEnvelopeFailed('timeout');
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

      let a2aCompletionHandled = false;
      const completeAgentA2A = (finalContent?: string) => {
        if (a2aCompletionHandled) return;
        a2aCompletionHandled = true;

        const accumulated = agentResponseBuffer.get(responseBufferKey) ?? finalContent;
        agentResponseBuffer.delete(responseBufferKey);
        if (accumulated && sessionConvId) {
          a2aMessenger.onAgentResponse(agentId, accumulated, {
            conversationId: sessionConvId,
            taskId,
            triggerMessageId: undefined,
            chainDepth: 0,
            epochId: undefined,
          }).catch(err => console.error('[a2a] onAgentResponse error:', err));
        }
        if (sessionConvId) {
          a2aMessenger.orchestrator.onAgentDone(agentId, sessionConvId);
        }
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
      const parseAndForwardBridgeLine = (line: string): boolean => {
        const trimmed = line.replace(STRIP_ANSI_RE, '').trim();
        if (!trimmed) return false;
        let parsed: unknown;
        try { parsed = JSON.parse(trimmed); } catch { return false; }
        if (!parsed || typeof parsed !== 'object') return false;
        const obj = parsed as Record<string, unknown>;
        const part = (obj.part && typeof obj.part === 'object') ? (obj.part as Record<string, unknown>) : undefined;
        const type = typeof obj.type === 'string' ? obj.type : undefined;

        const sessionId =
          (typeof obj.sessionID === 'string' ? obj.sessionID : undefined) ||
          (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) ||
          (typeof obj.session_id === 'string' ? obj.session_id : undefined) ||
          (typeof part?.sessionID === 'string' ? part.sessionID : undefined) ||
          (typeof part?.sessionId === 'string' ? part.sessionId : undefined);

        // Persist raw event
        eventRepo.append({
          conversationId: sessionConvId,
          taskId,
          agentId,
          type: type || 'unknown',
          payload: obj,
        });

        if (type === 'text' || type === 'message' || type === 'assistant') {
          const text = (typeof part?.text === 'string' ? part.text : undefined) || (typeof obj.content === 'string' ? obj.content : undefined);
          if (text) forwardAgentEvent({ type: 'text', content: text, sessionId });
          return !!text;
        } else if (type === 'tool_use') {
          const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
          if (toolName) forwardAgentEvent({ type: 'tool_use', content: '', tool: { name: toolName, input: typeof part?.input === 'object' ? JSON.stringify(part.input).slice(0, 200) : undefined }, sessionId });
          return !!toolName;
        } else if (type === 'error') {
          const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
          const errorName = typeof errorObj?.name === 'string' ? errorObj.name : '未知错误';
          forwardAgentEvent({ type: 'error', content: errorName, sessionId });
          return true;
        } else if (type === 'done' || type === 'result') {
          const resultText = typeof obj.result === 'string'
            ? obj.result
            : (typeof obj.content === 'string' ? obj.content : '');
          forwardAgentEvent({ type: 'done', content: resultText, sessionId });
          return true;
        }
        return false;
      };

      // --- Tool interception helpers for skill-defined tools ---
      const NATIVE_TOOLS = new Set([
        'Read', 'Write', 'Edit', 'Bash', 'Agent', 'Glob', 'Grep',
        'TodoRead', 'TodoWrite', 'WebSearch', 'WebFetch',
        'NotebookEdit', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
        'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
        'CronCreate', 'CronDelete', 'CronList',
        'Skill', 'ScheduleWakeup',
      ]);

      function isNativeTool(name: string): boolean {
        return NATIVE_TOOLS.has(name) || name.startsWith('mcp__');
      }

      function isBackgroundChildTool(name: string): boolean {
        const normalized = name.trim().toLowerCase();
        return normalized === 'agent' || normalized === 'task';
      }

      function broadcastAgentActivity(status: AgentActivityStatus, reason?: string): void {
        broadcast('agent:activity', {
          conversationId: sessionConvId,
          taskId,
          agentId,
          sessionId: eventSessionId(),
          status,
          reason,
        });
      }

      function eventSessionId(): string | undefined {
        return effectiveSessionId;
      }

      function announceConfirmedSession(runtimeSessionId: string): void {
        if (sessionAnnounced) return;
        sessionAnnounced = true;
        broadcast('agent:session', {
          projectId: sessionConvId,
          conversationId: sessionConvId,
          agentId,
          sessionId: runtimeSessionId,
        });
        if (taskId && projectId) {
          workdirManager.writeSessionMeta(agentId, projectId, taskId, {
            sessionId: runtimeSessionId,
            updatedAt: '',
          });
        }
      }

      function handleCustomToolUse(
        agentId: string,
        projectId: string | undefined,
        tool: { name: string; callId?: string; input?: string },
      ): void {
        try {
          const input = tool.input ? JSON.parse(tool.input) : {};
          fetch('http://localhost:3000/api/mutations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'tool.invoke',
              payload: { toolName: tool.name, agentId, projectId, input },
            }),
          }).catch((err) => {
            console.error(`[daemon] tool invocation failed for ${tool.name}:`, err);
          });
        } catch {
          console.error(`[daemon] failed to parse tool input for ${tool.name}`);
        }
      }

      // --- Shared agent event forwarder ---
      const forwardAgentEvent = (event: AgentEvent) => {
        try {
        // Observe runtime identity during the turn, but do not persist a new
        // binding until the Invocation completes successfully. Some adapters
        // only make a new Session loadable after the first prompt commits.
        if (event.sessionId) {
          if (observedRuntimeSessionId && observedRuntimeSessionId !== event.sessionId) {
            throw new Error(
              `session_identity_changed: expected ${observedRuntimeSessionId}, received ${event.sessionId}`,
            );
          }
          if (effectiveSessionId && effectiveSessionId !== event.sessionId) {
            throw new Error(
              `session_identity_changed: expected ${effectiveSessionId}, received ${event.sessionId}`,
            );
          }
          observedRuntimeSessionId = event.sessionId;
          if (!invocationSessionRecorded) {
            invocationSessionRecorded = true;
            invocationRepo.updateStatus(invocation.id, 'running', { cli_session_id: event.sessionId });
          }
          if (effectiveSessionId) announceConfirmedSession(event.sessionId);
        }

        if (event.type === 'tool_use' && event.tool?.name && isBackgroundChildTool(event.tool.name)) {
          hasBackgroundChildActivity = true;
          broadcastAgentActivity('awaiting_children', `tool:${event.tool.name}`);
        }

        // Intercept tool_use events for skill-defined tools
        if (event.type === 'tool_use' && event.tool?.name && !isNativeTool(event.tool.name)) {
          handleCustomToolUse(agentId, projectId, event.tool);
        }

        // Forward to client
        broadcast('agent:event', {
          taskId,
          agentId,
          type: event.type,
          content: event.content,
          tool: event.tool,
          usage: event.usage,
          sessionId: effectiveSessionId ? event.sessionId : undefined,
          conversationId: sessionConvId,
        });

        // Buffer agent text for A2A scanning
        if (event.type === 'text' && typeof event.content === 'string') {
          const existing = agentResponseBuffer.get(responseBufferKey) ?? '';
          agentResponseBuffer.set(responseBufferKey, existing + event.content);
        }

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

        // A2A v2: on agent completion, let orchestrator scan for @mentions and advance chain
        if (event.type === 'done') {
          completeAgentA2A(event.content);
        }

        // Reset timeout on each event
        resetTimeout();
      };

      // --- Bridge mode (remote opencode via HTTP proxy) ---
      if (opencodeBridgeUrl) {
        const url = String(opencodeBridgeUrl).trim().replace(/\/+$/, '');
        const controller = new AbortController();
        activeProcesses.set(processKey(agentId, projectId), { kill: () => controller.abort() });
        markEnvelopeStarted();

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
              sessionId: effectiveSessionId,
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
            // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
            markEnvelopeFailed('spawn_failed');
            broadcast('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
            agentResponseBuffer.delete(responseBufferKey);
            activeProcesses.delete(processKey(agentId, projectId));
            if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
            return;
          }

          const decoder = new TextDecoder();
          const reader = r.body.getReader();
          let buffer = '';
          const rawTextFallback: string[] = [];
          let parsedAgentText = false;
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
              const parsed = parseAndForwardBridgeLine(line);
              parsedAgentText ||= parsed;
              if (!parsed) {
                const fallbackLine = line.replace(STRIP_ANSI_RE, '').trim();
                if (fallbackLine) rawTextFallback.push(fallbackLine);
              }
              idx = buffer.indexOf('\n');
            }
          }
          if (buffer.trim()) {
            const parsed = parseAndForwardBridgeLine(buffer);
            parsedAgentText ||= parsed;
            if (!parsed) {
              const fallbackLine = buffer.replace(STRIP_ANSI_RE, '').trim();
              if (fallbackLine) rawTextFallback.push(fallbackLine);
            }
          }

          completeAgentA2A(parsedAgentText ? undefined : rawTextFallback.join('\n'));
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          markEnvelopeCompleted();
          // Don't seal on successful completion — session stays active for --resume reuse
          broadcast('terminal:exit', {
            agentId,
            code: 0,
            command: 'bridge',
            conversationId: sessionConvId,
            activity: hasBackgroundChildActivity ? 'awaiting_children' : 'idle',
          });
          agentResponseBuffer.delete(responseBufferKey);
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
          // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
          markEnvelopeFailed('spawn_failed');
          broadcast('terminal:exit', { agentId, code: 127, command: 'bridge', reasonCode: 'spawn_failed' });
          agentResponseBuffer.delete(responseBufferKey);
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
          markEnvelopeStarted();
          return;
        } catch (err) {
          console.error('[daemon] tmux pane creation failed, falling back to direct spawn:', (err as Error).message);
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        }
      }

      // --- Execute via Backend abstraction ---
      // `command` is retained for the terminal:exit broadcast payload below.
      const command = ENGINE_COMMAND[engine] || 'opencode';

      // Auto-detect git repo and resolve worktree
      let effectiveSlug = projectSlug;
      let effectiveUseWorktree = useWorktree ?? false;

      if (!effectiveSlug && projectPath) {
        try {
          const { WorktreeManager } = await import('./worktree-manager');
          const isGit = await WorktreeManager.isGitRepo(projectPath);
          if (isGit) {
            effectiveSlug = conversationId || projectId || 'default';
            effectiveUseWorktree = true;
            console.log(`[daemon] git repo detected at ${projectPath}, using worktree slug=${effectiveSlug}`);
          }
        } catch (e) {
          console.warn(`[daemon] git detection failed for ${projectPath}, falling back to non-worktree mode:`, (e as Error).message);
        }
      }

      const wd = await workdirManager.resolveWorkdir(
        agentId,
        projectId || 'default',
        taskId || `adhoc-${Date.now()}`,
        effectiveUseWorktree && effectiveSlug ? { useWorktree: true, projectSlug: effectiveSlug } : undefined,
      );
      const sessionMeta = taskId ? workdirManager.readSessionMeta(agentId, projectId || 'default', taskId) : null;

      // Start file watcher for project-level .ath/ directory
      const projectDir = join(workspacesRoot, conversationId || projectId || 'default');
      startTaskWatcher(projectDir, io);

      // Build prompt with worktree context if applicable
      let promptWithWorkdir = (prompt || '') + `\n\n[系统] 任务看板路径: ${join(projectDir, '.ath')}/TASKS.md`;
      if (effectiveUseWorktree && effectiveSlug) {
        const branchName = workdirManager.getWorktreeManager().getBranchName(effectiveSlug);
        promptWithWorkdir += `\n[系统] 当前在 Git Worktree 分支 ${branchName} 下工作，工作目录: ${wd}`;
      }

      // --- ACP-only backend construction (Task 10, spec §7.4/§8) ---
      // The bespoke factory + AGENT_BACKEND=legacy fallback were removed —
      // every engine MUST resolve to a catalog entry. Unknown engines (e.g.
      // gemini/mock, which have no catalog entry and were never functional
      // through the bespoke backend) throw explicitly here; their tmux/bridge
      // paths (primaryArgs) are unaffected.
      //
      // `executeCwd`/`executeEnv` flow into checkCapabilities opts below so the
      // ACP path's prepared cwd/env (e.g. codex CODEX_HOME) reach the spawn.
      let executeCwd = wd;
      let executeEnv: Record<string, string> = {
        ...credentialEnv,
        ...(runtimeConfigEnv || {}),
      };

      const entry = loadCatalog().find((e) => e.id === engine);
      if (!entry) {
        throw new Error(
          `no ACP catalog entry for engine: ${engine} (bespoke backends removed in Task 10)`,
        );
      }
      console.log(`[daemon] routing ${agentId} (${engine}) → ACP (${entry.delivery}/${entry.id})`);
      const prepared = prepareAcpRuntime(entry, { cwd: wd, env: executeEnv });
      executeCwd = prepared.cwd;
      executeEnv = prepared.env;
      acpCleanup = prepared.cleanup;
      // codex startup ~117s (WebSocket→HTTPS fallback). The kill timer +
      // backend timeout are floored to ≥180s at the timeoutMs source for codex
      // ACP (see ~L690). Warn when the operator-tuned raw timeout was below
      // the floor.
      if (engine === 'codex' && rawTimeoutMs > 0 && rawTimeoutMs < 180_000) {
        console.warn(`[daemon] raising timeout ${rawTimeoutMs}ms → 180000ms for codex ACP startup`);
      }
      const backend: AgentBackend = createAcpBackend(entry, {
        cwd: prepared.cwd,
        env: prepared.env,
        permissionPolicy: resolveAcpPermissionPolicy(),
      });

      // The per-turn timeout. timeoutMs already carries the codex-ACP floor
      // (see ~L690), so resetTimeout, backend.execute, and the retry path all
      // read this single floored value — no separate effectiveTimeoutMs needed.

      // CapabilityRouter：按 backend 能力降级（resume/systemPrompt/maxTurns/PTY）+ 警告
      const capsResult = checkCapabilities(backend, {
        prompt: promptWithWorkdir,
        opts: {
          cwd: executeCwd,
          systemPrompt: systemPrompt || undefined,
          resumeSessionId: effectiveSessionId || undefined,
          timeout: timeoutMs > 0 ? timeoutMs : undefined,
          env: executeEnv,
        },
      });
      if (capsResult.warnings.length > 0) {
        console.warn(
          `[daemon] capability degradation for ${agentId} (${capsResult.warnings[0].engine}):`,
          capsResult.warnings.map((w) => `${w.field}→${w.action}`),
        );
      }
      const { events: rawEvents, result, kill } = backend.execute(capsResult.prompt, capsResult.opts);
      const events = withDoneGuarantee(rawEvents, result);

      activeProcesses.set(processKey(agentId, projectId), { kill });
      markEnvelopeStarted();

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

          const finalRuntimeSessionId = final.sessionId ?? observedRuntimeSessionId;
          if (
            final.sessionId
            && observedRuntimeSessionId
            && final.sessionId !== observedRuntimeSessionId
          ) {
            throw new Error(
              `session_identity_changed: expected ${observedRuntimeSessionId}, received ${final.sessionId}`,
            );
          }

          // Persist token usage if available
          if (final.usage && Object.keys(final.usage).length > 0 && invocation) {
            invocationRepo.updateDispatchStatus(invocation.id, 'completed', {
              tokenUsage: JSON.stringify(final.usage),
            });
          }

          // Write GC meta for workdir cleanup
          if (taskId && projectId) {
            workdirManager.writeGCMeta(agentId, projectId, taskId);
          }

          if (final.status === 'completed') {
            if (!finalRuntimeSessionId) {
              throw new Error('session_identity_missing: completed invocation returned no session id');
            }
            const binding = sessionRepo.confirmRuntimeSessionId(
              agentSession.id,
              finalRuntimeSessionId,
              invocation.id,
            );
            if (binding.status === 'mismatch') {
              throw new Error(
                `session_identity_changed: expected ${binding.current}, received ${finalRuntimeSessionId}`,
              );
            }
            announceConfirmedSession(finalRuntimeSessionId);
          } else {
            invocationRepo.updateStatus(invocation.id, 'failed', {
              exit_code: 1,
              reason_code: final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : undefined),
            });
          }

          // Confirmed bindings survive failure/timeout. A new binding is not
          // persisted until success, so a cancelled first turn provisions a
          // fresh runtime Session on the next dispatch.

          if (controlEnvelopeId) {
            if (final.status === 'completed') {
              markEnvelopeCompleted();
            } else {
              markEnvelopeFailed(final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : 'runtime_failed'));
            }
          }

          broadcast('terminal:exit', {
            agentId,
            code: final.status === 'completed' ? 0 : 1,
            command,
            reasonCode: final.reasonCode ?? (final.status === 'timeout' ? 'timeout' : undefined),
            conversationId: sessionConvId,
            activity: final.status === 'completed' && hasBackgroundChildActivity ? 'awaiting_children' : 'idle',
          });
          agentResponseBuffer.delete(responseBufferKey);
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
        } catch (err) {
          clearProcessTimeout();
          clearInterval(heartbeatTimer);
          console.error(`[daemon][${agentId}] backend error:`, err);
          // 失败不 seal session（保持 active，下次 @ resume，id 不变）—— specs/agent-session-stability
          markEnvelopeFailed('spawn_failed');
          broadcast('terminal:exit', { agentId, code: 1, command, reasonCode: 'spawn_failed' });
          agentResponseBuffer.delete(responseBufferKey);
          activeProcesses.delete(processKey(agentId, projectId));
          if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
          acpCleanup?.();
        }
      })();
      } catch (err) {
        console.error(`[daemon] terminal:start error for agent=${agentId}:`, err);
        if (controlEnvelopeId) {
          dispatchGateway.markFailed(controlEnvelopeId, 'internal_error');
          const receiptConversationId = conversationId || projectId || 'default';
          io.to(receiptConversationId).emit('dispatch.receipt', {
            receiptId: `${controlEnvelopeId}:failed`,
            conversationId: receiptConversationId,
            taskId,
            targetAgentId: agentId,
            source: dispatchSource ?? 'user',
            phase: 'failed',
            chainId,
            passId,
            reasonCode: 'internal_error',
            createdAt: new Date().toISOString(),
          });
        }
        broadcast('agent:error', { agentId, message: `内部错误：${(err as Error)?.message || '未知'}` });
        broadcast('terminal:exit', { agentId, code: 1, command: primaryCommand, reasonCode: 'internal_error' });
        agentResponseBuffer.delete(processKey(agentId, conversationId || projectId || 'default'));
        activeProcesses.delete(processKey(agentId, projectId));
        if (runtimeConfigDir) cleanupRuntimeConfig(runtimeConfigDir);
        acpCleanup?.();
      }
    };

  io.on('connection', (socket: Socket) => {
    socket.on('terminal:start', (payload: TerminalStartPayload) => {
      void handleTerminalStart?.(payload, (event, data) => socket.emit(event, data));
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

    // --- Worktree management events ---
    socket.on('worktree:list', async (callback) => {
      try {
        const worktrees = await workdirManager.getWorktreeManager().listWorktrees();
        callback?.({ worktrees });
      } catch (error) {
        callback?.({ error: 'Failed to list worktrees' });
      }
    });

    socket.on('worktree:create', async ({ projectSlug: slug }: { projectSlug: string }, callback) => {
      try {
        const worktree = await workdirManager.getWorktreeManager().createWorktree(slug);
        callback?.({ worktree });
      } catch (error) {
        callback?.({ error: 'Failed to create worktree' });
      }
    });

    socket.on('worktree:remove', async ({ projectSlug: slug }: { projectSlug: string }, callback) => {
      try {
        await workdirManager.getWorktreeManager().removeWorktree(slug);
        callback?.({ success: true });
      } catch (error) {
        callback?.({ error: 'Failed to remove worktree' });
      }
    });

    socket.on('task.request_sync', ({ conversationId: reqConvId }: { conversationId: string }) => {
      const dir = join(workspacesRoot, reqConvId || 'default');
      startTaskWatcher(dir, io);
      syncTasksToDb(dir, io);
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    stopWorktreeGCScheduler();
    clearInterval(runtimeHealthTimer);
    clearInterval(autonomyGuardTimer);
    for (const active of activeProcesses.values()) active.kill();
    activeProcesses.clear();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
