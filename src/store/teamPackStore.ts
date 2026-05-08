// src/store/teamPackStore.ts

import { create } from 'zustand';
import type { TeamPack, CreateTeamPackInput } from '@/types/teamPack';

interface TeamPackState {
  teamPacks: TeamPack[];
  selectedPackId: string | null;
  isLoading: boolean;
  error: string | null;

  fetchTeamPacks: () => Promise<void>;
  createTeamPack: (input: CreateTeamPackInput) => Promise<TeamPack>;
  updateTeamPack: (id: string, patch: Partial<CreateTeamPackInput>) => Promise<void>;
  materializeTeamPack: (id: string) => Promise<TeamPack>;
  exportTeamPack: (id: string) => Promise<TeamPack>;
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
      const res = await fetch('/api/team-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to create team pack');
      const pack = await res.json();
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
      const res = await fetch(`/api/team-packs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update team pack');
      const refreshed = await fetch(`/api/team-packs/${id}`);
      if (!refreshed.ok) throw new Error('Failed to reload team pack');
      const pack = await refreshed.json();
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

  materializeTeamPack: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/team-packs/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'materializeRoleSnapshots' }),
      });
      if (!res.ok) throw new Error('Failed to materialize team pack');
      const pack = await res.json();
      set((state) => ({
        teamPacks: state.teamPacks.map((item) => item.id === pack.id ? pack : item),
        isLoading: false,
      }));
      return pack;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      set({ error: message, isLoading: false });
      throw e;
    }
  },

  exportTeamPack: async (id) => {
    const res = await fetch(`/api/team-packs/${id}?export=1`);
    if (!res.ok) throw new Error('Failed to export team pack');
    return res.json();
  },

  deleteTeamPack: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/team-packs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete team pack');
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
