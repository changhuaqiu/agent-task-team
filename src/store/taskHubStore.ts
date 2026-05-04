'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';

// Sub-store slice creators
import { createTaskSlice } from './taskStore';
import type { TaskStatus, Task } from './taskStore';
import { setTaskCounter, STATUS_LABELS, STATUS_ORDER } from './taskStore';
import { createAgentSlice, AGENT_ROSTER } from './agentStore';
import { loadAgents } from './agentStore';
import type { Account } from './agentStore';
import { createDaemonSlice } from './daemonStore';
import { socket, resetWatchdog, clearWatchdog } from './daemonStore';
import type { PendingDispatch } from './daemonStore';
import type { RoleCard } from '@/types/roleCard';
import type { Phase } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
import type { SkillSummary } from '@/lib/agent-context/PromptComposer';
import type { DetectedRuntime, CliEngine } from '@/server/types';
import type { ChatMessage, ToolEvent } from './types';
export type { ChatMessage, ToolEvent } from './types';

// Re-export types from sub-stores (backward compatibility)
export type { CliEngine, DetectedRuntime } from '@/server/types';
export type { TaskStatus } from './taskStore';
export type { Task, TaskArtifact } from './taskStore';
export { STATUS_LABELS, STATUS_ORDER } from './taskStore';
export type { AgentRole, AgentTheme, Agent } from './agentStore';
export { AGENT_ROSTER, loadAgents, PROVIDER_TO_ENGINE, PROVIDER_LABELS, PROVIDER_OPTIONS, MODEL_SUGGESTIONS, providerToEngine, resolveAgentEngine } from './agentStore';
export type { AccountProvider, AccountAuthMode, Account } from './agentStore';
export type { PendingDispatch } from './daemonStore';

// --- Types that remain in this module ---

export type ProjectId = 'default' | (string & {});

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export interface DispatchToAgentInput {
  agentId: string;
  prompt: string;
  referencedTaskId?: string;
  accountIds?: string[];
}

export type TeamRole = 'dev' | 'ux' | 'qa' | 'arch';

export interface Conversation {
  id: string;
  title: string;
  goal: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  projectPath: string;
  breakdownStatus: 'none' | 'proposal' | 'confirmed' | 'no_account';
  createdAt: string;
  updatedAt: string;
}

export type SupervisorOutputKind =
  | 'decision_brief'
  | 'execution_plan'
  | 'status_report'
  | 'quality_review_pack';

export interface SupervisorHumanAction {
  actionId: string;
  label: string;
  options?: { id: string; label: string }[];
}

export interface SupervisorOutputEnvelope {
  kind: SupervisorOutputKind;
  conversationId: string;
  invocationId: string;
  timestamp: string;
  summary: string;
  needsHuman: boolean;
  humanActions: SupervisorHumanAction[];
  body: unknown;
}

export type InternalEventType =
  | 'conversation.created'
  | 'conversation.updated'
  | 'task.status_changed'
  | 'run.started'
  | 'run.finished'
  | 'gate.result'
  | 'blocker.opened'
  | 'blocker.fixed'
  | 'artifact.added'
  | 'routing.hint_emitted'
  | 'supervisor.output'
  | 'invocation.started'
  | 'invocation.finished'
  | 'invocation.aborted'
  | 'invocation.worklist_pushed'
  | 'invocation.worklist_skipped';

export interface InternalEvent {
  id: string;
  conversationId: string;
  type: InternalEventType;
  timestamp: string;
  payload?: unknown;
}

export interface Blocker {
  id: string;
  conversationId: string;
  taskId: string;
  type: 'gate_fail' | 'execution_failure' | 'timeout' | 'manual';
  gateId?: 'lint' | 'typecheck' | 'unit' | 'build' | 'e2e' | 'security';
  reasonSummary: string;
  evidenceRef?: string;
  status: 'open' | 'fixed';
  createdAt: string;
  resolvedAt?: string;
}

// --- Helper Selectors ---

const selectActiveAgents = (state: TaskHubState) =>
  AGENT_ROSTER.filter((a) => state.activeAgentIds.includes(a.id));

const selectAvailableRoster = (state: TaskHubState) =>
  AGENT_ROSTER.filter((a) => !state.activeAgentIds.includes(a.id));

const selectPendingCount = (state: TaskHubState) => {
  const counts: Record<string, number> = {};
  for (const [agentId, queue] of Object.entries(state.pendingDispatches)) {
    if (queue && queue.length > 0) counts[agentId] = queue.length;
  }
  return counts;
};

// --- Helpers for server hydration ---
const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const EMPTY_EVENTS: InternalEvent[] = [];
const EMPTY_BLOCKERS: Blocker[] = [];
const EMPTY_CHAT: ChatMessage[] = [];

function mapMessagesToState(recentMessages: Record<string, any[]>): Record<string, ChatMessage[]> {
  const result: Record<string, ChatMessage[]> = {};
  for (const [convId, msgs] of Object.entries(recentMessages)) {
    const mapped: ChatMessage[] = [];
    for (const m of msgs) {
      const isToolUse = m.content_type === 'tool_use';

      if (isToolUse) {
        const meta = m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : {};
        const toolEvent: ToolEvent = {
          id: m.id,
          type: 'tool_use',
          label: meta?.toolEvent?.name || m.content.replace(/^🔧\s*使用工具：/, ''),
          detail: meta?.toolEvent?.input || undefined,
          timestamp: m.created_at,
        };
        const prev = mapped[mapped.length - 1];
        if (prev && prev.agentId === m.sender_id) {
          prev.toolEvents = [...(prev.toolEvents || []), toolEvent];
        } else {
          mapped.push({
            id: `synth-${m.id}`,
            agentId: m.sender_id,
            content: '',
            timestamp: m.created_at,
            toolEvents: [toolEvent],
          });
        }
      } else {
        mapped.push({
          id: m.id,
          agentId: m.sender_type === 'human' ? 'human' : m.sender_id,
          content: m.content,
          timestamp: m.created_at,
          mentions: typeof m.mentions === 'string' ? JSON.parse(m.mentions || '[]') : (m.mentions || []),
          intent: m.intent,
          referencedTaskId: m.task_id,
        });
      }
    }
    result[convId] = mapped;
  }
  return result;
}

