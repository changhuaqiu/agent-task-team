import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { conversationRepo } from '../repositories/conversation-repo';
import { A2ACollaborationRepository } from './collaboration';
import { A2AReadModelProjection } from './projection';

beforeEach(() => setTestDb(createTestDb()));
afterEach(() => resetDb());

describe('A2AReadModelProjection', () => {
  it('derives holders and handoffs only from the authoritative collaboration aggregate', () => {
    conversationRepo.create({
      id: 'project-a2a-projection',
      title: 'A2A projection',
    });
    let sequence = 0;
    const repository = new A2ACollaborationRepository({
      db: getDb(),
      inbox: new AgentInbox({
        db: getDb(),
        idFactory: (prefix) => `${prefix}-${++sequence}`,
      }),
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
    const created = repository.createChain({
      conversationId: 'project-a2a-projection',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'message-1',
      holderId: 'planner',
      holderType: 'agent',
    });
    const offered = repository.offerPassGroup({
      chainId: created.chain.id,
      sourcePossessionId: created.rootPossession.id,
      expectedSourceRevision: created.rootPossession.revision,
      idempotencyKey: 'review-v1',
      branches: [{
        toAgentId: 'reviewer',
        intent: 'review',
        packet: {
          title: 'Review implementation',
          requestedAction: 'Review the committed implementation',
          possessionSummary: 'Implementation is ready',
          relevantDecisions: [],
          evidenceRefs: [],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: ['message-1'],
        },
      }],
    });

    const snapshot = new A2AReadModelProjection(getDb()).build('project-a2a-projection');

    expect(snapshot).toMatchObject({
      conversationId: 'project-a2a-projection',
      chainId: created.chain.id,
      currentHolderIds: ['planner'],
      status: 'active',
      handoffs: [{
        passId: offered.passes[0]!.id,
        fromAgentId: 'planner',
        toAgentId: 'reviewer',
        status: 'offered',
        intent: 'review',
        title: 'Review implementation',
      }],
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM chain_worklist').get())
      .toEqual({ count: 0 });
  });
});
