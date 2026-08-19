import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { taskRepo } from '../repositories/task-repo';
import { AgentInbox } from '../platform-events/agent-inbox';
import { A2ACollaborationRepository } from '../a2a/collaboration';
import {
  TeamMemory,
  TeamMemoryError,
} from './team-memory';
import { TeamMemoryContextContributor } from './context-contributor';
import type { ContextQuery } from '@/lib/agent-context/ContextManager';

const NOW = '2026-08-19T10:00:00.000Z';

function proof(id: string, conversationId: string, taskId = 'TASK-1'): void {
  getDb().prepare(`
    INSERT INTO control_proof_event (
      id,event_type,conversation_id,task_id,agent_id,metadata,created_at
    ) VALUES (?,?,?,?,?,?,?)
  `).run(id, 'test.evidence', conversationId, taskId, 'builder', '{}', NOW);
}

function query(agentId = 'builder'): ContextQuery {
  return {
    scenario: 'iterate',
    trigger: 'resume',
    conversationId: 'project-a',
    taskId: 'TASK-1',
    agentId,
    archetype: 'worker',
    requestText: 'SQLite migration decision',
    budgetTokens: 20_000,
    requiredContributorIds: [],
    now: NOW,
  };
}

describe('TeamMemory', () => {
  let memory: TeamMemory;

  beforeEach(() => {
    setTestDb(createTestDb());
    conversationRepo.create({ id: 'project-a', title: 'Project A' });
    conversationRepo.create({ id: 'project-b', title: 'Project B' });
    taskRepo.create({ id: 'TASK-1', conversation_id: 'project-a', title: 'Build', agent_id: 'builder' });
    taskRepo.create({ id: 'TASK-1B', conversation_id: 'project-a', title: 'Sibling', agent_id: 'builder' });
    taskRepo.create({ id: 'TASK-2', conversation_id: 'project-b', title: 'Other', agent_id: 'other' });
    proof('proof-a', 'project-a');
    proof('proof-b', 'project-b', 'TASK-2');
    memory = new TeamMemory();
  });

  afterEach(() => resetDb());

  it('admits strong project evidence, indexes accepted memory, and hides proposed corrections', () => {
    const accepted = memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'remember-sqlite',
      disposition: 'propose',
      kind: 'decision',
      content: 'Use SQLite migrations as the durable schema owner.',
      scope: 'project',
      sourceRefs: ['proof:proof-a', 'task:TASK-1'],
    });
    const proposed = memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'correction-needs-human',
      disposition: 'propose',
      kind: 'correction',
      content: 'The user always wants a graph.',
      scope: 'project',
      sourceRefs: ['proof:proof-a'],
    });

    expect(accepted.memory).toMatchObject({ status: 'accepted', accepted_by: 'system:evidence-gate-v1' });
    expect(proposed.memory).toMatchObject({ status: 'proposed', accepted_by: null });
    expect(memory.recall({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'reviewer',
      query: 'SQLite migrations',
    }).items.map((item) => item.id)).toEqual([accepted.memory!.id]);
    expect(getDb().prepare('SELECT memory_id FROM team_memory_fts').all())
      .toEqual([{ memory_id: accepted.memory!.id }]);
  });

  it('rejects cross-project evidence before creating an opportunity or memory', () => {
    expect(() => memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'cross-project',
      disposition: 'propose',
      kind: 'fact',
      content: 'Foreign project fact',
      sourceRefs: ['proof:proof-b'],
    })).toThrowError(TeamMemoryError);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM team_memory_item').get())
      .toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM team_memory_opportunity').get())
      .toEqual({ count: 0 });
  });

  it('requires task-scoped memory to cite evidence from that exact task', () => {
    expect(() => memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1B',
      agentId: 'builder',
      idempotencyKey: 'wrong-task-source',
      disposition: 'propose',
      kind: 'lesson',
      content: 'A lesson from a different task must not leak into this task scope.',
      sourceRefs: ['proof:proof-a'],
    })).toThrowError(expect.objectContaining({ reasonCode: 'memory_task_source_mismatch' }));
  });

  it('keeps deferred opportunities content-free and visible only to the owning agent', async () => {
    const opportunity = memory.observe({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'review-boundary',
      sourceRefs: ['proof:proof-a'],
      reasonCode: 'tool_boundary:review',
      kindHint: 'lesson',
    });
    const row = getDb().prepare('SELECT * FROM team_memory_opportunity WHERE id=?')
      .get(opportunity.id) as Record<string, unknown>;
    expect(row).not.toHaveProperty('content');

    const contributor = new TeamMemoryContextContributor();
    const ownerFragments = await contributor.contribute(query('builder'));
    const otherFragments = await contributor.contribute(query('reviewer'));
    expect(ownerFragments.map((fragment) => String(fragment.content)).join('\n'))
      .toContain(opportunity.id);
    expect(otherFragments.map((fragment) => String(fragment.content)).join('\n'))
      .not.toContain(opportunity.id);

    const abstained = memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'review-boundary-resolution',
      opportunityId: opportunity.id,
      disposition: 'abstain',
      reasonCode: 'no durable delta',
    });
    expect(abstained.opportunity.disposition).toBe('abstained');
    expect(memory.recall({
      conversationId: 'project-a', taskId: 'TASK-1', agentId: 'builder',
    }).deferred).toEqual([]);
  });

  it('accepts only an exact completed A2A relationship and derives a score-free relationship summary', () => {
    let sequence = 0;
    const repository = new A2ACollaborationRepository({
      db: getDb(),
      inbox: new AgentInbox({ db: getDb(), now: () => new Date(NOW), idFactory: (prefix) => `${prefix}-${++sequence}` }),
      now: () => new Date(NOW),
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
    const chain = repository.createChain({
      conversationId: 'project-a',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'root-message',
      holderId: 'builder',
      holderType: 'agent',
      config: { maxDepth: 4 },
    });
    const offered = repository.offerPassGroup({
      chainId: chain.chain.id,
      sourcePossessionId: chain.rootPossession.id,
      sourceWorkId: 'TASK-1',
      expectedSourceRevision: chain.rootPossession.revision,
      idempotencyKey: 'handoff-reviewer',
      branches: [{
        toAgentId: 'reviewer',
        intent: 'review',
        taskId: 'TASK-1',
        packet: {
          title: 'Review',
          requestedAction: 'Review TASK-1',
          possessionSummary: 'Implementation ready',
          relevantDecisions: [],
          evidenceRefs: ['proof:proof-a'],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: [],
        },
      }],
    });
    const admitted = repository.markPassAdmitted(offered.passes[0].id, offered.passes[0].revision);
    const starting = repository.markPassStarting(admitted.id, admitted.revision);
    const started = repository.markPassStarted(starting.id, starting.revision);
    repository.completePossession({
      possessionId: started.possession.id,
      expectedRevision: started.possession.revision,
      summary: 'Review completed',
    });

    const relationship = memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'remember-handoff',
      disposition: 'propose',
      kind: 'relationship',
      content: 'Builder hands review-ready work to reviewer with proof references.',
      sourceRefs: [`a2a-pass:${offered.passes[0].id}`, 'task:TASK-1'],
      relationship: {
        subjectAgentId: 'builder',
        objectAgentId: 'reviewer',
        relationKind: 'handoff',
      },
    });
    expect(relationship.memory?.status).toBe('accepted');
    const recalled = memory.recall({
      conversationId: 'project-a', taskId: 'TASK-1', agentId: 'builder',
    });
    expect(recalled.relationships).toEqual([
      expect.objectContaining({
        otherAgentId: 'reviewer',
        handoffCount: 1,
        completedHandoffCount: 1,
        reviewCount: 0,
      }),
    ]);
    expect(JSON.stringify(recalled.relationships)).not.toMatch(/score|trust|personality/i);

    const unbound = memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'unbound-handoff',
      disposition: 'propose',
      kind: 'relationship',
      content: 'Builder hands work to an unrelated agent.',
      sourceRefs: [`a2a-pass:${offered.passes[0].id}`, 'task:TASK-1'],
      relationship: {
        subjectAgentId: 'builder',
        objectAgentId: 'other-agent',
        relationKind: 'handoff',
      },
    });
    expect(unbound.memory?.status).toBe('proposed');

    const humanChain = repository.createChain({
      conversationId: 'project-a',
      rootTriggerType: 'user_turn',
      rootTriggerId: 'human-root-message',
      holderId: 'human',
      holderType: 'user',
      config: { maxDepth: 4 },
    });
    const humanOffered = repository.offerPassGroup({
      chainId: humanChain.chain.id,
      sourcePossessionId: humanChain.rootPossession.id,
      sourceWorkId: 'TASK-1',
      expectedSourceRevision: humanChain.rootPossession.revision,
      idempotencyKey: 'human-handoff-reviewer',
      branches: [{
        toAgentId: 'reviewer',
        intent: 'review',
        taskId: 'TASK-1',
        packet: {
          title: 'Human handoff', requestedAction: 'Review', possessionSummary: 'User request',
          relevantDecisions: [], evidenceRefs: ['proof:proof-a'], constraints: [],
          openQuestions: [], forbiddenBehaviors: [], sourceMessageIds: [],
        },
      }],
    });
    const humanAdmitted = repository.markPassAdmitted(humanOffered.passes[0].id, humanOffered.passes[0].revision);
    const humanStarting = repository.markPassStarting(humanAdmitted.id, humanAdmitted.revision);
    const humanStarted = repository.markPassStarted(humanStarting.id, humanStarting.revision);
    repository.completePossession({
      possessionId: humanStarted.possession.id,
      expectedRevision: humanStarted.possession.revision,
      summary: 'Human-originated pass completed',
    });
    const humanRelationship = memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'reviewer',
      idempotencyKey: 'human-relationship-rejected',
      disposition: 'propose',
      kind: 'relationship',
      content: 'Human relationship data must not auto-materialize.',
      sourceRefs: [`a2a-pass:${humanOffered.passes[0].id}`, 'task:TASK-1'],
      relationship: {
        subjectAgentId: 'human',
        objectAgentId: 'reviewer',
        relationKind: 'handoff',
      },
    });
    expect(humanRelationship.memory?.status).toBe('proposed');
    expect(memory.recall({
      conversationId: 'project-a', taskId: 'TASK-1', agentId: 'reviewer',
    }).relationships.map((item) => item.otherAgentId)).not.toContain('human');
  });

  it('applies human lifecycle decisions and removes retired content from FTS recall', () => {
    const proposed = memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'human-correction',
      disposition: 'propose',
      kind: 'correction',
      content: 'Use the user-approved concise handoff format.',
      scope: 'project',
      sourceRefs: ['proof:proof-a'],
    }).memory!;
    const accepted = memory.decide({
      memoryId: proposed.id,
      expectedRevision: proposed.revision,
      decision: 'accept',
      actor: { type: 'human', id: 'human' },
      reasonCode: 'user_confirmed',
    });
    expect(memory.recall({
      conversationId: 'project-a', taskId: 'TASK-1', agentId: 'reviewer', query: 'concise handoff',
    }).items.map((item) => item.id)).toContain(accepted.id);
    const retired = memory.decide({
      memoryId: accepted.id,
      expectedRevision: accepted.revision,
      decision: 'retire',
      actor: { type: 'human', id: 'human' },
      reasonCode: 'no_longer_valid',
    });
    expect(retired.status).toBe('retired');
    expect(memory.recall({
      conversationId: 'project-a', taskId: 'TASK-1', agentId: 'reviewer', query: 'concise handoff',
    }).items.map((item) => item.id)).not.toContain(accepted.id);
    expect(getDb().prepare('SELECT memory_id FROM team_memory_fts WHERE memory_id=?').all(accepted.id))
      .toEqual([]);
  });

  it('removes canonical rows and FTS projections with the owning conversation aggregate', () => {
    memory.record({
      conversationId: 'project-a',
      taskId: 'TASK-1',
      agentId: 'builder',
      idempotencyKey: 'aggregate-delete-memory',
      disposition: 'propose',
      kind: 'fact',
      content: 'This memory belongs only to project A.',
      scope: 'project',
      sourceRefs: ['proof:proof-a'],
    });
    expect(conversationRepo.deleteAggregate('project-a')).toBe(true);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM team_memory_item').get())
      .toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM team_memory_fts').get())
      .toEqual({ count: 0 });
  });
});
