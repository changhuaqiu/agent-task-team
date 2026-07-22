import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setTestDb } from './index';
import {
  deleteAgent,
  getAgentById,
  listAgents,
  parseAgentAccountIds,
  updateAgentAccountIds,
  upsertAgent,
} from './agentQueries';
import { seedPresetAgents } from './seed-agents';

describe('agentQueries', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
  });

  describe('seed data', () => {
    beforeEach(() => {
      seedPresetAgents();
    });

    it('loads all 4 preset agents', () => {
      const agents = listAgents();
      expect(agents).toHaveLength(4);
    });

    it('each preset agent has is_preset = 1', () => {
      const agents = listAgents();
      for (const agent of agents) {
        expect(agent.is_preset).toBe(1);
      }
    });

    it('preset agents contain expected ids', () => {
      const ids = listAgents().map((a) => a.id).sort();
      expect(ids).toEqual(['dk', 'luigi', 'mario', 'peach']);
    });

    it('seeding twice does not duplicate rows', () => {
      seedPresetAgents();
      expect(listAgents()).toHaveLength(4);
    });
  });

  describe('listAgents', () => {
    it('returns empty array when no agents exist', () => {
      expect(listAgents()).toEqual([]);
    });
  });

  describe('getAgentById', () => {
    it('returns undefined for non-existent agent', () => {
      expect(getAgentById('nonexistent')).toBeUndefined();
    });

    it('returns the correct agent after upsert', () => {
      upsertAgent({
        id: 'test-agent',
        name: 'Test Agent',
        roleCardId: 'role-1',
        theme: 'blue',
        emoji: '🧪',
      });

      const agent = getAgentById('test-agent');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('test-agent');
      expect(agent!.name).toBe('Test Agent');
      expect(agent!.role_card_id).toBe('role-1');
      expect(agent!.theme).toBe('blue');
      expect(agent!.emoji).toBe('🧪');
      expect(agent!.is_preset).toBe(0);
    });
  });

  describe('upsertAgent', () => {
    it('creates a new agent', () => {
      const result = upsertAgent({
        id: 'custom-1',
        name: 'Custom Agent',
        roleCardId: 'role-custom',
        theme: 'green',
        emoji: '🌿',
      });

      expect(result.id).toBe('custom-1');
      expect(result.name).toBe('Custom Agent');
      expect(result.is_preset).toBe(0);
      expect(listAgents()).toHaveLength(1);
    });

    it('updates an existing agent on upsert', () => {
      upsertAgent({
        id: 'custom-1',
        name: 'Original',
        roleCardId: 'role-1',
        theme: 'red',
        emoji: '🔴',
      });

      const updated = upsertAgent({
        id: 'custom-1',
        name: 'Updated',
        roleCardId: 'role-2',
        theme: 'blue',
        emoji: '🔵',
      });

      expect(updated.name).toBe('Updated');
      expect(updated.role_card_id).toBe('role-2');
      expect(updated.theme).toBe('blue');
      expect(updated.emoji).toBe('🔵');
      expect(listAgents()).toHaveLength(1);
    });

    it('sets is_preset = 1 when isPreset is true', () => {
      const result = upsertAgent({
        id: 'preset-test',
        name: 'Preset Agent',
        roleCardId: 'role-p',
        theme: 'gold',
        emoji: '⭐',
        isPreset: true,
      });

      expect(result.is_preset).toBe(1);
    });

    it('defaults is_preset to 0 when isPreset not provided', () => {
      const result = upsertAgent({
        id: 'no-preset',
        name: 'No Preset',
        roleCardId: 'role-n',
        theme: 'silver',
        emoji: '🥈',
      });

      expect(result.is_preset).toBe(0);
    });

    it('sets created_at and updated_at timestamps', () => {
      const result = upsertAgent({
        id: 'ts-agent',
        name: 'Timestamp Agent',
        roleCardId: 'role-ts',
        theme: 'purple',
        emoji: '⏰',
      });

      expect(result.created_at).toBeTruthy();
      expect(result.updated_at).toBeTruthy();
    });

    it('persists account bindings and preserves them across preset reseeding', () => {
      seedPresetAgents();
      expect(updateAgentAccountIds('mario', ['acc-1', 'acc-1', 'acc-2'])).toBeDefined();
      expect(parseAgentAccountIds(getAgentById('mario')!)).toEqual(['acc-1', 'acc-2']);

      seedPresetAgents();
      expect(parseAgentAccountIds(getAgentById('mario')!)).toEqual(['acc-1', 'acc-2']);
    });
  });

  describe('deleteAgent', () => {
    it('deletes a non-preset agent', () => {
      upsertAgent({
        id: 'deletable',
        name: 'Deletable',
        roleCardId: 'role-d',
        theme: 'gray',
        emoji: '🗑️',
      });

      expect(getAgentById('deletable')).toBeDefined();

      deleteAgent('deletable');
      expect(getAgentById('deletable')).toBeUndefined();
      expect(listAgents()).toHaveLength(0);
    });

    it('throws when deleting a preset agent', () => {
      seedPresetAgents();

      expect(() => deleteAgent('mario')).toThrow('Cannot delete preset agent');
      expect(getAgentById('mario')).toBeDefined();
    });

    it('does not throw when deleting non-existent agent', () => {
      expect(() => deleteAgent('ghost')).not.toThrow();
    });
  });
});
