// src/store/teamPackStore.ts

import { create } from 'zustand';
import type { AgentTeamDefinitionInput, TeamPack } from '@/types/teamPack';

interface TeamPackState {
  teamPacks: TeamPack[];
  selectedPackId: string | null;
  isLoading: boolean;
  error: string | null;

  fetchTeamPacks: () => Promise<void>;
  createTeamPack: (input: AgentTeamDefinitionInput) => Promise<TeamPack>;
  updateTeamPack: (id: string, input: AgentTeamDefinitionInput) => Promise<void>;
  deleteTeamPack: (id: string) => Promise<void>;
  selectPack: (id: string | null) => void;
  getSelectedPack: () => TeamPack | undefined;
}

export const useTeamPackStore = create<TeamPackState>((set, get) => ({
  teamPacks: [],
  selectedPackId: null,
  isLoading: false,
  error: null,

  fetchTeamPacks: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/team-packs');
      if (!res.ok) throw new Error('Failed to fetch team packs');
      const packs = await res.json();
      set({ teamPacks: packs, isLoading: false });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      set({ error: message, isLoading: false });
    }
  },

  createTeamPack: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const commandId = `ui-${crypto.randomUUID()}`;
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'agent_team.create',
          commandId,
          idempotencyKey: commandId,
          projectId: 'workspace',
          input,
        }),
      });
      const receipt = await res.json();
      if (!res.ok) throw new Error(receipt.reasonCode ?? receipt.error ?? 'Agent Team 创建失败');
      const pack = receipt.result?.team as TeamPack | undefined;
      if (!pack) throw new Error('Agent Team 创建回执缺少对象');
      set(state => ({
        teamPacks: [...state.teamPacks, pack],
        isLoading: false,
      }));
      return pack;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      set({ error: message, isLoading: false });
      throw e;
    }
  },

  updateTeamPack: async (id, patch) => {
    set({ isLoading: true, error: null });
    try {
      const current = get().teamPacks.find((team) => team.id === id);
      if (!current) throw new Error('Agent Team 不存在');
      const commandId = `ui-${crypto.randomUUID()}`;
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'agent_team.update', commandId, idempotencyKey: commandId,
          expectedRevision: current.revision ?? 1, projectId: 'workspace', input: { ...patch, id },
        }),
      });
      const receipt = await res.json();
      if (!res.ok) throw new Error(receipt.reasonCode ?? receipt.error ?? 'Agent Team 更新失败');
      const pack = receipt.result?.team as TeamPack | undefined;
      if (!pack) throw new Error('Agent Team 更新回执缺少对象');
      set((state) => ({
        teamPacks: state.teamPacks.map((item) => item.id === id ? pack : item),
        isLoading: false,
      }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      set({ error: message, isLoading: false });
      throw e;
    }
  },

  deleteTeamPack: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const current = get().teamPacks.find((team) => team.id === id);
      if (!current) throw new Error('Agent Team 不存在');
      const commandId = `ui-${crypto.randomUUID()}`;
      const res = await fetch('/api/commands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'agent_team.delete', commandId, idempotencyKey: commandId, expectedRevision: current.revision ?? 1, projectId: 'workspace', input: { teamId: id } }),
      });
      const receipt = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(receipt.reasonCode ?? receipt.error ?? 'Agent Team 删除失败');
      set(state => ({
        teamPacks: state.teamPacks.filter(p => p.id !== id),
        selectedPackId: state.selectedPackId === id ? null : state.selectedPackId,
        isLoading: false,
      }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      set({ error: message, isLoading: false });
    }
  },

  selectPack: (id) => set({ selectedPackId: id }),

  getSelectedPack: () => {
    const { teamPacks, selectedPackId } = get();
    return teamPacks.find(p => p.id === selectedPackId);
  },
}));
