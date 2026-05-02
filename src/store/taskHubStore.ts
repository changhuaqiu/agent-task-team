'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { io } from 'socket.io-client';
import type { RoleCard } from '@/types/roleCard';
import type { Phase, PhaseStatus } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
import { PRESET_ROLE_CARDS, PRESET_ROLE_CARD_MAP } from '@/data/presetRoleCards';

const socket = io(undefined, { path: '/api/socketio', autoConnect: false });

/* ============================================================
   Task Hub Store
   Aligned with: docs/wiki/01-architecture.md
   ============================================================ */

// --- Status (6-state machine per spec §2.2) ---
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'rejected'
  | 'blocked';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待处理',
  in_progress: '进行中',
  in_review: '评审中',
  done: '已完成',
  rejected: '已拒绝',
  blocked: '已阻塞',
};

export const STATUS_ORDER: TaskStatus[] = [
  'blocked',
  'rejected',
  'in_progress',
  'in_review',
  'pending',
  'done',
];

// --- Agent Role ---
export type AgentRole = 'planner' | 'worker' | 'reviewer';

export type AgentTheme = 'jean' | 'keqing' | 'zhongli' | 'nahida' | 'albedo' | 'venti';

export type CliEngine = 'opencode' | 'claude' | 'codex' | 'gemini' | 'mock';

export interface Agent {
  id: string;
  name: string;
  /** @deprecated — use roleCardId + RoleCard instead */
  role: AgentRole;
  /** @deprecated — use roleCardId + RoleCard.displayName instead */
  roleLabel: string;
  roleCardId: string;
  theme: AgentTheme;
  emoji: string;
  isOnline: boolean;
  cliEngine?: CliEngine;
  accountIds: string[];
}

export const PROVIDER_TO_ENGINE: Record<AccountProvider, CliEngine> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
  kimi: 'opencode',
  opencode: 'opencode',
  other: 'opencode',
};

export function providerToEngine(provider: AccountProvider): CliEngine {
  return PROVIDER_TO_ENGINE[provider];
}

export function resolveAgentEngine(
  agent: Agent,
  accounts: Account[],
): { engine: CliEngine; accountId: string } | null {
  for (const accountId of agent.accountIds) {
    const account = accounts.find((a) => a.id === accountId && a.enabled);
    if (account) {
      return { engine: providerToEngine(account.provider), accountId };
    }
  }
  if (agent.cliEngine) {
    return { engine: agent.cliEngine, accountId: '' };
  }
  return null;
}

// --- Chat Message Entity ---
export interface ToolEvent {
  id: string;
  type: 'tool_use' | 'step_start' | 'step_finish' | 'error';
  label: string;
  detail?: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  agentId: string | 'human' | 'system';
  content: string;
  timestamp: string;
  isApprovalRequest?: boolean;
  referencedTaskId?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  mentions?: string[]; // Array of agentIds mentioned in the message
  intent?: 'ideate' | 'execute' | 'review' | 'general' | 'progress'; // Captured intent
  selectedProposals?: string[];
  toolEvents?: ToolEvent[];
  isStreaming?: boolean;
  progressData?: {
    taskId: string;
    type: 'start' | 'update' | 'complete';
    completedSteps: number;
    totalSteps: number;
    steps: { label: string; status: 'done' | 'in_progress' | 'pending' }[];
  };
  artifactPreview?: {
    files: { path: string; change: 'added' | 'modified' | 'deleted' }[];
  };
  rejectionReason?: string;
}

// --- Task Artifact ---
export interface TaskArtifact {
  type: 'file' | 'pr' | 'log' | 'link';
  label: string;
  url?: string;
}

// --- Task Entity (spec §2.2) ---
export interface Task {
  id: string;
  conversationId: string;
  phaseId: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  dependencies: string[];     // prerequisite task IDs
  artifacts: TaskArtifact[];
  reviewNote?: string;        // reviewer feedback
  createdAt: string;          // ISO date
  updatedAt: string;
}

export type ProjectId = 'default' | (string & {});

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
  breakdownStatus: 'none' | 'in_progress' | 'reviewed' | 'confirmed' | 'no_account';
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

export type AccountAuthMode = 'api_key' | 'oauth';

export type AccountProvider = 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';

export const PROVIDER_LABELS: Record<AccountProvider, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI / Codex',
  google: 'Gemini',
  kimi: 'Kimi',
  opencode: 'OpenCode',
  other: '其他',
};

export const PROVIDER_OPTIONS: AccountProvider[] = ['anthropic', 'openai', 'google', 'kimi', 'opencode', 'other'];

export const MODEL_SUGGESTIONS: Partial<Record<AccountProvider, string[]>> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-sonnet-4-5-20250929'],
  openai: ['gpt-5.4', 'gpt-5.3-codex', 'o3-pro'],
  google: ['gemini-2.5-pro', 'gemini-3-flash-preview'],
  kimi: ['moonshot-v2'],
  opencode: ['claude-sonnet-4-6', 'gpt-5.4'],
};

