import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { A2ACollaborationRepository } from '../a2a/collaboration';
import { A2ACollaborationInvariantError } from '../a2a/errors';
import { HumanA2ACommandService } from '../a2a/human-command-service';
import { AgentInbox, AgentInboxCapacityError } from './agent-inbox';
import {
  AgentInboxManualRetryError,
  AgentInboxManualRetryService,
} from './agent-inbox-manual-retry';

describe('AgentInboxManualRetryService', () => {
  let db: ReturnType<typeof createTestDb>;
  let inbox: AgentInbox;

  beforeEach(() => {
    db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('workstream-1','Project','active',?,?)
    `).run(now, now);
    inbox = new AgentInbox({ db });
  });

  afterEach(() => db.close());

  it('reissues a failed human A2A request and supersedes the stale Inbox', () => {
    const failed = inbox.enqueue({
      projectId: 'workstream-1', projectAgentId: 'mario', idempotencyKey: 'failed-a2a',
      command: {
        source: 'a2a', prompt: 'Original prompt', fromAgentId: 'human',
        a2aHandoff: {
          title: 'Human request', requestedAction: 'Plan the work', possessionSummary: 'Plan the work',
          relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
          forbiddenBehaviors: [], sourceMessageIds: ['message-1'],
        },
      },
    });
    const claim = inbox.claimNext()!;
    inbox.expire(failed.id, claim.leaseToken!, 'runtime_start_failed');
    const humanA2A = {
      retry: () => {
        const replacement = inbox.enqueue({
          projectId: 'workstream-1', projectAgentId: 'mario', idempotencyKey: 'replacement-a2a',
          command: { source: 'a2a', prompt: 'Plan the work', fromAgentId: 'human' },
        });
        return {
          status: 'offered' as const,
          handoff: { passes: [{ toAgentId: 'mario', inboxItemId: replacement.id }] },
        };
      },
    };

    const result = new AgentInboxManualRetryService({ db, inbox, humanA2A }).retry(failed.id);

    expect(result).toMatchObject({ reissued: true, item: { status: 'enqueued' } });
    expect(inbox.get(failed.id)).toMatchObject({
      status: 'cancelled', lastError: 'manual_retry_reissued',
    });
    expect(inbox.listExpired('workstream-1')).toEqual([]);
    expect(new AgentInboxManualRetryService({ db, inbox, humanA2A }).retry(failed.id))
      .toEqual(result);
  });

  it('keeps the terminal aggregate closed while a real collaboration service creates one new chain', () => {
    const collaboration = new A2ACollaborationRepository({ db, inbox });
    const humanA2A = new HumanA2ACommandService({
      db,
      collaboration,
      commandGuard: { assert: () => undefined },
    });
    const original = humanA2A.submit({
      conversationId: 'workstream-1', messageId: 'message-real',
      prompt: 'Plan the real work', targetAgentIds: ['mario'],
    });
    if (original.status !== 'offered') throw new Error('expected_original_handoff');
    const oldPass = original.handoff.passes[0]!;
    const oldInboxId = oldPass.inboxItemId!;
    const claim = inbox.claimNext()!;
    inbox.expire(oldInboxId, claim.leaseToken!, 'runtime_start_failed');
    collaboration.failPass({
      passId: oldPass.id,
      expectedRevision: oldPass.revision,
      status: 'error',
      reasonCode: 'runtime_start_failed',
      phase: 'runtime_start',
    });
    collaboration.abortActiveChain('workstream-1', 'runtime_start_failed');

    const retried = new AgentInboxManualRetryService({ db, inbox, humanA2A }).retry(oldInboxId)!;

    expect(retried).toMatchObject({ reissued: true, item: { status: 'enqueued' } });
    expect(db.prepare(`
      SELECT root_trigger_id,status FROM a2a_possession_chain ORDER BY created_at,id
    `).all()).toEqual([
      { root_trigger_id: 'message-real', status: 'aborted' },
      { root_trigger_id: `manual-retry:${oldInboxId}`, status: 'active' },
    ]);
    expect(db.prepare(`SELECT status FROM a2a_pass ORDER BY created_at,id`).all())
      .toEqual([{ status: 'error' }, { status: 'offered' }]);
    expect(inbox.get(oldInboxId)).toMatchObject({
      status: 'cancelled', lastError: 'manual_retry_reissued',
    });
    expect(new AgentInboxManualRetryService({ db, inbox, humanA2A }).retry(oldInboxId))
      .toEqual(retried);
  });

  it('keeps non-A2A failures on the original bounded retry path', () => {
    const failed = inbox.enqueue({
      projectId: 'workstream-1', projectAgentId: 'reviewer', idempotencyKey: 'failed-review',
      command: { source: 'review_gate', prompt: 'Review' },
    });
    const claim = inbox.claimNext()!;
    inbox.expire(failed.id, claim.leaseToken!, 'runtime_start_failed');

    expect(new AgentInboxManualRetryService({ db, inbox }).retry(failed.id)).toMatchObject({
      reissued: false,
      item: { id: failed.id, status: 'released' },
    });
  });

  it('rejects replaying an Agent-owned terminal A2A request as a human turn', () => {
    const failed = inbox.enqueue({
      projectId: 'workstream-1', projectAgentId: 'reviewer', idempotencyKey: 'failed-agent-a2a',
      command: { source: 'a2a', prompt: 'Review', fromAgentId: 'mario' },
    });
    const claim = inbox.claimNext()!;
    inbox.expire(failed.id, claim.leaseToken!, 'runtime_start_failed');

    expect(() => new AgentInboxManualRetryService({ db, inbox }).retry(failed.id))
      .toThrow(AgentInboxManualRetryError);
    expect(inbox.get(failed.id)?.status).toBe('expired');
  });

  it('reports a conflict instead of replacing active work', () => {
    const failed = inbox.enqueue({
      projectId: 'workstream-1', projectAgentId: 'mario', idempotencyKey: 'failed-active-a2a',
      command: {
        source: 'a2a', prompt: 'Original prompt', fromAgentId: 'human',
        a2aHandoff: {
          title: 'Human request', requestedAction: 'Plan the work', possessionSummary: 'Plan the work',
          relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
          forbiddenBehaviors: [], sourceMessageIds: ['message-1'],
        },
      },
    });
    const claim = inbox.claimNext()!;
    inbox.expire(failed.id, claim.leaseToken!, 'runtime_start_failed');
    const humanA2A = {
      retry: () => {
        throw new A2ACollaborationInvariantError(
          'a2a_active_chain_exists',
          'Another chain is active',
        );
      },
    };

    expect(() => new AgentInboxManualRetryService({ db, inbox, humanA2A }).retry(failed.id))
      .toThrowError(expect.objectContaining({ reasonCode: 'a2a_retry_active_work_exists' }));
    expect(inbox.get(failed.id)?.status).toBe('expired');
  });

  it.each([
    {
      error: new A2ACollaborationInvariantError('a2a_target_not_in_roster', 'mario'),
      reasonCode: 'a2a_target_not_in_roster',
      httpStatus: 422,
    },
    {
      error: new AgentInboxCapacityError('lane full'),
      reasonCode: 'agent_inbox_lane_capacity_exceeded',
      httpStatus: 429,
    },
  ])('maps expected domain failure $reasonCode to HTTP $httpStatus', ({
    error, reasonCode, httpStatus,
  }) => {
    const failed = inbox.enqueue({
      projectId: 'workstream-1', projectAgentId: 'mario', idempotencyKey: `failed-${reasonCode}`,
      command: {
        source: 'a2a', prompt: 'Original prompt', fromAgentId: 'human',
        a2aHandoff: {
          title: 'Human request', requestedAction: 'Plan the work', possessionSummary: 'Plan the work',
          relevantDecisions: [], evidenceRefs: [], constraints: [], openQuestions: [],
          forbiddenBehaviors: [], sourceMessageIds: ['message-1'],
        },
      },
    });
    const claim = inbox.claimNext()!;
    inbox.expire(failed.id, claim.leaseToken!, 'runtime_start_failed');
    const humanA2A = { retry: () => { throw error; } };

    try {
      new AgentInboxManualRetryService({ db, inbox, humanA2A }).retry(failed.id);
      throw new Error('expected_retry_failure');
    } catch (caught) {
      expect(caught).toMatchObject({ reasonCode, httpStatus });
    }
    expect(inbox.get(failed.id)?.status).toBe('expired');
  });
});