function mapSessionsToState(sessions: any[]): Record<string, Record<string, string | undefined>> {
  const result: Record<string, Record<string, string | undefined>> = { default: {} };
  for (const s of sessions) {
    const projectId = s.conversation_id || 'default';
    if (!result[projectId]) result[projectId] = {};
    if (s.cli_session_id) {
      result[projectId][s.agent_id] = s.cli_session_id;
    }
  }
  return result;
}

function mergeSessions(
  serverSessions: Record<string, Record<string, string | undefined>>,
  persistedSessions: Record<string, Record<string, string | undefined>>,
): Record<string, Record<string, string | undefined>> {
  const result: Record<string, Record<string, string | undefined>> = {};
  const allProjects = new Set([
    ...Object.keys(serverSessions),
    ...Object.keys(persistedSessions),
  ]);
  for (const project of allProjects) {
    const server = serverSessions[project] || {};
    const persisted = persistedSessions[project] || {};
    const agents = new Set([...Object.keys(server), ...Object.keys(persisted)]);
    const merged: Record<string, string | undefined> = {};
    for (const agent of agents) {
      merged[agent] = server[agent] || persisted[agent];
    }
    result[project] = merged;
  }
  return result;
}

// --- Store Interface (composed from all slices) ---

export interface TaskHubState {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  refreshRuntimeCatalog: () => void;
  mergeLegacyChatMessages: (legacyMessages: ChatMessage[]) => void;
  getAvailableRuntime: () => { engine: CliEngine; available: boolean } | null;

  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  enableMockRunner: boolean;
  setEnableMockRunner: (enabled: boolean) => void;

  daemonConnection: {
    status: 'disconnected' | 'connecting' | 'connected';
    error?: string;
  };
  setDaemonConnection: (next: { status: 'disconnected' | 'connecting' | 'connected'; error?: string }) => void;

  daemonRuntimes: DetectedRuntime[];
  setDaemonRuntimes: (runtimes: DetectedRuntime[]) => void;

  accounts: Account[];
  upsertAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastVerifiedAt' | 'verifyError' | 'hasApiKey'> & { id?: string; apiKey?: string }) => Promise<string>;
  removeAccount: (accountId: string) => Promise<void>;
  loadAccounts: () => Promise<void>;

  selectedProjectId: ProjectId;
  agentSessions: Record<ProjectId, Record<string, string | undefined>>;
  needsFullCompose: Record<string, boolean>;
  activeAgentIds: string[];
  conversations: Conversation[];
  selectedConversationId: string | null;
  tasks: Task[];
  chatMessagesByConversation: Record<string, ChatMessage[]>;
  eventsByConversation: Record<string, InternalEvent[]>;
  blockersByConversation: Record<string, Blocker[]>;

  getTasksByAgent: (agentId: string) => Task[];
  getTaskById:     (taskId: string) => Task | undefined;
  getAgentCurrentTask: (agentId: string) => Task | undefined;
  getConversations: () => Conversation[];
  getSelectedConversation: () => Conversation | undefined;
  getEventsForSelectedConversation: () => InternalEvent[];
  getOpenBlockersForSelectedConversation: () => Blocker[];
  getChatMessagesForSelectedConversation: () => ChatMessage[];

  loadFromServer: () => Promise<void>;