export interface Account {
  id: string;
  name: string;
  authMode: AccountAuthMode;
  provider: AccountProvider;
  baseUrl?: string;
  // apiKey lives in server credentials — never stored client-side
  models: string[];
  enabled: boolean;
  status: 'unknown' | 'valid' | 'pending' | 'error';
  lastVerifiedAt?: string;
  verifyError?: string;
  hasApiKey?: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Store ---
interface TaskHubState {
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

  opencodeStatus: {
    checked: boolean;
    available: boolean;
    path?: string;
    version?: string;
    error?: string;
  };
  setOpencodeStatus: (status: {
    checked: boolean;
    available: boolean;
    path?: string;
    version?: string;
    error?: string;
  }) => void;

  opencodeBridge: {
    url: string;
    enabled: boolean;
    checked: boolean;
    available: boolean;
    version?: string;
    error?: string;
  };
  setOpencodeBridge: (bridge: {
    url: string;
    enabled: boolean;
    checked: boolean;
    available: boolean;
    version?: string;
    error?: string;
  }) => void;

  accounts: Account[];
  upsertAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastVerifiedAt' | 'verifyError' | 'hasApiKey'> & { id?: string; apiKey?: string }) => Promise<string>;
  removeAccount: (accountId: string) => Promise<void>;
  loadAccounts: () => Promise<void>;

  selectedProjectId: ProjectId;
  agentSessions: Record<ProjectId, Record<string, string | undefined>>;
  activeAgentIds: string[];
  conversations: Conversation[];
  selectedConversationId: string | null;
  tasks: Task[];
  chatMessagesByConversation: Record<string, ChatMessage[]>;
  eventsByConversation: Record<string, InternalEvent[]>;
  blockersByConversation: Record<string, Blocker[]>;

  // We remove getActiveAgents and getAvailableRoster from the state interface
  // because derived data should be computed in the components or via selectors,
  // not returned via functions that create new array references every time they are called.
  getTasksByAgent: (agentId: string) => Task[];
  getTaskById:     (taskId: string) => Task | undefined;
  getAgentCurrentTask: (agentId: string) => Task | undefined;
  getConversations: () => Conversation[];
  getSelectedConversation: () => Conversation | undefined;
  getEventsForSelectedConversation: () => InternalEvent[];
  getOpenBlockersForSelectedConversation: () => Blocker[];
  getChatMessagesForSelectedConversation: () => ChatMessage[];

  // Server hydration
  loadFromServer: () => Promise<void>;

  // Mutations
  createConversation: (input: { title: string; goal: string; projectPath?: string; priority?: Conversation['priority']; autoBreakdown?: boolean }) => void;
  setSelectedConversationId: (conversationId: string | null) => void;
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

  // --- Terminal Store ---
  terminalLogs: Record<string, string[]>;
  agentStatus: Record<string, 'idle' | 'busy'>;
  activeRunsByAgent: Record<string, { runId: string; taskId?: string; conversationId: string; startedAt: string } | undefined>;
  activeStreamMessageId: Record<string, string>;

  // Actions
  connectDaemon: () => void;
  upsertAgentSession: (projectId: ProjectId, agentId: string, sessionId: string) => void;
  dispatchToAgent: (input: DispatchToAgentInput) => void;
  appendTerminalLog: (agentId: string, log: string) => void;
  simulateCliExecution: (taskId: string, prompt: string, sessionId?: string) => void;
  ensureStreamMessage: (agentId: string, conversationId: string) => string;
  appendToStreamMessage: (messageId: string, patch: { content?: string; toolEvent?: ToolEvent }) => void;
  completeStreamMessage: (agentId: string) => void;
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

