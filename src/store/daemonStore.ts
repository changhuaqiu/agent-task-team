'use client';

import { io } from 'socket.io-client';
import type { DetectedRuntime, CliEngine } from '@/server/types';
import { composeSystemPrompt, composeUserPrompt } from '@/lib/agent-context/PromptComposer';
import type { ComposeOptions } from '@/lib/agent-context/PromptComposer';
import { resolveAgentEngine } from './agentStore';
import type { Agent } from './agentStore';

// --- Shared socket instance ---
export const socket = io(undefined, { path: '/api/socketio', autoConnect: false });

// --- Stream watchdogs & buffer (module-level, shared across slice & socket listeners) ---

const STREAM_WATCHDOG_MS = 300_000;
const streamWatchdogs: Record<string, ReturnType<typeof setTimeout>> = {};

const streamBuffer: Record<string, string> = {};
let bufferFlushScheduled = false;

export function resetWatchdog(agentId: string, getState: () => any, setState: (partial: any) => void) {
  if (streamWatchdogs[agentId]) clearTimeout(streamWatchdogs[agentId]);
  streamWatchdogs[agentId] = setTimeout(() => {
    const state = getState();
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

export function appendToStreamBuffer(messageId: string, content: string) {
  streamBuffer[messageId] = (streamBuffer[messageId] || '') + content;
}

// --- Daemon Slice Creator ---

export interface PendingDispatch {
  prompt: string;
  referencedTaskId?: string;
  queuedAt: string;
  source?: 'user' | 'a2a';
  fromAgentId?: string;
  conversationId: string;
}

/** Composite key for per-project queue isolation: agentId:conversationId */
function queueKey(agentId: string, conversationId: string): string {
  return `${agentId}:${conversationId}`;
}

export const createDaemonSlice = (set: any, get: () => any) => {
  const _resetWatchdog = (agentId: string) => resetWatchdog(agentId, get, set);
  const _scheduleFlush = () => scheduleBufferFlush(get, set);

  return {
    daemonConnection: { status: 'disconnected' as 'disconnected' | 'connecting' | 'connected', error: undefined as string | undefined },
    setDaemonConnection: (next: { status: 'disconnected' | 'connecting' | 'connected'; error?: string }) => set({ daemonConnection: next }),

    daemonRuntimes: [] as DetectedRuntime[],
    setDaemonRuntimes: (runtimes: DetectedRuntime[]) => set({ daemonRuntimes: runtimes }),

    enableMockRunner: false as boolean,
    setEnableMockRunner: (enabled: boolean) => set({ enableMockRunner: enabled }),

    terminalLogs: {} as Record<string, string[]>,
    agentStatus: {} as Record<string, 'idle' | 'busy'>,
    activeRunsByAgent: {} as Record<string, { runId: string; taskId?: string; conversationId: string; startedAt: string } | undefined>,
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

    dispatchToAgent: ({ agentId, prompt, referencedTaskId, source, fromAgentId, conversationId: explicitConvId }: { agentId: string; prompt: string; referencedTaskId?: string; source?: 'user' | 'a2a'; fromAgentId?: string; conversationId?: string }) => {
      const conversationId =
        explicitConvId ??
        (referencedTaskId ? get().getTaskById(referencedTaskId)?.conversationId : undefined) ??
        get().selectedConversationId;
      if (!conversationId) {
        console.warn(`[dispatch] ${agentId} aborted: no conversationId`);
        return;
      }

      if (get().agentStatus[agentId] === 'busy') {
        console.log(`[dispatch] ${agentId} busy, enqueuing for conversation ${conversationId}`);
        get().enqueueDispatch(agentId, { prompt, referencedTaskId, source, fromAgentId, conversationId });
        return;
      }
      const projectId = get().selectedProjectId;
      const sessionId = get().agentSessions[projectId]?.[agentId];
      const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const profile = get().getAgentRuntimeProfile(agentId);
      const agent = profile?.agent;
      const effectiveIds = profile?.accountIds ?? [];
      const resolvedBinding = agent ? resolveAgentEngine({ ...agent, accountIds: effectiveIds }, get().accounts) : null;
      const agentEngine = agent?.cliEngine ?? 'opencode';
      const resolvedEngine = resolvedBinding?.engine ?? agentEngine;

      console.log(`[dispatch] ${agentId} → engine=${resolvedEngine}, accountId=${resolvedBinding?.accountId ?? '(none)'}, convId=${conversationId}`);

      const roleCard = profile?.roleCard;
      const conv = get().conversations.find((c: any) => c.id === conversationId);
      const task = referencedTaskId ? get().getTaskById(referencedTaskId) : undefined;
      const phase = task?.phaseId ? get().phases.find((p: any) => p.id === task.phaseId) : undefined;

      const composeKey = `${projectId}:${agentId}`;
      const isFirstWake = get().needsFullCompose[composeKey] !== false;

      const composeOpts: ComposeOptions = {
        agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
        roleCard,
        allRoleCards: get().roleCards,
        project: { name: conv?.title ?? '', path: conv?.projectPath ?? '' },
        isFirstWake,
        messages: get().chatMessagesByConversation[conversationId] ?? [],
        task: task ? {
          id: task.id, title: task.title,
          description: task.description,
          phase: phase ? { title: phase.title } : undefined,
        } : undefined,
        rawPrompt: prompt,
        currentLoad: Object.fromEntries(
          get().getEffectiveRoster().map((rosterAgent: Agent) => [
            rosterAgent.id,
            get().tasks.filter(
              (t: any) =>
                t.agentId === rosterAgent.id &&
                (t.status === 'in_progress' || t.status === 'pending'),
            ).length,
          ]),
        ),
        tasks: get().tasks
          .filter((t: any) => t.conversationId === conversationId)
          .map((t: any) => ({
            id: t.id,
            title: t.title,
            agentId: t.agentId,
            status: t.status,
          })),
        skills: get().getSkillsForAgent(agentId),
        a2a: source === 'a2a' && fromAgentId ? {
          from: fromAgentId,
          content: prompt,
        } : undefined,
        teamPack: (() => {
          if (!conv?.teamPackId) return undefined;
          try {
            const { useTeamPackStore } = require('./teamPackStore');
            return useTeamPackStore.getState().teamPacks.find((p: any) => p.id === conv.teamPackId);
          } catch {
            return undefined;
          }
        })(),
      };

      const systemPrompt = composeSystemPrompt(composeOpts);
      const effectivePrompt = composeUserPrompt(composeOpts);

      console.log(`[dispatch] ${agentId} isFirstWake=${composeOpts.isFirstWake}, systemPrompt=${systemPrompt ? `${systemPrompt.length} chars` : 'undefined'}, roleCard=${composeOpts.roleCard?.id ?? '(none)'}`);

      set((state: any) => ({
        agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
        terminalLogs: { ...state.terminalLogs, [agentId]: [] },
        needsFullCompose: { ...state.needsFullCompose, [composeKey]: false },
        activeRunsByAgent: {
          ...state.activeRunsByAgent,
          [agentId]: { runId, taskId: referencedTaskId, conversationId, startedAt: new Date().toISOString() },
        },
      }));

      get().addEvent({
        conversationId,
        type: 'run.started',
        payload: { runId, agentId, taskId: referencedTaskId, engine: resolvedEngine },
      });

      socket.emit('terminal:start', {
        projectId,
        taskId: referencedTaskId,
        conversationId,
        agentId,
        prompt: effectivePrompt,
        systemPrompt,
        sessionId,
        allowMockRunner: get().enableMockRunner,
        opencodeBridgeUrl: undefined,
        engine: resolvedEngine,
        accountIds: effectiveIds,
        accountId: resolvedBinding?.accountId ?? '',
      });
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
          payload: { agentId, prompt: payload.prompt, referencedTaskId: payload.referencedTaskId },
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
      get().dispatchToAgent({
        agentId,
        prompt: next.prompt,
        referencedTaskId: next.referencedTaskId,
        source: next.source,
        fromAgentId: next.fromAgentId,
        conversationId: nextConvId,
      });
    },

    clearPendingDispatches: (agentId: string, conversationId: string) => {
      const key = queueKey(agentId, conversationId);
      const nextPending = { ...get().pendingDispatches };
      delete nextPending[key];
      set({ pendingDispatches: nextPending });
    },

    forceSendDispatch: ({ agentId, prompt, referencedTaskId, conversationId: explicitConvId }: { agentId: string; prompt: string; referencedTaskId?: string; conversationId?: string }) => {
      const conversationId = explicitConvId ?? get().selectedConversationId ?? '';
      socket.emit('terminal:kill', { agentId, projectId: get().selectedProjectId, force: true });
      if (conversationId) get().clearPendingDispatches(agentId, conversationId);
      get().completeStreamMessage(agentId);
      set((state: any) => ({
        agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
        activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
      }));
      setTimeout(() => {
        get().dispatchToAgent({ agentId, prompt, referencedTaskId, conversationId });
      }, 500);
    },

    appendTerminalLog: (agentId: string, log: string) =>
      set((state: any) => ({
        terminalLogs: {
          ...state.terminalLogs,
          [agentId]: [...(state.terminalLogs[agentId] || []), log],
        },
      })),

    simulateCliExecution: (taskId: string, prompt: string, sessionId?: string) => {
      const state = get();
      const projectId = state.selectedProjectId;
      const task = state.tasks.find((t: any) => t.id === taskId);
      if (!task) return;
      const agentId = task.agentId;
      const resolvedSessionId = sessionId || state.agentSessions[projectId]?.[agentId];
      const conversationId = task.conversationId;
      const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const profile = state.getAgentRuntimeProfile(agentId);
      const agent = profile?.agent;
      const effectiveIds = profile?.accountIds ?? [];
      const resolvedBinding = agent ? resolveAgentEngine({ ...agent, accountIds: effectiveIds }, state.accounts) : null;
      const agentEngine = agent?.cliEngine ?? 'opencode';
      const resolvedEngine = resolvedBinding?.engine ?? agentEngine;

      const simRoleCard = profile?.roleCard;
      const simComposeKey = `${projectId}:${agentId}`;
      const simIsFirstWake = state.needsFullCompose[simComposeKey] !== false;

      const simOpts: ComposeOptions = {
        agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
        roleCard: simRoleCard,
        allRoleCards: state.roleCards,
        project: { name: '', path: '' },
        isFirstWake: simIsFirstWake,
        rawPrompt: prompt,
        skills: state.getSkillsForAgent(agentId),
      };

      const systemPrompt = composeSystemPrompt(simOpts);

      set((s: any) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'busy' },
        terminalLogs: { ...s.terminalLogs, [agentId]: [] },
        needsFullCompose: { ...s.needsFullCompose, [simComposeKey]: false },
        activeRunsByAgent: {
          ...s.activeRunsByAgent,
          [agentId]: { runId, taskId, conversationId, startedAt: new Date().toISOString() },
        },
      }));

      get().addEvent({
        conversationId,
        type: 'run.started',
        payload: { runId, agentId, taskId, engine: resolvedEngine },
      });

      socket.emit('terminal:start', {
        projectId,
        taskId,
        agentId,
        prompt,
        systemPrompt,
        sessionId: resolvedSessionId,
        allowMockRunner: get().enableMockRunner,
        opencodeBridgeUrl: undefined,
        engine: resolvedEngine,
        accountIds: effectiveIds,
        accountId: resolvedBinding?.accountId ?? '',
      });
    },

    ensureStreamMessage: (agentId: string, conversationId: string): string => {
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
            { id, agentId, content: '', timestamp: stamp, isStreaming: true, toolEvents: [] },
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
