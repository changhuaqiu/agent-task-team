'use client';

import { io } from 'socket.io-client';
import type { DetectedRuntime } from '@/server/types';

// --- Shared socket instance ---
export const socket = io(undefined, { path: '/api/socketio', autoConnect: false });

// --- Stream watchdogs & buffer (module-level, shared across slice & socket listeners) ---

const STREAM_WATCHDOG_MS = 300_000;
const streamWatchdogs: Record<string, ReturnType<typeof setTimeout>> = {};

const streamBuffer: Record<string, string> = {};
let bufferFlushScheduled = false;

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

function scheduleBufferFlush(getState: () => any, setState: (partial: any) => void) {
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

function flushStreamBufferForMessage(
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

function appendToStreamBuffer(messageId: string, content: string) {
  streamBuffer[messageId] = (streamBuffer[messageId] || '') + content;
}

// --- Daemon Slice Creator ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- set/get typed as any to avoid circular dependency with TaskHubState
export const createDaemonSlice = (set: any, get: () => any) => {
  const _resetWatchdog = (agentId: string) => resetWatchdog(agentId, get, set);
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
