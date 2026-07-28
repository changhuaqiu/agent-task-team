'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';

// Sub-store slice creators
import { createTaskSlice } from './taskStore';
import type { TaskStatus, Task, TaskArtifact } from './taskStore';
import { setTaskCounter, STATUS_LABELS, STATUS_ORDER } from './taskStore';
import { createAgentSlice, AGENT_ROSTER } from './agentStore';
import { loadAgents } from './agentStore';
import type { Account, Agent, AgentRole } from './agentStore';
import { createDaemonSlice } from './daemonStore';
import {
  socket,
  resetWatchdog,
  clearWatchdog,
  registerBrowserRuntimeNode,
  clearInFlightDispatch,
  takeInFlightDispatch,
} from './daemonStore';
import type { PendingDispatch } from './daemonStore';
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { PresetRuntimeAgentInput, RuntimeAgentProfile, TeamRuntime } from '@/lib/team-runtime';
import type { RoleCard } from '@/types/roleCard';
import type { TeamPackRole, TeamPack } from '@/types/teamPack';
import {
  DEFAULT_CHANNEL_CONFIGS,
  DEFAULT_PROVIDER_PROFILES,
  DEFAULT_ROUTING_POLICIES,
  type ChannelConfig,
  type ProviderProfile,
  type RoutingPolicy,
} from '@/types/integrationConfig';
import type { Phase } from '@/types/phase';
import type { PhaseProposal } from '@/lib/breakdownParser';
import type { SkillSummary } from '@/lib/agent-context/types';
import type { DetectedRuntime, CliEngine } from '@/server/types';
import type { A2AHandoffStatus, A2APossessionView, ChatMessage, ToolEvent } from './types';
export type { A2AHandoffStatus, A2AHandoffView, A2APossessionView, ChatMessage, ToolEvent } from './types';

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
export type AgentRunStatus = 'idle' | 'busy' | 'background';
export type AgentRunActivity = 'foreground' | 'awaiting_children';

export interface ActiveAgentRun {
  runId: string;
  taskId?: string;
  conversationId: string;
  startedAt: string;
  activity?: AgentRunActivity;
}

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
  source?: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';
  fromAgentId?: string;
  conversationId?: string;
  chainId?: string;
  passId?: string;
  contextSnapshot?: string;
  epochId?: string;
}

export interface DispatchReceipt {
  receiptId: string;
  conversationId: string;
  taskId?: string;
  targetAgentId: string;
  source?: 'user' | 'a2a' | 'workflow' | 'review_gate' | 'test_gate' | 'system';
  phase: 'requested' | 'sent' | 'started' | 'completed' | 'blocked' | 'failed';
  chainId?: string;
  passId?: string;
  runId?: string;
  reasonCode?: string;
  createdAt: string;
}

export type TeamRole = 'dev' | 'ux' | 'qa' | 'arch';

