'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { io } from 'socket.io-client';
import type { RoleCard } from '@/types/roleCard';
import type { Phase, PhaseStatus } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
import type { CliEngine, DetectedRuntime } from '@/server/types';
import { PRESET_ROLE_CARDS, PRESET_ROLE_CARD_MAP } from '@/data/presetRoleCards';
import { composeSystemPrompt, composeUserPrompt } from '@/lib/agent-context/PromptComposer';
import type { ComposeOptions, SkillSummary } from '@/lib/agent-context/PromptComposer';
import { DispatchAdvisor } from '@/lib/dispatchAdvisor';

export type { CliEngine, DetectedRuntime };

const socket = io(undefined, { path: '/api/socketio', autoConnect: false });

/** Stream timeout watchdogs — auto-complete stuck streaming messages after 5min of silence. */
const STREAM_WATCHDOG_MS = 300_000;
const streamWatchdogs: Record<string, ReturnType<typeof setTimeout>> = {};

/** Stream content debounce — batch text appends via rAF to reduce React re-renders. */
const streamBuffer: Record<string, string> = {};
let bufferFlushScheduled = false;

function scheduleBufferFlush() {
  if (bufferFlushScheduled) return;
  bufferFlushScheduled = true;
  requestAnimationFrame(() => {
    bufferFlushScheduled = false;
    const state = useTaskHubStore.getState();
    const entries = Object.entries(streamBuffer);
    for (const [messageId, pending] of entries) {
      if (!pending) continue;
      delete streamBuffer[messageId];
      // Find which conversation this message belongs to via active stream tracking
      const agentEntry = Object.entries(state.activeStreamMessageId).find(([, id]) => id === messageId);
      const convId = agentEntry ? state.activeStreamConversationId[agentEntry[0]] : undefined;
      if (!convId) continue;
      useTaskHubStore.setState((s) => {
        const msgs = s.chatMessagesByConversation[convId];
        if (!msgs) return s;
        return {
          chatMessagesByConversation: {
            ...s.chatMessagesByConversation,
            [convId]: msgs.map((m) =>
              m.id === messageId ? { ...m, content: m.content + pending } : m
            ),
          },
        };
      });
    }
  });
}

function resetWatchdog(agentId: string) {
  if (streamWatchdogs[agentId]) clearTimeout(streamWatchdogs[agentId]);
  streamWatchdogs[agentId] = setTimeout(() => {
    const state = useTaskHubStore.getState();
    if (state.activeStreamMessageId[agentId]) {
      console.warn(`[watchdog] Stream for ${agentId} timed out after ${STREAM_WATCHDOG_MS / 1000}s, auto-completing`);
      useTaskHubStore.setState((s) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'idle' },
        activeRunsByAgent: { ...s.activeRunsByAgent, [agentId]: undefined },
      }));
      useTaskHubStore.getState().completeStreamMessage(agentId);
    }
    delete streamWatchdogs[agentId];
  }, STREAM_WATCHDOG_MS);
}

function clearWatchdog(agentId: string) {
  if (streamWatchdogs[agentId]) {
    clearTimeout(streamWatchdogs[agentId]);
    delete streamWatchdogs[agentId];
  }
}

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

export type AgentTheme = 'mario' | 'luigi' | 'toad' | 'peach' | 'dk' | 'yoshi';

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
  type: 'tool_use' | 'tool_result' | 'error';
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

export interface PendingDispatch {
  prompt: string;
  referencedTaskId?: string;
  queuedAt: string;
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

  daemonRuntimes: DetectedRuntime[];
  setDaemonRuntimes: (runtimes: DetectedRuntime[]) => void;

  accounts: Account[];
  upsertAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastVerifiedAt' | 'verifyError' | 'hasApiKey'> & { id?: string; apiKey?: string }) => Promise<string>;
  removeAccount: (accountId: string) => Promise<void>;
  loadAccounts: () => Promise<void>;

  selectedProjectId: ProjectId;
  agentSessions: Record<ProjectId, Record<string, string | undefined>>;
  // Tracks whether next dispatch needs full compose (role card + history).
  // Keyed by `${projectId}:${agentId}`. undefined / true = needs full compose.
  needsFullCompose: Record<string, boolean>;
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