  // --- Role Card Store ---
  roleCards: RoleCard[];
  upsertRoleCard: (card: Omit<RoleCard, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isPreset'> & { id?: string; isPreset?: boolean }) => string;
  removeRoleCard: (cardId: string) => void;
  getRoleCardById: (cardId: string) => RoleCard | undefined;
  getRoleCardForAgent: (agentId: string) => RoleCard | undefined;
  setAgentRoleCardId: (agentId: string, roleCardId: string) => void;
  setRoleCardAccountIds: (roleCardId: string, accountIds: string[]) => void;

  // Phase state
  phases: Phase[];
  upsertPhase: (phase: Omit<Phase, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => string;
  removePhase: (phaseId: string) => void;

  // Breakdown actions
  setBreakdownStatus: (conversationId: string, status: Conversation['breakdownStatus']) => void;
  triggerBreakdown: (conversationId: string) => void;
  confirmBreakdown: (conversationId: string, proposals: PhaseProposal[]) => void;

  // Role Card UI state
  isRoleCardDetailOpen: boolean;
  selectedRoleCardId: string | null;
  setRoleCardDetailOpen: (open: boolean, cardId?: string) => void;
  isRoleCardEditorOpen: boolean;
  editingRoleCardId: string | null;
  setRoleCardEditorOpen: (open: boolean, cardId?: string) => void;
}

// --- Initial Data (Pixel-art themed) ---
export const AGENT_ROSTER: Agent[] = [
  {
    id: 'jean',
    name: 'Jean',
    role: 'planner',
    roleLabel: '项目统筹',
    roleCardId: 'preset-planner',
    theme: 'jean',
    emoji: '⚔️',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'keqing',
    name: 'Keqing',
    role: 'worker',
    roleLabel: '前端负责人',
    roleCardId: 'preset-frontend',
    theme: 'keqing',
    emoji: '⚡',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'zhongli',
    name: 'Zhongli',
    role: 'worker',
    roleLabel: '后端负责人',
    roleCardId: 'preset-backend',
    theme: 'zhongli',
    emoji: '🔶',
    isOnline: false,
    accountIds: [],
  },
  {
    id: 'nahida',
    name: 'Nahida',
    role: 'reviewer',
    roleLabel: '代码评审',
    roleCardId: 'preset-code-reviewer',
    theme: 'nahida',
    emoji: '🌿',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'albedo',
    name: 'Albedo',
    role: 'worker',
    roleLabel: '算法工程',
    roleCardId: 'preset-arch-reviewer',
    theme: 'albedo',
    emoji: '✨',
    isOnline: false,
    accountIds: [],
  },
  {
    id: 'venti',
    name: 'Venti',
    role: 'reviewer',
    roleLabel: 'QA 测试',
    roleCardId: 'preset-qa',
    theme: 'venti',
    emoji: '💨',
    isOnline: false,
    accountIds: [],
  },
];

// --- Helper Selectors ---
// Note: We use useShallow in components to avoid infinite loops when returning arrays
export const selectActiveAgents = (state: TaskHubState) => 
  AGENT_ROSTER.filter((a) => state.activeAgentIds.includes(a.id));

export const selectAvailableRoster = (state: TaskHubState) => 
  AGENT_ROSTER.filter((a) => !state.activeAgentIds.includes(a.id));
let taskCounter = 1;
let state_phases_seq = 1;

const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const EMPTY_EVENTS: InternalEvent[] = [];
const EMPTY_BLOCKERS: Blocker[] = [];
const EMPTY_CHAT: ChatMessage[] = [];

// --- Helpers for mapping DB rows to store shape ---
function mapMessagesToState(recentMessages: Record<string, any[]>): Record<string, ChatMessage[]> {
  const result: Record<string, ChatMessage[]> = {};
  for (const [convId, msgs] of Object.entries(recentMessages)) {
    result[convId] = msgs.map((m) => ({
      id: m.id,
      agentId: m.sender_type === 'human' ? 'human' : m.sender_id,
      content: m.content,
      timestamp: m.created_at,
      mentions: typeof m.mentions === 'string' ? JSON.parse(m.mentions || '[]') : (m.mentions || []),
      intent: m.intent,
      referencedTaskId: m.task_id,
      ...(m.metadata ? { metadata: JSON.parse(m.metadata) } : {}),
    }));
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

export const useTaskHubStore = create<TaskHubState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

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

          const tasks: Task[] = (data.tasks || []).map((t: any) => ({
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

          set({
            conversations,
            tasks,
            chatMessagesByConversation: mapMessagesToState(data.recentMessages || {}),
            agentSessions: mapSessionsToState(data.activeSessions || []),
            hasHydrated: true,
          });

          if (tasks.length) {
            const max = tasks.reduce((acc, t) => {
              const m = /^TASK-(\d+)$/.exec(t.id);
              const n = m ? Number(m[1]) : 0;
              return n > acc ? n : acc;
            }, 0);
            taskCounter = max + 1;
          }

          get().loadAccounts();

          get().refreshRuntimeCatalog();

          const existingIds = new Set(get().roleCards.map((c) => c.id));
          const missing = PRESET_ROLE_CARDS.filter((c) => !existingIds.has(c.id));
          if (missing.length) {
            set((state) => ({ roleCards: [...missing, ...state.roleCards] }));
          }
        } catch (err) {
          console.error('[loadFromServer] Failed:', err);
          set({ hasHydrated: true });
        }
      },
      refreshRuntimeCatalog: () => {},
      mergeLegacyChatMessages: (legacyMessages) => {
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
        set((state) => ({
          chatMessagesByConversation: {
            ...state.chatMessagesByConversation,
            [conversationId]: [...(state.chatMessagesByConversation[conversationId] || []), ...legacyMessages],
          },
        }));
      },

      isSettingsOpen: false,
      setSettingsOpen: (open) => set({ isSettingsOpen: open }),

      enableMockRunner: false,
      setEnableMockRunner: (enabled) => set({ enableMockRunner: enabled }),

      daemonConnection: { status: 'disconnected' },
      setDaemonConnection: (next) => set({ daemonConnection: next }),

      opencodeStatus: { checked: false, available: false },
      setOpencodeStatus: (status) => set({ opencodeStatus: status }),

      opencodeBridge: { url: '', enabled: false, checked: false, available: false },
      setOpencodeBridge: (bridge) => set({ opencodeBridge: bridge }),

      accounts: [],
      upsertAccount: async (account) => {
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

        set((state) => {
          const serverAccount = data.account;
          const exists = state.accounts.some((a) => a.id === serverAccount.id);
          return {
            accounts: exists
              ? state.accounts.map((a) => a.id === serverAccount.id ? serverAccount : a)
              : [serverAccount, ...state.accounts],
          };
        });

        return data.account.id;
      },
      removeAccount: async (accountId) => {
        await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
        set((state) => ({
          accounts: state.accounts.filter((a) => a.id !== accountId),
        }));
      },
      loadAccounts: async () => {
        try {
          const res = await fetch('/api/accounts');
          const data = await res.json();
          set({ accounts: data.accounts });
        } catch {}
      },

      getAvailableRuntime: () => {
        const s = get();
        if (s.opencodeStatus.checked && s.opencodeStatus.available) {
          return { engine: 'opencode' as CliEngine, available: true };
        }
        if (s.opencodeBridge.enabled && s.opencodeBridge.checked && s.opencodeBridge.available) {
          return { engine: 'opencode' as CliEngine, available: true };
        }
        if (s.enableMockRunner) {
          return { engine: 'mock' as CliEngine, available: true };
        }
        return null;
      },

      selectedProjectId: 'default',
      agentSessions: { default: {} },
      activeAgentIds: ['jean', 'keqing'],
      phases: [],
      conversations: [],
      selectedConversationId: null,
      tasks: [],
      chatMessagesByConversation: {},
      eventsByConversation: {},
      blockersByConversation: {},

      terminalLogs: {},
      agentStatus: {},
      activeRunsByAgent: {},
      activeStreamMessageId: {},

      connectDaemon: () => {
        if (socket.connected) return;
        get().setDaemonConnection({ status: 'connecting' });
        fetch('/api/daemon/init')
          .catch((e) => {
            get().setDaemonConnection({ status: 'disconnected', error: String((e as any)?.message || e) });
          })
          .finally(() => socket.connect());
      },

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

      createConversation: ({ title, goal, projectPath, priority, autoBreakdown }) => {
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

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          selectedConversationId: id,
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

        if (autoBreakdown !== false) {
          setTimeout(() => get().triggerBreakdown(id), 500);
        }
      },

      setSelectedConversationId: (conversationId) => set({ selectedConversationId: conversationId }),

      addEvent: ({ id, timestamp, ...event }) => {
        const resolvedId = id ?? makeId('evt');
        const resolvedTimestamp = timestamp ?? new Date().toISOString();
        const record: InternalEvent = { ...event, id: resolvedId, timestamp: resolvedTimestamp };
        set((state) => ({
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

      addSupervisorOutput: (output) => {
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

      openBlocker: ({ id, status, createdAt, ...input }) => {
        const resolvedId = id ?? makeId('blk');
        const stamp = createdAt ?? new Date().toISOString();
        const blocker: Blocker = {
          ...input,
          id: resolvedId,
          status: status ?? 'open',
          createdAt: stamp,
        };

        set((state) => ({
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

      fixBlocker: (conversationId, blockerId) => {
        const stamp = new Date().toISOString();
        set((state) => ({
          blockersByConversation: {
            ...state.blockersByConversation,
            [conversationId]: (state.blockersByConversation[conversationId] || []).map((b) =>
              b.id === blockerId ? { ...b, status: 'fixed', resolvedAt: stamp } : b
            ),
          },
        }));
        get().addEvent({ conversationId, type: 'blocker.fixed', payload: { blockerId } });
      },

      selectedTaskId: null,
      setSelectedTaskId: (id) => set({ selectedTaskId: id }),

      isNewTaskDialogOpen: false,
      setNewTaskDialogOpen: (open) => set({ isNewTaskDialogOpen: open }),

      isRosterModalOpen: false,
      setRosterModalOpen: (open) => set({ isRosterModalOpen: open }),

      agentAccountOverrides: {},
      setAgentAccountIds: (agentId, accountIds) =>
        set((state) => ({
          agentAccountOverrides: {
            ...state.agentAccountOverrides,
            [agentId]: accountIds,
          },
        })),

      createProgressMessage: (params, conversationId) => {
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

      // --- Role Card Store ---
      roleCards: [...PRESET_ROLE_CARDS],
      upsertRoleCard: (card) => {
        const now = new Date().toISOString();
        if (card.id) {
          set((state) => ({
            roleCards: state.roleCards.map((c) =>
              c.id === card.id
                ? { ...c, ...card, updatedAt: now, version: c.version + 1 } as RoleCard
                : c
            ),
          }));
          return card.id;
        }
        const id = makeId('rc');
        set((state) => ({
          roleCards: [
            ...state.roleCards,
            { ...card, id, isPreset: false, version: 1, createdAt: now, updatedAt: now } as RoleCard,
          ],
        }));
        return id;
      },
      removeRoleCard: (cardId) =>
        set((state) => ({
          roleCards: state.roleCards.filter((c) => !(c.id === cardId && !c.isPreset)),
        })),
      getRoleCardById: (cardId) => get().roleCards.find((c) => c.id === cardId),
      getRoleCardForAgent: (agentId) => {
        const agent = AGENT_ROSTER.find((a) => a.id === agentId);
        if (!agent?.roleCardId) return undefined;
        return get().roleCards.find((c) => c.id === agent.roleCardId);
      },
      setAgentRoleCardId: (agentId, roleCardId) => {
        const idx = AGENT_ROSTER.findIndex((a) => a.id === agentId);
        if (idx !== -1) {
          (AGENT_ROSTER as Agent[])[idx].roleCardId = roleCardId;
        }
        set({}); // trigger re-render
      },

      setRoleCardAccountIds: (roleCardId, accountIds) =>
        set((state) => ({
          roleCards: state.roleCards.map((c) =>
            c.id === roleCardId ? { ...c, accountIds, updatedAt: new Date().toISOString() } : c
          ),
        })),

      // Phase actions
      upsertPhase: (phaseData) => {
        const stamp = new Date().toISOString();
        const existing = get().phases.find((p) => p.id === phaseData.id);
        if (existing) {
          set((state) => ({
            phases: state.phases.map((p) =>
              p.id === phaseData.id ? { ...p, ...phaseData, updatedAt: stamp } : p
            ),
          }));
          return phaseData.id!;
        }
        const id = phaseData.id || `${get().selectedConversationId}-PHASE-${String(state_phases_seq++).padStart(3, '0')}`;
        set((state) => ({
          phases: [...state.phases, {
            id,
            conversationId: phaseData.conversationId,
            title: phaseData.title,
            description: phaseData.description,
            order: phaseData.order,
            status: phaseData.status,
            createdAt: stamp,
            updatedAt: stamp,
          }],
        }));
        return id;
      },

      removePhase: (phaseId) => {
        set((state) => ({ phases: state.phases.filter((p) => p.id !== phaseId) }));
      },

      setBreakdownStatus: (conversationId, status) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, breakdownStatus: status } : c
          ),
        }));
      },

      triggerBreakdown: (conversationId) => {
        const conv = get().conversations.find((c) => c.id === conversationId);
        if (!conv) return;

        // Account guard: check if Jean has valid accounts configured
        const jean = AGENT_ROSTER.find((a) => a.id === 'jean');
        const accounts = get().accounts;
        const roleCard = jean?.roleCardId ? get().roleCards.find((c) => c.id === jean.roleCardId) : null;
        const effectiveIds = (roleCard && roleCard.accountIds.length > 0)
          ? roleCard.accountIds
          : (get().agentAccountOverrides['jean'] ?? jean?.accountIds ?? []);
        const hasAccount = effectiveIds.some((aid) => accounts.some((a) => a.id === aid && a.enabled));
        if (!hasAccount) {
          get().setBreakdownStatus(conversationId, 'no_account');
          return;
        }

        get().setBreakdownStatus(conversationId, 'in_progress');
        const prompt = `你是项目统筹 Jean。请将以下项目目标拆解为 2-4 个阶段。

项目：${conv.title}
目标：${conv.goal}${conv.projectPath ? `\n项目路径：${conv.projectPath}` : ''}

请严格按以下格式输出，不要输出其他内容：

PHASE: {阶段名} | {阶段简述}
TASK: {任务标题} | {任务描述} @{推荐agentId}
TASK: {任务标题} | {任务描述} @{推荐agentId}
PHASE: {下一个阶段名} | {阶段简述}
TASK: {任务标题} | {任务描述} @{推荐agentId}`;
        get().dispatchToAgent({
          agentId: 'jean',
          prompt,
        });
      },

      confirmBreakdown: (conversationId, proposals) => {
        let taskSeq = get().tasks.length;
        for (let pi = 0; pi < proposals.length; pi++) {
          const prop = proposals[pi];
          const phaseId = get().upsertPhase({
            conversationId,
            title: prop.title,
            description: prop.description,
            order: pi,
            status: 'planned',
          });
          for (const taskProp of prop.tasks) {
            taskSeq++;
            const taskId = `TASK-${String(taskSeq).padStart(3, '0')}`;
            const stamp = new Date().toISOString();
            set((state) => ({
              tasks: [...state.tasks, {
                id: taskId,
                conversationId,
                phaseId,
                title: taskProp.title,
                description: taskProp.description,
                status: 'pending' as TaskStatus,
                agentId: taskProp.agentId || 'jean',
                dependencies: [],
                artifacts: [],
                createdAt: stamp,
                updatedAt: stamp,
              }],
            }));
          }
        }
        get().setBreakdownStatus(conversationId, 'confirmed');

        // System feedback message
        const totalTasks = proposals.reduce((sum, p) => sum + p.tasks.length, 0);
        const totalPhases = proposals.length;
        const phaseSummary = proposals.map((p, i) =>
          `阶段 ${i + 1}: ${p.tasks.length} 任务 ${i === 0 ? '✓ 已派发' : '⏳ 等待前置阶段'}`
        ).join('\n');

        const systemMsg = {
          id: `msg-${Date.now()}-sys`,
          agentId: 'system' as const,
          content: `已创建 **${totalTasks} 个任务**，分 **${totalPhases} 个阶段**执行：\n\n${phaseSummary}\n\n你可以随时 @Agent 追加指令或调整计划。`,
          timestamp: new Date().toISOString(),
          intent: 'general' as const,
          conversationId,
        };

        set((state) => ({
          chatMessagesByConversation: {
            ...state.chatMessagesByConversation,
            [conversationId]: [...(state.chatMessagesByConversation[conversationId] || []), systemMsg],
          },
        }));
      },
      isRoleCardDetailOpen: false,
      selectedRoleCardId: null,
      setRoleCardDetailOpen: (open, cardId) =>
        set({ isRoleCardDetailOpen: open, selectedRoleCardId: cardId ?? null }),
      isRoleCardEditorOpen: false,
      editingRoleCardId: null,
      setRoleCardEditorOpen: (open, cardId) =>
        set({ isRoleCardEditorOpen: open, editingRoleCardId: cardId ?? null }),

      inviteAgent: (agentId) =>
        set((state) => {
          if (state.activeAgentIds.includes(agentId)) return state;
          return { activeAgentIds: [...state.activeAgentIds, agentId] };
        }),

      dismissAgent: (agentId) =>
        set((state) => ({
          activeAgentIds: state.activeAgentIds.filter((id) => id !== agentId),
        })),

      getTasksByAgent: (agentId) => {
        const conversationId = get().selectedConversationId;
        return get().tasks.filter((t) => t.agentId === agentId && t.conversationId === conversationId);
      },

      getTaskById: (taskId) => {
        return get().tasks.find((t) => t.id === taskId);
      },

      getAgentCurrentTask: (agentId) => {
        return get().tasks.find((t) => t.agentId === agentId && t.status === 'in_progress');
      },

      upsertAgentSession: (projectId, agentId, sessionId) =>
        set((state) => ({
          agentSessions: {
            ...state.agentSessions,
            [projectId]: {
              ...(state.agentSessions[projectId] || {}),
              [agentId]: sessionId,
            },
          },
        })),

      dispatchToAgent: ({ agentId, prompt, referencedTaskId }) => {
        const projectId = get().selectedProjectId;
        const sessionId = get().agentSessions[projectId]?.[agentId];
        const conversationId =
          (referencedTaskId ? get().getTaskById(referencedTaskId)?.conversationId : undefined) ??
          get().selectedConversationId;
        if (!conversationId) return;
        const runId = makeId('run');
        const agent = AGENT_ROSTER.find((item) => item.id === agentId);
        // Account resolution: role card accounts > agent override > agent default
        let effectiveIds: string[] = [];
        if (agent) {
          const roleCard = agent.roleCardId ? get().roleCards.find((c) => c.id === agent.roleCardId) : null;
          if (roleCard && roleCard.accountIds.length > 0) {
            effectiveIds = roleCard.accountIds;
          } else {
            effectiveIds = get().agentAccountOverrides[agentId] ?? agent.accountIds;
          }
        }
        const resolvedBinding = agent ? resolveAgentEngine({ ...agent, accountIds: effectiveIds }, get().accounts) : null;
        const agentEngine = agent?.cliEngine ?? 'opencode';
        const resolvedEngine = get().getAvailableRuntime()?.engine ?? resolvedBinding?.engine ?? agentEngine;

        // Build role card context prefix
        let effectivePrompt = prompt;
        if (agent?.roleCardId) {
          const rc = get().roleCards.find((c) => c.id === agent.roleCardId);
          if (rc) {
            const parts: string[] = [`[Role: ${rc.displayName}]`];
            if (rc.responsibilities.length) parts.push(`Responsibilities: ${rc.responsibilities.join(', ')}`);
            if (rc.nonResponsibilities.length) parts.push(`NOT responsible for: ${rc.nonResponsibilities.join(', ')}`);
            if (rc.outputFormat !== 'freeform') parts.push(`Output format: ${rc.outputFormat}`);
            if (rc.requiresEvidence) parts.push('Must provide evidence/references');
            if (rc.forbiddenActions.length) parts.push(`Forbidden: ${rc.forbiddenActions.join(', ')}`);
            parts.push('---');
            effectivePrompt = `${parts.join('\n')}\n${prompt}`;
          }
        }

        set((state) => ({
          agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
          terminalLogs: { ...state.terminalLogs, [agentId]: [] },
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
          agentId,
          prompt: effectivePrompt,
          sessionId,
          allowMockRunner: get().enableMockRunner,
          opencodeBridgeUrl: get().opencodeBridge.enabled ? get().opencodeBridge.url : undefined,
          engine: resolvedEngine,
          accountIds: effectiveIds,
          accountId: resolvedBinding?.accountId ?? '',
        });
      },

      appendTerminalLog: (agentId, log) =>
        set((state) => ({
          terminalLogs: {
            ...state.terminalLogs,
            [agentId]: [...(state.terminalLogs[agentId] || []), log],
          },
        })),

      simulateCliExecution: (taskId, prompt, sessionId) => {
        const projectId = get().selectedProjectId;
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return;
        const agentId = task.agentId;
        const resolvedSessionId = sessionId || get().agentSessions[projectId]?.[agentId];
        const conversationId = task.conversationId;
        const runId = makeId('run');
        const agent = AGENT_ROSTER.find((item) => item.id === agentId);
        // Account resolution: role card accounts > agent override > agent default
        let effectiveIds: string[] = [];
        if (agent) {
          const roleCard = agent.roleCardId ? get().roleCards.find((c) => c.id === agent.roleCardId) : null;
          if (roleCard && roleCard.accountIds.length > 0) {
            effectiveIds = roleCard.accountIds;
          } else {
            effectiveIds = get().agentAccountOverrides[agentId] ?? agent.accountIds;
          }
        }
        const resolvedBinding = agent ? resolveAgentEngine({ ...agent, accountIds: effectiveIds }, get().accounts) : null;
        const agentEngine = agent?.cliEngine ?? 'opencode';
        const resolvedEngine = get().getAvailableRuntime()?.engine ?? resolvedBinding?.engine ?? agentEngine;

        set((state) => ({
          agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
          terminalLogs: { ...state.terminalLogs, [agentId]: [] },
          activeRunsByAgent: {
            ...state.activeRunsByAgent,
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
          sessionId: resolvedSessionId,
          allowMockRunner: get().enableMockRunner,
          opencodeBridgeUrl: get().opencodeBridge.enabled ? get().opencodeBridge.url : undefined,
          engine: resolvedEngine,
          accountIds: effectiveIds,
          accountId: resolvedBinding?.accountId ?? '',
        });
      },

      ensureStreamMessage: (agentId, conversationId) => {
        const existing = get().activeStreamMessageId[agentId];
        if (existing) {
          const msgs = get().chatMessagesByConversation[conversationId] ?? [];
          if (msgs.some((m) => m.id === existing)) return existing;
        }
        const id = `msg-${Date.now()}-${agentId}`;
        const stamp = new Date().toISOString();
        set((state) => ({
          activeStreamMessageId: { ...state.activeStreamMessageId, [agentId]: id },
          chatMessagesByConversation: {
            ...state.chatMessagesByConversation,
            [conversationId]: [
              ...(state.chatMessagesByConversation[conversationId] || []),
              { id, agentId, content: '', timestamp: stamp, isStreaming: true, toolEvents: [] },
            ],
          },
        }));
        return id;
      },

      appendToStreamMessage: (messageId, patch) => {
        set((state) => {
          const convId = state.selectedConversationId;
          if (!convId) return state;
          const msgs = state.chatMessagesByConversation[convId];
          if (!msgs) return state;
          return {
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [convId]: msgs.map((m) => {
                if (m.id !== messageId) return m;
                return {
                  ...m,
                  content: patch.content != null ? m.content + patch.content : m.content,
                  toolEvents: patch.toolEvent ? [...(m.toolEvents ?? []), patch.toolEvent] : m.toolEvents,
                };
              }),
            },
          };
        });
      },

      completeStreamMessage: (agentId) => {
        const activeId = get().activeStreamMessageId[agentId];
        if (!activeId) return;
        set((state) => {
          const { [agentId]: _, ...rest } = state.activeStreamMessageId;
          const convId = state.selectedConversationId;
          if (!convId) return { activeStreamMessageId: rest as Record<string, string> };
          const msgs = state.chatMessagesByConversation[convId];
          return {
            activeStreamMessageId: rest as Record<string, string>,
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [convId]: msgs
                ? msgs.map((m) => m.id === activeId ? { ...m, isStreaming: false } : m)
                : msgs,
            },
          };
        });
      },

      updateTaskStatus: (taskId, status, reviewNote) =>
        (() => {
          const prev = get().getTaskById(taskId);
          if (!prev) return;
          const conversationId = prev.conversationId;

          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status,
                    reviewNote: reviewNote ?? task.reviewNote,
                    updatedAt: new Date().toISOString(),
                  }
                : task
            ),
          }));

          get().addEvent({
            conversationId,
            type: 'task.status_changed',
            payload: { taskId, status, reviewNote },
          });

          fetch('/api/mutations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'task.updateStatus', payload: { id: taskId, status, reviewNote } }),
          }).catch((err) => console.error('[mutation] task.updateStatus failed:', err));

          if (status === 'done' || status === 'rejected' || status === 'blocked') {
            const task = get().tasks.find((t) => t.id === taskId);
            if (task) {
              fetch('/api/mutations', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'session.sealByTask', payload: { agentId: task.agentId, taskId, reason: `task_${status}` } }),
              }).catch((err) => console.error('[mutation] session.sealByTask failed:', err));
            }
          }

          if (prev && status === 'in_progress') {
            get().dispatchToAgent({
              agentId: prev.agentId,
              referencedTaskId: prev.id,
              prompt: `Start ${prev.id}: ${prev.title}. ${prev.description}`,
            });
          }
        })(),

