'use client';

import type { SkillSummary } from '@/lib/agent-context/types';
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import {
  type AccountAuthMode,
  type AccountProvider,
} from '@/lib/account-auth';
import {
  DEFAULT_COORDINATOR_INSTRUCTIONS,
  type AgentResponsibility,
} from '@/shared/agent-definition';

// --- Agent Role & Roster ---

export type AgentTheme = 'mario' | 'luigi' | 'peach' | 'dk';

export interface Agent {
  id: string;
  name: string;
  theme: AgentTheme;
  emoji: string;
  isOnline: boolean;
  cliEngine?: RuntimeCliEngine;
  accountIds: string[];
  instructions: string;
  responsibility?: AgentResponsibility;
  avatarUrl?: string;
  model?: string;
  skillIds: string[];
  canModifyCode: boolean;
  canReview: boolean;
  runtimeMode?: 'defaults' | 'custom';
  audienceMode?: 'owner' | 'anyone' | 'selected';
  audienceIds?: string[];
  parallelism?: number;
  instanceNamePool?: string[];
  runLocation?: 'local';
  revision?: number;
}

const FALLBACK_AGENTS: Agent[] = [
  {
    id: 'mario',
    name: 'Mario',
    theme: 'mario',
    emoji: '⭐',
    isOnline: true,
    cliEngine: 'codex',
    accountIds: [],
    instructions: DEFAULT_COORDINATOR_INSTRUCTIONS,
    responsibility: 'coordinator',
    skillIds: [],
    canModifyCode: true,
    canReview: false,
    runtimeMode: 'defaults', audienceMode: 'owner', audienceIds: [], instanceNamePool: [], runLocation: 'local', revision: 1,
  },
  {
    id: 'luigi',
    name: 'Luigi',
    theme: 'luigi',
    emoji: '⚡',
    isOnline: true,
    cliEngine: 'codex',
    accountIds: [],
    instructions: '负责在明确边界内完成全栈实现，并提供可验证的实现证据。',
    responsibility: 'implementer',
    skillIds: [],
    canModifyCode: true,
    canReview: false,
    runtimeMode: 'defaults', audienceMode: 'owner', audienceIds: [], instanceNamePool: [], runLocation: 'local', revision: 1,
  },
  {
    id: 'peach',
    name: 'Peach',
    theme: 'peach',
    emoji: '🌸',
    isOnline: true,
    cliEngine: 'codex',
    accountIds: [],
    instructions: '负责独立评审、测试与质量判断，发现问题时给出可执行反馈。',
    responsibility: 'reviewer',
    skillIds: [],
    canModifyCode: false,
    canReview: true,
    runtimeMode: 'defaults', audienceMode: 'owner', audienceIds: [], instanceNamePool: [], runLocation: 'local', revision: 1,
  },
  {
    id: 'dk',
    name: 'Donkey Kong',
    theme: 'dk',
    emoji: '⚙️',
    isOnline: false,
    cliEngine: 'codex',
    accountIds: [],
    instructions: '负责架构、数据模型、安全与跨模块风险评估。',
    responsibility: 'reviewer',
    skillIds: [],
    canModifyCode: false,
    canReview: true,
    runtimeMode: 'defaults', audienceMode: 'owner', audienceIds: [], instanceNamePool: [], runLocation: 'local', revision: 1,
  },
];

export let AGENT_ROSTER: Agent[] = [...FALLBACK_AGENTS];

export interface LoadAgentsOptions {
  signal?: AbortSignal;
  propagateFailure?: boolean;
}

