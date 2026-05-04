import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setTestDb } from './index';
import { upsertRoleCard, loadAllRoleCards, deleteRoleCard } from './roleCardQueries';
import type { RoleCard } from '@/types/roleCard';

const makeCard = (id: string): RoleCard => ({
  id,
  name: id,
  displayName: `Display ${id}`,
  description: 'test',
  category: 'frontend',
  tags: [],
  applicableScenarios: [],
  responsibilities: [],
  nonResponsibilities: [],
  successCriteria: [],
  clarifyBeforeExecute: 'when_ambiguous',
  outputStyle: 'concise',
  preferStructuredOutput: false,
  allowedActions: [],
  requiresConfirmation: [],
  forbiddenActions: [],
  preferredEngines: [],
  allowedTools: [],
  accountIds: [],
  outputFormat: 'freeform',
  requiresEvidence: false,
  riskGrading: 'none',
  isPreset: false,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('roleCardQueries', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
  });

  it('upserts and loads a role card', () => {
    const card = makeCard('test-card');
    upsertRoleCard(card);

    const loaded = loadAllRoleCards();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test-card');
    expect(loaded[0].displayName).toBe('Display test-card');
  });

  it('updates existing card on upsert', () => {
    const card = makeCard('test-card');
    upsertRoleCard(card);

    const updated = { ...card, displayName: 'Updated' };
    upsertRoleCard(updated);

    const loaded = loadAllRoleCards();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].displayName).toBe('Updated');
  });

  it('deletes a non-preset role card', () => {
    const card = makeCard('custom-card');
    upsertRoleCard(card);

    deleteRoleCard('custom-card');

    const loaded = loadAllRoleCards();
    expect(loaded).toHaveLength(0);
  });

  it('preserves capabilities through round-trip', () => {
    const card: RoleCard = {
      ...makeCard('cap-card'),
      capabilities: {
        domains: ['frontend', 'backend'],
        skills: ['react', 'sql'],
        seniority: 'senior',
        maxConcurrentTasks: 3,
      },
    };

    upsertRoleCard(card);
    const loaded = loadAllRoleCards();
    expect(loaded[0].capabilities?.domains).toEqual(['frontend', 'backend']);
    expect(loaded[0].capabilities?.maxConcurrentTasks).toBe(3);
  });
});
