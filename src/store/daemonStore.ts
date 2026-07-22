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

/** UI runtime state must never collapse the same agent across conversations. */
export function agentRuntimeKey(conversationId: string, agentId: string): string {
  return `${conversationId}\0${agentId}`;
}

export function getAgentStatusForConversation(
  state: { agentStatus: Record<string, AgentRunStatus | undefined> },
  conversationId: string,
  agentId: string,
): AgentRunStatus | undefined {
  return state.agentStatus[agentRuntimeKey(conversationId, agentId)] ?? state.agentStatus[agentId];
}

export function getActiveRunForConversation(
  state: { activeRunsByAgent: Record<string, ActiveAgentRun | undefined> },
  conversationId: string,
  agentId: string,
): ActiveAgentRun | undefined {
  const scoped = state.activeRunsByAgent[agentRuntimeKey(conversationId, agentId)];
  if (scoped) return scoped;
  const legacy = state.activeRunsByAgent[agentId];
  return legacy?.conversationId === conversationId ? legacy : undefined;
}

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

export function resetWatchdog(
  agentId: string,
  conversationId: string,
  getState: () => any,
  setState: (partial: any) => void,
) {
  const scopeKey = agentRuntimeKey(conversationId, agentId);
  if (streamWatchdogs[scopeKey]) clearTimeout(streamWatchdogs[scopeKey]);
  streamWatchdogs[scopeKey] = setTimeout(() => {
    const state = getState();
    if (getActiveRunForConversation(state, conversationId, agentId)?.activity === 'awaiting_children') {
      delete streamWatchdogs[scopeKey];
      return;
    }
    if (state.activeStreamMessageId[scopeKey]) {
      console.warn(`[watchdog] Stream for ${conversationId}/${agentId} timed out after ${STREAM_WATCHDOG_MS / 1000}s, auto-completing`);
      setState((s: any) => ({
        agentStatus: { ...s.agentStatus, [scopeKey]: 'idle' },
        activeRunsByAgent: { ...s.activeRunsByAgent, [scopeKey]: undefined },
      }));
      getState().completeStreamMessage(agentId, conversationId);
    }
    delete streamWatchdogs[scopeKey];
  }, STREAM_WATCHDOG_MS);
}