  createConversation: (input: { title: string; goal: string; projectPath?: string; priority?: Conversation['priority'] }) => void;
  setSelectedConversationId: (conversationId: string | null) => void;
  deleteConversation: (conversationId: string) => void;
  addSupervisorOutput: (output: SupervisorOutputEnvelope) => void;
  addEvent: (event: Omit<InternalEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => void;
  openBlocker: (input: Omit<Blocker, 'id' | 'status' | 'createdAt'> & { id?: string; status?: Blocker['status']; createdAt?: string }) => string;
  fixBlocker: (conversationId: string, blockerId: string) => void;
  inviteAgent:      (agentId: string) => void;
  dismissAgent:     (agentId: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, reviewNote?: string) => void;
  addTask:          (taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'conversationId' | 'phaseId'> & { phaseId?: string }) => void;
  removeTask:       (taskId: string) => void;
  updateTask:       (taskId: string, patch: Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>) => void;
  addChatMessage:   (msg: Omit<ChatMessage, 'id' | 'timestamp' | 'mentions' | 'intent'> & { conversationId?: string }) => void;
  updateChatMessageStatus: (msgId: string, status: 'approved' | 'rejected', rejectionReason?: string) => void;

  terminalLogs: Record<string, string[]>;
  agentStatus: Record<string, 'idle' | 'busy'>;
  activeRunsByAgent: Record<string, { runId: string; taskId?: string; conversationId: string; startedAt: string } | undefined>;
  activeStreamMessageId: Record<string, string>;
  activeStreamConversationId: Record<string, string>;
  pendingDispatches: Record<string, PendingDispatch[]>;

  connectDaemon: () => void;
  upsertAgentSession: (projectId: ProjectId, agentId: string, sessionId: string) => void;
  dispatchToAgent: (input: DispatchToAgentInput) => void;
  forceSendDispatch: (input: DispatchToAgentInput) => void;
  enqueueDispatch: (agentId: string, payload: Omit<PendingDispatch, 'queuedAt'>) => void;
  dequeueNextPending: (agentId: string) => void;
  clearPendingDispatches: (agentId: string) => void;
  appendTerminalLog: (agentId: string, log: string) => void;
  simulateCliExecution: (taskId: string, prompt: string, sessionId?: string) => void;
  ensureStreamMessage: (agentId: string, conversationId: string) => string;
  appendToStreamMessage: (messageId: string, patch: { content?: string; toolEvent?: ToolEvent }) => void;
  completeStreamMessage: (agentId: string) => void;
  cleanupStaleStreams: () => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  isNewTaskDialogOpen: boolean;
  setNewTaskDialogOpen: (open: boolean) => void;
  isRosterModalOpen: boolean;
  setRosterModalOpen: (open: boolean) => void;

  agentAccountOverrides: Record<string, string[]>;
  setAgentAccountIds: (agentId: string, accountIds: string[]) => void;

  createProgressMessage: (params: {
    taskId: string;
    taskTitle: string;
    type: 'start' | 'update' | 'complete';
    completedSteps?: number;
    totalSteps?: number;
    steps?: { label: string; status: 'done' | 'in_progress' | 'pending' }[];
  }, conversationId: string) => ChatMessage;

  roleCards: RoleCard[];
  upsertRoleCard: (card: Omit<RoleCard, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isPreset'> & { id?: string; isPreset?: boolean }) => string;
  removeRoleCard: (cardId: string) => void;
  getRoleCardById: (cardId: string) => RoleCard | undefined;
  getRoleCardForAgent: (agentId: string) => RoleCard | undefined;
  setAgentRoleCardId: (agentId: string, roleCardId: string) => void;
  setRoleCardAccountIds: (roleCardId: string, accountIds: string[]) => void;

  phases: Phase[];
  upsertPhase: (phase: Omit<Phase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => string;
  removePhase: (phaseId: string) => void;

  setBreakdownStatus: (conversationId: string, status: Conversation['breakdownStatus']) => void;
  triggerProposal: (conversationId: string) => void;
  confirmBreakdown: (conversationId: string, proposals: PhaseProposal[]) => void;

  isRoleCardDetailOpen: boolean;
  selectedRoleCardId: string | null;
  setRoleCardDetailOpen: (open: boolean, cardId?: string) => void;
  isRoleCardEditorOpen: boolean;
  editingRoleCardId: string | null;
  setRoleCardEditorOpen: (open: boolean, cardId?: string) => void;

  skillsMap: Record<string, SkillSummary>;
  agentSkillIds: Record<string, string[]>;
  loadSkills: () => Promise<void>;
  getSkillsForAgent: (agentId: string) => SkillSummary[];
  assignSkillsToAgent: (agentId: string, skillIds: string[]) => Promise<void>;
  importSkills: (source: string) => Promise<{ imported?: number; error?: string }>;

  worktrees: WorktreeInfo[];
  worktreesLoading: boolean;

  fetchWorktrees: () => Promise<void>;
  createWorktree: (projectSlug: string) => Promise<void>;
  removeWorktree: (projectSlug: string) => Promise<void>;
}

export { selectActiveAgents, selectAvailableRoster, selectPendingCount };

// --- Composed Store ---

export const useTaskHubStore = create<TaskHubState>()(
  persist(
    (...a) => {
      const [set, get] = a;

      // App slice (conversations, chat, events, blockers, accounts, settings, hydration)
      const appSlice = {
        hasHydrated: false,
        setHasHydrated: (hydrated: boolean) => set({ hasHydrated: hydrated }),

        isSettingsOpen: false,
        setSettingsOpen: (open: boolean) => set({ isSettingsOpen: open }),

        accounts: [] as import('./agentStore').Account[],
        upsertAccount: async (account: Omit<import('./agentStore').Account, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastVerifiedAt' | 'verifyError' | 'hasApiKey'> & { id?: string; apiKey?: string }): Promise<string> => {
          const isCreate = !account.id;
          const url = isCreate ? '/api/accounts' : `/api/accounts/${account.id}`;
          const method = isCreate ? 'POST' : 'PATCH';

          const body: Record<string, unknown> = {
            name: account.name,
            provider: account.provider,
            baseUrl: account.baseUrl,
            models: account.models,
            enabled: account.enabled,
          };

          if (isCreate) {
            body.authMode = account.authMode;
          }

          if (account.apiKey) body.apiKey = account.apiKey;

          const res = await fetch(url, {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err as Record<string, unknown>).error ? String((err as Record<string, unknown>).error) : `API error ${res.status}`);
          }

          const data = await res.json();

          set((state: any) => {
            const serverAccount = data.account;
            const exists = state.accounts.some((a: any) => a.id === serverAccount.id);
            return {
              accounts: exists
                ? state.accounts.map((a: any) => a.id === serverAccount.id ? serverAccount : a)
                : [serverAccount, ...state.accounts],
            };
          });

          return data.account.id;
        },
        removeAccount: async (accountId: string) => {
          await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
          set((state: any) => ({
            accounts: state.accounts.filter((a: any) => a.id !== accountId),
          }));
        },
        loadAccounts: async () => {
          try {
            const res = await fetch('/api/accounts');
            const data = await res.json();
            set({ accounts: data.accounts });
          } catch {}
        },

        selectedProjectId: 'default' as ProjectId,
        conversations: [] as Conversation[],
        selectedConversationId: null as string | null,
        chatMessagesByConversation: {} as Record<string, ChatMessage[]>,
        eventsByConversation: {} as Record<string, InternalEvent[]>,
        blockersByConversation: {} as Record<string, Blocker[]>,

        getConversations: () => get().conversations,
        getSelectedConversation: () =>
          get().selectedConversationId
            ? get().conversations.find((c) => c.id === get().selectedConversationId)
            : undefined,
        getEventsForSelectedConversation: () => {
          const id = get().selectedConversationId;
          if (!id) return EMPTY_EVENTS;
          return get().eventsByConversation[id] ?? EMPTY_EVENTS;
        },
        getOpenBlockersForSelectedConversation: () => {
          const id = get().selectedConversationId;
          if (!id) return EMPTY_BLOCKERS;
          return get().blockersByConversation[id] ?? EMPTY_BLOCKERS;
        },
        getChatMessagesForSelectedConversation: () => {
          const id = get().selectedConversationId;
          if (!id) return EMPTY_CHAT;
          return get().chatMessagesByConversation[id] ?? EMPTY_CHAT;
        },

        loadFromServer: async () => {
          try {
            const oldData = localStorage.getItem('agent-task-hub-store-clean');
            if (oldData) {
              try {
                const parsed = JSON.parse(oldData);
                if (parsed?.conversations?.length) {
                  for (const conv of parsed.conversations) {
                    fetch('/api/mutations', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ type: 'conversation.create', payload: { id: conv.id, title: conv.title, goal: conv.goal, priority: conv.priority } }),
                    }).catch(() => {});
                  }
                }
                if (parsed?.tasks?.length) {
                  for (const t of parsed.tasks) {
                    fetch('/api/mutations', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ type: 'task.create', payload: { id: t.id, conversation_id: t.conversationId, title: t.title, description: t.description, agent_id: t.agentId, dependencies: JSON.stringify(t.dependencies || []), artifacts: JSON.stringify(t.artifacts || []) } }),
                    }).catch(() => {});
                  }
                }
                if (parsed?.chatMessagesByConversation) {
                  for (const [convId, msgs] of Object.entries(parsed.chatMessagesByConversation)) {
                    for (const rawMsg of (msgs as any[])) {
                      const msg = rawMsg as any;
                      fetch('/api/mutations', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ type: 'message.append', payload: { conversationId: convId, senderType: msg.agentId === 'human' ? 'human' : 'agent', senderId: msg.agentId, content: msg.content, mentions: msg.mentions, intent: msg.intent, taskId: msg.referencedTaskId } }),
                      }).catch(() => {});
                    }
                  }
                }
                localStorage.removeItem('agent-task-hub-store-clean');
              } catch (migrationErr) {
                console.error('[loadFromServer] localStorage migration failed:', migrationErr);
              }
            }

            const res = await fetch('/api/state');
            if (!res.ok) {
              set({ hasHydrated: true });
              return;
            }
            const data = await res.json();

            const conversations: Conversation[] = (data.conversations || []).map((c: any) => ({
              id: c.id,
              title: c.title || '',
              goal: c.goal || '',
              status: c.status || 'active',
              priority: c.priority || 'p2',
              projectPath: c.project_path || '',
              breakdownStatus: c.breakdown_status || 'none',
              createdAt: c.created_at,
              updatedAt: c.updated_at,
            }));

            const tasks: import('./taskStore').Task[] = (data.tasks || []).map((t: any) => ({
              id: t.id,
              conversationId: t.conversation_id,
              phaseId: t.phase_id || '',
              title: t.title,
              description: t.description || '',
              status: t.status,
              agentId: t.agent_id,
              dependencies: typeof t.dependencies === 'string' ? JSON.parse(t.dependencies || '[]') : (t.dependencies || []),
              artifacts: typeof t.artifacts === 'string' ? JSON.parse(t.artifacts || '[]') : (t.artifacts || []),
              reviewNote: t.review_note,
              createdAt: t.created_at,
              updatedAt: t.updated_at,
            }));

            const mergedSessions = mergeSessions(
              mapSessionsToState(data.activeSessions || []),
              get().agentSessions,
            );

            const hydratedNeedsFullCompose: Record<string, boolean> = {};
            for (const [proj, agents] of Object.entries(mergedSessions)) {
              for (const [aid, sid] of Object.entries(agents || {})) {
                if (sid) hydratedNeedsFullCompose[`${proj}:${aid}`] = false;
              }
            }

            set({
              conversations,
              tasks,
              chatMessagesByConversation: mapMessagesToState(data.recentMessages || {}),
              agentSessions: mergedSessions,
              needsFullCompose: hydratedNeedsFullCompose,
              hasHydrated: true,
            });

            if (tasks.length) {
              const max = tasks.reduce((acc, t) => {
                const m = /^TASK-(\d+)$/.exec(t.id);
                const n = m ? Number(m[1]) : 0;
                return n > acc ? n : acc;
              }, 0);
              setTaskCounter(max + 1);
            }

            try {
              if (Array.isArray(data.phases) && data.phases.length > 0) {
                const phases: Phase[] = data.phases.map((p: any) => ({
                  id: p.id,
                  conversationId: p.conversation_id ?? p.conversationId,
                  title: p.title,
                  description: p.description ?? '',
                  order: p.order ?? 0,
                  status: p.status ?? 'planned',
                  createdAt: p.created_at ?? p.createdAt,
                  updatedAt: p.updated_at ?? p.updatedAt,
                }));
                set({ phases });
              } else if (conversations.length > 0) {
                const allPhases: Phase[] = [];
                for (const conv of conversations) {
                  try {
                    const phaseRes = await fetch(`/api/phases?conversationId=${conv.id}`);
                    if (phaseRes.ok) {
                      const phaseData = await phaseRes.json();
                      if (Array.isArray(phaseData)) {
                        allPhases.push(...phaseData);
                      }
                    }
                  } catch {}
                }
                if (allPhases.length > 0) {
                  set({ phases: allPhases });
                }
              }
            } catch (phaseErr) {
              console.error('[loadFromServer] phase hydration failed:', phaseErr);
            }

            get().loadAccounts();

            await loadAgents();

            get().refreshRuntimeCatalog();

            const existingIds = new Set(get().roleCards.map((c: any) => c.id));
            const missing = PRESET_ROLE_CARDS.filter((c) => !existingIds.has(c.id));
            if (missing.length) {
              set((state: any) => ({ roleCards: [...missing, ...state.roleCards] }));
            }

            get().loadSkills();
          } catch (err) {
            console.error('[loadFromServer] Failed:', err);
            set({ hasHydrated: true });
          }
        },

        mergeLegacyChatMessages: (legacyMessages: ChatMessage[]) => {
          if (!legacyMessages.length) return;
          let conversationId: string | null =
            get().selectedConversationId ??
            get().conversations[0]?.id ??
            null;
          if (!conversationId) {
            get().createConversation({ title: '未命名会话', goal: '迁移自旧版本的聊天记录' });
            conversationId = get().selectedConversationId ?? null;
          }
          if (!conversationId) return;
          set((state: any) => ({
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [conversationId]: [...(state.chatMessagesByConversation[conversationId] || []), ...legacyMessages],
            },
          }));
        },

        createConversation: ({ title, goal, projectPath, priority }: { title: string; goal: string; projectPath?: string; priority?: Conversation['priority'] }) => {
          const id = makeId('conv');
          const stamp = new Date().toISOString();
          const conversation: Conversation = {
            id,
            title,
            goal,
            status: 'active',
            priority: priority ?? 'p1',
            projectPath: projectPath ?? '',
            breakdownStatus: 'none',
            createdAt: stamp,
            updatedAt: stamp,
          };

          set((state: any) => ({
            conversations: [conversation, ...state.conversations],
            selectedConversationId: id,
            selectedProjectId: id,
            eventsByConversation: {
              ...state.eventsByConversation,
              [id]: [
                {
                  id: makeId('evt'),
                  conversationId: id,
                  type: 'conversation.created',
                  timestamp: stamp,
                  payload: { conversationId: id },
                },
              ],
            },
            blockersByConversation: {
              ...state.blockersByConversation,
              [id]: [],
            },
          }));

          get().addSupervisorOutput({
            kind: 'status_report',
            conversationId: id,
            invocationId: makeId('inv'),
            timestamp: stamp,
            summary: '会话已创建，可以开始规划。',
            needsHuman: false,
            humanActions: [],
            body: {
              phase: 'discovery',
              progress: { done: [], inProgress: [], blocked: [] },
              risksTop3: [],
              nextStepsTop3: [],
              evidenceLinks: [],
            },
          });

          fetch('/api/mutations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'conversation.create', payload: { id, title, goal, priority: priority ?? 'p1', project_path: projectPath } }),
          }).catch((err) => console.error('[mutation] conversation.create failed:', err));

          setTimeout(() => get().triggerProposal(id), 500);
        },

        setSelectedConversationId: (conversationId: string | null) => set({ selectedConversationId: conversationId, selectedProjectId: conversationId || 'default' }),

        deleteConversation: (conversationId: string) => {
          const state = get();
          if (state.selectedConversationId === conversationId) {
            set({ selectedConversationId: null, selectedProjectId: 'default' });
          }
          const { [conversationId]: _msgs, ...restMsgs } = state.chatMessagesByConversation;
          const { [conversationId]: _evts, ...restEvts } = state.eventsByConversation;
          const { [conversationId]: _blockers, ...restBlockers } = state.blockersByConversation;
          set({
            conversations: state.conversations.filter((c) => c.id !== conversationId),
            tasks: state.tasks.filter((t: any) => t.conversationId !== conversationId),
            chatMessagesByConversation: restMsgs,
            eventsByConversation: restEvts,
            blockersByConversation: restBlockers,
          });
          fetch('/api/mutations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'conversation.delete', payload: { id: conversationId } }),
          }).catch(() => {});
        },

        addEvent: ({ id, timestamp, ...event }: Omit<InternalEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => {
          const resolvedId = id ?? makeId('evt');
          const resolvedTimestamp = timestamp ?? new Date().toISOString();
          const record: InternalEvent = { ...event, id: resolvedId, timestamp: resolvedTimestamp };
          set((state: any) => ({
            eventsByConversation: {
              ...state.eventsByConversation,
              [record.conversationId]: [...(state.eventsByConversation[record.conversationId] || []), record],
            },
          }));

          if (record.conversationId) {
            fetch('/api/mutations', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ type: 'event.append', payload: {
                conversationId: record.conversationId,
                taskId: (record.payload as any)?.taskId,
                agentId: (record.payload as any)?.agentId || 'system',
                type: record.type,
                payload: record.payload,
              }}),
            }).catch((err) => console.error('[mutation] event.append failed:', err));
          }
        },

        addSupervisorOutput: (output: SupervisorOutputEnvelope) => {
          const tail = (get().eventsByConversation[output.conversationId] || []).slice(-1)[0];
          if (tail?.type === 'supervisor.output') {
            const prev = tail.payload as SupervisorOutputEnvelope | undefined;
            if (prev?.kind === output.kind) return;
          }
          get().addEvent({
            conversationId: output.conversationId,
            type: 'supervisor.output',
            payload: output,
          });
        },

        openBlocker: ({ id, status, createdAt, ...input }: Omit<Blocker, 'id' | 'status' | 'createdAt'> & { id?: string; status?: Blocker['status']; createdAt?: string }): string => {
          const resolvedId = id ?? makeId('blk');
          const stamp = createdAt ?? new Date().toISOString();
          const blocker: Blocker = {
            ...input,
            id: resolvedId,
            status: status ?? 'open',
            createdAt: stamp,
          };

          set((state: any) => ({
            blockersByConversation: {
              ...state.blockersByConversation,
              [blocker.conversationId]: [...(state.blockersByConversation[blocker.conversationId] || []), blocker],
            },
          }));

          get().addEvent({
            conversationId: blocker.conversationId,
            type: 'blocker.opened',
            payload: blocker,
          });

          return resolvedId;
        },

        fixBlocker: (conversationId: string, blockerId: string) => {
          const stamp = new Date().toISOString();
          set((state: any) => ({
            blockersByConversation: {
              ...state.blockersByConversation,
              [conversationId]: (state.blockersByConversation[conversationId] || []).map((b: Blocker) =>
                b.id === blockerId ? { ...b, status: 'fixed', resolvedAt: stamp } : b
              ),
            },
          }));
          get().addEvent({ conversationId, type: 'blocker.fixed', payload: { blockerId } });
        },

        createProgressMessage: (params: {
          taskId: string;
          taskTitle: string;
          type: 'start' | 'update' | 'complete';
          completedSteps?: number;
          totalSteps?: number;
          steps?: { label: string; status: 'done' | 'in_progress' | 'pending' }[];
        }, conversationId: string): ChatMessage => {
          const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const contentTemplates: Record<string, string> = {
            start: `▶ #${params.taskId} 开始执行 — ${params.taskTitle}`,
            update: `⟳ #${params.taskId} 进度更新 — ${params.completedSteps}/${params.totalSteps}`,
            complete: `✓ #${params.taskId} 执行完成 — ${params.taskTitle}`,
          };

          return {
            id,
            agentId: 'system',
            content: contentTemplates[params.type],
            timestamp: new Date().toISOString(),
            intent: 'progress',
            referencedTaskId: params.taskId,
            conversationId,
            progressData: {
              taskId: params.taskId,
              type: params.type,
              completedSteps: params.completedSteps ?? 0,
              totalSteps: params.totalSteps ?? 0,
              steps: params.steps ?? [],
            },
          };
        },

        addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp' | 'mentions' | 'intent'> & { conversationId?: string }) => {
          if (!get().selectedConversationId && get().conversations.length === 0 && msg.agentId === 'human') {
            const title = msg.content.length > 20
              ? msg.content.slice(0, msg.content.indexOf('，') > 0 ? msg.content.indexOf('，') : 20)
              : msg.content;
            get().createConversation({ title, goal: msg.content });
          }

          const { conversationId: conv, ...rest } = msg as any;
          const conversationId = conv ?? get().selectedConversationId;
          if (!conversationId) return;

          const mentionsMatch = rest.content.match(/@(\w+)/g);
          const mentions = mentionsMatch ? mentionsMatch.map((m: string) => m.substring(1)) : [];

          let intent: ChatMessage['intent'] = 'general';
          const contentLower = rest.content.toLowerCase();
          if (contentLower.includes('brainstorm') || contentLower.includes('design') || contentLower.includes('plan')) {
            intent = 'ideate';
          } else if (contentLower.includes('implement') || contentLower.includes('execute') || contentLower.includes('build')) {
            intent = 'execute';
          } else if (contentLower.includes('review') || contentLower.includes('check') || contentLower.includes('audit')) {
            intent = 'review';
          }

          const existingConv = get().conversations.find((c: Conversation) => c.id === conversationId);
          if (existingConv && existingConv.breakdownStatus === 'none' && !mentions.length) {
            setTimeout(() => {
              const state = useTaskHubStore.getState();
              if (state.conversations.find((c: Conversation) => c.id === conversationId)?.breakdownStatus === 'none') {
                state.triggerProposal(conversationId);
              }
            }, 500);
          }

          if (rest.agentId === 'human') {
            const uniqueMentions = [...new Set<string>(mentions)].filter((id) =>
              AGENT_ROSTER.some((a) => a.id === id),
            );

            if (uniqueMentions.length > 0) {
              const busyAgents = uniqueMentions.filter((id) => get().agentStatus[id] === 'busy');
              const idleAgents = uniqueMentions.filter((id) => get().agentStatus[id] !== 'busy');

              if (busyAgents.length === uniqueMentions.length) {
                for (const agentId of busyAgents) {
                  get().enqueueDispatch(agentId, { prompt: rest.content, referencedTaskId: rest.referencedTaskId });
                }
                return;
              }

              set((state: any) => ({
                chatMessagesByConversation: {
                  ...state.chatMessagesByConversation,
                  [conversationId]: [
                    ...(state.chatMessagesByConversation[conversationId] || []),
                    {
                      ...rest,
                      id: `msg-${Date.now()}`,
                      timestamp: new Date().toISOString(),
                      mentions,
                      intent,
                    },
                  ],
                },
              }));

              for (const agentId of idleAgents) {
                get().dispatchToAgent({
                  agentId,
                  referencedTaskId: rest.referencedTaskId,
                  prompt: rest.content,
                });
              }
              for (const agentId of busyAgents) {
                get().enqueueDispatch(agentId, { prompt: rest.content, referencedTaskId: rest.referencedTaskId });
              }
            } else {
              set((state: any) => ({
                chatMessagesByConversation: {
                  ...state.chatMessagesByConversation,
                  [conversationId]: [
                    ...(state.chatMessagesByConversation[conversationId] || []),
                    {
                      ...rest,
                      id: `msg-${Date.now()}`,
                      timestamp: new Date().toISOString(),
                      mentions,
                      intent,
                    },
                  ],
                },
              }));
            }
          } else {
            set((state: any) => ({
              chatMessagesByConversation: {
                ...state.chatMessagesByConversation,
                [conversationId]: [
                  ...(state.chatMessagesByConversation[conversationId] || []),
                  {
                    ...rest,
                    id: `msg-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    mentions,
                    intent,
                  },
                ],
              },
            }));
          }

          fetch('/api/mutations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'message.append', payload: {
              conversationId,
              taskId: rest.referencedTaskId,
              senderType: rest.agentId === 'human' ? 'human' : 'agent',
              senderId: rest.agentId,
              content: rest.content,
              mentions,
              intent,
            }}),
          }).catch((err) => console.error('[mutation] message.append failed:', err));
        },

        updateChatMessageStatus: (msgId: string, status: 'approved' | 'rejected', rejectionReason?: string) =>
          set((state: any) => {
            let changed = false;
            const next = { ...state.chatMessagesByConversation };
            for (const conversationId of Object.keys(next)) {
              const msgs = next[conversationId] || [];
              const idx = msgs.findIndex((m: any) => m.id === msgId);
              if (idx === -1) continue;
              changed = true;
              next[conversationId] = msgs.map((m: any) =>
                m.id === msgId
                  ? { ...m, approvalStatus: status, ...(status === 'rejected' && rejectionReason ? { rejectionReason } : {}) }
                  : m
              );
            }
            return changed ? { chatMessagesByConversation: next } : {};
          }),

        worktrees: [] as WorktreeInfo[],
        worktreesLoading: false,

        fetchWorktrees: async () => {
          set({ worktreesLoading: true });
          try {
            const response = await fetch('/api/worktrees');
            const data = await response.json();
            set({ worktrees: data.worktrees, worktreesLoading: false });
          } catch (error) {
            console.error('Failed to fetch worktrees:', error);
            set({ worktreesLoading: false });
          }
        },

        createWorktree: async (projectSlug: string) => {
          try {
            const response = await fetch('/api/worktrees', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectSlug }),
            });
            if (response.ok) {
              await get().fetchWorktrees();
            }
          } catch (error) {
            console.error('Failed to create worktree:', error);
          }
        },

        removeWorktree: async (projectSlug: string) => {
          try {
            const response = await fetch('/api/worktrees', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectSlug }),
            });
            if (response.ok) {
              await get().fetchWorktrees();
            }
          } catch (error) {
            console.error('Failed to remove worktree:', error);
          }
        },
      };

      // Compose all slices
      return {
        ...appSlice,
        ...createTaskSlice(set, get),
        ...createAgentSlice(set, get),
        ...createDaemonSlice(set, get),
      };
    },
    {
      name: 'agent-task-hub-store-clean',
      version: 3,
      migrate: (persisted: any, version: number) => {
        if (version === 0) {
          const idMap: Record<string, string> = {
            jean: 'mario', keqing: 'luigi', zhongli: 'toad',
            nahida: 'peach', albedo: 'dk', venti: 'yoshi',
          };
          const remap = (id: string) => idMap[id] ?? id;

          if (Array.isArray(persisted.activeAgentIds)) {
            persisted.activeAgentIds = persisted.activeAgentIds.map(remap);
          }

          persisted.agentSessions = {};

          if (persisted.agentAccountOverrides && typeof persisted.agentAccountOverrides === 'object') {
            const mapped: Record<string, any> = {};
            for (const [aid, ids] of Object.entries(persisted.agentAccountOverrides)) {
              mapped[remap(aid)] = ids;
            }
            persisted.agentAccountOverrides = mapped;
          }

          if (Array.isArray(persisted.tasks)) {
            persisted.tasks = persisted.tasks.map((t: any) => ({
              ...t,
              agentId: remap(t.agentId),
            }));
          }

          if (persisted.chatMessagesByConversation && typeof persisted.chatMessagesByConversation === 'object') {
            const mapped: Record<string, any> = {};
            for (const [convId, msgs] of Object.entries(persisted.chatMessagesByConversation)) {
              if (Array.isArray(msgs)) {
                mapped[convId] = msgs.map((m: any) => ({
                  ...m,
                  agentId: typeof m.agentId === 'string' ? remap(m.agentId) : m.agentId,
                  mentions: Array.isArray(m.mentions) ? m.mentions.map(remap) : m.mentions,
                }));
              } else {
                mapped[convId] = msgs;
              }
            }
            persisted.chatMessagesByConversation = mapped;
          }
        }
        if (version < 2) {
          persisted.agentSessions = {};
        }
        if (version < 3) {
          persisted.activeAgentIds = ['mario', 'luigi'];
        }
        return persisted;
      },
      partialize: (state) => ({
        conversations: state.conversations,
        tasks: state.tasks,
        chatMessagesByConversation: state.chatMessagesByConversation,
        eventsByConversation: state.eventsByConversation,
        blockersByConversation: state.blockersByConversation,
        activeAgentIds: state.activeAgentIds,
        agentSessions: state.agentSessions,
        agentAccountOverrides: state.agentAccountOverrides,
        enableMockRunner: state.enableMockRunner,
        roleCards: state.roleCards,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        let needsConvUpdate = false;
        const updatedConversations = state.conversations.map((c: any) => {
          let updated = false;
          const patches: Record<string, any> = {};
          if (c.breakdownStatus === undefined) { patches.breakdownStatus = 'none'; updated = true; }
          if (c.projectPath === undefined) { patches.projectPath = ''; updated = true; }
          if (updated) { needsConvUpdate = true; return { ...c, ...patches }; }
          return c;
        });
        if (needsConvUpdate) {
          state.conversations = updatedConversations;
        }

        let needsTaskUpdate = false;
        const updatedTasks = state.tasks.map((t: any) => {
          if (t.phaseId === undefined) { needsTaskUpdate = true; return { ...t, phaseId: '' }; }
          return t;
        });
        if (needsTaskUpdate) {
          state.tasks = updatedTasks;
        }
      },
    },
  ),
);

// --- Socket.io Event Listeners ---
socket.off('connect');
socket.off('disconnect');
socket.off('connect_error');

socket.on('connect', () => {
  useTaskHubStore.getState().setDaemonConnection({ status: 'connected' });

  socket.emit('runtimes:list', (response: { runtimes: import('@/server/types').DetectedRuntime[] }) => {
    if (response?.runtimes) {
      useTaskHubStore.getState().setDaemonRuntimes(response.runtimes);
    }
  });

  socket.emit('daemon:status', (response: { activeAgents: Record<string, { taskId?: string; conversationId?: string }> }) => {
    if (!response?.activeAgents) return;
    const statusUpdate: Record<string, 'busy'> = {};
    const runsUpdate: Record<string, { runId: string; taskId?: string; conversationId: string; startedAt: string } | undefined> = {};
    for (const [agentId, info] of Object.entries(response.activeAgents)) {
      statusUpdate[agentId] = 'busy';
      runsUpdate[agentId] = info.conversationId
        ? {
            runId: `recovered-${agentId}`,
            taskId: info.taskId,
            conversationId: info.conversationId,
            startedAt: new Date().toISOString(),
          }
        : undefined;
    }
    useTaskHubStore.setState((state) => ({
      agentStatus: { ...state.agentStatus, ...statusUpdate },
      activeRunsByAgent: { ...state.activeRunsByAgent, ...runsUpdate },
    }));
  });

  useTaskHubStore.getState().cleanupStaleStreams();
});

socket.on('disconnect', () => {
  useTaskHubStore.getState().setDaemonConnection({ status: 'disconnected' });
});

socket.on('connect_error', (err) => {
  useTaskHubStore.getState().setDaemonConnection({ status: 'disconnected', error: String((err as any)?.message || err) });
});

socket.on('runtimes:update', ({ runtimes }: { runtimes: import('@/server/types').DetectedRuntime[] }) => {
  useTaskHubStore.getState().setDaemonRuntimes(runtimes);
});

socket.on('terminal:data', ({ agentId, data }) => {
  useTaskHubStore.getState().appendTerminalLog(agentId, data);
});

socket.on('agent:session', ({ projectId, agentId, sessionId }) => {
  useTaskHubStore.getState().upsertAgentSession(projectId || 'default', agentId, sessionId);
});

socket.on('agent:event', (event) => {
  const { agentId, type, content, tool, sessionId, conversationId: eventConvId } = event;
  const state = useTaskHubStore.getState();

  const active = state.activeRunsByAgent[agentId];
  let conversationId: string | undefined;
  if (eventConvId && eventConvId !== 'default') {
    conversationId = eventConvId;
  } else if (active?.conversationId) {
    conversationId = active.conversationId;
  } else {
    conversationId = state.selectedConversationId ?? undefined;
  }
  if (!conversationId) return;

  if (sessionId) {
    const actualProjectId = useTaskHubStore.getState().selectedProjectId;
    state.upsertAgentSession(actualProjectId, agentId, sessionId);
  }

  if (type === 'heartbeat') {
    resetWatchdog(agentId, useTaskHubStore.getState, useTaskHubStore.setState);
    return;
  }

  if (type === 'done') {
    state.completeStreamMessage(agentId);
    return;
  }

  let activeId = state.activeStreamMessageId[agentId];
  if (!activeId) {
    activeId = state.ensureStreamMessage(agentId, conversationId);
  }

  if (type === 'text') {
    state.appendToStreamMessage(activeId, { content: content || '' });
  } else if (type === 'thinking') {
    // skip
  } else if (type === 'tool_use') {
    state.appendToStreamMessage(activeId, {
      toolEvent: {
        id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'tool_use',
        label: tool?.name || 'unknown',
        detail: tool?.input,
        timestamp: new Date().toISOString(),
      },
    });
  } else if (type === 'tool_result') {
    state.appendToStreamMessage(activeId, {
      toolEvent: {
        id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'tool_result',
        label: tool?.name || 'unknown',
        detail: tool?.output,
        timestamp: new Date().toISOString(),
      },
    });
  } else if (type === 'error') {
    state.appendToStreamMessage(activeId, {
      toolEvent: {
        id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'error',
        label: '错误',
        detail: content,
        timestamp: new Date().toISOString(),
      },
    });
  } else {
    state.appendToStreamMessage(activeId, { content: content || '' });
  }
});

socket.on('terminal:exit', ({ agentId, code, command, reasonCode }: { agentId: string; code: number; command?: string; reasonCode?: string }) => {
  const store = useTaskHubStore.getState();
  const active = store.activeRunsByAgent[agentId];
  const conversationId =
    active?.conversationId ||
    (active?.taskId ? store.getTaskById(active.taskId)?.conversationId : null) ||
    store.selectedConversationId;
  const runId = active?.runId;
  const taskId = active?.taskId;

  store.appendTerminalLog(agentId, `\r\n\x1b[36m[process exited with code ${code}]\x1b[0m\r\n`);

  if (runId && conversationId) {
    store.addEvent({
      conversationId,
      type: 'run.finished',
      payload: { runId, agentId, taskId, code, reasonCode },
    });
  }

  if (typeof code === 'number' && code !== 0 && taskId && conversationId) {
    let blockerType: Blocker['type'] = 'execution_failure';
    let reasonSummary = `执行失败（退出码 ${code}）。`;

    if (reasonCode === 'not_found') {
      reasonSummary = 'CLI 工具未找到，请检查安装。';
    } else if (reasonCode === 'timeout') {
      blockerType = 'timeout';
      reasonSummary = '执行超时，Agent 已自动终止。';
    } else if (reasonCode === 'spawn_failed') {
      reasonSummary = '进程启动失败。';
    }

    store.updateTaskStatus(taskId, 'blocked', reasonSummary);
    store.openBlocker({
      conversationId,
      taskId,
      type: blockerType,
      reasonSummary,
      evidenceRef: runId ? `run:${runId}` : (command ? `cli:${command}` : undefined),
    });

  }

  // Auto-advance: CLI exit=0 → task in_review
  if (code === 0 && taskId) {
    const task = store.getTaskById(taskId);
    if (task && task.status === 'in_progress') {
      store.updateTaskStatus(taskId, 'in_review');
    }
  }

  const exitProjectId = useTaskHubStore.getState().selectedProjectId || 'default';
  const exitComposeKey = `${exitProjectId}:${agentId}`;

  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
    activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
    needsFullCompose: { ...state.needsFullCompose, [exitComposeKey]: true },
  }));
  useTaskHubStore.getState().completeStreamMessage(agentId);

  const pending = useTaskHubStore.getState().pendingDispatches[agentId];
  if (pending && pending.length > 0) {
    setTimeout(() => {
      useTaskHubStore.getState().dequeueNextPending(agentId);
    }, 300);
  }
});

socket.on('a2a:dispatch', ({ agentId, prompt, referencedTaskId, fromAgentId, conversationId }: { agentId: string; prompt: string; referencedTaskId?: string; fromAgentId: string; conversationId?: string }) => {
  console.log(`[a2a] dispatch from ${fromAgentId} to ${agentId}`);
  useTaskHubStore.getState().enqueueDispatch(agentId, {
    prompt,
    referencedTaskId,
    source: 'a2a',
    fromAgentId,
  });
});

socket.on('agent:error', ({ agentId, message, reasonCode }: { agentId: string; message: string; reasonCode?: string }) => {
  const state = useTaskHubStore.getState();

  if (message === 'Agent is busy, message queued') {
    const active = state.activeRunsByAgent[agentId];
    const pending = state.pendingDispatches[agentId];
    if (!pending || pending.length === 0) {
      useTaskHubStore.setState((s) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'busy' },
      }));
    }
    setTimeout(() => {
      const current = useTaskHubStore.getState();
      if (current.agentStatus[agentId] === 'idle' && current.pendingDispatches[agentId]?.length) {
        current.dequeueNextPending(agentId);
      }
    }, 2000);
    return;
  }

  const activeId = state.activeStreamMessageId[agentId];
  if (activeId) {
    state.appendToStreamMessage(activeId, { content: `\n⚠️ ${message}` });
    state.completeStreamMessage(agentId);
  } else {
    state.addChatMessage({
      agentId: agentId || 'system',
      content: `⚠️ ${message}`,
    });
  }
});

socket.on('task.assigned', ({ taskId, agentId, conversationId }: { taskId: string; agentId: string; conversationId: string }) => {
  const store = useTaskHubStore.getState();
  const task = store.getTaskById(taskId);
  if (!task) return;

  useTaskHubStore.setState((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, agentId, updatedAt: new Date().toISOString() } : t
    ),
  }));

  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    prompt: `你被分配了 ${taskId}: ${task.title}. ${task.description || ''}`,
  });
});

socket.on('task.sync', ({ projectPath, conversationId, tasks: syncedTasks, blockers: syncedBlockers }: { projectPath: string; conversationId: string; tasks: any[]; blockers?: any[] }) => {
  const store = useTaskHubStore.getState();

  for (const synced of syncedTasks) {
    const existing = store.getTaskById(synced.id);
    if (!existing) {
      // New task from file — add to store
      useTaskHubStore.setState((state) => ({
        tasks: [...state.tasks, {
          id: synced.id,
          conversationId: conversationId || state.selectedConversationId || '',
          phaseId: synced.phase || '',
          title: synced.title,
          description: synced.deliverable || '',
          status: synced.status,
          agentId: synced.agent || '',
          dependencies: synced.depends || [],
          artifacts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      }));
      continue;
    }

    if (existing.status !== synced.status || existing.agentId !== synced.agent) {
      useTaskHubStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === synced.id
            ? { ...t, status: synced.status, agentId: synced.agent || t.agentId, updatedAt: new Date().toISOString() }
            : t
        ),
      }));
    }
  }

  // Sync blockers from file
  if (syncedBlockers && syncedBlockers.length > 0) {
    for (const b of syncedBlockers) {
      if (b.status === 'open') {
        const existingBlk = (store.blockersByConversation[conversationId] || []).find((eb: any) => eb.id === b.id);
        if (!existingBlk) {
          store.openBlocker({
            id: b.id,
            conversationId,
            taskId: b.taskId,
            type: b.type,
            reasonSummary: b.summary,
            status: 'open',
          });
        }
      }
    }
  }
});

socket.on('task.ready', ({ taskId, agentId }: { taskId: string; agentId: string }) => {
  const store = useTaskHubStore.getState();
  const task = store.getTaskById(taskId);
  if (!task || task.status !== 'pending') return;

  store.updateTaskStatus(taskId, 'in_progress');
  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    prompt: `依赖已满足，开始执行 ${taskId}: ${task.title}. ${task.description || ''}`,
  });
});
