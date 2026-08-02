'use client';

import { io } from 'socket.io-client';
import type { DetectedRuntime, CliEngine } from '@/server/types';

// --- Shared socket instance ---
export const socket = io(undefined, { path: '/api/socketio', autoConnect: false });

const BROWSER_NODE_STORAGE_KEY = 'ath.browserRuntimeNodeId';
let runtimeHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function getBrowserRuntimeNodeId(): string {
  if (typeof window === 'undefined') return 'browser:ssr';
  const existing = window.localStorage.getItem(BROWSER_NODE_STORAGE_KEY);
  if (existing) return existing;
  const id = `browser:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(BROWSER_NODE_STORAGE_KEY, id);
  return id;
}

export function registerBrowserRuntimeNode() {
  const nodeId = getBrowserRuntimeNodeId();
  socket.emit('runtime:hello', {
    nodeId,
    kind: 'browser',
    label: 'Browser UI',
    capabilities: ['dispatch-intent', 'socket-transport'],
  });
  socket.emit('runtime:heartbeat', { nodeId });
  if (runtimeHeartbeatTimer) clearInterval(runtimeHeartbeatTimer);
  runtimeHeartbeatTimer = setInterval(() => {
    if (socket.connected) socket.emit('runtime:heartbeat', { nodeId });
  }, 5_000);
}

// --- Stream watchdogs & buffer (module-level, shared across slice & socket listeners) ---

const STREAM_WATCHDOG_MS = 300_000;
const streamWatchdogs: Record<string, ReturnType<typeof setTimeout>> = {};

const streamBuffer: Record<string, string> = {};
let bufferFlushScheduled = false;

const NO_RUNTIME_PROFILE_ABORT = {
  reasonCode: 'no_runtime_profile',
  message: '请先为该角色绑定可用账号或执行引擎',
} as const;

type AgentRunStatus = 'idle' | 'busy' | 'background';
type ActiveAgentRun = {
  runId: string;
  taskId?: string;
  conversationId: string;
  startedAt: string;
  activity?: 'foreground' | 'awaiting_children';
};

export function resetWatchdog(agentId: string, getState: () => any, setState: (partial: any) => void) {
  if (streamWatchdogs[agentId]) clearTimeout(streamWatchdogs[agentId]);
  streamWatchdogs[agentId] = setTimeout(() => {
    const state = getState();
    if (state.activeRunsByAgent[agentId]?.activity === 'awaiting_children') {
      delete streamWatchdogs[agentId];
      return;
    }
    if (state.activeStreamMessageId[agentId]) {
      console.warn(`[watchdog] Stream for ${agentId} timed out after ${STREAM_WATCHDOG_MS / 1000}s, auto-completing`);
      setState((s: any) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'idle' },
        activeRunsByAgent: { ...s.activeRunsByAgent, [agentId]: undefined },
      }));
      getState().completeStreamMessage(agentId);
    }
    delete streamWatchdogs[agentId];
  }, STREAM_WATCHDOG_MS);
}

export function clearWatchdog(agentId: string) {
  if (streamWatchdogs[agentId]) {
    clearTimeout(streamWatchdogs[agentId]);
    delete streamWatchdogs[agentId];
  }
}

export function scheduleBufferFlush(getState: () => any, setState: (partial: any) => void) {
  if (bufferFlushScheduled) return;
  bufferFlushScheduled = true;
  requestAnimationFrame(() => {
    bufferFlushScheduled = false;
    const state = getState();
    const entries = Object.entries(streamBuffer);
    for (const [messageId, pending] of entries) {
      if (!pending) continue;
      delete streamBuffer[messageId];
      const agentEntry = Object.entries(state.activeStreamMessageId).find(([, id]) => id === messageId);
      const convId = agentEntry ? state.activeStreamConversationId[agentEntry[0]] : undefined;
      if (!convId) continue;
      setState((s: any) => {
        const msgs = s.chatMessagesByConversation[convId];
        if (!msgs) return s;
        return {
          chatMessagesByConversation: {
            ...s.chatMessagesByConversation,
            [convId]: msgs.map((m: any) =>
              m.id === messageId ? { ...m, content: m.content + pending } : m
            ),
          },
        };
      });
    }
  });
}

export function flushStreamBufferForMessage(
  messageId: string,
  conversationId: string,
  setState: (partial: any) => void,
) {
  const pending = streamBuffer[messageId];
  if (!pending) return;
  delete streamBuffer[messageId];
  setState((s: any) => {
    const msgs = s.chatMessagesByConversation[conversationId];
    if (!msgs) return s;
    return {
      chatMessagesByConversation: {
        ...s.chatMessagesByConversation,
        [conversationId]: msgs.map((m: any) =>
          m.id === messageId ? { ...m, content: m.content + pending } : m
        ),
      },
    };
  });
}

export function appendToStreamBuffer(messageId: string, content: string) {
  streamBuffer[messageId] = (streamBuffer[messageId] || '') + content;
}

// --- Daemon Slice Creator ---

export interface PendingDispatch {
  idempotencyKey: string;
  inboxItemId?: string;
  persistenceStatus: 'persisting' | 'persisted' | 'failed';
  prompt: string;
  referencedTaskId?: string;
  queuedAt: string;
  source?: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';
  fromAgentId?: string;
  conversationId: string;
  legacyProposal?: boolean;
}

type InFlightDispatch = Omit<
  PendingDispatch,
  'queuedAt' | 'idempotencyKey' | 'inboxItemId' | 'persistenceStatus'
>;

// Browser busy state is only a projection. Keep the request until daemon
// confirms it was sent so an agent_busy response can recover it into the
// conversation-scoped pending queue instead of dropping the user turn.
const inFlightDispatches = new Map<string, InFlightDispatch>();

/** Composite key for per-project queue isolation: agentId:conversationId */
function queueKey(agentId: string, conversationId: string): string {
  return `${agentId}:${conversationId}`;
}

export function takeInFlightDispatch(agentId: string, conversationId: string): InFlightDispatch | undefined {
  const key = queueKey(agentId, conversationId);
  const dispatch = inFlightDispatches.get(key);
  inFlightDispatches.delete(key);
  return dispatch;
}

export function clearInFlightDispatch(agentId: string, conversationId: string): void {
  inFlightDispatches.delete(queueKey(agentId, conversationId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- set/get typed as any to avoid circular dependency with TaskHubState
export const createDaemonSlice = (set: any, get: () => any) => {
  const _resetWatchdog = (agentId: string) => resetWatchdog(agentId, get, set);
  const _scheduleFlush = () => scheduleBufferFlush(get, set);
  const _recordNoRuntimeProfileAbort = (conversationId: string, agentId: string, visibleToUser = false) => {
    get().addEvent({
      conversationId,
      type: 'invocation.aborted',
      payload: {
        agentId,
        ...NO_RUNTIME_PROFILE_ABORT,
      },
    });
    if (visibleToUser) {
      get().addChatMessage({
        agentId: 'system',
        conversationId,
        content: `@${agentId} 未启动：${NO_RUNTIME_PROFILE_ABORT.message}。`,
        source: 'system',
      });
    }
  };
  const _updatePendingPersistence = (
    agentId: string,
    conversationId: string,
    idempotencyKey: string,
    patch: Partial<Pick<PendingDispatch, 'persistenceStatus' | 'inboxItemId'>>,
  ) => {
    const key = queueKey(agentId, conversationId);
    set((state: any) => ({
      pendingDispatches: {
        ...state.pendingDispatches,
        [key]: (state.pendingDispatches[key] || []).map((item: PendingDispatch) =>
          item.idempotencyKey === idempotencyKey ? { ...item, ...patch } : item),
      },
    }));
  };
  const _persistPendingDispatch = async (
    agentId: string,
    entry: PendingDispatch,
    attemptsRemaining = 3,
  ): Promise<void> => {
    try {
      const response = await fetch('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'dispatch.enqueue',
          payload: {
            agentId,
            conversationId: entry.conversationId,
            prompt: entry.prompt,
            referencedTaskId: entry.referencedTaskId,
            source: entry.source,
            fromAgentId: entry.fromAgentId,
            idempotencyKey: entry.idempotencyKey,
          },
        }),
      });
      if (!response.ok) throw new Error(`dispatch_enqueue_http_${response.status}`);
      const body = typeof response.json === 'function'
        ? await response.json() as { result?: { id?: string } }
        : {};
      _updatePendingPersistence(agentId, entry.conversationId, entry.idempotencyKey, {
        persistenceStatus: 'persisted',
        inboxItemId: body.result?.id,
      });
    } catch {
      if (attemptsRemaining > 1) {
        setTimeout(() => {
          void _persistPendingDispatch(agentId, entry, attemptsRemaining - 1);
        }, 500);
        return;
      }
      _updatePendingPersistence(agentId, entry.conversationId, entry.idempotencyKey, {
        persistenceStatus: 'failed',
      });
    }
  };

  return {
    daemonConnection: { status: 'disconnected' as 'disconnected' | 'connecting' | 'connected', error: undefined as string | undefined },
    setDaemonConnection: (next: { status: 'disconnected' | 'connecting' | 'connected'; error?: string }) => set({ daemonConnection: next }),

    daemonRuntimes: [] as DetectedRuntime[],
    setDaemonRuntimes: (runtimes: DetectedRuntime[]) => set({ daemonRuntimes: runtimes }),

    enableMockRunner: false as boolean,
    setEnableMockRunner: (enabled: boolean) => set({ enableMockRunner: enabled }),

    terminalLogs: {} as Record<string, string[]>,
    agentStatus: {} as Record<string, AgentRunStatus>,
    activeRunsByAgent: {} as Record<string, ActiveAgentRun | undefined>,
    activeStreamMessageId: {} as Record<string, string>,
    activeStreamConversationId: {} as Record<string, string>,
    pendingDispatches: {} as Record<string, PendingDispatch[]>,
    agentSessions: { default: {} } as Record<string, Record<string, string | undefined>>,
    needsFullCompose: {} as Record<string, boolean>,

    refreshRuntimeCatalog: () => {},

    getAvailableRuntime: (): { engine: CliEngine; available: boolean } | null => {
      const runtimes = get().daemonRuntimes;
      const found = runtimes.find((r: DetectedRuntime) => r.available);
      if (found) return { engine: found.engine, available: true };
      if (get().enableMockRunner) {
        return { engine: 'mock' as CliEngine, available: true };
      }
      return null;
    },

    connectDaemon: () => {
      if (socket.connected) return;
      get().setDaemonConnection({ status: 'connecting' });
      const conversationId = get().selectedConversationId;
      if (conversationId) {
        void get().refreshPendingDispatches(conversationId).catch((error: unknown) => {
          console.error('[dispatch] failed to hydrate Agent Inbox projection:', error);
        });
      }
      fetch('/api/daemon/init')
        .catch((e: any) => {
          get().setDaemonConnection({ status: 'disconnected', error: String((e as any)?.message || e) });
        })
        .finally(() => socket.connect());
    },

    refreshPendingDispatches: async (conversationId: string) => {
      const response = await fetch(`/api/dispatches?conversationId=${encodeURIComponent(conversationId)}`);
      if (!response.ok) throw new Error(`dispatch_list_http_${response.status}`);
      const items = await response.json() as Array<{
        id: string;
        projectAgentId: string;
        idempotencyKey: string;
        command: {
          prompt: string;
          taskId?: string;
          source?: PendingDispatch['source'];
          fromAgentId?: string;
        };
        createdAt: string;
      }>;
      const current = get().pendingDispatches as Record<string, PendingDispatch[]>;
      const next = Object.fromEntries(
        Object.entries(current).filter(([, queue]) => queue[0]?.conversationId !== conversationId),
      ) as Record<string, PendingDispatch[]>;
      for (const [key, queue] of Object.entries(current)) {
        const unconfirmed = queue.filter((item) =>
          item.conversationId === conversationId && item.persistenceStatus !== 'persisted');
        if (unconfirmed.length) next[key] = unconfirmed;
      }
      for (const item of items) {
        const key = queueKey(item.projectAgentId, conversationId);
        const queue = next[key] ??= [];
        const projected: PendingDispatch = {
          idempotencyKey: item.idempotencyKey,
          inboxItemId: item.id,
          persistenceStatus: 'persisted',
          prompt: item.command.prompt,
          referencedTaskId: item.command.taskId,
          source: item.command.source,
          fromAgentId: item.command.fromAgentId,
          conversationId,
          queuedAt: item.createdAt,
        };
        const existingIndex = queue.findIndex(
          (candidate) => candidate.idempotencyKey === item.idempotencyKey,
        );
        if (existingIndex >= 0) queue[existingIndex] = projected;
        else queue.push(projected);
      }
      set({ pendingDispatches: next });
    },

    upsertAgentSession: (projectId: string, agentId: string, sessionId: string) =>
      set((state: any) => ({
        agentSessions: {
          ...state.agentSessions,
          [projectId]: {
            ...(state.agentSessions[projectId] || {}),
            [agentId]: sessionId,
          },
        },
      })),

    dispatchToAgent: async ({ agentId, prompt, referencedTaskId, source, fromAgentId, conversationId: explicitConvId, chainId, passId, legacyProposal }: { agentId: string; prompt: string; referencedTaskId?: string; source?: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system'; fromAgentId?: string; conversationId?: string; chainId?: string; passId?: string; legacyProposal?: boolean }) => {
      if ((source === undefined || source === 'user') && get().runtimeRefreshInProgress) {
        console.warn(`[dispatch] ${agentId} deferred: runtime configuration refresh in progress`);
        return false;
      }
      const conversationId =
        explicitConvId ??
        (referencedTaskId ? get().getTaskById(referencedTaskId)?.conversationId : undefined) ??
        get().selectedConversationId;
      if (!conversationId) {
        console.warn(`[dispatch] ${agentId} aborted: no conversationId`);
        return false;
      }

      const profile = get().getAgentRuntimeProfile(agentId);
      if (!profile) {
        console.warn(`[dispatch] ${agentId} aborted: no runtime profile or enabled account for conversation ${conversationId}`);
        _recordNoRuntimeProfileAbort(conversationId, agentId, source === undefined || source === 'user');
        return false;
      }

      if (get().agentStatus[agentId] && get().agentStatus[agentId] !== 'idle') {
        console.log(`[dispatch] ${agentId} busy, enqueuing for conversation ${conversationId}`);
        get().enqueueDispatch(agentId, {
          prompt,
          referencedTaskId,
          source,
          fromAgentId,
          conversationId,
          legacyProposal,
        });
        return true;
      }

      const projectId = conversationId;
      const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const effectiveIds = profile.agent.accountIds;
      const resolvedEngine = profile.execution.engine;

      console.log(`[dispatch] ${agentId} → engine=${resolvedEngine}, accountId=${profile.execution.accountId ?? '(none)'}, convId=${conversationId}`);

      const conv = get().conversations.find((c: any) => c.id === conversationId);
      const composeKey = `${conversationId}:${agentId}`;

      set((state: any) => ({
        agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
        terminalLogs: { ...state.terminalLogs, [agentId]: [] },
        needsFullCompose: { ...state.needsFullCompose, [composeKey]: false },
        activeRunsByAgent: {
          ...state.activeRunsByAgent,
          [agentId]: { runId, taskId: referencedTaskId, conversationId, startedAt: new Date().toISOString(), activity: 'foreground' },
        },
      }));

      get().addEvent({
        conversationId,
        type: 'run.started',
        payload: { runId, agentId, taskId: referencedTaskId, engine: resolvedEngine },
      });

      inFlightDispatches.set(queueKey(agentId, conversationId), {
        prompt,
        referencedTaskId,
        source,
        fromAgentId,
        conversationId,
        legacyProposal,
      });

      socket.emit('terminal:start', {
        dispatchId: runId,
        projectId,
        taskId: referencedTaskId,
        conversationId,
        sourceNodeId: getBrowserRuntimeNodeId(),
        dispatchSource: source ?? 'user',
        dispatchIntent: source === 'a2a' ? 'delegate' : (source === 'workflow' ? 'implement' : 'answer'),
        fromAgentId,
        chainId,
        passId,
        legacyProposal,
        agentId,
        prompt,
        allowMockRunner: get().enableMockRunner,
        opencodeBridgeUrl: undefined,
        engine: resolvedEngine,
        runtimeId: profile.execution.runtimeId,
        accountIds: effectiveIds,
        accountId: profile.execution.accountId ?? '',
        projectPath: conv?.projectPath || undefined,
        useWorktree: conv?.useWorktree || undefined,
      });
      return true;
    },

    enqueueDispatch: (agentId: string, payload: Omit<PendingDispatch, 'queuedAt' | 'idempotencyKey' | 'inboxItemId' | 'persistenceStatus'> & { idempotencyKey?: string }) => {
      const conversationId = payload.conversationId
        ?? (payload.referencedTaskId ? get().getTaskById(payload.referencedTaskId)?.conversationId : undefined)
        ?? get().selectedConversationId;
      if (!conversationId) return;

      const idempotencyKey = payload.idempotencyKey
        ?? `browser:${conversationId}:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
      const entry: PendingDispatch = {
        ...payload,
        idempotencyKey,
        persistenceStatus: 'persisting',
        queuedAt: new Date().toISOString(),
        conversationId,
      };
      const key = queueKey(agentId, conversationId);

      set((state: any) => ({
        pendingDispatches: {
          ...state.pendingDispatches,
          [key]: [...(state.pendingDispatches[key] || []), entry],
        },
      }));

      void _persistPendingDispatch(agentId, entry);
    },

    clearPendingDispatches: async (agentId: string, conversationId: string, idempotencyKey?: string) => {
      const key = queueKey(agentId, conversationId);
      const currentQueue = (get().pendingDispatches[key] || []) as PendingDispatch[];
      const target = idempotencyKey
        ? currentQueue.find((item) => item.idempotencyKey === idempotencyKey)
        : undefined;
      if (
        target?.persistenceStatus === 'persisting'
        || (!idempotencyKey && currentQueue.some((item) => item.persistenceStatus === 'persisting'))
      ) {
        throw new Error('dispatch_persistence_in_progress');
      }
      const response = await fetch('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'dispatch.cancel',
          payload: { agentId, conversationId, idempotencyKey },
        }),
      });
      if (!response.ok) throw new Error(`dispatch_cancel_http_${response.status}`);
      const cancellation = typeof response.json === 'function'
        ? await response.json() as { result?: { cancelled?: number; status?: string } }
        : {};
      await get().refreshPendingDispatches(conversationId);
      const terminalOrAbsent = cancellation.result?.status === 'missing'
        || cancellation.result?.status === 'cancelled'
        || cancellation.result?.status === 'completed'
        || cancellation.result?.status === 'failed';
      if (
        idempotencyKey
        && terminalOrAbsent
      ) {
        const nextPending = { ...get().pendingDispatches };
        const remaining = ((nextPending[key] || []) as PendingDispatch[])
          .filter((item) => item.idempotencyKey !== idempotencyKey);
        if (remaining.length) nextPending[key] = remaining;
        else delete nextPending[key];
        set({ pendingDispatches: nextPending });
      } else if (!idempotencyKey) {
        const nextPending = { ...get().pendingDispatches };
        const remaining = ((nextPending[key] || []) as PendingDispatch[])
          .filter((item) => item.persistenceStatus !== 'failed');
        if (remaining.length) nextPending[key] = remaining;
        else delete nextPending[key];
        set({ pendingDispatches: nextPending });
      }
      if (
        idempotencyKey
        && (
          cancellation.result?.status === 'claimed'
          || ((get().pendingDispatches[key] || []) as PendingDispatch[])
            .some((item) => item.idempotencyKey === idempotencyKey)
        )
      ) {
        throw new Error('dispatch_not_cancellable');
      }
    },

    forceSendDispatch: async ({ agentId, prompt, referencedTaskId, conversationId: explicitConvId, queuedIdempotencyKey }: { agentId: string; prompt: string; referencedTaskId?: string; conversationId?: string; queuedIdempotencyKey?: string }) => {
      const conversationId = explicitConvId ?? get().selectedConversationId ?? '';
      if (conversationId) {
        await get().clearPendingDispatches(agentId, conversationId, queuedIdempotencyKey);
      }
      socket.emit('terminal:kill', { agentId, projectId: conversationId || get().selectedProjectId, force: true });
      get().completeStreamMessage(agentId);
      set((state: any) => ({
        agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
        activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
      }));
      setTimeout(() => {
        void get().dispatchToAgent({ agentId, prompt, referencedTaskId, conversationId });
      }, 500);
    },

    appendTerminalLog: (agentId: string, log: string) =>
      set((state: any) => ({
        terminalLogs: {
          ...state.terminalLogs,
          [agentId]: [...(state.terminalLogs[agentId] || []), log],
        },
      })),

    simulateCliExecution: async (taskId: string, prompt: string) => {
      const state = get();
      const task = state.tasks.find((t: any) => t.id === taskId);
      if (!task) return;
      const agentId = task.agentId;
      const conversationId = task.conversationId;
      const projectId = conversationId;
      const profile = state.getAgentRuntimeProfile(agentId);
      if (!profile) {
        console.warn(`[simulate] ${agentId} aborted: no runtime profile or enabled account for conversation ${conversationId}`);
        _recordNoRuntimeProfileAbort(conversationId, agentId);
        return;
      }

      const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const effectiveIds = profile.agent.accountIds;
      const resolvedEngine = profile.execution.engine;

      const simComposeKey = `${projectId}:${agentId}`;
      const conv = state.conversations.find((c: any) => c.id === conversationId);

      set((s: any) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'busy' },
        terminalLogs: { ...s.terminalLogs, [agentId]: [] },
        needsFullCompose: { ...s.needsFullCompose, [simComposeKey]: false },
        activeRunsByAgent: {
          ...s.activeRunsByAgent,
          [agentId]: { runId, taskId, conversationId, startedAt: new Date().toISOString(), activity: 'foreground' },
        },
      }));

      get().addEvent({
        conversationId,
        type: 'run.started',
        payload: { runId, agentId, taskId, engine: resolvedEngine },
      });

      socket.emit('terminal:start', {
        dispatchId: runId,
        projectId,
        taskId,
        conversationId,
        agentId,
        prompt,
        dispatchSource: 'workflow',
        dispatchIntent: 'implement',
        allowMockRunner: get().enableMockRunner,
        opencodeBridgeUrl: undefined,
        engine: resolvedEngine,
        runtimeId: profile.execution.runtimeId,
        accountIds: effectiveIds,
        accountId: profile.execution.accountId ?? '',
        projectPath: conv?.projectPath || undefined,
        useWorktree: conv?.useWorktree || undefined,
      });
    },

    ensureStreamMessage: (agentId: string, conversationId: string, invocationId?: string): string => {
      const existing = get().activeStreamMessageId[agentId];
      if (existing) {
        const existingConvId = get().activeStreamConversationId[agentId];
        const msgs = get().chatMessagesByConversation[existingConvId ?? conversationId] ?? [];
        if (msgs.some((m: any) => m.id === existing)) {
          _resetWatchdog(agentId);
          return existing;
        }
      }
      const id = `msg-${Date.now()}-${agentId}`;
      const stamp = new Date().toISOString();
      set((state: any) => ({
        activeStreamMessageId: { ...state.activeStreamMessageId, [agentId]: id },
        activeStreamConversationId: { ...state.activeStreamConversationId, [agentId]: conversationId },
        chatMessagesByConversation: {
          ...state.chatMessagesByConversation,
          [conversationId]: [
            ...(state.chatMessagesByConversation[conversationId] || []),
            { id, agentId, content: '', timestamp: stamp, conversationId, invocationId, isStreaming: true, toolEvents: [] },
          ],
        },
      }));
      _resetWatchdog(agentId);
      return id;
    },

    appendToStreamMessage: (messageId: string, patch: { content?: string; toolEvent?: any }) => {
      const agentEntry = Object.entries(get().activeStreamMessageId).find(([, id]) => id === messageId);
      const trackedConvId = agentEntry ? get().activeStreamConversationId[agentEntry[0]] : undefined;
      if (!trackedConvId) return;
      if (agentEntry) _resetWatchdog(agentEntry[0]);

      if (patch.content != null) {
        appendToStreamBuffer(messageId, patch.content);
        _scheduleFlush();
      }

      if (patch.toolEvent) {
        set((state: any) => {
          const convId = trackedConvId;
          const msgs = state.chatMessagesByConversation[convId];
          if (!msgs) return state;
          return {
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [convId]: msgs.map((m: any) => {
                if (m.id !== messageId) return m;
                return { ...m, toolEvents: [...(m.toolEvents ?? []), patch.toolEvent!] };
              }),
            },
          };
        });
      }
    },

    completeStreamMessage: (agentId: string) => {
      const activeId = get().activeStreamMessageId[agentId];
      if (!activeId) return;
      clearWatchdog(agentId);
      const trackedConvId = get().activeStreamConversationId[agentId];
      if (trackedConvId) {
        flushStreamBufferForMessage(activeId, trackedConvId, set);
      }
      set((state: any) => {
        const { [agentId]: _, ...restMsgIds } = state.activeStreamMessageId;
        const { [agentId]: __, ...restConvIds } = state.activeStreamConversationId;
        if (!trackedConvId) return { activeStreamMessageId: restMsgIds, activeStreamConversationId: restConvIds };
        const msgs = state.chatMessagesByConversation[trackedConvId];
        return {
          activeStreamMessageId: restMsgIds,
          activeStreamConversationId: restConvIds,
          chatMessagesByConversation: {
            ...state.chatMessagesByConversation,
            [trackedConvId]: msgs
              ? msgs.map((m: any) => m.id === activeId ? { ...m, isStreaming: false } : m)
              : msgs,
          },
        };
      });
    },

    cleanupStaleStreams: () => {
      const state = get();
      const updates: Record<string, any[]> = {};
      for (const [convId, msgs] of Object.entries(state.chatMessagesByConversation) as [string, any[]][]) {
        const hasStale = msgs.some((m: any) => m.isStreaming);
        if (hasStale) {
          updates[convId] = msgs.map((m: any) => m.isStreaming ? { ...m, isStreaming: false } : m);
        }
      }
      if (Object.keys(updates).length > 0) {
        set({ chatMessagesByConversation: { ...state.chatMessagesByConversation, ...updates } });
      }
      if (Object.keys(state.activeStreamMessageId).length > 0) {
        set({ activeStreamMessageId: {}, activeStreamConversationId: {} });
      }
    },
  };
};
