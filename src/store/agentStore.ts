'use client';

import type { RoleCard } from '@/types/roleCard';
import type { TeamPackRole } from '@/types/teamPack';
import type { SkillSummary } from '@/lib/agent-context/types';
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import {
  type AccountAuthMode,
  type AccountProvider,
} from '@/lib/account-auth';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';

// --- Agent Role & Roster ---

export type AgentTheme = 'mario' | 'luigi' | 'peach' | 'dk';

export interface Agent {
  id: string;
  name: string;
  roleCardId: string;
  theme: AgentTheme;
  emoji: string;
  isOnline: boolean;
  cliEngine?: RuntimeCliEngine;
  accountIds: string[];
}

const FALLBACK_AGENTS: Agent[] = [
  {
    id: 'mario',
    name: 'Mario',
    roleCardId: 'preset-planner',
    theme: 'mario',
    emoji: '⭐',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'luigi',
    name: 'Luigi',
    roleCardId: 'preset-frontend',
    theme: 'luigi',
    emoji: '⚡',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'peach',
    name: 'Peach',
    roleCardId: 'preset-code-reviewer',
    theme: 'peach',
    emoji: '🌸',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'dk',
    name: 'Donkey Kong',
    roleCardId: 'preset-arch-reviewer',
    theme: 'dk',
    emoji: '⚙️',
    isOnline: false,
    accountIds: [],
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
      roleCardId: row.role_card_id,
      theme: row.theme as AgentTheme,
      emoji: row.emoji,
      isOnline: prevOnline[row.id] ?? false,
      cliEngine: prevCliEngine[row.id],
      accountIds: prevAccountIds[row.id] ?? [],
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

    // Role Cards
    roleCards: [...PRESET_ROLE_CARDS] as RoleCard[],
    upsertRoleCard: (card: Omit<RoleCard, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isPreset'> & { id?: string; isPreset?: boolean }): string => {
      const now = new Date().toISOString();
      if (card.id) {
        set((state: any) => ({
          roleCards: state.roleCards.map((c: RoleCard) =>
            c.id === card.id
              ? { ...c, ...card, updatedAt: now, version: c.version + 1 } as RoleCard
              : c
          ),
        }));
        return card.id;
      }
      const id = `rc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      set((state: any) => ({
        roleCards: [
          ...state.roleCards,
          { ...card, id, isPreset: false, version: 1, createdAt: now, updatedAt: now } as RoleCard,
        ],
      }));
      return id;
    },
    removeRoleCard: (cardId: string) =>
      set((state: any) => ({
        roleCards: state.roleCards.filter((c: RoleCard) => !(c.id === cardId && !c.isPreset)),
      })),
    setAgentRoleCardId: (agentId: string, roleCardId: string) => {
      const idx = AGENT_ROSTER.findIndex((a) => a.id === agentId);
      if (idx !== -1) {
        (AGENT_ROSTER as Agent[])[idx].roleCardId = roleCardId;
      }
      set((state: any) => ({
        agentRoster: [...AGENT_ROSTER],
        agentRoleCardOverrides: {
          ...(state.agentRoleCardOverrides ?? {}),
          [agentId]: roleCardId,
        },
      }));
    },
    setRoleCardAccountIds: (roleCardId: string, accountIds: string[]) =>
      set((state: any) => ({
        roleCards: state.roleCards.map((c: RoleCard) =>
          c.id === roleCardId ? { ...c, accountIds, updatedAt: new Date().toISOString() } : c
        ),
      })),

    // Agent account bindings
    agentAccountOverrides: {} as Record<string, string[]>,
    agentRoleCardOverrides: {} as Record<string, string>,
    setAgentAccountIds: (agentId: string, accountIds: string[]) => {
      const teamRole = typeof get().getSelectedConversation === 'function'
        ? get().currentTeamPack?.roles?.find((role: TeamPackRole) => role.id === agentId)
        : undefined;
      if (teamRole && typeof get().setTeamRoleAccountIds === 'function') {
        void get().setTeamRoleAccountIds(agentId, accountIds);
        return;
      }
      set((state: any) => ({
        agentAccountOverrides: {
          ...state.agentAccountOverrides,
          [agentId]: accountIds,
        },
      }));
    },

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

    // Role Card UI state
    isRoleCardDetailOpen: false as boolean,
    selectedRoleCardId: null as string | null,
    setRoleCardDetailOpen: (open: boolean, cardId?: string) =>
      set({ isRoleCardDetailOpen: open, selectedRoleCardId: cardId ?? null }),
    isRoleCardEditorOpen: false as boolean,
    editingRoleCardId: null as string | null,
    setRoleCardEditorOpen: (open: boolean, cardId?: string) =>
      set({ isRoleCardEditorOpen: open, editingRoleCardId: cardId ?? null }),

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
    assignSkillsToAgent: async (agentId: string, skillIds: string[]) => {
      await fetch(`/api/agents/${agentId}/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillIds }),
      });
      set((state: any) => ({
        agentSkillIds: { ...state.agentSkillIds, [agentId]: skillIds },
      }));
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
