'use client';

import { io } from 'socket.io-client';
import type { DetectedRuntime } from '@/server/types';

// --- Shared socket instance ---
export const socket = io(undefined, { path: '/api/socketio', autoConnect: false });

// --- Stream watchdogs & buffer (module-level, shared across slice & socket listeners) ---

const STREAM_WATCHDOG_MS = 300_000;
const streamWatchdogs: Record<string, ReturnType<typeof setTimeout>> = {};
const streamWatchdogAgents: Record<string, string> = {};

const streamBuffer: Record<string, { content: string; thinking: string }> = {};
let bufferFlushScheduled = false;

type AgentRunStatus = 'idle' | 'busy' | 'background';
type ActiveAgentRun = {
  runId: string;
  taskId?: string;
  conversationId: string;
  startedAt: string;
  activity?: 'foreground' | 'awaiting_children';
};

export function streamIdentityKey(agentId: string, invocationId?: string): string {
  return invocationId ? `invocation:${invocationId}` : agentId;
}

function activeStreamKeysForAgent(state: any, agentId: string): string[] {
  return Object.entries(state.activeStreamMessageId)
    .filter(([key, messageId]) => {
      if (key === agentId) return true;
      const conversationId = state.activeStreamConversationId[key];
      return (state.chatMessagesByConversation[conversationId] ?? [])
        .some((message: any) => message.id === messageId && message.agentId === agentId);
    })
    .map(([key]) => key);
}

export function hasActiveStreamForAgent(
  state: any,
  agentId: string,
  excludingInvocationId?: string,
): boolean {
  const excludedKey = excludingInvocationId
    ? streamIdentityKey(agentId, excludingInvocationId)
    : undefined;
  return activeStreamKeysForAgent(state, agentId).some((key) => key !== excludedKey);
}

export function resetWatchdog(
  agentId: string,
  getState: () => any,
  setState: (partial: any) => void,
  invocationId?: string,
) {
  const streamKey = streamIdentityKey(agentId, invocationId);
  if (streamWatchdogs[streamKey]) clearTimeout(streamWatchdogs[streamKey]);
  streamWatchdogAgents[streamKey] = agentId;
  streamWatchdogs[streamKey] = setTimeout(() => {
    const state = getState();
    if (state.activeRunsByAgent[agentId]?.activity === 'awaiting_children') {
      delete streamWatchdogs[streamKey];
      delete streamWatchdogAgents[streamKey];
      return;
    }
    if (state.activeStreamMessageId[streamKey]) {
      console.warn(`[watchdog] Stream for ${streamKey} timed out after ${STREAM_WATCHDOG_MS / 1000}s, auto-completing`);
      getState().completeStreamMessage(agentId, invocationId);
      if (activeStreamKeysForAgent(getState(), agentId).length === 0) {
        setState((s: any) => ({
          agentStatus: { ...s.agentStatus, [agentId]: 'idle' },
          activeRunsByAgent: { ...s.activeRunsByAgent, [agentId]: undefined },
        }));
      }
    }
    delete streamWatchdogs[streamKey];
    delete streamWatchdogAgents[streamKey];
  }, STREAM_WATCHDOG_MS);
}

export function clearWatchdog(agentId: string, invocationId?: string) {
  const keys = [streamIdentityKey(agentId, invocationId)];
  for (const key of keys) {
    if (!streamWatchdogs[key]) continue;
    clearTimeout(streamWatchdogs[key]);
    delete streamWatchdogs[key];
    delete streamWatchdogAgents[key];
  }
}

export function clearAllWatchdogs(agentId: string) {
  const keys = Object.keys(streamWatchdogs)
    .filter((key) => streamWatchdogAgents[key] === agentId || key === agentId);
  for (const key of keys) {
    clearTimeout(streamWatchdogs[key]);
    delete streamWatchdogs[key];
    delete streamWatchdogAgents[key];
  }
}

function scheduleBufferFlush(getState: () => any, setState: (partial: any) => void) {
  if (bufferFlushScheduled) return;
  bufferFlushScheduled = true;
  requestAnimationFrame(() => {
    bufferFlushScheduled = false;
    const state = getState();
    const entries = Object.entries(streamBuffer);
    for (const [messageId, pending] of entries) {
      if (!pending.content && !pending.thinking) continue;
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
              m.id === messageId ? {
                ...m,
                content: m.content + pending.content,
                thinking: (m.thinking ?? '') + pending.thinking,
              } : m
            ),
          },
        };
      });
    }
  });
}

function flushStreamBufferForMessage(
  messageId: string,
  conversationId: string,
  setState: (partial: any) => void,
) {
  const pending = streamBuffer[messageId];
  if (!pending || (!pending.content && !pending.thinking)) return;
  delete streamBuffer[messageId];
  setState((s: any) => {
    const msgs = s.chatMessagesByConversation[conversationId];
    if (!msgs) return s;
    return {
      chatMessagesByConversation: {
        ...s.chatMessagesByConversation,
        [conversationId]: msgs.map((m: any) =>
          m.id === messageId ? {
            ...m,
            content: m.content + pending.content,
            thinking: (m.thinking ?? '') + pending.thinking,
          } : m
        ),
      },
    };
  });
}

function appendToStreamBuffer(messageId: string, patch: { content?: string; thinking?: string }) {
  const pending = streamBuffer[messageId] ?? { content: '', thinking: '' };
  streamBuffer[messageId] = {
    content: pending.content + (patch.content ?? ''),
    thinking: pending.thinking + (patch.thinking ?? ''),
  };
}

