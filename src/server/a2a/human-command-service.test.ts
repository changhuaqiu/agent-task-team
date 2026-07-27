import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import { A2ACollaborationRepository } from './collaboration';
import { HumanA2ACommandService } from './human-command-service';

const NOW = new Date('2026-07-28T13:00:00.000Z');

describe('HumanA2ACommandService', () => {
  let service: HumanA2ACommandService;
  let sequence: number;

  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-human-a2a', 'Human A2A', 'active', NOW.toISOString(), NOW.toISOString());
    sequence = 0;
    const inbox = new AgentInbox({
      db,
      now: () => NOW,
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
    const collaboration = new A2ACollaborationRepository({
      db,
      inbox,
      now: () => NOW,
      idFactory: (prefix) => `${prefix}-${++sequence}`,
    });
    service = new HumanA2ACommandService({ db, collaboration });
  });

  afterEach(() => resetDb());

  it('creates the collaboration and durable Inbox work before any Runtime starts', () => {
    const result = service.submit({
      conversationId: 'project-human-a2a',
      messageId: 'message-1',
      prompt: 'Implement the accepted design',
      targetAgentIds: ['builder'],
      taskId: 'TASK-1',
    });

    expect(result).toMatchObject({
      status: 'offered',
      handoff: {
        group: { mode: 'transfer', status: 'offered' },
        passes: [{ toAgentId: 'builder', status: 'offered' }],
        inboxItems: [{
          projectAgentId: 'builder',
          status: 'enqueued',
          command: {
            source: 'a2a',
            taskId: 'TASK-1',
            fromAgentId: 'human',
            passId: expect.any(String),
          },
        }],
      },
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM invocation').get())
      .toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) count FROM chain_worklist').get())
      .toEqual({ count: 0 });
  });

  it('atomically supersedes the previous human collaboration on a new turn', () => {
    const first = service.submit({
      conversationId: 'project-human-a2a',
      messageId: 'message-1',
      prompt: 'First request',
      targetAgentIds: ['builder'],
    });
    const second = service.submit({
      conversationId: 'project-human-a2a',
      messageId: 'message-2',
      prompt: 'Second request',
      targetAgentIds: ['reviewer'],
    });

    expect(first.status).toBe('offered');
    expect(second.status).toBe('offered');
    expect(getDb().prepare(`
      SELECT root_trigger_id,status FROM a2a_possession_chain ORDER BY created_at,id
    `).all()).toEqual([
      { root_trigger_id: 'message-1', status: 'aborted' },
      { root_trigger_id: 'message-2', status: 'active' },
    ]);
    expect(getDb().prepare(`
      SELECT project_agent_id,status,last_error
      FROM agent_inbox_item ORDER BY project_agent_id
    `).all()).toEqual([
      {
        project_agent_id: 'builder',
        status: 'cancelled',
        last_error: 'user_cancelled',
      },
      {
        project_agent_id: 'reviewer',
        status: 'enqueued',
        last_error: null,
      },
    ]);
  });

  it('treats a human turn without a target as an explicit collaboration abort', () => {
    service.submit({
      conversationId: 'project-human-a2a',
      messageId: 'message-1',
      prompt: 'First request',
      targetAgentIds: ['builder'],
    });

    expect(service.submit({
      conversationId: 'project-human-a2a',
      messageId: 'message-2',
      prompt: 'Do not delegate',
      targetAgentIds: [],
    })).toMatchObject({
      status: 'aborted',
      previous: { chainId: expect.any(String), cancelledInboxItems: 1 },
    });
    expect(getDb().prepare(`
      SELECT status FROM a2a_possession_chain
    `).get()).toEqual({ status: 'aborted' });
  });
});