      addTask: (taskData) => {
        const conversationId = get().selectedConversationId;
        if (!conversationId) return;
        const existing = get().tasks.find(
          (t) =>
            t.conversationId === conversationId &&
            t.title === taskData.title &&
            t.agentId === taskData.agentId
        );
        if (existing) return;

        const id = `TASK-${String(taskCounter++).padStart(3, '0')}`;
        const stamp = new Date().toISOString();

        set((state) => ({
          tasks: [
            ...state.tasks,
            { ...taskData, id, phaseId: taskData.phaseId || '', createdAt: stamp, updatedAt: stamp, conversationId },
          ],
        }));

        if (taskData.agentId) {
          get().dispatchToAgent({
            agentId: taskData.agentId,
            referencedTaskId: id,
            prompt: `You are assigned ${id}: ${taskData.title}. ${taskData.description}. Reply with your plan and next steps.`,
          });
        }

        fetch('/api/mutations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'task.create', payload: { id, conversation_id: conversationId, title: taskData.title, description: taskData.description, agent_id: taskData.agentId, dependencies: JSON.stringify(taskData.dependencies), artifacts: JSON.stringify(taskData.artifacts) } }),
        }).catch((err) => console.error('[mutation] task.create failed:', err));
      },

      removeTask: (taskId) =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== taskId),
          selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
        })),

      updateTask: (taskId, patch) => {
        const prev = get().getTaskById(taskId);

        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task
          ),
        }));

        if (prev && patch.agentId && patch.agentId !== prev.agentId) {
          const title = patch.title ?? prev.title;
          const description = patch.description ?? prev.description;
          get().dispatchToAgent({
            agentId: patch.agentId,
            referencedTaskId: taskId,
            prompt: `You are assigned ${taskId}: ${title}. ${description}. Reply with your plan and next steps.`,
          });
        }
      },

      addChatMessage: (msg) => {
        // Auto-create conversation if none selected and none exist
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

        // Auto-trigger Jean breakdown for new projects
        const existingConv = get().conversations.find((c: Conversation) => c.id === conversationId);
        if (existingConv && existingConv.breakdownStatus === 'none' && !mentions.length) {
          setTimeout(() => {
            const state = useTaskHubStore.getState();
            if (state.conversations.find((c: Conversation) => c.id === conversationId)?.breakdownStatus === 'none') {
              state.triggerBreakdown(conversationId);
            }
          }, 500);
        }

        set((state) => ({
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

        if (rest.agentId === 'human') {
          for (const mentionedAgentId of mentions.slice(0, 2)) {
            get().dispatchToAgent({
              agentId: mentionedAgentId,
              referencedTaskId: rest.referencedTaskId,
              prompt: rest.content,
            });
          }
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

      updateChatMessageStatus: (msgId, status, rejectionReason) =>
        set((state) => {
          let changed = false;
          const next = { ...state.chatMessagesByConversation };
          for (const conversationId of Object.keys(next)) {
            const msgs = next[conversationId] || [];
            const idx = msgs.findIndex((m) => m.id === msgId);
            if (idx === -1) continue;
            changed = true;
            next[conversationId] = msgs.map((m) =>
              m.id === msgId
                ? { ...m, approvalStatus: status, ...(status === 'rejected' && rejectionReason ? { rejectionReason } : {}) }
                : m
            );
          }
          return changed ? { chatMessagesByConversation: next } : {};
        }),
    }),
  {
    name: 'agent-task-hub-store-clean',
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
      phases: state.phases,
    }),
    onRehydrateStorage: () => (state) => {
      if (!state) return;

      // Backfill breakdownStatus and projectPath on existing conversations
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

      // Backfill phaseId on existing tasks
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
});

socket.on('disconnect', () => {
  useTaskHubStore.getState().setDaemonConnection({ status: 'disconnected' });
});

socket.on('connect_error', (err) => {
  useTaskHubStore.getState().setDaemonConnection({ status: 'disconnected', error: String((err as any)?.message || err) });
});

socket.on('terminal:data', ({ agentId, data }) => {
  useTaskHubStore.getState().appendTerminalLog(agentId, data);
});

socket.on('agent:session', ({ projectId, agentId, sessionId }) => {
  useTaskHubStore.getState().upsertAgentSession(projectId || 'default', agentId, sessionId);
  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
  }));
});