export async function loadAgents(options: LoadAgentsOptions = {}): Promise<void> {
  try {
    const res = await fetch('/api/agents', { signal: options.signal });
    if (!res.ok) throw new Error('智能体配置加载失败');
    const data = await res.json();
    if (!Array.isArray(data.agents)) throw new Error('智能体配置响应无效');
    if (data.agents.length === 0) return;

    const prevOnline: Record<string, boolean> = {};
    const prevCliEngine: Record<string, RuntimeCliEngine | undefined> = {};
    const prevAccountIds: Record<string, string[]> = {};
    for (const a of AGENT_ROSTER) {
      prevOnline[a.id] = a.isOnline;
      prevCliEngine[a.id] = a.cliEngine;
      prevAccountIds[a.id] = a.accountIds;
    }

    AGENT_ROSTER = data.agents.map((row: any) => ({
      id: row.id,
      name: row.name,
      theme: row.theme as AgentTheme,
      emoji: row.emoji,
      isOnline: prevOnline[row.id] ?? false,
      cliEngine: row.runtime_id ?? prevCliEngine[row.id],
      accountIds: (() => {
        try {
          const value = typeof row.account_ids === 'string' ? JSON.parse(row.account_ids) : row.account_ids;
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
        } catch {
          return prevAccountIds[row.id] ?? [];
        }
      })(),
      instructions: typeof row.instructions === 'string' ? row.instructions : '',
      responsibility: ['coordinator', 'implementer', 'reviewer', 'specialist'].includes(row.responsibility)
        ? row.responsibility
        : 'specialist',
      avatarUrl: row.avatar_url ?? undefined,
      model: row.model ?? undefined,
      skillIds: Array.isArray(row.skill_ids) ? row.skill_ids : [],
      canModifyCode: Boolean(row.can_modify_code),
      canReview: Boolean(row.can_review),
      runtimeMode: row.use_runtime_defaults === 0 ? 'custom' : 'defaults',
      audienceMode: ['owner', 'anyone', 'selected'].includes(row.audience_mode) ? row.audience_mode : 'owner',
      audienceIds: (() => {
        try {
          const value = typeof row.audience_ids === 'string' ? JSON.parse(row.audience_ids) : row.audience_ids;
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
        } catch { return []; }
      })(),
      parallelism: Number.isSafeInteger(row.parallelism) ? row.parallelism : undefined,
      instanceNamePool: (() => {
        try {
          const value = typeof row.instance_name_pool === 'string' ? JSON.parse(row.instance_name_pool) : row.instance_name_pool;
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
        } catch { return []; }
      })(),
      runLocation: 'local',
      revision: Number.isSafeInteger(row.revision) ? row.revision : 1,
    }));

    // Sync to Zustand state for reactivity
    try {
      const { useTaskHubStore } = await import('./taskHubStore');
      useTaskHubStore.setState({ agentRoster: [...AGENT_ROSTER] });
    } catch {}
  } catch (err) {
    console.error('[loadAgents] Failed, using fallback:', err);
    if (options.propagateFailure) throw err;
  }
}

// --- Account types & helpers ---

export type { AccountAuthMode, AccountProvider } from '@/lib/account-auth';

export interface Account {
  id: string;
  name: string;
  authMode: AccountAuthMode;
  provider: AccountProvider;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  status: 'unknown' | 'valid' | 'pending' | 'error';
  lastVerifiedAt?: string;
  verifyError?: string;
  hasApiKey?: boolean;
  createdAt: string;
  updatedAt: string;
}

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

// --- Agent Slice Creator ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- set/get typed as any to avoid circular dependency with TaskHubState
export const createAgentSlice = (set: any, get: () => any) => {
  return {
    agentRoster: [...FALLBACK_AGENTS] as Agent[],

    activeAgentIds: ['mario', 'luigi'] as string[],

    // Invite / dismiss
    inviteAgent: (agentId: string) =>
      set((state: any) => {
        if (state.activeAgentIds.includes(agentId)) return state;
        return { activeAgentIds: [...state.activeAgentIds, agentId] };
      }),

    dismissAgent: (agentId: string) =>
      set((state: any) => ({
        activeAgentIds: state.activeAgentIds.filter((id: string) => id !== agentId),
      })),

    // Roster modal UI
    isRosterModalOpen: false as boolean,
    setRosterModalOpen: (open: boolean) => set({ isRosterModalOpen: open }),

    // Skill state
    skillsMap: {} as Record<string, SkillSummary>,
    agentSkillIds: {} as Record<string, string[]>,
    loadSkills: async () => {
      try {
        const res = await fetch('/api/skills');
        const rawSkills = await res.json();
        const map: Record<string, SkillSummary> = {};
        for (const s of rawSkills) {
          map[s.id] = {
            name: s.name,
            content: s.content,
          };
        }

        const effectiveRoster = typeof get().getEffectiveRoster === 'function'
          ? get().getEffectiveRoster()
          : AGENT_ROSTER;
        const agentIds: string[] = Array.from(new Set<string>(effectiveRoster.map((a: Agent) => a.id)));
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
    getSkillsForAgent: (agentId: string): SkillSummary[] => {
      const { skillsMap, agentSkillIds } = get();
      const ids = agentSkillIds[agentId] ?? [];
      return ids.map((id: string) => skillsMap[id]).filter(Boolean);
    },
    importSkills: async (source: string): Promise<{ imported?: number; error?: string }> => {
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
  };
};