  // --- Terminal Store ---
  terminalLogs: Record<string, string[]>;
  agentStatus: Record<string, 'idle' | 'busy'>;
  activeRunsByAgent: Record<string, { runId: string; taskId?: string; conversationId: string; startedAt: string } | undefined>;
  activeStreamMessageId: Record<string, string>;
  activeStreamConversationId: Record<string, string>;
  pendingDispatches: Record<string, PendingDispatch[]>;

  // Actions
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
  triggerProposal: (conversationId: string) => void;
  confirmBreakdown: (conversationId: string, proposals: PhaseProposal[]) => void;

  // Role Card UI state
  isRoleCardDetailOpen: boolean;
  selectedRoleCardId: string | null;
  setRoleCardDetailOpen: (open: boolean, cardId?: string) => void;
  isRoleCardEditorOpen: boolean;
  editingRoleCardId: string | null;
  setRoleCardEditorOpen: (open: boolean, cardId?: string) => void;

  // Skill state
  skillsMap: Record<string, SkillSummary>;
  agentSkillIds: Record<string, string[]>;
  loadSkills: () => Promise<void>;
  getSkillsForAgent: (agentId: string) => SkillSummary[];
  assignSkillsToAgent: (agentId: string, skillIds: string[]) => Promise<void>;
  importSkills: (source: string) => Promise<{ imported?: number; error?: string }>;
}

