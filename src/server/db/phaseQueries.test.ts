import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setTestDb, getDb } from './index';
import {
  listPhasesByConversation,
  getPhaseById,
  upsertPhase,
  deletePhase,
  deletePhasesByConversation,
} from './phaseQueries';
import type { Phase } from '@/types/phase';

const CONV_ID = 'conv-test-001';

function seedConversation(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT OR IGNORE INTO conversation (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(id, `Test ${id}`, now, now);
}

const makePhase = (overrides: Partial<Phase> = {}): Phase => ({
  id: `${CONV_ID}-PHASE-0`,
  conversationId: CONV_ID,
  title: 'Test Phase',
  description: 'A test phase',
  order: 0,
  status: 'planned',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('phaseQueries', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    seedConversation(CONV_ID);
    seedConversation('conv-other-999');
  });

  it('upserts and retrieves a phase', () => {
    const phase = makePhase();
    upsertPhase(phase);

    const loaded = getPhaseById(phase.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(phase.id);
    expect(loaded!.title).toBe('Test Phase');
    expect(loaded!.conversationId).toBe(CONV_ID);
  });

  it('updates existing phase on upsert', () => {
    const phase = makePhase();
    upsertPhase(phase);

    const updated = makePhase({ title: 'Updated', status: 'active' });
    upsertPhase(updated);

    const loaded = getPhaseById(phase.id);
    expect(loaded!.title).toBe('Updated');
    expect(loaded!.status).toBe('active');
  });

  it('lists phases by conversation ordered by order', () => {
    upsertPhase(makePhase({ id: `${CONV_ID}-PHASE-2`, order: 2, title: 'Third' }));
    upsertPhase(makePhase({ id: `${CONV_ID}-PHASE-0`, order: 0, title: 'First' }));
    upsertPhase(makePhase({ id: `${CONV_ID}-PHASE-1`, order: 1, title: 'Second' }));

    const phases = listPhasesByConversation(CONV_ID);
    expect(phases).toHaveLength(3);
    expect(phases[0].title).toBe('First');
    expect(phases[1].title).toBe('Second');
    expect(phases[2].title).toBe('Third');
  });

  it('filters by conversationId', () => {
    const OTHER_CONV = 'conv-other-999';
    upsertPhase(makePhase({ conversationId: CONV_ID }));
    upsertPhase(makePhase({ id: `${OTHER_CONV}-PHASE-0`, conversationId: OTHER_CONV }));

    expect(listPhasesByConversation(CONV_ID)).toHaveLength(1);
    expect(listPhasesByConversation(OTHER_CONV)).toHaveLength(1);
  });

  it('returns undefined for non-existent phase', () => {
    expect(getPhaseById('nonexistent')).toBeUndefined();
  });

  it('deletes a single phase', () => {
    const phase = makePhase({ id: `${CONV_ID}-PHASE-del` });
    upsertPhase(phase);
    expect(getPhaseById(phase.id)).toBeDefined();

    deletePhase(phase.id);
    expect(getPhaseById(phase.id)).toBeUndefined();
  });

  it('deletes all phases by conversation', () => {
    upsertPhase(makePhase({ id: `${CONV_ID}-PHASE-0`, order: 0 }));
    upsertPhase(makePhase({ id: `${CONV_ID}-PHASE-1`, order: 1 }));
    const OTHER_CONV = 'conv-other-999';
    upsertPhase(makePhase({ id: `${OTHER_CONV}-PHASE-0`, conversationId: OTHER_CONV }));

    deletePhasesByConversation(CONV_ID);

    expect(listPhasesByConversation(CONV_ID)).toHaveLength(0);
    expect(listPhasesByConversation(OTHER_CONV)).toHaveLength(1);
  });

  it('handles null description', () => {
    const phase = makePhase({ description: '' });
    upsertPhase(phase);

    const loaded = getPhaseById(phase.id);
    expect(loaded!.description).toBe('');
  });

  it('cycles through all statuses', () => {
    const phase = makePhase();

    for (const status of ['planned', 'active', 'done'] as const) {
      upsertPhase(makePhase({ status }));
      expect(getPhaseById(phase.id)!.status).toBe(status);
    }
  });
});