export interface Conversation {
  id: string;
  title: string;
  goal: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  projectPath: string;
  useWorktree?: boolean;
  gitRepoRoot?: string;
  breakdownStatus: 'none' | 'proposal' | 'confirmed' | 'no_account';
  autonomous?: boolean;
  teamPackId?: string;
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
  | 'run.background_waiting'
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

// --- Lookup Indexes (O(1) by reference equality) ---

let _convLookup: Record<string, Conversation> = {};
let _convLookupRef: Conversation[] | null = null;

function getConvLookup(conversations: Conversation[]): Record<string, Conversation> {
  if (conversations !== _convLookupRef) {
    _convLookupRef = conversations;
    _convLookup = {};
    for (const c of conversations) _convLookup[c.id] = c;
  }
  return _convLookup;
}

// --- Memoized Selectors ---

let _lastActiveKey = '';
let _lastActiveResult: Agent[] = [];
const selectActiveAgents = (state: TaskHubState) => {
  const key = state.activeAgentIds.join(',') + ':' + state.agentRoster.length;
  if (key === _lastActiveKey) return _lastActiveResult;
  _lastActiveKey = key;
  _lastActiveResult = state.agentRoster.filter((a) => state.activeAgentIds.includes(a.id));
  return _lastActiveResult;
};

let _lastAvailableKey = '';
let _lastAvailableResult: Agent[] = [];
const selectAvailableRoster = (state: TaskHubState) => {
  const key = state.activeAgentIds.join(',') + ':' + state.agentRoster.length;
  if (key === _lastAvailableKey) return _lastAvailableResult;
  _lastAvailableKey = key;
  _lastAvailableResult = state.agentRoster.filter((a) => !state.activeAgentIds.includes(a.id));
  return _lastAvailableResult;
};

const selectAgentRoster = (state: TaskHubState) => state.agentRoster;

// --- Helper Selectors ---

function findCurrentTeamRole(state: TaskHubState, agentId: string): TeamPackRole | undefined {
  const conv = state.conversations.find((c) => c.id === state.selectedConversationId);
  if (!conv?.teamPackId || !state.currentTeamPack || state.currentTeamPack.id !== conv.teamPackId) {
    return undefined;
  }
  return state.currentTeamPack.roles.find((role) => role.id === agentId);
}

function updateCurrentTeamRole(
  state: TaskHubState,
  agentId: string,
  patch: Partial<TeamPackRole>,
): Pick<TaskHubState, 'currentTeamPack'> {
  if (!state.currentTeamPack) return { currentTeamPack: state.currentTeamPack };
  return {
    currentTeamPack: {
      ...state.currentTeamPack,
      roles: state.currentTeamPack.roles.map((role) =>
        role.id === agentId ? { ...role, ...patch } : role
      ),
    },
  };
}

function buildTeamRuntimeFromState(state: TaskHubState) {
  const conv = state.conversations.find((c) => c.id === state.selectedConversationId);
  const currentTeamPack = conv?.teamPackId && state.currentTeamPack?.id === conv.teamPackId
    ? state.currentTeamPack
    : undefined;
  const presetAgents: PresetRuntimeAgentInput[] = AGENT_ROSTER.map((agent) => ({
    id: agent.id,
    name: agent.name,
    roleCardId: agent.roleCardId,
    accountIds: agent.accountIds,
    cliEngine: agent.cliEngine,
    emoji: agent.emoji,
    theme: agent.theme,
  }));

  const runtime = resolveTeamRuntime({
    conversationId: conv?.id ?? state.selectedConversationId ?? 'default',
    teamPack: currentTeamPack,
    presetAgents,
    activeAgentIds: state.activeAgentIds,
    roleCards: state.roleCards,
    skillsMap: state.skillsMap,
    agentSkillIds: state.agentSkillIds,
    agentAccountOverrides: state.agentAccountOverrides,
    agentRoleCardOverrides: state.agentRoleCardOverrides ?? {},
  });

  if (!currentTeamPack) {
    return runtime;
  }

  const presetRuntime = resolveTeamRuntime({
    conversationId: runtime.conversationId,
    presetAgents,
    activeAgentIds: state.activeAgentIds,
    roleCards: state.roleCards,
    skillsMap: state.skillsMap,
    agentSkillIds: state.agentSkillIds,
    agentAccountOverrides: state.agentAccountOverrides,
    agentRoleCardOverrides: state.agentRoleCardOverrides ?? {},
  });
  const existingIds = new Set(runtime.roster.map((agent) => agent.id));
  return {
    ...runtime,
    roster: [
      ...runtime.roster,
      ...presetRuntime.roster.filter((agent) => !existingIds.has(agent.id)),
    ],
  };
}

interface TeamRuntimeCache {
  selectedConversationId: string | null;
  conversations: Conversation[];
  currentTeamPack: TeamPack | null;
  activeAgentIds: string[];
  roleCards: RoleCard[];
  skillsMap: Record<string, SkillSummary>;
  agentSkillIds: Record<string, string[]>;
  agentAccountOverrides: Record<string, string[]>;
  agentRoleCardOverrides: Record<string, string>;
  presetRosterSignature: string;
  runtime: TeamRuntime;
  effectiveRoster: Agent[] | null;
  profilesByAgentId: Map<string, { accounts: Account[]; profile: RuntimeAgentProfile | null }>;
}

let teamRuntimeCache: TeamRuntimeCache | null = null;

function getPresetRosterSignature(): string {
  return AGENT_ROSTER.map((agent) => [
    agent.id,
    agent.name,
    agent.roleCardId,
    agent.cliEngine ?? '',
    agent.theme,
    agent.emoji,
    agent.isOnline ? '1' : '0',
    agent.accountIds.join(','),
  ].join(':')).join('|');
}

function isTeamRuntimeCacheCurrent(
  cache: TeamRuntimeCache,
  state: TaskHubState,
  presetRosterSignature: string,
): boolean {
  return cache.selectedConversationId === state.selectedConversationId
    && cache.conversations === state.conversations
    && cache.currentTeamPack === state.currentTeamPack
    && cache.activeAgentIds === state.activeAgentIds
    && cache.roleCards === state.roleCards
    && cache.skillsMap === state.skillsMap
    && cache.agentSkillIds === state.agentSkillIds
    && cache.agentAccountOverrides === state.agentAccountOverrides
    && cache.agentRoleCardOverrides === state.agentRoleCardOverrides
    && cache.presetRosterSignature === presetRosterSignature;
}

function getCachedTeamRuntime(state: TaskHubState): TeamRuntime {
  const presetRosterSignature = getPresetRosterSignature();
  if (teamRuntimeCache && isTeamRuntimeCacheCurrent(teamRuntimeCache, state, presetRosterSignature)) {
    return teamRuntimeCache.runtime;
  }

  const runtime = buildTeamRuntimeFromState(state);
  teamRuntimeCache = {
    selectedConversationId: state.selectedConversationId,
    conversations: state.conversations,
    currentTeamPack: state.currentTeamPack,
    activeAgentIds: state.activeAgentIds,
    roleCards: state.roleCards,
    skillsMap: state.skillsMap,
    agentSkillIds: state.agentSkillIds,
    agentAccountOverrides: state.agentAccountOverrides,
    agentRoleCardOverrides: state.agentRoleCardOverrides,
    presetRosterSignature,
    runtime,
    effectiveRoster: null,
    profilesByAgentId: new Map(),
  };
  return runtime;
}

function getCachedEffectiveRoster(state: TaskHubState): Agent[] {
  const runtime = getCachedTeamRuntime(state);
  const cache = teamRuntimeCache;
  if (cache?.effectiveRoster) return cache.effectiveRoster;

  const effectiveRoster = runtime.roster.map((runtimeAgent) => {
    const presetAgent = AGENT_ROSTER.find((agent) => agent.id === runtimeAgent.id);
    return {
      id: runtimeAgent.id,
      name: runtimeAgent.displayName,
      role: presetAgent?.role ?? ('worker' as AgentRole),
      roleLabel: runtimeAgent.roleCard?.displayName ?? presetAgent?.roleLabel ?? runtimeAgent.displayName,
      roleCardId: runtimeAgent.roleCardId ?? presetAgent?.roleCardId ?? `team-role-${runtimeAgent.id}`,
      theme: runtimeAgent.theme ?? presetAgent?.theme ?? 'mario',
      emoji: runtimeAgent.emoji ?? presetAgent?.emoji ?? '🤖',
      isOnline: presetAgent?.isOnline ?? true,
      cliEngine: runtimeAgent.cliEngine ?? presetAgent?.cliEngine,
      accountIds: runtimeAgent.accountIds,
    };
  });

  if (cache) cache.effectiveRoster = effectiveRoster;
  return effectiveRoster;
}

function getCachedAgentRuntimeProfile(state: TaskHubState, agentId: string): RuntimeAgentProfile | null {
  const runtime = getCachedTeamRuntime(state);
  const cache = teamRuntimeCache;
  const cachedProfile = cache?.profilesByAgentId.get(agentId);
  if (cachedProfile?.accounts === state.accounts) return cachedProfile.profile;

  const profile = resolveRuntimeAgentProfile(runtime, agentId, state.accounts);
  cache?.profilesByAgentId.set(agentId, { accounts: state.accounts, profile });
  return profile;
}

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
const DEFAULT_ACTIVE_AGENT_IDS = ['mario', 'luigi'];
const MENTION_PATTERN = /@([\w\u4e00-\u9fff-]+)/g;

function extractMentionTokens(content: string): string[] {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  MENTION_PATTERN.lastIndex = 0;
  while ((match = MENTION_PATTERN.exec(content)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function resolveMentionAgentIds(state: TaskHubState, tokens: string[]): string[] {
  const roster = state.getEffectiveRoster();
  const byMention = new Map<string, string>();
  for (const agent of roster) {
    byMention.set(agent.id.toLowerCase(), agent.id);
    byMention.set(agent.name.toLowerCase(), agent.id);
    const roleCardName = agent.roleCardId
      ? state.roleCards.find((card) => card.id === agent.roleCardId)?.displayName
      : undefined;
    if (roleCardName) byMention.set(roleCardName.toLowerCase(), agent.id);
  }
  return [...new Set(tokens.map((token) => byMention.get(token.toLowerCase())).filter(Boolean) as string[])];
}

/**
 * A normal chat turn has one team-loop entry point. Later mentions describe
 * downstream collaboration and must not bypass A2A possession by fan-out.
 */
export function selectUserEntryAgentIds(resolvedAgentIds: string[]): string[] {
  return resolvedAgentIds.length > 0 ? [resolvedAgentIds[0]] : [];
}

export function shouldTriggerInitialProposal(
  senderAgentId: string,
  breakdownStatus: Conversation['breakdownStatus'],
  mentionCount: number,
): boolean {
  return senderAgentId === 'human' && breakdownStatus === 'none' && mentionCount === 0;
}

export const RUNTIME_HYDRATION_TIMEOUT_MS = 15_000;

async function resolveRuntimeDependency<T>(
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label}加载超时，请重试。`));
      controller.abort();
    }, RUNTIME_HYDRATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('加载超时')) throw error;
    throw new Error(`${label}加载失败，请重试。`);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function fetchRuntimeJson<T>(
  input: RequestInfo | URL,
  label: string,
): Promise<T> {
  return resolveRuntimeDependency(label, async (signal) => {
    const response = await fetch(input, { signal });
    if (!response.ok) throw new Error(`${label}加载失败，请重试。`);
    const data = await response.json();
    return data as T;
  });
}

function applyConversationTeamPack(
  get: () => TaskHubState,
  set: (partial: any) => void,
  conversationId: string | null,
  teamPackId: string,
  options: { triggerProposalAfterLoad?: boolean; propagateFailure?: boolean } = {},
): Promise<void> {
  return fetchRuntimeJson<TeamPack>(`/api/team-packs/${teamPackId}`, '团队运行配置')
    .then((teamPack) => {
      const current = get().conversations.find((c) => c.id === conversationId);
      if (
        get().selectedConversationId !== conversationId
        || !current?.teamPackId
        || current.teamPackId !== teamPackId
      ) {
        return;
      }

      if (teamPack && teamPack.id === teamPackId && teamPack.roles?.length > 0) {
        set({
          selectedConversationId: conversationId,
          selectedProjectId: conversationId || 'default',
          activeAgentIds: teamPack.roles.map((role: any) => role.id),
          currentTeamPack: teamPack,
        });
        if (options.triggerProposalAfterLoad && conversationId) {
          setTimeout(() => get().triggerProposal(conversationId), 500);
        }
      } else {
        throw new Error('团队运行配置无效，请重试或重新绑定账号。');
      }
    })
    .catch((error: unknown) => {
      if (get().selectedConversationId !== conversationId) return;
      set({
        selectedConversationId: conversationId,
        selectedProjectId: conversationId || 'default',
        activeAgentIds: DEFAULT_ACTIVE_AGENT_IDS,
        currentTeamPack: null,
      });
      if (options.propagateFailure) throw error;
    });
}

export function mapMessagesToState(recentMessages: Record<string, any[]>): Record<string, ChatMessage[]> {
  const result: Record<string, ChatMessage[]> = {};
  for (const [convId, msgs] of Object.entries(recentMessages)) {
    const mapped: ChatMessage[] = [];
    for (const m of msgs) {
      const isToolUse = m.content_type === 'tool_use';

      if (isToolUse) {
        const meta = m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : {};
        const invocationId = m.invocation_id ?? meta?.invocationId;
        const toolEvent: ToolEvent = {
          id: m.id,
          type: 'tool_use',
          label: meta?.toolEvent?.name || m.content.replace(/^🔧\s*使用工具：/, ''),
          detail: meta?.toolEvent?.input || undefined,
          timestamp: m.created_at,
        };
        const prev = mapped[mapped.length - 1];
        if (prev && prev.agentId === m.sender_id && prev.invocationId === invocationId) {
          prev.toolEvents = [...(prev.toolEvents || []), toolEvent];
        } else {
          mapped.push({
            id: `synth-${m.id}`,
            agentId: m.sender_id,
            content: '',
            timestamp: m.created_at,
            conversationId: convId,
            invocationId,
            toolEvents: [toolEvent],
          });
        }
      } else {
        const meta = m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : {};
        mapped.push({
          id: m.id,
          agentId: m.sender_type === 'human' ? 'human' : m.sender_id,
          content: m.content,
          timestamp: m.created_at,
          conversationId: convId,
          invocationId: m.invocation_id ?? meta?.invocationId,
          mentions: typeof m.mentions === 'string' ? JSON.parse(m.mentions || '[]') : (m.mentions || []),
          intent: m.intent,
          referencedTaskId: m.task_id,
          source: meta?.source,
          fromAgentId: meta?.fromAgentId,
          metadata: meta,
          taskActionIds: Array.isArray(meta?.taskActionIds) ? meta.taskActionIds : undefined,
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

// --- Store Interface (composed from all slices) ---

export interface TaskHubState {
  agentRoster: Agent[];
  hasHydrated: boolean;
  runtimeHydrationError: string | null;
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

  providerProfiles: ProviderProfile[];
  channelConfigs: ChannelConfig[];
  routingPolicies: RoutingPolicy[];
  updateProviderProfile: (id: string, patch: Partial<ProviderProfile>) => void;
  updateChannelConfig: (id: string, patch: Partial<ChannelConfig>) => void;
  updateRoutingPolicy: (id: string, patch: Partial<RoutingPolicy>) => void;
  resetIntegrationDefaults: () => void;

  accounts: Account[];
  upsertAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastVerifiedAt' | 'verifyError' | 'hasApiKey'> & { id?: string; apiKey?: string }) => Promise<string>;
  removeAccount: (accountId: string) => Promise<void>;
  loadAccounts: () => Promise<void>;

  selectedProjectId: ProjectId;
  agentSessions: Record<ProjectId, Record<string, string | undefined>>;
  needsFullCompose: Record<string, boolean>;
  activeAgentIds: string[];
  currentTeamPack: TeamPack | null;
  getEffectiveRoster: () => Agent[];
  getAgentRuntimeProfile: (agentId: string) => RuntimeAgentProfile | null;
  setTeamRoleAccountIds: (agentId: string, accountIds: string[]) => Promise<void>;
  setTeamRoleSkillIds: (agentId: string, skillIds: string[]) => Promise<void>;
  setTeamRoleCardSnapshot: (agentId: string, roleCardId: string) => Promise<void>;
  conversations: Conversation[];
  selectedConversationId: string | null;
  tasks: Task[];
  taskSyncError: { message: string; timestamp: string; conversationId: string } | null;
  lastTaskSyncAt: string | null;
  clearTaskSyncError: () => void;
  chatMessagesByConversation: Record<string, ChatMessage[]>;
  eventsByConversation: Record<string, InternalEvent[]>;
  blockersByConversation: Record<string, Blocker[]>;
  a2aByConversation: Record<string, A2APossessionView>;

  getTasksByAgent: (agentId: string) => Task[];
  getTaskById:     (taskId: string) => Task | undefined;
  getAgentCurrentTask: (agentId: string) => Task | undefined;
  getConversations: () => Conversation[];
  getSelectedConversation: () => Conversation | undefined;
  getEventsForSelectedConversation: () => InternalEvent[];
  getOpenBlockersForSelectedConversation: () => Blocker[];
  getChatMessagesForSelectedConversation: () => ChatMessage[];
  getA2AForSelectedConversation: () => A2APossessionView | undefined;
  getDispatchReceiptsForSelectedConversation: () => DispatchReceipt[];
  recordDispatchReceipt: (receipt: DispatchReceipt) => void;
  recordA2APassOffer: (payload: { conversationId: string; chainId: string; passId?: string; fromAgentId?: string; toAgentId?: string; title?: string }) => void;
  recordA2APossessionChanged: (payload: { conversationId: string; chainId: string; currentHolderId: string; passId?: string }) => void;
  recordA2APassBlocked: (payload: { conversationId: string; chainId?: string; passId?: string; fromAgentId?: string; toAgentId?: string; reason: string; status?: A2AHandoffStatus }) => void;

  loadFromServer: () => Promise<void>;

  createConversation: (input: { title: string; goal: string; projectPath?: string; priority?: Conversation['priority']; teamPackId?: string; useWorktree?: boolean; gitRepoRoot?: string; autonomous?: boolean }) => Promise<string>;
  setSelectedConversationId: (conversationId: string | null) => void;
  deleteConversation: (
    conversationId: string,
    options?: { persist?: boolean },
  ) => Promise<boolean>;
  restoreConversation: (conversation: Conversation) => void;
  addSupervisorOutput: (output: SupervisorOutputEnvelope) => void;
  addEvent: (event: Omit<InternalEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => void;
  openBlocker: (input: Omit<Blocker, 'id' | 'status' | 'createdAt'> & { id?: string; status?: Blocker['status']; createdAt?: string }) => string;
  fixBlocker: (conversationId: string, blockerId: string) => void;
  inviteAgent:      (agentId: string) => void;
  dismissAgent:     (agentId: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, reviewNote?: string, evidence?: Record<string, unknown>) => Promise<void>;
  addTask:          (taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'conversationId' | 'phaseId'> & { phaseId?: string }) => void;
  removeTask:       (taskId: string) => void;
  updateTask:       (taskId: string, patch: Partial<Pick<Task, 'title' | 'description' | 'agentId' | 'dependencies' | 'artifacts'>>) => void;
  addChatMessage:   (msg: Omit<ChatMessage, 'id' | 'timestamp' | 'mentions' | 'intent'> & { conversationId?: string }) => void;
  updateChatMessageStatus: (msgId: string, status: 'approved' | 'rejected', rejectionReason?: string) => void;

  terminalLogs: Record<string, string[]>;
  agentStatus: Record<string, AgentRunStatus>;
  activeRunsByAgent: Record<string, ActiveAgentRun | undefined>;
  activeStreamMessageId: Record<string, string>;
  activeStreamConversationId: Record<string, string>;
  pendingDispatches: Record<string, PendingDispatch[]>;
  dispatchReceiptsByConversation: Record<string, DispatchReceipt[]>;

  connectDaemon: () => void;
  upsertAgentSession: (projectId: ProjectId, agentId: string, sessionId: string) => void;
  dispatchToAgent: (input: DispatchToAgentInput) => Promise<boolean>;
  forceSendDispatch: (input: DispatchToAgentInput) => void;
  enqueueDispatch: (agentId: string, payload: Omit<PendingDispatch, 'queuedAt'>) => void;
  dequeueNextPending: (agentId: string, conversationId: string) => void;
  clearPendingDispatches: (agentId: string, conversationId: string) => void;
  appendTerminalLog: (agentId: string, log: string) => void;
  simulateCliExecution: (taskId: string, prompt: string, sessionId?: string) => void;
  ensureStreamMessage: (agentId: string, conversationId: string, invocationId?: string) => string;
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
  agentRoleCardOverrides: Record<string, string>;
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

export { selectActiveAgents, selectAvailableRoster, selectAgentRoster, selectPendingCount };

// --- Composed Store ---

export const useTaskHubStore = create<TaskHubState>()(
  persist(
    (...a) => {
      const [set, get] = a;
      let loadFromServerInFlight: Promise<void> | null = null;

      // App slice (conversations, chat, events, blockers, accounts, settings, hydration)
      const appSlice = {
        hasHydrated: false,
        runtimeHydrationError: null as string | null,
        setHasHydrated: (hydrated: boolean) => set({ hasHydrated: hydrated }),

        isSettingsOpen: false,
        setSettingsOpen: (open: boolean) => set({ isSettingsOpen: open }),

        accounts: [] as import('./agentStore').Account[],
        providerProfiles: DEFAULT_PROVIDER_PROFILES,
        channelConfigs: DEFAULT_CHANNEL_CONFIGS,
        routingPolicies: DEFAULT_ROUTING_POLICIES,
        updateProviderProfile: (id: string, patch: Partial<ProviderProfile>) => {
          set((state: TaskHubState) => ({
            providerProfiles: state.providerProfiles.map((profile) =>
              profile.id === id ? { ...profile, ...patch } : profile
            ),
          }));
        },
        updateChannelConfig: (id: string, patch: Partial<ChannelConfig>) => {
          set((state: TaskHubState) => ({
            channelConfigs: state.channelConfigs.map((channel) =>
              channel.id === id ? { ...channel, ...patch } : channel
            ),
          }));
        },
        updateRoutingPolicy: (id: string, patch: Partial<RoutingPolicy>) => {
          set((state: TaskHubState) => ({
            routingPolicies: state.routingPolicies.map((policy) =>
              policy.id === id ? { ...policy, ...patch } : policy
            ),
          }));
        },
        resetIntegrationDefaults: () => set({
          providerProfiles: DEFAULT_PROVIDER_PROFILES,
          channelConfigs: DEFAULT_CHANNEL_CONFIGS,
          routingPolicies: DEFAULT_ROUTING_POLICIES,
        }),
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

          set((state: TaskHubState) => {
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
          set((state: TaskHubState) => ({
            accounts: state.accounts.filter((a: any) => a.id !== accountId),
          }));
        },
        loadAccounts: async () => {
          const data = await fetchRuntimeJson<{ accounts?: unknown }>('/api/accounts', '账号配置');
          if (!Array.isArray(data.accounts)) {
            throw new Error('账号配置响应无效，请重试。');
          }
          set({ accounts: data.accounts });
        },

        selectedProjectId: 'default' as ProjectId,
        currentTeamPack: null as TeamPack | null,
        conversations: [] as Conversation[],
        selectedConversationId: null as string | null,
        taskSyncError: null as { message: string; timestamp: string; conversationId: string } | null,
        lastTaskSyncAt: null as string | null,
        clearTaskSyncError: () => set({ taskSyncError: null }),
        chatMessagesByConversation: {} as Record<string, ChatMessage[]>,
        eventsByConversation: {} as Record<string, InternalEvent[]>,
        blockersByConversation: {} as Record<string, Blocker[]>,
        a2aByConversation: {} as Record<string, A2APossessionView>,
        dispatchReceiptsByConversation: {} as Record<string, DispatchReceipt[]>,

        getConversations: () => get().conversations,
        getSelectedConversation: () => {
          const id = get().selectedConversationId;
          if (!id) return undefined;
          return getConvLookup(get().conversations)[id];
        },
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
        getA2AForSelectedConversation: () => {
          const id = get().selectedConversationId;
          if (!id) return undefined;
          return get().a2aByConversation[id];
        },
        getDispatchReceiptsForSelectedConversation: () => {
          const id = get().selectedConversationId;
          if (!id) return [];
          return get().dispatchReceiptsByConversation[id] ?? [];
        },
        recordDispatchReceipt: (receipt: DispatchReceipt) => set((state: TaskHubState) => {
          const existing = state.dispatchReceiptsByConversation[receipt.conversationId] ?? [];
          const next = [
            ...existing.filter((item) => item.receiptId !== receipt.receiptId),
            receipt,
          ].slice(-50);
          return {
            dispatchReceiptsByConversation: {
              ...state.dispatchReceiptsByConversation,
              [receipt.conversationId]: next,
            },
          };
        }),
        recordA2APassOffer: (payload: { conversationId: string; chainId: string; passId?: string; fromAgentId?: string; toAgentId?: string; title?: string }) => set((state: TaskHubState) => {
          const now = new Date().toISOString();
          const existing: A2APossessionView = state.a2aByConversation[payload.conversationId] ?? {
            chainId: payload.chainId,
            status: 'active',
            updatedAt: now,
            handoffs: [],
          };
          const handoffId = payload.passId ?? `offer-${payload.chainId}-${now}`;
          const handoffs = [
            ...existing.handoffs.filter((handoff) => handoff.id !== handoffId),
            {
              id: handoffId,
              chainId: payload.chainId,
              passId: payload.passId,
              fromAgentId: payload.fromAgentId,
              toAgentId: payload.toAgentId,
              status: 'offered' as const,
              title: payload.title,
              timestamp: now,
            },
          ].slice(-8);
          return {
            a2aByConversation: {
              ...state.a2aByConversation,
              [payload.conversationId]: {
                ...existing,
                chainId: payload.chainId,
                status: 'active',
                updatedAt: now,
                handoffs,
              },
            },
          };
        }),
        recordA2APossessionChanged: (payload: { conversationId: string; chainId: string; currentHolderId: string; passId?: string }) => set((state: TaskHubState) => {
          const now = new Date().toISOString();
          const existing: A2APossessionView = state.a2aByConversation[payload.conversationId] ?? {
            chainId: payload.chainId,
            status: 'active',
            updatedAt: now,
            handoffs: [],
          };
          const handoffs = existing.handoffs.map((handoff) =>
            payload.passId && handoff.passId === payload.passId
              ? { ...handoff, status: 'started' as const, timestamp: now }
              : handoff
          );
          return {
            a2aByConversation: {
              ...state.a2aByConversation,
              [payload.conversationId]: {
                ...existing,
                chainId: payload.chainId,
                currentHolderId: payload.currentHolderId,
                status: 'active',
                updatedAt: now,
                handoffs,
              },
            },
          };
        }),
        recordA2APassBlocked: (payload: { conversationId: string; chainId?: string; passId?: string; fromAgentId?: string; toAgentId?: string; reason: string; status?: A2AHandoffStatus }) => set((state: TaskHubState) => {
          const now = new Date().toISOString();
          const chainId = payload.chainId ?? state.a2aByConversation[payload.conversationId]?.chainId ?? `blocked-${now}`;
          const existing: A2APossessionView = state.a2aByConversation[payload.conversationId] ?? {
            chainId,
            status: 'active',
            updatedAt: now,
            handoffs: [],
          };
          const handoffId = payload.passId ?? `blocked-${chainId}-${now}`;
          const status = payload.status ?? 'blocked';
          const handoffs = [
            ...existing.handoffs.filter((handoff) => handoff.id !== handoffId),
            {
              id: handoffId,
              chainId,
              passId: payload.passId,
              fromAgentId: payload.fromAgentId,
              toAgentId: payload.toAgentId,
              status,
              reason: payload.reason,
              timestamp: now,
            },
          ].slice(-8);
          return {
            a2aByConversation: {
              ...state.a2aByConversation,
              [payload.conversationId]: {
                ...existing,
                chainId,
                status: status === 'timeout' ? 'timeout' : 'blocked',
                updatedAt: now,
                handoffs,
              },
            },
          };
        }),

        getEffectiveRoster: () => {
          return getCachedEffectiveRoster(get());
        },

        getAgentRuntimeProfile: (agentId: string) => {
          return getCachedAgentRuntimeProfile(get(), agentId);
        },

        setTeamRoleAccountIds: async (agentId: string, accountIds: string[]) => {
          const teamRole = findCurrentTeamRole(get(), agentId);
          const packId = teamRole ? get().currentTeamPack?.id : undefined;
          if (!packId) {
            get().setAgentAccountIds(agentId, accountIds);
            return;
          }
          const res = await fetch(`/api/team-packs/${packId}/roles/${agentId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accountIds }),
          });
          if (!res.ok) throw new Error('Failed to update team member accounts');
          const data = await res.json();
          set((state: TaskHubState) => updateCurrentTeamRole(state, agentId, data.role));
        },

        setTeamRoleSkillIds: async (agentId: string, skillIds: string[]) => {
          const teamRole = findCurrentTeamRole(get(), agentId);
          const packId = teamRole ? get().currentTeamPack?.id : undefined;
          if (!packId) {
            await get().assignSkillsToAgent(agentId, skillIds);
            return;
          }
          const res = await fetch(`/api/team-packs/${packId}/roles/${agentId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillIds }),
          });
          if (!res.ok) throw new Error('Failed to update team member skills');
          const data = await res.json();
          set((state: TaskHubState) => updateCurrentTeamRole(state, agentId, data.role));
        },

        setTeamRoleCardSnapshot: async (agentId: string, roleCardId: string) => {
          const teamRole = findCurrentTeamRole(get(), agentId);
          const packId = teamRole ? get().currentTeamPack?.id : undefined;
          const card = get().roleCards.find((item: RoleCard) => item.id === roleCardId);
          if (!packId || !card) {
            get().setAgentRoleCardId(agentId, roleCardId);
            return;
          }
          const { id, isPreset, version, createdAt, updatedAt, ...snapshotBase } = card;
          const roleCardSnapshot = {
            ...snapshotBase,
            sourceRoleCardId: id,
            snapshotVersion: version,
            snapshottedAt: new Date().toISOString(),
          };
          const res = await fetch(`/api/team-packs/${packId}/roles/${agentId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ roleCardId, roleCardSnapshot }),
          });
          if (!res.ok) throw new Error('Failed to update team member role');
          const data = await res.json();
          set((state: TaskHubState) => updateCurrentTeamRole(state, agentId, data.role));
        },

        loadFromServer: () => {
          if (loadFromServerInFlight) return loadFromServerInFlight;

          const hydration = (async () => {
            set({ hasHydrated: false, runtimeHydrationError: null });
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

            const data = await fetchRuntimeJson<Awaited<ReturnType<Response['json']>>>(
              '/api/state',
              '项目状态',
            );

            const conversations: Conversation[] = (data.conversations || []).map((c: any) => ({
              id: c.id,
              title: c.title || '',
              goal: c.goal || '',
              status: c.status || 'active',
              priority: c.priority || 'p2',
              projectPath: c.project_path || '',
              useWorktree: c.use_worktree === 1 || c.use_worktree === true,
              gitRepoRoot: c.git_repo_root || undefined,
              breakdownStatus: c.breakdown_status || 'none',
              autonomous: c.autonomous === true,
              teamPackId: c.team_pack_id || undefined,
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

            // Server bindings are authoritative. Never revive a runtime
            // session from persisted browser state when the server has no
            // active binding for that project + agent.
            const serverSessions = {
              default: {},
              ...mapSessionsToState(data.activeSessions || []),
            };

            const hydratedNeedsFullCompose: Record<string, boolean> = {};
            for (const [proj, agents] of Object.entries(serverSessions)) {
              for (const [aid, sid] of Object.entries(agents || {})) {
                if (sid) hydratedNeedsFullCompose[`${proj}:${aid}`] = false;
              }
            }

            set({
              conversations,
              tasks,
              chatMessagesByConversation: mapMessagesToState(data.recentMessages || {}),
              agentSessions: serverSessions,
              needsFullCompose: hydratedNeedsFullCompose,
            });

            // Keep a still-valid selection, otherwise use the most recently
            // updated conversation. Runtime dependencies are hydrated below
            // before the page becomes interactive.
            const selectedConversation = conversations.find((conversation) => (
              conversation.id === get().selectedConversationId
            )) ?? (conversations.length > 0
              ? conversations.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b)
              : undefined);
            set({
              selectedConversationId: selectedConversation?.id ?? null,
              selectedProjectId: selectedConversation?.id ?? 'default',
              activeAgentIds: selectedConversation?.teamPackId ? [] : DEFAULT_ACTIVE_AGENT_IDS,
              currentTeamPack: null,
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
                    const phaseData = await fetchRuntimeJson<unknown>(
                      `/api/phases?conversationId=${conv.id}`,
                      '项目阶段',
                    );
                    if (Array.isArray(phaseData)) {
                      allPhases.push(...phaseData);
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

            await get().loadAccounts();

            await resolveRuntimeDependency(
              '智能体配置',
              signal => loadAgents({ signal, propagateFailure: true }),
            );

            get().refreshRuntimeCatalog();

            const existingIds = new Set(get().roleCards.map((c: any) => c.id));
            const missing = PRESET_ROLE_CARDS.filter((c) => !existingIds.has(c.id));
            if (missing.length) {
              set((state: TaskHubState) => ({ roleCards: [...missing, ...state.roleCards] }));
            }

            get().loadSkills();

            // A team-backed conversation is not dispatch-ready until both
            // accounts and its Team Pack have been resolved. Keep the loading
            // skeleton visible until this gate completes so the first user
            // turn cannot be rejected with a false no_runtime_profile.
            if (selectedConversation?.teamPackId) {
              await applyConversationTeamPack(
                get,
                set,
                selectedConversation.id,
                selectedConversation.teamPackId,
                { propagateFailure: true },
              );
            }

            set({ hasHydrated: true, runtimeHydrationError: null });
          } catch (err) {
            console.error('[loadFromServer] Failed:', err);
            set({
              hasHydrated: true,
              runtimeHydrationError: err instanceof Error
                ? err.message
                : 'Agent 运行配置加载失败，请重试。',
            });
            }
          })();

          const published = hydration.finally(() => {
            if (loadFromServerInFlight === published) {
              loadFromServerInFlight = null;
            }
          });
          loadFromServerInFlight = published;
          return published;
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
          set((state: TaskHubState) => ({
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [conversationId]: [...(state.chatMessagesByConversation[conversationId] || []), ...legacyMessages],
            },
          }));
        },

        createConversation: async ({ title, goal, projectPath, priority, teamPackId, useWorktree, gitRepoRoot, autonomous }: { title: string; goal: string; projectPath?: string; priority?: Conversation['priority']; teamPackId?: string; useWorktree?: boolean; gitRepoRoot?: string; autonomous?: boolean }) => {
          const id = makeId('conv');
          const stamp = new Date().toISOString();
          const conversation: Conversation = {
            id,
            title,
            goal,
            status: 'active',
            priority: priority ?? 'p1',
            projectPath: projectPath ?? '',
            useWorktree,
            gitRepoRoot,
            breakdownStatus: 'none',
            autonomous: Boolean(autonomous),
            teamPackId,
            createdAt: stamp,
            updatedAt: stamp,
          };

          set((state: TaskHubState) => ({
            conversations: [conversation, ...state.conversations],
            selectedConversationId: id,
            selectedProjectId: id,
            activeAgentIds: teamPackId ? [] : DEFAULT_ACTIVE_AGENT_IDS,
            currentTeamPack: null,
            agentSessions: {
              ...state.agentSessions,
              [id]: {},
            },
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

          if (teamPackId) {
            applyConversationTeamPack(get, set, id, teamPackId, {
              triggerProposalAfterLoad: !autonomous,
            });
          }

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

          try {
            const response = await fetch('/api/mutations', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ type: 'conversation.create', payload: { id, title, goal, priority: priority ?? 'p1', project_path: projectPath, team_pack_id: teamPackId, use_worktree: useWorktree, git_repo_root: gitRepoRoot } }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body.error ?? '创建项目失败');
            }
          } catch (error) {
            await get().deleteConversation(id, { persist: false });
            console.error('[mutation] conversation.create failed:', error);
            return '';
          }

          if (!teamPackId && !autonomous) {
            setTimeout(() => get().triggerProposal(id), 500);
          }
          return id;
        },

        setSelectedConversationId: (conversationId: string | null) => {
          const previousConversationId = get().selectedConversationId;
          const conv = get().conversations.find((c) => c.id === conversationId);
          if (previousConversationId && previousConversationId !== conversationId) {
            socket.emit('conversation:leave', { conversationId: previousConversationId });
          }
          if (conversationId) {
            socket.emit('conversation:join', { conversationId });
          }

          if (conv?.teamPackId) {
            set({
              selectedConversationId: conversationId,
              selectedProjectId: conversationId || 'default',
              activeAgentIds: [],
              currentTeamPack: null,
            });
            applyConversationTeamPack(get, set, conversationId, conv.teamPackId);
            return;
          }

          set({
            selectedConversationId: conversationId,
            selectedProjectId: conversationId || 'default',
            activeAgentIds: DEFAULT_ACTIVE_AGENT_IDS,
            currentTeamPack: null,
          });
        },

        deleteConversation: async (
          conversationId: string,
          options?: { persist?: boolean },
        ) => {
          const state = get();
          const removedConversation = state.conversations.find((item) => item.id === conversationId);
          const removedTasks = state.tasks.filter((item) => item.conversationId === conversationId);
          const removedMessages = state.chatMessagesByConversation[conversationId];
          const removedEvents = state.eventsByConversation[conversationId];
          const removedBlockers = state.blockersByConversation[conversationId];
          const removedSessions = state.agentSessions[conversationId];
          const wasSelected = state.selectedConversationId === conversationId;
          if (state.selectedConversationId === conversationId) {
            set({ selectedConversationId: null, selectedProjectId: 'default' });
          }
          const { [conversationId]: _msgs, ...restMsgs } = state.chatMessagesByConversation;
          const { [conversationId]: _evts, ...restEvts } = state.eventsByConversation;
          const { [conversationId]: _blockers, ...restBlockers } = state.blockersByConversation;
          const { [conversationId]: _sessions, ...restSessions } = state.agentSessions;
          set({
            conversations: state.conversations.filter((c) => c.id !== conversationId),
            tasks: state.tasks.filter((task) => task.conversationId !== conversationId),
            chatMessagesByConversation: restMsgs,
            eventsByConversation: restEvts,
            blockersByConversation: restBlockers,
            agentSessions: { default: state.agentSessions.default ?? {}, ...restSessions },
          });
          if (options?.persist === false) return true;

          try {
            const response = await fetch('/api/mutations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'conversation.delete', payload: { id: conversationId } }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body.error ?? `删除项目失败（HTTP ${response.status}）`);
            }
            return true;
          } catch (error) {
            set((current) => ({
              conversations: removedConversation
                && !current.conversations.some((item) => item.id === conversationId)
                ? [...current.conversations, removedConversation]
                : current.conversations,
              tasks: [
                ...current.tasks,
                ...removedTasks.filter(
                  (removed) => !current.tasks.some((item) => item.id === removed.id),
                ),
              ],
              chatMessagesByConversation: removedMessages
                ? { ...current.chatMessagesByConversation, [conversationId]: removedMessages }
                : current.chatMessagesByConversation,
              eventsByConversation: removedEvents
                ? { ...current.eventsByConversation, [conversationId]: removedEvents }
                : current.eventsByConversation,
              blockersByConversation: removedBlockers
                ? { ...current.blockersByConversation, [conversationId]: removedBlockers }
                : current.blockersByConversation,
              agentSessions: removedSessions
                ? { ...current.agentSessions, [conversationId]: removedSessions }
                : current.agentSessions,
              selectedConversationId: wasSelected ? conversationId : current.selectedConversationId,
              selectedProjectId: wasSelected ? conversationId : current.selectedProjectId,
            }));
            console.error('[mutation] conversation.delete failed:', error);
            return false;
          }
        },

        restoreConversation: (conversation: Conversation) => {
          set((state: TaskHubState) => ({
            conversations: [...state.conversations, conversation],
            selectedConversationId: conversation.id,
          }));
          fetch('/api/mutations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'conversation.create',
              payload: {
                id: conversation.id,
                title: conversation.title,
                goal: conversation.goal,
                status: conversation.status,
                priority: conversation.priority,
                project_path: conversation.projectPath,
                team_pack_id: conversation.teamPackId,
                use_worktree: conversation.useWorktree,
                git_repo_root: conversation.gitRepoRoot,
              },
            }),
          }).catch(() => {});
        },

        addEvent: ({ id, timestamp, ...event }: Omit<InternalEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => {
          const resolvedId = id ?? makeId('evt');
          const resolvedTimestamp = timestamp ?? new Date().toISOString();
          const record: InternalEvent = { ...event, id: resolvedId, timestamp: resolvedTimestamp };
          set((state: TaskHubState) => ({
            eventsByConversation: {
              ...state.eventsByConversation,
              [record.conversationId]: [...(state.eventsByConversation[record.conversationId] || []), record],
            },
          }));

          if (record.conversationId) {
            const payloadObj = (record.payload && typeof record.payload === 'object') ? record.payload as Record<string, unknown> : {};
            fetch('/api/mutations', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ type: 'event.append', payload: {
                conversationId: record.conversationId,
                taskId: (payloadObj?.taskId as string) || undefined,
                agentId: (payloadObj?.agentId as string) || 'system',
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

          set((state: TaskHubState) => ({
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
          set((state: TaskHubState) => ({
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

        addChatMessage: async (msg: Omit<ChatMessage, 'id' | 'timestamp' | 'mentions' | 'intent'> & { conversationId?: string }) => {
          if (!get().selectedConversationId && get().conversations.length === 0 && msg.agentId === 'human') {
            const title = msg.content.length > 20
              ? msg.content.slice(0, msg.content.indexOf('，') > 0 ? msg.content.indexOf('，') : 20)
              : msg.content;
            get().createConversation({ title, goal: msg.content });
          }

          const { conversationId: conv, ...rest } = msg as any;
          let conversationId = conv ?? get().selectedConversationId;
          // Fallback: if no conversation is selected but some exist, auto-select
          // the first one instead of silently dropping the message (issue #38).
          if (!conversationId && get().conversations.length > 0) {
            const first = get().conversations[0];
            conversationId = first.id;
            set({ selectedConversationId: first.id });
          }
          if (!conversationId) return;

          const mentions = extractMentionTokens(rest.content);
          const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
          if (
            existingConv
            && !existingConv.autonomous
            && shouldTriggerInitialProposal(rest.agentId, existingConv.breakdownStatus, mentions.length)
          ) {
            setTimeout(() => {
              const state = useTaskHubStore.getState();
              if (state.conversations.find((c: Conversation) => c.id === conversationId)?.breakdownStatus === 'none') {
                state.triggerProposal(conversationId);
              }
            }, 500);
          }

          // A user turn is a chat fact even when every target is busy. Persist
          // it before dispatch admission so queueing can never make it vanish.
          set((state: TaskHubState) => ({
            chatMessagesByConversation: {
              ...state.chatMessagesByConversation,
              [conversationId]: [
                ...(state.chatMessagesByConversation[conversationId] || []),
                {
                  ...rest,
                  id: messageId,
                  timestamp: new Date().toISOString(),
                  mentions,
                  intent,
                },
              ].sort((a: any, b: any) => (a.timestamp || '').localeCompare(b.timestamp || '')),
            },
          }));

          if (rest.agentId === 'human') {
            const resolvedMentions = resolveMentionAgentIds(get(), mentions);
            const entryAgentIds = selectUserEntryAgentIds(resolvedMentions);
            const busyAgents = entryAgentIds.filter((id) => get().agentStatus[id] && get().agentStatus[id] !== 'idle');
            const idleAgents = entryAgentIds.filter((id) => !get().agentStatus[id] || get().agentStatus[id] === 'idle');
            const acceptedAgentIds: string[] = [];

            for (const agentId of idleAgents) {
              const accepted = await get().dispatchToAgent({
                agentId,
                referencedTaskId: rest.referencedTaskId,
                prompt: rest.content,
                conversationId,
              });
              if (accepted) acceptedAgentIds.push(agentId);
            }

            socket.emit('a2a:user-turn-created', {
              conversationId,
              messageId,
              targetAgentIds: acceptedAgentIds,
              prompt: rest.content,
              taskId: rest.referencedTaskId,
            });

            for (const agentId of busyAgents) {
              get().enqueueDispatch(agentId, { prompt: rest.content, referencedTaskId: rest.referencedTaskId, conversationId });
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
              metadata: {
                source: rest.source,
                fromAgentId: rest.fromAgentId,
              },
            }}),
          }).catch((err) => console.error('[mutation] message.append failed:', err));
        },

        updateChatMessageStatus: (msgId: string, status: 'approved' | 'rejected', rejectionReason?: string) =>
          set((state: TaskHubState) => {
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
      version: 6,
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
        if (version < 4) {
          persisted.currentTeamPack = persisted.currentTeamPack ?? null;
        }
        if (version < 5) {
          persisted.providerProfiles = persisted.providerProfiles ?? DEFAULT_PROVIDER_PROFILES;
          persisted.channelConfigs = persisted.channelConfigs ?? DEFAULT_CHANNEL_CONFIGS;
          persisted.routingPolicies = persisted.routingPolicies ?? DEFAULT_ROUTING_POLICIES;
        }
        if (version < 6) {
          persisted.agentSessions = { default: {} };
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
        currentTeamPack: state.currentTeamPack,
        agentAccountOverrides: state.agentAccountOverrides,
        enableMockRunner: state.enableMockRunner,
        roleCards: state.roleCards,
        providerProfiles: state.providerProfiles,
        channelConfigs: state.channelConfigs,
        routingPolicies: state.routingPolicies,
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
  registerBrowserRuntimeNode();
  const selectedConversationId = useTaskHubStore.getState().selectedConversationId;
  if (selectedConversationId) {
    socket.emit('conversation:join', { conversationId: selectedConversationId });
  }

  socket.emit('runtimes:list', (response: { runtimes: import('@/server/types').DetectedRuntime[] }) => {
    if (response?.runtimes) {
      useTaskHubStore.getState().setDaemonRuntimes(response.runtimes);
    }
  });

  socket.emit('daemon:status', (response: { activeAgents: Record<string, { taskId?: string; conversationId?: string }> }) => {
    if (!response?.activeAgents) return;
    const statusUpdate: Record<string, AgentRunStatus> = {};
    const runsUpdate: Record<string, ActiveAgentRun | undefined> = {};
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

socket.on('agent:session', ({ projectId, conversationId, agentId, sessionId }) => {
  useTaskHubStore.getState().upsertAgentSession(conversationId || projectId || 'default', agentId, sessionId);
});

socket.on('agent:activity', ({ conversationId, taskId, agentId, sessionId, status, reason }: {
  conversationId?: string;
  taskId?: string;
  agentId: string;
  sessionId?: string;
  status: 'running' | 'awaiting_children' | 'idle';
  reason?: string;
}) => {
  if (!conversationId) return;
  const state = useTaskHubStore.getState();
  if (sessionId) {
    state.upsertAgentSession(conversationId, agentId, sessionId);
  }

  if (status === 'awaiting_children') {
    clearWatchdog(agentId);
    const existing = state.activeRunsByAgent[agentId];
    useTaskHubStore.setState((s) => ({
      agentStatus: { ...s.agentStatus, [agentId]: 'background' },
      activeRunsByAgent: {
        ...s.activeRunsByAgent,
        [agentId]: {
          runId: existing?.runId ?? `background-${agentId}-${Date.now()}`,
          taskId: taskId ?? existing?.taskId,
          conversationId,
          startedAt: existing?.startedAt ?? new Date().toISOString(),
          activity: 'awaiting_children',
        },
      },
    }));
    state.addEvent({
      conversationId,
      type: 'run.background_waiting',
      payload: { agentId, taskId, sessionId, reason },
    });
    return;
  }

  if (status === 'idle') {
    useTaskHubStore.setState((s) => ({
      agentStatus: { ...s.agentStatus, [agentId]: 'idle' },
      activeRunsByAgent: { ...s.activeRunsByAgent, [agentId]: undefined },
    }));
    state.completeStreamMessage(agentId);
  }
});

socket.on('agent:event', (event) => {
  const { agentId, type, content, tool, sessionId, invocationId, conversationId: eventConvId } = event;
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
    state.upsertAgentSession(conversationId, agentId, sessionId);
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
    activeId = state.ensureStreamMessage(agentId, conversationId, invocationId);
  }

  if (type === 'text') {
    state.appendToStreamMessage(activeId, { content: content || '' });
  } else if (type === 'thinking') {
    // skip
  } else if (type === 'plan') {
    // Plan updates are projected in observability; they are not chat content.
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

socket.on('a2a:pass-offer', ({ agentId, fromAgentId, conversationId, chainId, passId }: { agentId: string; fromAgentId?: string; conversationId?: string; chainId?: string; passId?: string }) => {
  if (!conversationId || !chainId) return;
  useTaskHubStore.getState().recordA2APassOffer({
    conversationId,
    chainId,
    passId,
    fromAgentId,
    toAgentId: agentId,
    title: fromAgentId ? `${fromAgentId} 交接给 ${agentId}` : `交接给 ${agentId}`,
  });
});

socket.on('dispatch.receipt', (receipt: DispatchReceipt) => {
  if (!receipt?.conversationId || !receipt.receiptId || !receipt.targetAgentId) return;
  if (
    receipt.phase === 'sent'
    || receipt.phase === 'started'
    || receipt.phase === 'completed'
    || receipt.phase === 'blocked'
    || (receipt.phase === 'failed' && receipt.reasonCode !== 'agent_busy')
  ) {
    clearInFlightDispatch(receipt.targetAgentId, receipt.conversationId);
  }
  useTaskHubStore.getState().recordDispatchReceipt(receipt);
});

socket.on('a2a:possession-changed', ({ chainId, conversationId, currentHolderId, passId }: { chainId?: string; conversationId?: string; currentHolderId?: string; passId?: string }) => {
  if (!conversationId || !chainId || !currentHolderId) return;
  useTaskHubStore.getState().recordA2APossessionChanged({
    conversationId,
    chainId,
    currentHolderId,
    passId,
  });
});

socket.on('a2a:pass-blocked', ({ conversationId, chainId, passId, fromAgentId, toAgentId, reason, status }: { conversationId?: string; chainId?: string; passId?: string; fromAgentId?: string; toAgentId?: string; reason?: string; status?: A2AHandoffStatus }) => {
  if (!conversationId || !reason) return;
  useTaskHubStore.getState().recordA2APassBlocked({
    conversationId,
    chainId,
    passId,
    fromAgentId,
    toAgentId,
    reason,
    status,
  });
});

socket.on('terminal:exit', ({ agentId, code, command, reasonCode, conversationId: exitConvId, activity }: {
  agentId: string;
  code: number;
  command?: string;
  reasonCode?: string;
  conversationId?: string;
  activity?: 'awaiting_children' | 'idle';
}) => {
  const store = useTaskHubStore.getState();
  const active = store.activeRunsByAgent[agentId];
  const conversationId =
    exitConvId ||
    active?.conversationId ||
    (active?.taskId ? store.getTaskById(active.taskId)?.conversationId : null) ||
    store.selectedConversationId;
  const runId = active?.runId;
  const taskId = active?.taskId;
  const backgroundWaiting = code === 0 && (activity === 'awaiting_children' || active?.activity === 'awaiting_children');
  let missingEvidenceRecovery: { taskId: string; conversationId: string; prompt: string } | undefined;

  store.appendTerminalLog(agentId, `\r\n\x1b[36m[process exited with code ${code}]\x1b[0m\r\n`);

  if (runId && conversationId && !backgroundWaiting) {
    store.addEvent({
      conversationId,
      type: 'run.finished',
      payload: { runId, agentId, taskId, code, reasonCode },
    });
  }

  if (backgroundWaiting && conversationId) {
    clearWatchdog(agentId);
    if (active?.activity !== 'awaiting_children') {
      store.addEvent({
        conversationId,
        type: 'run.background_waiting',
        payload: { runId, agentId, taskId, command, reasonCode: reasonCode ?? 'awaiting_children' },
      });
    }
    useTaskHubStore.setState((state) => ({
      agentStatus: { ...state.agentStatus, [agentId]: 'background' },
      activeRunsByAgent: {
        ...state.activeRunsByAgent,
        [agentId]: active
          ? { ...active, conversationId, activity: 'awaiting_children' }
          : {
              runId: `background-${agentId}-${Date.now()}`,
              taskId,
              conversationId,
              startedAt: new Date().toISOString(),
              activity: 'awaiting_children',
            },
      },
    }));
    return;
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

  // CLI success does not prove review readiness. The implementer must submit
  // explicit install/build/impact evidence before the task can enter review.
  if (code === 0 && taskId) {
      const task = store.getTaskById(taskId);
      if (task && task.status === 'in_progress') {
        store.openBlocker({
        conversationId: task.conversationId,
        taskId,
        type: 'gate_fail',
        gateId: 'build',
        reasonSummary: '等待开发交付（implementation_evidence）：需要已验证 PR，以及 installResult、buildResult、testResult、impactEvidence。',
        evidenceRef: runId ? `run:${runId}` : (command ? `cli:${command}` : undefined),
      });
      missingEvidenceRecovery = {
        taskId,
        conversationId: task.conversationId,
        prompt: `请补齐 ${taskId}: ${task.title} 的 implementation_evidence：创建 PR 并记录已验证回执，同时提供 installResult、buildResult、testResult、impactEvidence。完成后由平台推进到 in_review。`,
      };
    }
  }

  const exitProjectId = conversationId || useTaskHubStore.getState().selectedProjectId || 'default';
  const exitComposeKey = `${exitProjectId}:${agentId}`;

  useTaskHubStore.setState((state) => ({
    agentStatus: { ...state.agentStatus, [agentId]: 'idle' },
    activeRunsByAgent: { ...state.activeRunsByAgent, [agentId]: undefined },
    needsFullCompose: { ...state.needsFullCompose, [exitComposeKey]: true },
  }));
  useTaskHubStore.getState().completeStreamMessage(agentId);

  if (missingEvidenceRecovery) {
    const recovery = missingEvidenceRecovery;
    setTimeout(() => {
      const current = useTaskHubStore.getState();
      if (current.agentStatus[agentId] && current.agentStatus[agentId] !== 'idle') {
        current.enqueueDispatch(agentId, {
          prompt: recovery.prompt,
          referencedTaskId: recovery.taskId,
          source: 'system',
          conversationId: recovery.conversationId,
        });
        return;
      }
      current.dispatchToAgent({
        agentId,
        referencedTaskId: recovery.taskId,
        conversationId: recovery.conversationId,
        source: 'system',
        prompt: recovery.prompt,
      });
    }, 300);
  }

  if (conversationId) {
    const key = `${agentId}:${conversationId}`;
    const pending = useTaskHubStore.getState().pendingDispatches[key];
    if (pending && pending.length > 0) {
      const exitConvId = conversationId;
      setTimeout(() => {
        useTaskHubStore.getState().dequeueNextPending(agentId, exitConvId);
      }, 300);
    }
  }
});

socket.on('a2a:dispatch', async ({ agentId, prompt, referencedTaskId, fromAgentId, conversationId, chainId, entryId, passId, handledByHarness }: { agentId: string; prompt: string; referencedTaskId?: string; fromAgentId: string; conversationId?: string; chainId?: string; entryId?: string; passId?: string; handledByHarness?: boolean; harnessFallbackReasonCode?: string }) => {
  if (handledByHarness) return;
  console.log(`[a2a:v2] chain=${chainId} dispatch ${fromAgentId} → ${agentId}`);
  const state = useTaskHubStore.getState();
  if (state.agentStatus[agentId] && state.agentStatus[agentId] !== 'idle') {
    if (chainId && entryId && conversationId) {
      socket.emit('a2a:dispatch-deferred', {
        chainId,
        entryId,
        conversationId,
        agentId,
        passId,
        reason: 'target agent is busy',
      });
    }
    return;
  }
  const accepted = await state.dispatchToAgent({
    agentId,
    prompt,
    referencedTaskId,
    source: 'a2a',
    fromAgentId,
    conversationId,
    chainId,
    passId,
  });
  if (accepted && chainId && entryId && conversationId) {
    socket.emit('a2a:agent-started', {
      chainId,
      entryId,
      conversationId,
      agentId,
      passId,
    });
  } else if (!accepted && chainId && entryId && conversationId) {
    socket.emit('a2a:dispatch-failed', {
      chainId,
      entryId,
      conversationId,
      agentId,
      reason: 'no runtime profile or conversation context',
    });
  }
});

socket.on('agent:error', ({ agentId, message, reasonCode }: { agentId: string; message: string; reasonCode?: string }) => {
  const state = useTaskHubStore.getState();

  if (reasonCode === 'agent_busy' || message === 'Agent is busy, message queued') {
    const active = state.activeRunsByAgent[agentId];
    const convId = active?.conversationId || state.selectedConversationId;
    if (!convId) return;
    const key = `${agentId}:${convId}`;
    const rejectedDispatch = takeInFlightDispatch(agentId, convId);
    const pending = state.pendingDispatches[key];
    const alreadyQueued = rejectedDispatch && pending?.some((entry) =>
      entry.prompt === rejectedDispatch.prompt
      && entry.referencedTaskId === rejectedDispatch.referencedTaskId
      && entry.source === rejectedDispatch.source
      && entry.fromAgentId === rejectedDispatch.fromAgentId
    );
    if (rejectedDispatch && !alreadyQueued) {
      state.enqueueDispatch(agentId, rejectedDispatch);
    } else if (!rejectedDispatch && (!pending || pending.length === 0)) {
      useTaskHubStore.setState((s) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'busy' },
      }));
    }
    const errConvId = convId;
    setTimeout(() => {
      const current = useTaskHubStore.getState();
      if (current.agentStatus[agentId] === 'idle' && current.pendingDispatches[key]?.length) {
        current.dequeueNextPending(agentId, errConvId);
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
    source: 'workflow',
    prompt: `你被分配了 ${taskId}: ${task.title}. ${task.description || ''}`,
  });
});

interface TaskStateSocketRow {
  id?: string;
  conversation_id?: string;
  phase_id?: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  agent_id?: string;
  dependencies?: string | string[];
  artifacts?: string | TaskArtifact[];
  review_note?: string | null;
  created_at?: string;
  updated_at?: string;
}

socket.on('task.state', ({ task: row }: { task?: TaskStateSocketRow }) => {
  if (!row?.id || !row.conversation_id) return;
  const task: Task = {
    id: row.id,
    conversationId: row.conversation_id,
    phaseId: row.phase_id || '',
    title: row.title || '',
    description: row.description || '',
    status: row.status || 'pending',
    agentId: row.agent_id || '',
    dependencies: typeof row.dependencies === 'string'
      ? JSON.parse(row.dependencies || '[]')
      : (row.dependencies || []),
    artifacts: typeof row.artifacts === 'string'
      ? JSON.parse(row.artifacts || '[]')
      : (row.artifacts || []),
    reviewNote: row.review_note || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
  useTaskHubStore.setState((state) => {
    const exists = state.tasks.some((item) => item.id === task.id);
    return {
      tasks: exists
        ? state.tasks.map((item) => item.id === task.id ? task : item)
        : [...state.tasks, task],
    };
  });
});

socket.on('task.notification', (notification: {
  id?: string;
  conversationId?: string;
  taskId?: string;
  recipients?: string[];
  content?: string;
  createdAt?: string;
  kind?: string;
  changedFields?: string[];
  metadata?: Record<string, any>;
}) => {
  const conversationId = notification.conversationId;
  const content = notification.content;
  if (!conversationId || !content) return;

  useTaskHubStore.setState((state) => {
    const existing = state.chatMessagesByConversation[conversationId] || [];
    if (notification.id && existing.some((message) => message.id === notification.id)) return {};
    const message: ChatMessage = {
      id: notification.id || `msg-${Date.now()}-task-notify`,
      agentId: 'system',
      content,
      timestamp: notification.createdAt || new Date().toISOString(),
      conversationId,
      referencedTaskId: notification.taskId,
      mentions: notification.recipients || [],
      intent: 'task_status',
      metadata: {
        ...(notification.metadata || {}),
        kind: notification.kind,
        changedFields: notification.changedFields,
        recipients: notification.recipients || [],
      },
    };
    return {
      chatMessagesByConversation: {
        ...state.chatMessagesByConversation,
        [conversationId]: [...existing, message],
      },
    };
  });
});

socket.on('task.wakeup', (wakeup: {
  id?: string;
  conversationId?: string;
  taskId?: string;
  agentId?: string;
  reasonCode?: 'owner_ready' | 'review_requested' | 'review_decision_ready' | 'test_requested' | 'dependency_resolved' | 'unblocked_unassigned' | 'missing_implementation_evidence' | 'missing_delivery_evidence' | 'stale_review_gate' | 'stale_test_gate' | 'runnable_owned_idle';
  dispatchSource?: 'workflow' | 'review_gate' | 'test_gate' | 'system';
  prompt?: string;
  content?: string;
  createdAt?: string;
  metadata?: Record<string, any>;
  handledByHarness?: boolean;
  harnessFallbackReasonCode?: string;
}) => {
  const conversationId = wakeup.conversationId;
  const taskId = wakeup.taskId;
  const agentId = wakeup.agentId;
  if (!conversationId || !taskId || !agentId) return;

  if (wakeup.content) {
    useTaskHubStore.setState((state) => {
      const existing = state.chatMessagesByConversation[conversationId] || [];
      if (wakeup.id && existing.some((message) => message.id === wakeup.id)) return {};
      const message: ChatMessage = {
        id: wakeup.id || `msg-${Date.now()}-task-wakeup`,
        agentId: 'system',
        content: wakeup.content!,
        timestamp: wakeup.createdAt || new Date().toISOString(),
        conversationId,
        referencedTaskId: taskId,
        mentions: [agentId],
        intent: 'task_status',
        metadata: {
          ...(wakeup.metadata || {}),
          reasonCode: wakeup.reasonCode,
          dispatchSource: wakeup.dispatchSource,
          startsA2AHandoff: false,
          startsDispatch: true,
        },
      };
      return {
        chatMessagesByConversation: {
          ...state.chatMessagesByConversation,
          [conversationId]: [...existing, message],
        },
      };
    });
  }

  // The service-side Harness owns continuation after admission. The wakeup
  // remains visible in chat, but the browser must not start a duplicate run.
  if (wakeup.handledByHarness) return;

  const store = useTaskHubStore.getState();
  const task = store.getTaskById(taskId);
  if (!task) return;

  if ((wakeup.reasonCode === 'owner_ready' || wakeup.reasonCode === 'dependency_resolved') && task.status === 'pending') {
    store.dispatchToAgent({
      agentId,
      referencedTaskId: taskId,
      conversationId,
      source: 'workflow',
      prompt: wakeup.prompt || `依赖已满足，开始执行 ${taskId}: ${task.title}. ${task.description || ''}`,
    });
    store.updateTaskStatus(taskId, 'in_progress');
    return;
  }

  if (wakeup.reasonCode === 'review_requested' || wakeup.reasonCode === 'review_decision_ready' || wakeup.reasonCode === 'test_requested') {
    store.dispatchToAgent({
      agentId,
      referencedTaskId: taskId,
      conversationId,
      source: wakeup.reasonCode === 'test_requested' ? 'test_gate' : 'review_gate',
      prompt: wakeup.prompt || (
        wakeup.reasonCode === 'review_decision_ready'
          ? `请确认 ${taskId}: ${task.title} 的评审结论，并决定是否通过或退回修改。${task.description || ''}`
          : wakeup.reasonCode === 'test_requested'
            ? `请开始测试 ${taskId}: ${task.title}. ${task.description || ''}`
          : `请开始评审 ${taskId}: ${task.title}. ${task.description || ''}`
      ),
    });
  }

  if (
    wakeup.reasonCode === 'missing_implementation_evidence' ||
    wakeup.reasonCode === 'missing_delivery_evidence' ||
    wakeup.reasonCode === 'stale_review_gate' ||
    wakeup.reasonCode === 'stale_test_gate' ||
    wakeup.reasonCode === 'runnable_owned_idle'
  ) {
    store.dispatchToAgent({
      agentId,
      referencedTaskId: taskId,
      conversationId,
      source: 'system',
      prompt: wakeup.prompt || `请恢复处理 ${taskId}: ${task.title}. ${task.description || ''}`,
    });
  }

  if (wakeup.reasonCode === 'unblocked_unassigned') {
    store.dispatchToAgent({
      agentId,
      referencedTaskId: taskId,
      conversationId,
      source: 'workflow',
      prompt: wakeup.prompt || `请分配负责人：${taskId}「${task.title}」的依赖已全部满足，但尚未分配负责人。`,
    });
  }
});

socket.on('task.sync', ({ projectPath, conversationId, tasks: syncedTasks, blockers: syncedBlockers }: { projectPath: string; conversationId: string; tasks: any[]; blockers?: any[] }) => {
  useTaskHubStore.setState({ lastTaskSyncAt: new Date().toISOString(), taskSyncError: null });
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

    const nextDescription = synced.deliverable || existing.description;
    const nextDependencies = synced.depends || existing.dependencies;
    const changed =
      existing.status !== synced.status ||
      existing.agentId !== synced.agent ||
      existing.title !== synced.title ||
      existing.description !== nextDescription ||
      JSON.stringify(existing.dependencies || []) !== JSON.stringify(nextDependencies || []);
    if (changed) {
      useTaskHubStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === synced.id
            ? {
                ...t,
                title: synced.title || t.title,
                description: nextDescription,
                status: synced.status,
                agentId: synced.agent || t.agentId,
                dependencies: nextDependencies,
                updatedAt: new Date().toISOString(),
              }
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

socket.on('task.sync_error', ({ conversationId, message }: { conversationId: string; message: string }) => {
  useTaskHubStore.setState({
    taskSyncError: { message, timestamp: new Date().toISOString(), conversationId },
  });
});