// --- Daemon Slice Creator ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- set/get typed as any to avoid circular dependency with TaskHubState
export const createDaemonSlice = (set: any, get: () => any) => {
  const _resetWatchdog = (agentId: string, invocationId?: string) => (
    resetWatchdog(agentId, get, set, invocationId)
  );
  const _scheduleFlush = () => scheduleBufferFlush(get, set);

  return {
    daemonConnection: { status: 'disconnected' as 'disconnected' | 'connecting' | 'connected', error: undefined as string | undefined },
    setDaemonConnection: (next: { status: 'disconnected' | 'connecting' | 'connected'; error?: string }) => set({ daemonConnection: next }),

    daemonRuntimes: [] as DetectedRuntime[],
    setDaemonRuntimes: (runtimes: DetectedRuntime[]) => set({ daemonRuntimes: runtimes }),

    terminalLogs: {} as Record<string, string[]>,
    agentStatus: {} as Record<string, AgentRunStatus>,
    activeRunsByAgent: {} as Record<string, ActiveAgentRun | undefined>,
    activeStreamMessageId: {} as Record<string, string>,
    activeStreamConversationId: {} as Record<string, string>,
    agentSessions: { default: {} } as Record<string, Record<string, string | undefined>>,
    needsFullCompose: {} as Record<string, boolean>,

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

    appendTerminalLog: (agentId: string, log: string) =>
      set((state: any) => ({
        terminalLogs: {
          ...state.terminalLogs,
          [agentId]: [...(state.terminalLogs[agentId] || []), log],
        },
      })),

    ensureStreamMessage: (agentId: string, conversationId: string, invocationId?: string): string => {
      const streamKey = streamIdentityKey(agentId, invocationId);
      const existing = get().activeStreamMessageId[streamKey];
      if (existing) {
        const existingConvId = get().activeStreamConversationId[streamKey];
        const msgs = get().chatMessagesByConversation[existingConvId ?? conversationId] ?? [];
        if (msgs.some((m: any) => m.id === existing)) {
          _resetWatchdog(agentId, invocationId);
          return existing;
        }
      }
      const id = `msg-${Date.now()}-${agentId}-${Math.random().toString(36).slice(2, 7)}`;
      const stamp = new Date().toISOString();
      set((state: any) => ({
        activeStreamMessageId: { ...state.activeStreamMessageId, [streamKey]: id },
        activeStreamConversationId: { ...state.activeStreamConversationId, [streamKey]: conversationId },
        chatMessagesByConversation: {
          ...state.chatMessagesByConversation,
          [conversationId]: [
            ...(state.chatMessagesByConversation[conversationId] || []),
            { id, agentId, content: '', thinking: '', contentType: 'text', timestamp: stamp, conversationId, invocationId, isStreaming: true, toolEvents: [] },
          ],
        },
      }));
      _resetWatchdog(agentId, invocationId);
      return id;
    },

    appendToStreamMessage: (messageId: string, patch: { content?: string; thinking?: string; toolEvent?: any }) => {
      const agentEntry = Object.entries(get().activeStreamMessageId).find(([, id]) => id === messageId);
      const trackedConvId = agentEntry ? get().activeStreamConversationId[agentEntry[0]] : undefined;
      if (!trackedConvId) return;
      if (agentEntry) {
        const message = (get().chatMessagesByConversation[trackedConvId] ?? [])
          .find((candidate: any) => candidate.id === messageId);
        if (message) _resetWatchdog(message.agentId, message.invocationId);
      }

      if (patch.content != null || patch.thinking != null) {
        appendToStreamBuffer(messageId, patch);
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

    completeStreamMessage: (agentId: string, invocationId?: string) => {
      const state = get();
      const exactKey = invocationId ? streamIdentityKey(agentId, invocationId) : undefined;
      const streamKeys = exactKey
        ? (state.activeStreamMessageId[exactKey] ? [exactKey] : [])
        : (state.activeStreamMessageId[agentId] ? [agentId] : []);
      if (streamKeys.length === 0) return;
      clearWatchdog(agentId, invocationId);
      for (const key of streamKeys) {
        const messageId = state.activeStreamMessageId[key];
        const conversationId = state.activeStreamConversationId[key];
        if (messageId && conversationId) flushStreamBufferForMessage(messageId, conversationId, set);
      }
      set((state: any) => {
        const restMsgIds = { ...state.activeStreamMessageId };
        const restConvIds = { ...state.activeStreamConversationId };
        const completedIds = new Set<string>();
        for (const key of streamKeys) {
          if (restMsgIds[key]) completedIds.add(restMsgIds[key]);
          delete restMsgIds[key];
          delete restConvIds[key];
        }
        const changedConversations = new Set(
          streamKeys.map((key) => state.activeStreamConversationId[key]).filter(Boolean),
        );
        const messages = { ...state.chatMessagesByConversation };
        for (const conversationId of changedConversations) {
          messages[conversationId] = (messages[conversationId] ?? []).map((message: any) => (
            completedIds.has(message.id) ? { ...message, isStreaming: false } : message
          ));
        }
        return {
          activeStreamMessageId: restMsgIds,
          activeStreamConversationId: restConvIds,
          chatMessagesByConversation: messages,
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
