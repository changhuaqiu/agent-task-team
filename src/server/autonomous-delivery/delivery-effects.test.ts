import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { DurableEffectOutbox } from '../platform-events/durable-effect-outbox';
import type { ProviderActionPort } from './provider-actions';
import { AutonomousDeliveryRepository } from './repository';
import { DELIVERY_EFFECT_TYPES, registerDeliveryEffectAdapters } from './delivery-effects';

describe('delivery provider Effects', () => {
  let db: Database.Database;
  let runId: string;
  let deliveries: AutonomousDeliveryRepository;
  const now = new Date('2026-07-28T00:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    deliveries = new AutonomousDeliveryRepository();
    runId = deliveries.createRun({
      idempotencyKey: 'delivery-effects-run',
      goal: 'Ship',
      acceptanceCriteria: ['Works'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true,
        allowPush: true,
        allowPullRequest: true,
        allowAutoMerge: true,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 2,
        maxRepairCycles: 1,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: false,
        requireWebE2E: false,
        requireMerge: true,
      },
    }, now).run.id;
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('retries a requested merge until the provider reports a merged receipt', async () => {
    const integrate = vi.fn<ProviderActionPort['integrate']>()
      .mockResolvedValueOnce([{
        kind: 'provider.github.pull_request.merge_requested',
        status: 'succeeded',
        externalId: '42',
        idempotencyKey: `${runId}:merge-requested`,
      }])
      .mockResolvedValueOnce([{
        kind: 'provider.github.pull_request.merged',
        status: 'succeeded',
        externalId: '42',
        idempotencyKey: `${runId}:merged`,
      }]);
    const provider: ProviderActionPort = {
      integrate,
      observeIntegration: vi.fn(),
    };
    const outbox = new DurableEffectOutbox({
      db,
      now: () => now,
      retryDelayMs: () => 0,
      idFactory: (prefix) => `${prefix}-${Math.random()}`,
    });
    registerDeliveryEffectAdapters(outbox, { provider, deliveries });
    const revision = deliveries.getRun(runId)!.revision;
    const sourceEventId = (db.prepare(`
      SELECT id FROM platform_event WHERE project_id=? ORDER BY recorded_at DESC,id DESC LIMIT 1
    `).get('project-1') as { id: string }).id;
    const [effect] = outbox.enqueueBatch({
      sourceEventId,
      laneKey: `delivery:${runId}:provider`,
      effects: [{
        type: DELIVERY_EFFECT_TYPES.githubIntegrate,
        targetKey: runId,
        payload: { runId },
        criticality: 'blocking',
        deliveryRunId: runId,
        appliesFromRevision: revision,
        sourceActionId: 'control-action-1',
      }],
    });

    expect(await outbox.drain()).toMatchObject({ failed: 1, succeeded: 0 });
    expect(outbox.get(effect!.id)?.status).toBe('queued');
    expect(await outbox.drain()).toMatchObject({ failed: 0, succeeded: 1 });
    expect(outbox.get(effect!.id)?.status).toBe('succeeded');
    expect(deliveries.getSnapshot(runId)?.receipts.map((receipt) => receipt.kind))
      .toEqual([
        'provider.github.pull_request.merge_requested',
        'provider.github.pull_request.merged',
      ]);
  });
});