export function clearWatchdog(agentId: string, conversationId: string) {
  const scopeKey = agentRuntimeKey(conversationId, agentId);
  if (streamWatchdogs[scopeKey]) {
    clearTimeout(streamWatchdogs[scopeKey]);
    delete streamWatchdogs[scopeKey];
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
  prompt: string;
  referencedTaskId?: string;
  queuedAt: string;
  source?: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';
  fromAgentId?: string;
  conversationId: string;
}

type InFlightDispatch = Omit<PendingDispatch, 'queuedAt'>;

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
  const _resetWatchdog = (agentId: string, conversationId: string) =>
    resetWatchdog(agentId, conversationId, get, set);
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
      fetch('/api/daemon/init')
        .catch((e: any) => {
          get().setDaemonConnection({ status: 'disconnected', error: String((e as any)?.message || e) });
        })
        .finally(() => socket.connect());
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

    dispatchToAgent: async ({ agentId, prompt, referencedTaskId, source, fromAgentId, conversationId: explicitConvId, chainId, passId }: { agentId: string; prompt: string; referencedTaskId?: string; source?: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system'; fromAgentId?: string; conversationId?: string; chainId?: string; passId?: string }) => {
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

      const scopeKey = agentRuntimeKey(conversationId, agentId);
      const scopedStatus = getAgentStatusForConversation(get(), conversationId, agentId);
      if (scopedStatus && scopedStatus !== 'idle') {
        console.log(`[dispatch] ${agentId} busy, enqueuing for conversation ${conversationId}`);
        get().enqueueDispatch(agentId, { prompt, referencedTaskId, source, fromAgentId, conversationId });
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
        agentStatus: { ...state.agentStatus, [scopeKey]: 'busy' },
        terminalLogs: { ...state.terminalLogs, [scopeKey]: [] },
        needsFullCompose: { ...state.needsFullCompose, [composeKey]: false },
        activeRunsByAgent: {
          ...state.activeRunsByAgent,
          [scopeKey]: { runId, taskId: referencedTaskId, conversationId, startedAt: new Date().toISOString(), activity: 'foreground' },
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

    enqueueDispatch: (agentId: string, payload: Omit<PendingDispatch, 'queuedAt'>) => {
      const conversationId = payload.conversationId
        ?? (payload.referencedTaskId ? get().getTaskById(payload.referencedTaskId)?.conversationId : undefined)
        ?? get().selectedConversationId;
      if (!conversationId) return;

      const entry: PendingDispatch = { ...payload, queuedAt: new Date().toISOString(), conversationId };
      const key = queueKey(agentId, conversationId);

      set((state: any) => ({
        pendingDispatches: {
          ...state.pendingDispatches,
          [key]: [...(state.pendingDispatches[key] || []), entry],
        },
      }));

      fetch('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'dispatch.enqueue',
          payload: { agentId, conversationId, prompt: payload.prompt, referencedTaskId: payload.referencedTaskId },
        }),
      }).catch(() => {});
    },

    dequeueNextPending: (agentId: string, conversationId: string) => {
      const key = queueKey(agentId, conversationId);
      const queue = get().pendingDispatches[key];
      if (!queue || queue.length === 0) return;
      const [next, ...rest] = queue;
      const nextPending = { ...get().pendingDispatches };
      if (rest.length > 0) {
        nextPending[key] = rest;
      } else {
        delete nextPending[key];
      }
      set({ pendingDispatches: nextPending });
      const nextConvId = next.conversationId
        ?? (next.referencedTaskId ? get().getTaskById(next.referencedTaskId)?.conversationId : undefined)
        ?? get().selectedConversationId;
      if (nextConvId) {
        set((state: any) => ({
          chatMessagesByConversation: {
            ...state.chatMessagesByConversation,
            [nextConvId]: [
              ...(state.chatMessagesByConversation[nextConvId] || []),
              {
                id: `msg-${Date.now()}`,
                agentId: next.source === 'a2a' ? (next.fromAgentId ?? 'system') : 'human',
                content: next.prompt,
                referencedTaskId: next.referencedTaskId,
                timestamp: new Date().toISOString(),
                mentions: [agentId],
                intent: 'general' as const,
                source: next.source ?? 'user',
                fromAgentId: next.fromAgentId,
              },
            ],
          },
        }));
      }
      const accepted = get().dispatchToAgent({
        agentId,
        prompt: next.prompt,
        referencedTaskId: next.referencedTaskId,
        source: next.source,
        fromAgentId: next.fromAgentId,
        conversationId: nextConvId,
      });
      if (accepted && next.source !== 'a2a' && nextConvId) {
        socket.emit('a2a:user-turn-created', {
          conversationId: nextConvId,
          messageId: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          targetAgentIds: [agentId],
          prompt: next.prompt,
          taskId: next.referencedTaskId,
        });
      }
    },

    clearPendingDispatches: (agentId: string, conversationId: string) => {
      const key = queueKey(agentId, conversationId);
      const nextPending = { ...get().pendingDispatches };
      delete nextPending[key];
      set({ pendingDispatches: nextPending });
    },

    forceSendDispatch: ({ agentId, prompt, referencedTaskId, conversationId: explicitConvId }: { agentId: string; prompt: string; referencedTaskId?: string; conversationId?: string }) => {
      const conversationId = explicitConvId ?? get().selectedConversationId ?? '';
      const scopeKey = agentRuntimeKey(conversationId, agentId);
      socket.emit('terminal:kill', { agentId, projectId: conversationId || get().selectedProjectId, force: true });
      if (conversationId) get().clearPendingDispatches(agentId, conversationId);
      get().completeStreamMessage(agentId, conversationId);
      set((state: any) => ({
        agentStatus: { ...state.agentStatus, [scopeKey]: 'idle' },
        activeRunsByAgent: { ...state.activeRunsByAgent, [scopeKey]: undefined },
      }));
      setTimeout(() => {
        get().dispatchToAgent({ agentId, prompt, referencedTaskId, conversationId });
      }, 500);
    },

    appendTerminalLog: (agentId: string, log: string, conversationId?: string) => {
      const resolvedConversationId = conversationId ?? get().selectedConversationId ?? 'default';
      const scopeKey = agentRuntimeKey(resolvedConversationId, agentId);
      set((state: any) => ({
        terminalLogs: {
          ...state.terminalLogs,
          [scopeKey]: [...(state.terminalLogs[scopeKey] || []), log],
        },
      }));
    },

    simulateCliExecution: async (taskId: string, prompt: string) => {
      const state = get();
      const task = state.tasks.find((t: any) => t.id === taskId);
      if (!task) return;
      const agentId = task.agentId;
      const conversationId = task.conversationId;
      const scopeKey = agentRuntimeKey(conversationId, agentId);
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
        agentStatus: { ...s.agentStatus, [scopeKey]: 'busy' },
        terminalLogs: { ...s.terminalLogs, [scopeKey]: [] },
        needsFullCompose: { ...s.needsFullCompose, [simComposeKey]: false },
        activeRunsByAgent: {
          ...s.activeRunsByAgent,
          [scopeKey]: { runId, taskId, conversationId, startedAt: new Date().toISOString(), activity: 'foreground' },
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
      const scopeKey = agentRuntimeKey(conversationId, agentId);
      const existing = get().activeStreamMessageId[scopeKey];
      if (existing) {
        const existingConvId = get().activeStreamConversationId[scopeKey];
        const msgs = get().chatMessagesByConversation[existingConvId ?? conversationId] ?? [];
        if (msgs.some((m: any) => m.id === existing)) {
          _resetWatchdog(agentId, conversationId);
          return existing;
        }
      }
      const id = `msg-${Date.now()}-${conversationId}-${agentId}`;
      const stamp = new Date().toISOString();
      set((state: any) => ({
        activeStreamMessageId: { ...state.activeStreamMessageId, [scopeKey]: id },
        activeStreamConversationId: { ...state.activeStreamConversationId, [scopeKey]: conversationId },
        chatMessagesByConversation: {
          ...state.chatMessagesByConversation,
          [conversationId]: [
            ...(state.chatMessagesByConversation[conversationId] || []),
            { id, agentId, content: '', timestamp: stamp, conversationId, invocationId, isStreaming: true, toolEvents: [] },
          ],
        },
      }));
      _resetWatchdog(agentId, conversationId);
      return id;
    },

    appendToStreamMessage: (messageId: string, patch: { content?: string; toolEvent?: any }) => {
      const agentEntry = Object.entries(get().activeStreamMessageId).find(([, id]) => id === messageId);
      const trackedConvId = agentEntry ? get().activeStreamConversationId[agentEntry[0]] : undefined;
      if (!trackedConvId) return;
      if (agentEntry) {
        const streamKey = agentEntry[0];
        const convId = get().activeStreamConversationId[streamKey];
        const streamAgentId = streamKey.slice(streamKey.indexOf('\0') + 1);
        if (convId) _resetWatchdog(streamAgentId, convId);
      }

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

    completeStreamMessage: (agentId: string, conversationId?: string) => {
      const resolvedConversationId = conversationId ?? get().selectedConversationId;
      const scopeKey = resolvedConversationId
        ? agentRuntimeKey(resolvedConversationId, agentId)
        : Object.keys(get().activeStreamMessageId).find((key) => key.endsWith(`\0${agentId}`));
      if (!scopeKey) return;
      const activeId = get().activeStreamMessageId[scopeKey];
      if (!activeId) return;
      const trackedConvId = get().activeStreamConversationId[scopeKey];
      if (trackedConvId) clearWatchdog(agentId, trackedConvId);
      if (trackedConvId) {
        flushStreamBufferForMessage(activeId, trackedConvId, set);
      }
      set((state: any) => {
        const { [scopeKey]: _, ...restMsgIds } = state.activeStreamMessageId;
        const { [scopeKey]: __, ...restConvIds } = state.activeStreamConversationId;
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