socket.on('agent:event', (event) => {
  const { taskId, agentId, type, message, toolName, toolInput } = event;
  const state = useTaskHubStore.getState();
  const conversationId = state.selectedConversationId;
  if (!conversationId) return;

  if (type === 'step_start') {
    state.ensureStreamMessage(agentId, conversationId);
    return;
  }

  const activeId = state.activeStreamMessageId[agentId];
  if (!activeId) {
    state.addChatMessage({
      agentId: agentId || 'system',
      content: message || JSON.stringify(event),
      referencedTaskId: taskId,
    });
    return;
  }

  if (type === 'message') {
    state.appendToStreamMessage(activeId, { content: message });
  } else if (type === 'tool_use') {
    state.appendToStreamMessage(activeId, {
      toolEvent: {
        id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'tool_use',
        label: toolName || 'unknown',
        detail: toolInput,
        timestamp: new Date().toISOString(),
      },
    });
  } else if (type === 'step_finish') {
    state.appendToStreamMessage(activeId, {
      toolEvent: {
        id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'step_finish',
        label: '完成',
        timestamp: new Date().toISOString(),
      },
    });
  } else if (type === 'error') {
    state.appendToStreamMessage(activeId, {
      toolEvent: {
        id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'error',
        label: '错误',
        detail: message,
        timestamp: new Date().toISOString(),
      },
    });
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

    const task = store.tasks.find((t) => t.id === taskId);
    if (task) {
      fetch('/api/mutations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'session.sealByTask', payload: { agentId: task.agentId, taskId, reason: `exit_${code}` } }),
      }).catch(() => {});
    }
  }

  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
    activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
  }));
  useTaskHubStore.getState().completeStreamMessage(agentId);
});

socket.on('agent:error', ({ agentId, message, reasonCode }: { agentId: string; message: string; reasonCode?: string }) => {
  const state = useTaskHubStore.getState();
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