// --- Initial Data (Pixel-art themed) ---
export const AGENT_ROSTER: Agent[] = [
  {
    id: 'mario',
    name: 'Mario',
    role: 'planner',
    roleLabel: '项目统筹',
    roleCardId: 'preset-planner',
    theme: 'mario',
    emoji: '⭐',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'luigi',
    name: 'Luigi',
    role: 'worker',
    roleLabel: '前端实现',
    roleCardId: 'preset-frontend',
    theme: 'luigi',
    emoji: '⚡',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'toad',
    name: 'Toad',
    role: 'worker',
    roleLabel: '后端开发',
    roleCardId: 'preset-backend',
    theme: 'toad',
    emoji: '🛡️',
    isOnline: false,
    accountIds: [],
  },
  {
    id: 'peach',
    name: 'Peach',
    role: 'reviewer',
    roleLabel: '代码评审',
    roleCardId: 'preset-code-reviewer',
    theme: 'peach',
    emoji: '🌸',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'dk',
    name: 'Donkey Kong',
    role: 'worker',
    roleLabel: '架构工程',
    roleCardId: 'preset-arch-reviewer',
    theme: 'dk',
    emoji: '⚙️',
    isOnline: false,
    accountIds: [],
  },
  {
    id: 'yoshi',
    name: 'Yoshi',
    role: 'reviewer',
    roleLabel: 'QA 测试',
    roleCardId: 'preset-qa',
    theme: 'yoshi',
    emoji: '🎵',
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

export const selectPendingCount = (state: TaskHubState) => {
  const counts: Record<string, number> = {};
  for (const [agentId, queue] of Object.entries(state.pendingDispatches)) {
    if (queue && queue.length > 0) counts[agentId] = queue.length;
  }
  return counts;
};
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
    const mapped: ChatMessage[] = [];
    for (const m of msgs) {
      const isToolUse = m.content_type === 'tool_use';

      if (isToolUse) {
        // Merge tool_use rows into the preceding agent message's toolEvents
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
          // Orphan tool_use without preceding agent message — create a synthetic one
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

          const mergedSessions = mergeSessions(
            mapSessionsToState(data.activeSessions || []),
            get().agentSessions,
          );

          // Derive needsFullCompose from hydrated sessions:
          // agents with active sessions already had role card injected
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
            taskCounter = max + 1;
          }

          get().loadAccounts();

          get().refreshRuntimeCatalog();

          const existingIds = new Set(get().roleCards.map((c) => c.id));
          const missing = PRESET_ROLE_CARDS.filter((c) => !existingIds.has(c.id));
          if (missing.length) {
            set((state) => ({ roleCards: [...missing, ...state.roleCards] }));
          }

          get().loadSkills();
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

      daemonRuntimes: [],
      setDaemonRuntimes: (runtimes) => set({ daemonRuntimes: runtimes }),

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
        const runtimes = get().daemonRuntimes;
        const found = runtimes.find((r) => r.available);
        if (found) return { engine: found.engine, available: true };
        if (get().enableMockRunner) {
          return { engine: 'mock' as CliEngine, available: true };
        }
        return null;
      },

      selectedProjectId: 'default',
      agentSessions: { default: {} },
      needsFullCompose: {},
      activeAgentIds: ['mario', 'luigi'],
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
      activeStreamConversationId: {},
      pendingDispatches: {},

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

      createConversation: ({ title, goal, projectPath, priority }) => {
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

      setSelectedConversationId: (conversationId) => set({ selectedConversationId: conversationId, selectedProjectId: conversationId || 'default' }),

      deleteConversation: (conversationId) => {
        const state = get();
        // Clear selection if deleting the active conversation
        if (state.selectedConversationId === conversationId) {
          set({ selectedConversationId: null, selectedProjectId: 'default' });
        }
        // Remove local state
        const { [conversationId]: _msgs, ...restMsgs } = state.chatMessagesByConversation;
        const { [conversationId]: _evts, ...restEvts } = state.eventsByConversation;
        const { [conversationId]: _blockers, ...restBlockers } = state.blockersByConversation;
        set({
          conversations: state.conversations.filter((c) => c.id !== conversationId),
          tasks: state.tasks.filter((t) => t.conversationId !== conversationId),
          chatMessagesByConversation: restMsgs,
          eventsByConversation: restEvts,
          blockersByConversation: restBlockers,
        });
        // Server-side delete
        fetch('/api/mutations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'conversation.delete', payload: { id: conversationId } }),
        }).catch(() => {});
      },

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

      triggerProposal: (conversationId) => {
        const conv = get().conversations.find((c) => c.id === conversationId);
        if (!conv) return;

        // Account guard: check if Mario has valid accounts configured
        const mario = AGENT_ROSTER.find((a) => a.id === 'mario');
        const accounts = get().accounts;
        const roleCard = mario?.roleCardId ? get().roleCards.find((c) => c.id === mario.roleCardId) : null;
        const effectiveIds = (roleCard && roleCard.accountIds.length > 0)
          ? roleCard.accountIds
          : (get().agentAccountOverrides['mario'] ?? mario?.accountIds ?? []);
        const hasAccount = effectiveIds.some((aid) => accounts.some((a) => a.id === aid && a.enabled));
        if (!hasAccount) {
          get().setBreakdownStatus(conversationId, 'no_account');
          return;
        }

        get().setBreakdownStatus(conversationId, 'proposal');
        const prompt = `请先基于以下项目目标输出一份技术架构方案和业务方案草案。

方案需要包含：
- 技术架构：核心技术选型、模块划分、关键依赖
- 业务方案：核心流程、边界条件、优先级建议

和用户讨论确认后，当你判断需求已足够清晰，再使用 PHASE/TASK 格式输出任务拆解。

项目：${conv.title}
目标：${conv.goal}${conv.projectPath ? `\n项目路径：${conv.projectPath}` : ''}`;
        get().dispatchToAgent({
          agentId: 'mario',
          prompt,
        });
      },

      confirmBreakdown: (conversationId, proposals) => {
        // Build AgentProfile list from AGENT_ROSTER + RoleCards
        const allRoleCards = get().roleCards;
        const agentProfiles = AGENT_ROSTER.map((agent) => {
          const rc = allRoleCards.find((c) => c.id === agent.roleCardId);
          return {
            id: agent.id,
            forbiddenActions: rc?.forbiddenActions ?? [],
            capabilities: rc?.capabilities,
          };
        });

        // Count current load per agent
        const currentTasks = get().tasks;
        const currentLoad: Record<string, number> = {};
        for (const t of currentTasks) {
          if (t.status === 'in_progress' || t.status === 'pending') {
            currentLoad[t.agentId] = (currentLoad[t.agentId] ?? 0) + 1;
          }
        }

        const advisor = new DispatchAdvisor(agentProfiles);
        const enriched = advisor.suggest(proposals, currentLoad);

        let taskSeq = get().tasks.length;
        for (let pi = 0; pi < enriched.length; pi++) {
          const prop = enriched[pi];
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
                agentId: taskProp.agentId || 'mario',
                dependencies: [],
                artifacts: [],
                createdAt: stamp,
                updatedAt: stamp,
              }],
            }));
          }
        }
        get().setBreakdownStatus(conversationId, 'confirmed');

        // System feedback message with per-agent assignment details
        const totalTasks = enriched.reduce((sum, p) => sum + p.tasks.length, 0);
        const totalPhases = enriched.length;
        const phaseSummary = enriched.map((p, i) => {
          const taskLines = p.tasks.map((t) => {
            const agentName = t.agentId ? `→ @${t.agentId}` : '→ 未分配';
            return `  - ${t.title} ${agentName}`;
          }).join('\n');
          return `阶段 ${i + 1}:\n${taskLines}`;
        }).join('\n\n');

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

      // Skill state
      skillsMap: {},
      agentSkillIds: {},
      loadSkills: async () => {
        try {
          const res = await fetch('/api/skills');
          const rawSkills = await res.json();
          const map: Record<string, SkillSummary> = {};
          for (const s of rawSkills) {
            map[s.id] = {
              name: s.name,
              content: s.content,
              files: (s.files ?? []).map((f: { path: string; content: string }) => ({ path: f.path, content: f.content })),
            };
          }

          // Load agent-skill assignments and merge any agent-specific skill data
          const agentIds = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'];
          const assignments: Record<string, string[]> = {};
          await Promise.all(agentIds.map(async (id) => {
            try {
              const r = await fetch(`/api/agents/${id}/skills`);
              const agentSkills = await r.json();
              for (const as of agentSkills) {
                if (!map[as.id]) {
                  map[as.id] = {
                    name: as.name,
                    content: as.content,
                    files: (as.files ?? []).map((f: { path: string; content: string }) => ({ path: f.path, content: f.content })),
                  };
                }
              }
              assignments[id] = agentSkills.map((s: { id: string }) => s.id);
            } catch { /* ignore */ }
          }));
          set({ skillsMap: map, agentSkillIds: assignments });
        } catch (err) {
          console.error('[loadSkills] Failed:', err);
        }
      },
      getSkillsForAgent: (agentId) => {
        const { skillsMap, agentSkillIds } = get();
        const ids = agentSkillIds[agentId] ?? [];
        return ids.map((id) => skillsMap[id]).filter(Boolean);
      },
      assignSkillsToAgent: async (agentId, skillIds) => {
        await fetch(`/api/agents/${agentId}/skills`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skillIds }),
        });
        set((state) => ({
          agentSkillIds: { ...state.agentSkillIds, [agentId]: skillIds },
        }));
      },
      importSkills: async (source) => {
        const res = await fetch('/api/skills/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source }),
        });
        const result = await res.json();
        if (result.imported) {
          await get().loadSkills();
        }
        return result;
      },

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
        // If agent is busy, enqueue instead of dispatching
        if (get().agentStatus[agentId] === 'busy') {
          console.log(`[dispatch] ${agentId} busy, enqueuing`);
          get().enqueueDispatch(agentId, { prompt, referencedTaskId });
          return;
        }
        const projectId = get().selectedProjectId;
        const sessionId = get().agentSessions[projectId]?.[agentId];
        const conversationId =
          (referencedTaskId ? get().getTaskById(referencedTaskId)?.conversationId : undefined) ??
          get().selectedConversationId;
        if (!conversationId) {
          console.warn(`[dispatch] ${agentId} aborted: no conversationId`);
          return;
        }
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
        const resolvedEngine = resolvedBinding?.engine ?? agentEngine;

        console.log(`[dispatch] ${agentId} → engine=${resolvedEngine}, accountId=${resolvedBinding?.accountId ?? '(none)'}, convId=${conversationId}`);

        // Build prompts via PromptComposer
        const roleCard = agent?.roleCardId ? get().roleCards.find((c) => c.id === agent.roleCardId) : undefined;
        const conv = get().conversations.find((c) => c.id === conversationId);
        const task = referencedTaskId ? get().getTaskById(referencedTaskId) : undefined;
        const phase = task?.phaseId ? get().phases.find((p) => p.id === task.phaseId) : undefined;

        const composeKey = `${projectId}:${agentId}`;
        const isFirstWake = get().needsFullCompose[composeKey] !== false;

        const composeOpts: ComposeOptions = {
          agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
          roleCard,
          allRoleCards: get().roleCards,
          project: { name: conv?.title ?? '', path: conv?.projectPath ?? '' },
          isFirstWake,
          messages: isFirstWake ? (get().chatMessagesByConversation[conversationId] ?? []) : undefined,
          task: task ? {
            id: task.id, title: task.title,
            description: task.description,
            phase: phase ? { title: phase.title } : undefined,
          } : undefined,
          rawPrompt: prompt,
          currentLoad: Object.fromEntries(
            AGENT_ROSTER.map((rosterAgent) => [
              rosterAgent.id,
              get().tasks.filter(
                (t) =>
                  t.agentId === rosterAgent.id &&
                  (t.status === 'in_progress' || t.status === 'pending'),
              ).length,
            ]),
          ),
          tasks: get().tasks
            .filter((t) => t.conversationId === conversationId)
            .map((t) => ({
              id: t.id,
              title: t.title,
              agentId: t.agentId,
              status: t.status,
            })),
          skills: get().getSkillsForAgent(agentId),
        };

        const systemPrompt = composeSystemPrompt(composeOpts);
        const effectivePrompt = composeUserPrompt(composeOpts);

        console.log(`[dispatch] ${agentId} isFirstWake=${composeOpts.isFirstWake}, systemPrompt=${systemPrompt ? `${systemPrompt.length} chars` : 'undefined'}, roleCard=${composeOpts.roleCard?.id ?? '(none)'}`);

        set((state) => ({
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

      enqueueDispatch: (agentId, payload) => {
        const entry: PendingDispatch = { ...payload, queuedAt: new Date().toISOString() };

        // Coalescing: if a pending dispatch already exists for this agent+task, merge instead of enqueue
        const existing = get().pendingDispatches[agentId];
        if (existing && existing.length > 0 && payload.referencedTaskId) {
          const match = existing.find((d) => d.referencedTaskId === payload.referencedTaskId);
          if (match) {
            match.prompt = `${match.prompt}\n\n[追加指令]: ${payload.prompt}`;
            set((state) => ({
              pendingDispatches: { ...state.pendingDispatches },
            }));
            return;
          }
        }

        set((state) => ({
          pendingDispatches: {
            ...state.pendingDispatches,
            [agentId]: [...(state.pendingDispatches[agentId] || []), entry],
          },
        }));

        // Persist dispatch to DB for crash recovery
        fetch('/api/mutations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'dispatch.enqueue',
            payload: { agentId, prompt: payload.prompt, referencedTaskId: payload.referencedTaskId },
          }),
        }).catch(() => {});
      },

      dequeueNextPending: (agentId) => {
        const queue = get().pendingDispatches[agentId];
        if (!queue || queue.length === 0) return;
        const [next, ...rest] = queue;
        const nextPending = { ...get().pendingDispatches };
        if (rest.length > 0) {
          nextPending[agentId] = rest;
        } else {
          delete nextPending[agentId];
        }
        set({ pendingDispatches: nextPending });
        // Show the human message in chat now that it's actually being dispatched
        const conversationId = get().selectedConversationId;
        if (conversationId) {
          set((state) => ({
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [conversationId]: [
                ...(state.chatMessagesByConversation[conversationId] || []),
                {
                  id: `msg-${Date.now()}`,
                  agentId: 'human' as const,
                  content: next.prompt,
                  referencedTaskId: next.referencedTaskId,
                  timestamp: new Date().toISOString(),
                  mentions: [agentId],
                  intent: 'general' as const,
                },
              ],
            },
          }));
        }
        // Dispatch — agent is idle now
        get().dispatchToAgent({ agentId, prompt: next.prompt, referencedTaskId: next.referencedTaskId });
      },

      clearPendingDispatches: (agentId) => {
        const nextPending = { ...get().pendingDispatches };
        delete nextPending[agentId];
        set({ pendingDispatches: nextPending });
      },

      forceSendDispatch: ({ agentId, prompt, referencedTaskId }) => {
        // Kill the running process
        socket.emit('terminal:kill', { agentId, projectId: get().selectedProjectId, force: true });
        // Clear any queued messages
        get().clearPendingDispatches(agentId);
        // Complete any active stream
        get().completeStreamMessage(agentId);
        // Mark agent idle so dispatch proceeds
        set((state) => ({
          agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
          activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
        }));
        // Small delay for kill to take effect, then dispatch
        setTimeout(() => {
          get().dispatchToAgent({ agentId, prompt, referencedTaskId });
        }, 500);
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
        const resolvedEngine = resolvedBinding?.engine ?? agentEngine;

        // Build system prompt via PromptComposer
        const simRoleCard = agent?.roleCardId ? get().roleCards.find((c) => c.id === agent.roleCardId) : undefined;
        const simComposeKey = `${projectId}:${agentId}`;
        const simIsFirstWake = get().needsFullCompose[simComposeKey] !== false;

        const simOpts: ComposeOptions = {
          agent: agent ? { id: agent.id, name: agent.name } : { id: agentId, name: agentId },
          roleCard: simRoleCard,
          allRoleCards: get().roleCards,
          project: { name: '', path: '' },
          isFirstWake: simIsFirstWake,
          rawPrompt: prompt,
          skills: get().getSkillsForAgent(agentId),
        };

        const systemPrompt = composeSystemPrompt(simOpts);

        set((state) => ({
          agentStatus: { ...state.agentStatus, [agentId]: 'busy' },
          terminalLogs: { ...state.terminalLogs, [agentId]: [] },
          needsFullCompose: { ...state.needsFullCompose, [simComposeKey]: false },
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
          systemPrompt,
          sessionId: resolvedSessionId,
          allowMockRunner: get().enableMockRunner,
          opencodeBridgeUrl: undefined,
          engine: resolvedEngine,
          accountIds: effectiveIds,
          accountId: resolvedBinding?.accountId ?? '',
        });
      },

      ensureStreamMessage: (agentId, conversationId) => {
        const existing = get().activeStreamMessageId[agentId];
        if (existing) {
          const existingConvId = get().activeStreamConversationId[agentId];
          const msgs = get().chatMessagesByConversation[existingConvId ?? conversationId] ?? [];
          if (msgs.some((m) => m.id === existing)) {
            resetWatchdog(agentId);
            return existing;
          }
        }
        const id = `msg-${Date.now()}-${agentId}`;
        const stamp = new Date().toISOString();
        set((state) => ({
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
        resetWatchdog(agentId);
        return id;
      },

      appendToStreamMessage: (messageId, patch) => {
        // Resolve conversation from tracked stream state
        const agentEntry = Object.entries(get().activeStreamMessageId).find(([, id]) => id === messageId);
        const trackedConvId = agentEntry ? get().activeStreamConversationId[agentEntry[0]] : undefined;
        if (!trackedConvId) return; // no tracked conversation
        // Reset watchdog on each append
        if (agentEntry) resetWatchdog(agentEntry[0]);

        // Buffer content via rAF to batch React re-renders
        if (patch.content != null) {
          streamBuffer[messageId] = (streamBuffer[messageId] || '') + patch.content;
          scheduleBufferFlush();
        }

        // Tool events are low-frequency
        if (patch.toolEvent) {
          set((state) => {
            const convId = trackedConvId;
            const msgs = state.chatMessagesByConversation[convId];
            if (!msgs) return state;
            return {
              chatMessagesByConversation: {
                ...state.chatMessagesByConversation,
                [convId]: msgs.map((m) => {
                  if (m.id !== messageId) return m;
                  return { ...m, toolEvents: [...(m.toolEvents ?? []), patch.toolEvent!] };
                }),
              },
            };
          });
        }
      },

      completeStreamMessage: (agentId) => {
        const activeId = get().activeStreamMessageId[agentId];
        if (!activeId) return;
        clearWatchdog(agentId);
        const trackedConvId = get().activeStreamConversationId[agentId];
        set((state) => {
          const { [agentId]: _, ...restMsgIds } = state.activeStreamMessageId;
          const { [agentId]: __, ...restConvIds } = state.activeStreamConversationId;
          if (!trackedConvId) return { activeStreamMessageId: restMsgIds as Record<string, string>, activeStreamConversationId: restConvIds as Record<string, string> };
          const msgs = state.chatMessagesByConversation[trackedConvId];
          return {
            activeStreamMessageId: restMsgIds as Record<string, string>,
            activeStreamConversationId: restConvIds as Record<string, string>,
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [trackedConvId]: msgs
                ? msgs.map((m) => m.id === activeId ? { ...m, isStreaming: false } : m)
                : msgs,
            },
          };
        });
      },

      cleanupStaleStreams: () => {
        const state = get();
        const updates: Record<string, ChatMessage[]> = {};
        for (const [convId, msgs] of Object.entries(state.chatMessagesByConversation)) {
          const hasStale = msgs.some((m) => m.isStreaming);
          if (hasStale) {
            updates[convId] = msgs.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
          }
        }
        if (Object.keys(updates).length > 0) {
          set({ chatMessagesByConversation: { ...state.chatMessagesByConversation, ...updates } });
        }
        if (Object.keys(state.activeStreamMessageId).length > 0) {
          set({ activeStreamMessageId: {}, activeStreamConversationId: {} });
        }
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

        // Auto-trigger Mario proposal for new projects
        const existingConv = get().conversations.find((c: Conversation) => c.id === conversationId);
        if (existingConv && existingConv.breakdownStatus === 'none' && !mentions.length) {
          setTimeout(() => {
            const state = useTaskHubStore.getState();
            if (state.conversations.find((c: Conversation) => c.id === conversationId)?.breakdownStatus === 'none') {
              state.triggerProposal(conversationId);
            }
          }, 500);
        }

        // For human messages with @mentions, determine queue behavior
        if (rest.agentId === 'human') {
          const uniqueMentions = [...new Set<string>(mentions)].filter((id) =>
            AGENT_ROSTER.some((a) => a.id === id),
          );

          if (uniqueMentions.length > 0) {
            const busyAgents = uniqueMentions.filter((id) => get().agentStatus[id] === 'busy');
            const idleAgents = uniqueMentions.filter((id) => get().agentStatus[id] !== 'busy');

            if (busyAgents.length === uniqueMentions.length) {
              // ALL mentioned agents are busy — only enqueue, don't show chat bubble
              for (const agentId of busyAgents) {
                get().enqueueDispatch(agentId, { prompt: rest.content, referencedTaskId: rest.referencedTaskId });
              }
              return;
            }

            // Some idle, some busy — show bubble, dispatch idle ones, enqueue busy ones
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
            // No valid @mentions — just show the message
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
          }
        } else {
          // Non-human messages (agent, system) — always add to chat
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
    version: 3,
    migrate: (persisted: any, version: number) => {
      if (version === 0) {
        // Migrate legacy agent IDs to the current Mario roster IDs
        const idMap: Record<string, string> = {
          jean: 'mario', keqing: 'luigi', zhongli: 'toad',
          nahida: 'peach', albedo: 'dk', venti: 'yoshi',
        };
        const remap = (id: string) => idMap[id] ?? id;

        // activeAgentIds
        if (Array.isArray(persisted.activeAgentIds)) {
          persisted.activeAgentIds = persisted.activeAgentIds.map(remap);
        }

        // agentSessions: clear entirely — old CLI sessions are dead after migration
        persisted.agentSessions = {};

        // agentAccountOverrides: Record<agentId, string[]>
        if (persisted.agentAccountOverrides && typeof persisted.agentAccountOverrides === 'object') {
          const mapped: Record<string, any> = {};
          for (const [aid, ids] of Object.entries(persisted.agentAccountOverrides)) {
            mapped[remap(aid)] = ids;
          }
          persisted.agentAccountOverrides = mapped;
        }

        // tasks[].agentId
        if (Array.isArray(persisted.tasks)) {
          persisted.tasks = persisted.tasks.map((t: any) => ({
            ...t,
            agentId: remap(t.agentId),
          }));
        }

        // chatMessagesByConversation messages[].agentId + mentions
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
        // Clear stale CLI sessions — agents need fresh systemPrompt injection
        persisted.agentSessions = {};
      }
      if (version < 3) {
        // Reset activeAgentIds to defaults — stale persistence could include all 6 agents
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

  // Request available runtimes
  socket.emit('runtimes:list', (response: { runtimes: DetectedRuntime[] }) => {
    if (response?.runtimes) {
      useTaskHubStore.getState().setDaemonRuntimes(response.runtimes);
    }
  });

  // Sync daemon process state
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

  // Clean up stale streaming messages from previous session
  useTaskHubStore.getState().cleanupStaleStreams();
});

socket.on('disconnect', () => {
  useTaskHubStore.getState().setDaemonConnection({ status: 'disconnected' });
});

socket.on('connect_error', (err) => {
  useTaskHubStore.getState().setDaemonConnection({ status: 'disconnected', error: String((err as any)?.message || err) });
});

socket.on('runtimes:update', ({ runtimes }: { runtimes: DetectedRuntime[] }) => {
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

  // Resolve conversationId: prefer event payload, then active run tracking, then selected
  // Daemon may send 'default' as fallback — resolve to actual frontend conversation
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

  // Register session ID if present — scope to actual project, not hardcoded 'default'
  if (sessionId) {
    const actualProjectId = useTaskHubStore.getState().selectedProjectId;
    state.upsertAgentSession(actualProjectId, agentId, sessionId);
  }

  // Heartbeat: daemon keeps the watchdog alive while process is running
  if (type === 'heartbeat') {
    resetWatchdog(agentId);
    return;
  }

  // 'done' event signals completion — just complete the stream
  if (type === 'done') {
    state.completeStreamMessage(agentId);
    return;
  }

  // Auto-create stream message on first event if not exists
  let activeId = state.activeStreamMessageId[agentId];
  if (!activeId) {
    activeId = state.ensureStreamMessage(agentId, conversationId);
  }

  if (type === 'text') {
    state.appendToStreamMessage(activeId, { content: content || '' });
  } else if (type === 'thinking') {
    // Thinking events are Claude-specific internal process, skip for now
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
    // Fallback for unknown event types
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

  const exitProjectId = useTaskHubStore.getState().selectedProjectId || 'default';
  const exitComposeKey = `${exitProjectId}:${agentId}`;

  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
    activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
    // Mark that next dispatch needs full compose (role card + history),
    // but preserve sessionId for UI display.
    needsFullCompose: { ...state.needsFullCompose, [exitComposeKey]: true },
  }));
  useTaskHubStore.getState().completeStreamMessage(agentId);

  // Auto-dequeue pending messages for this agent
  const pending = useTaskHubStore.getState().pendingDispatches[agentId];
  if (pending && pending.length > 0) {
    // Small delay to let the process fully clean up
    setTimeout(() => {
      useTaskHubStore.getState().dequeueNextPending(agentId);
    }, 300);
  }
});

socket.on('agent:error', ({ agentId, message, reasonCode }: { agentId: string; message: string; reasonCode?: string }) => {
  const state = useTaskHubStore.getState();

  // Daemon rejected dispatch because agent was busy (client-daemon state mismatch)
  // Sync client state to busy and ensure the prompt is queued
  if (message === 'Agent is busy, message queued') {
    const active = state.activeRunsByAgent[agentId];
    const prompt = active ? undefined : undefined; // run entry exists but process wasn't actually spawned
    // Clean up the stale run entry — the real process will emit terminal:exit eventually
    const pending = state.pendingDispatches[agentId];
    if (!pending || pending.length === 0) {
      // Nothing queued — daemon has a process but client lost track
      // Keep agentStatus as busy, clear the stale run entry so terminal:exit can still fire
      useTaskHubStore.setState((s) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'busy' },
      }));
    }
    // Retry dequeue after a short delay — the current run may finish soon
    setTimeout(() => {
      const current = useTaskHubStore.getState();
      if (current.agentStatus[agentId] === 'idle' && current.pendingDispatches[agentId]?.length) {
        current.dequeueNextPending(agentId);
      }
    }, 2000);
    return; // Silent — don't show error bubble
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
