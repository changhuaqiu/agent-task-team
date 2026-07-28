import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, getDb, setTestDb, resetDb } from '../db/index';
import { generateSortableId, resetSeq } from './sortable-id';
import { conversationRepo } from './conversation-repo';
import { taskRepo } from './task-repo';
import { messageRepo } from './message-repo';
import { sessionRepo } from './session-repo';
import { invocationRepo } from './invocation-repo';
import { eventRepo } from './event-repo';

function installManagedInvocationSchema(): void {
  getDb().exec(`
    ALTER TABLE invocation ADD COLUMN outcome TEXT;
    ALTER TABLE invocation ADD COLUMN started_at TEXT;
    ALTER TABLE invocation ADD COLUMN terminated_at TEXT;
    ALTER TABLE invocation ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

    CREATE TRIGGER trg_invocation_status_insert
    BEFORE INSERT ON invocation
    WHEN NEW.status NOT IN ('planned','starting','running','terminating','terminated')
    BEGIN
      SELECT RAISE(ABORT, 'invalid_invocation_status');
    END;

    CREATE TRIGGER trg_invocation_status_update
    BEFORE UPDATE OF status ON invocation
    WHEN NEW.status NOT IN ('planned','starting','running','terminating','terminated')
    BEGIN
      SELECT RAISE(ABORT, 'invalid_invocation_status');
    END;

    CREATE TRIGGER trg_invocation_transition_update
    BEFORE UPDATE OF status ON invocation
    WHEN NEW.status <> OLD.status
      AND NOT (
        (OLD.status = 'planned' AND NEW.status IN ('starting','terminating','terminated'))
        OR (OLD.status = 'starting' AND NEW.status IN ('running','terminating','terminated'))
        OR (OLD.status = 'running' AND NEW.status IN ('terminating','terminated'))
        OR (OLD.status = 'terminating' AND NEW.status = 'terminated')
      )
    BEGIN
      SELECT RAISE(ABORT, 'invalid_invocation_transition');
    END;

    CREATE TRIGGER trg_invocation_outcome_update
    BEFORE UPDATE OF status, outcome ON invocation
    WHEN (NEW.status = 'terminated' AND (
            NEW.outcome IS NULL
            OR NEW.outcome NOT IN ('completed','failed','cancelled','timed_out')
          ))
      OR (NEW.status <> 'terminated' AND NEW.outcome IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid_invocation_outcome');
    END;

    CREATE TRIGGER trg_invocation_outcome_insert
    BEFORE INSERT ON invocation
    WHEN (NEW.status = 'terminated' AND (
            NEW.outcome IS NULL
            OR NEW.outcome NOT IN ('completed','failed','cancelled','timed_out')
          ))
      OR (NEW.status <> 'terminated' AND NEW.outcome IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'invalid_invocation_outcome');
    END;
  `);
}

function installManagedTaskSchema(): void {
  getDb().exec(`
    ALTER TABLE task ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

    CREATE TRIGGER trg_task_status_insert
    BEFORE INSERT ON task
    WHEN NEW.status NOT IN ('proposed','ready','in_progress','blocked','in_review','done','cancelled')
    BEGIN
      SELECT RAISE(ABORT, 'invalid_task_status');
    END;

    CREATE TRIGGER trg_task_status_update
    BEFORE UPDATE OF status ON task
    WHEN NEW.status NOT IN ('proposed','ready','in_progress','blocked','in_review','done','cancelled')
    BEGIN
      SELECT RAISE(ABORT, 'invalid_task_status');
    END;

    CREATE TRIGGER trg_task_transition_update
    BEFORE UPDATE OF status ON task
    WHEN NEW.status <> OLD.status
      AND NOT (
        (OLD.status = 'proposed' AND NEW.status IN ('ready','cancelled'))
        OR (OLD.status = 'ready' AND NEW.status IN ('in_progress','blocked','cancelled'))
        OR (OLD.status = 'in_progress' AND NEW.status IN ('blocked','in_review','cancelled'))
        OR (OLD.status = 'blocked' AND NEW.status IN ('ready','in_progress','cancelled'))
        OR (OLD.status = 'in_review' AND NEW.status IN ('done','in_progress','blocked','cancelled'))
        OR (OLD.status = 'done' AND NEW.status = 'ready')
      )
    BEGIN
      SELECT RAISE(ABORT, 'invalid_task_transition');
    END;

    CREATE TRIGGER trg_task_revision_update
    BEFORE UPDATE OF revision ON task
    WHEN NEW.revision <= OLD.revision
    BEGIN
      SELECT RAISE(ABORT, 'invalid_task_revision');
    END;
  `);
}

beforeEach(() => {
  const db = createTestDb();
  setTestDb(db);
  resetSeq();
});

afterEach(() => {
  resetDb();
});

describe('sortable-id', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSortableId());
    }
    expect(ids.size).toBe(100);
  });

  it('IDs sort chronologically', () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(generateSortableId());
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('supports prefix', () => {
    const id = generateSortableId('msg');
    expect(id.startsWith('msg-')).toBe(true);
  });

  it('resetSeq resets the counter', () => {
    const a = generateSortableId();
    resetSeq();
    const b = generateSortableId();
    expect(a).not.toBe(b);
  });
});

describe('conversation-repo', () => {
  it('creates and retrieves a conversation', () => {
    const conv = conversationRepo.create({
      id: 'conv-1',
      title: 'Test Conv',
      goal: 'Build stuff',
    });
    expect(conv.id).toBe('conv-1');
    expect(conv.title).toBe('Test Conv');
    expect(conv.goal).toBe('Build stuff');
    expect(conv.status).toBe('active');
    expect(conv.priority).toBe('p2');

    const fetched = conversationRepo.getById('conv-1');
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe('Test Conv');
  });

  it('lists conversations ordered by updated_at DESC', () => {
    conversationRepo.create({ id: 'conv-1', title: 'First' });
    conversationRepo.create({ id: 'conv-2', title: 'Second' });
    conversationRepo.update('conv-1', { title: 'Updated First' });
    const list = conversationRepo.list();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('conv-1');
  });

  it('updates a conversation', () => {
    conversationRepo.create({ id: 'conv-1', title: 'Original' });
    conversationRepo.update('conv-1', { title: 'Updated', status: 'archived' });
    const updated = conversationRepo.getById('conv-1')!;
    expect(updated.title).toBe('Updated');
    expect(updated.status).toBe('archived');
  });

  it('deletes a conversation', () => {
    conversationRepo.create({ id: 'conv-1', title: 'To Delete' });
    conversationRepo.delete('conv-1');
    expect(conversationRepo.getById('conv-1')).toBeUndefined();
  });

  it('deletes an aggregate when branch-specific projection tables are absent', () => {
    const db = getDb();
    db.exec(`
      DROP TABLE a2a_delivery;
      DROP TABLE chain_worklist;
      DROP TABLE invocation_chain;
      DROP TABLE delivery_cursor;
      DROP TABLE a2a_audit_log;
    `);
    conversationRepo.create({
      id: 'conv-optional-projections',
      title: 'Rollback target',
    });

    expect(conversationRepo.deleteAggregate('conv-optional-projections')).toBe(true);
    expect(conversationRepo.getById('conv-optional-projections')).toBeUndefined();
  });

  it('returns undefined for missing conversation', () => {
    expect(conversationRepo.getById('nonexistent')).toBeUndefined();
  });
});

describe('task-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Parent' });
  });

  it('creates and retrieves a task', () => {
    const task = taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'Implement X',
      agent_id: 'agent-a',
    });
    expect(task.id).toBe('task-1');
    expect(task.status).toBe('pending');
    expect(task.agent_id).toBe('agent-a');
  });

  it('gets tasks by conversation', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
    });
    taskRepo.create({
      id: 'task-2',
      conversation_id: 'conv-1',
      title: 'T2',
      agent_id: 'b',
    });
    const tasks = taskRepo.getByConversation('conv-1');
    expect(tasks.length).toBe(2);
  });

  it('gets tasks by agent', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'agent-a',
    });
    taskRepo.create({
      id: 'task-2',
      conversation_id: 'conv-1',
      title: 'T2',
      agent_id: 'agent-b',
    });
    const tasks = taskRepo.getByAgent('agent-a');
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe('task-1');
  });

  it('updates task status', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
    });
    taskRepo.updateStatus('task-1', 'in_progress');
    expect(taskRepo.getById('task-1')!.status).toBe('in_progress');
  });

  it('updates task status with review note', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
    });
    taskRepo.updateStatus('task-1', 'approved', 'LGTM');
    const task = taskRepo.getById('task-1')!;
    expect(task.status).toBe('approved');
    expect(task.review_note).toBe('LGTM');
  });

  it('adapts legacy task states to a managed lifecycle using legal transitions', () => {
    installManagedTaskSchema();

    const created = taskRepo.create({
      id: 'task-managed',
      conversation_id: 'conv-1',
      title: 'Managed compatibility',
      agent_id: 'agent-a',
    });
    expect(created.status).toBe('pending');
    expect(getDb().prepare('SELECT status, revision FROM task WHERE id = ?').get('task-managed')).toEqual({ status: 'ready', revision: 0 });

    taskRepo.updateStatus('task-managed', 'completed', 'verified');
    expect(taskRepo.getById('task-managed')).toMatchObject({
      status: 'done',
      review_note: 'verified',
    });
    expect(getDb().prepare('SELECT status, revision FROM task WHERE id = ?').get('task-managed')).toEqual({ status: 'done', revision: 3 });

    taskRepo.update('task-managed', {
      status: 'rejected',
      title: 'Needs repair',
    });
    expect(taskRepo.getById('task-managed')).toMatchObject({
      status: 'blocked',
      title: 'Needs repair',
    });

    taskRepo.updateStatus('task-managed', 'pending');
    expect(taskRepo.getById('task-managed')!.status).toBe('pending');
    expect(getDb().prepare('SELECT status FROM task WHERE id = ?').get('task-managed')).toEqual({ status: 'ready' });
  });

  it('rejects unknown task states before a managed database trigger does', () => {
    installManagedTaskSchema();
    taskRepo.create({
      id: 'task-managed',
      conversation_id: 'conv-1',
      title: 'Managed compatibility',
      agent_id: 'agent-a',
    });

    expect(() => taskRepo.updateStatus('task-managed', 'mystery')).toThrow('unsupported_managed_task_status:mystery');
  });

  it('deletes a task', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
    });
    taskRepo.delete('task-1');
    expect(taskRepo.getById('task-1')).toBeUndefined();
  });

  it('foreign key prevents deleting conversation with tasks', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
    });
    expect(() => conversationRepo.delete('conv-1')).toThrow();
    expect(taskRepo.getById('task-1')).toBeDefined();
  });

  it('stores dependencies as JSON', () => {
    const task = taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
      dependencies: ['dep-1', 'dep-2'],
    });
    expect(task.dependencies).toBe('["dep-1","dep-2"]');
  });
});

describe('message-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Test' });
  });

  it('appends a message and returns ID', () => {
    const id = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'user-1',
      content: 'Hello world',
    });
    expect(id).toBeTruthy();
    expect(id.startsWith('msg-')).toBe(true);
  });

  it('gets messages by conversation', () => {
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: 'Msg 1',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'a1',
      content: 'Msg 2',
    });
    const msgs = messageRepo.getByConversation('conv-1');
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe('Msg 1');
    expect(msgs[1].content).toBe('Msg 2');
  });

  it('paginates with cursor', () => {
    const id1 = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: 'A',
    });
    const id2 = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: 'B',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: 'C',
    });

    const page = messageRepo.getByConversation('conv-1', {
      cursor: id1,
      limit: 1,
    });
    expect(page.length).toBe(1);
    expect(page[0].id).toBe(id2);
  });

  it('gets messages by task', () => {
    conversationRepo.create({ id: 'conv-2', title: 'T2' });
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'a',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      taskId: 'task-1',
      senderType: 'agent',
      senderId: 'a',
      content: 'Task msg',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: 'Non-task msg',
    });

    const taskMsgs = messageRepo.getByTask('task-1');
    expect(taskMsgs.length).toBe(1);
    expect(taskMsgs[0].content).toBe('Task msg');
  });

  it('gets messages by agent', () => {
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'agent-a',
      content: 'From A',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'agent-b',
      content: 'From B',
    });
    const msgs = messageRepo.getByAgent('agent-a');
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe('From A');
  });

  it('gets private history by conversation and agent in chronological order', () => {
    conversationRepo.create({ id: 'conv-2', title: 'Other' });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'agent-a',
      content: 'First',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'agent-b',
      content: 'Other agent',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'agent-a',
      content: 'Second',
    });
    messageRepo.append({
      conversationId: 'conv-2',
      senderType: 'agent',
      senderId: 'agent-a',
      content: 'Other project',
    });
    expect(messageRepo.getByConversationAgent('conv-1', 'agent-a').map((row) => row.content)).toEqual(['First', 'Second']);
  });

  it('counts messages by conversation', () => {
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: 'A',
    });
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: 'B',
    });
    expect(messageRepo.countByConversation('conv-1')).toBe(2);
  });

  it('round-trips mentions as JSON', () => {
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'u1',
      content: '@agent-a please review',
      mentions: ['agent-a'],
    });
    const msgs = messageRepo.getByConversation('conv-1');
    expect(JSON.parse(msgs[0].mentions!)).toEqual(['agent-a']);
  });

  it('round-trips metadata as JSON', () => {
    messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'a1',
      content: 'result',
      metadata: { tokens: 42, model: 'gpt-4' },
    });
    const msgs = messageRepo.getByConversation('conv-1');
    expect(JSON.parse(msgs[0].metadata!)).toEqual({
      tokens: 42,
      model: 'gpt-4',
    });
  });
});

describe('session-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'agent-a',
    });
  });

  it('creates and finds an active session', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    const found = sessionRepo.findActive('agent-a', 'task-1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('ses-1');
    expect(found!.status).toBe('active');
  });

  it('returns undefined when no active session', () => {
    expect(sessionRepo.findActive('agent-a', 'task-1')).toBeUndefined();
  });

  it('updates cli_session_id', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.updateCliSessionId('ses-1', 'cli-ses-123');
    expect(sessionRepo.getById('ses-1')!.cli_session_id).toBe('cli-ses-123');
  });

  it('increments message count', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.incrementMessageCount('ses-1');
    sessionRepo.incrementMessageCount('ses-1');
    expect(sessionRepo.getById('ses-1')!.message_count).toBe(2);
  });

  it('seals a session', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.seal('ses-1', 'task completed');
    const sealed = sessionRepo.getById('ses-1')!;
    expect(sealed.status).toBe('sealed');
    expect(sealed.seal_reason).toBe('task completed');
    expect(sealed.sealed_at).toBeTruthy();
  });

  it('seals sessions by agent and task', () => {
    conversationRepo.create({ id: 'conv-2', title: 'Test 2' });
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      seq: 0,
    });
    sessionRepo.create({
      id: 'ses-2',
      conversationId: 'conv-2',
      agentId: 'agent-a',
      taskId: 'task-1',
      seq: 1,
    });
    sessionRepo.sealByTask('agent-a', 'task-1', 'done');
    expect(sessionRepo.getById('ses-1')!.status).toBe('sealed');
    expect(sessionRepo.getById('ses-2')!.status).toBe('sealed');
  });

  it('findActive returns undefined after sealing', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.seal('ses-1', 'done');
    expect(sessionRepo.findActive('agent-a', 'task-1')).toBeUndefined();
  });

  it('lists active sessions by agent', () => {
    conversationRepo.create({ id: 'conv-2', title: 'Test 2' });
    taskRepo.create({
      id: 'task-2',
      conversation_id: 'conv-2',
      title: 'T2',
      agent_id: 'agent-a',
    });
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.create({
      id: 'ses-2',
      conversationId: 'conv-2',
      agentId: 'agent-a',
      taskId: 'task-2',
    });
    sessionRepo.seal('ses-2', 'done');
    const active = sessionRepo.listActiveByAgent('agent-a');
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('ses-1');
  });

  it('lists active sessions by conversation', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    const active = sessionRepo.listActiveByConversation('conv-1');
    expect(active.length).toBe(1);
  });

  it('enforces unique constraint on (agent_id, task_id, seq)', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      seq: 0,
    });
    expect(() => {
      sessionRepo.create({
        id: 'ses-2',
        conversationId: 'conv-1',
        agentId: 'agent-a',
        taskId: 'task-1',
        seq: 0,
      });
    }).toThrow();
  });

  it('allows a new sequence after the prior project session is sealed', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      seq: 0,
    });
    sessionRepo.seal('ses-1', 'rotated');
    const ses2 = sessionRepo.create({
      id: 'ses-2',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      seq: 1,
    });
    expect(ses2.id).toBe('ses-2');
  });

  it('appends stream chunks to one text message', () => {
    const id = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'a1',
      content: '工作',
    });
    expect(messageRepo.appendTextChunk(id, '目录')).toBe(true);
    expect(messageRepo.getByConversation('conv-1')).toMatchObject([{ id, content: '工作目录', content_type: 'text' }]);
  });

  it('does not append text chunks to tool messages', () => {
    const id = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'a1',
      content: 'tool',
      contentType: 'tool_use',
    });
    expect(messageRepo.appendTextChunk(id, 'unexpected')).toBe(false);
  });

  it('keeps one active logical session per project and agent', () => {
    const first = sessionRepo.getOrCreateActive({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      seq: 0,
    });
    const again = sessionRepo.getOrCreateActive({
      id: 'ses-2',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
      seq: 1,
    });
    expect(again.id).toBe(first.id);
    expect(sessionRepo.listActiveByConversation('conv-1')).toHaveLength(1);
  });

  it('binds runtime identity once and rejects replacement', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    expect(sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-1')).toEqual({
      status: 'bound',
      current: 'runtime-1',
    });
    expect(sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-1')).toEqual({
      status: 'unchanged',
      current: 'runtime-1',
    });
    expect(sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-2')).toEqual({
      status: 'mismatch',
      current: 'runtime-1',
    });
  });

  it('releases a failed unconfirmed runtime binding but not an unobserved binding', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-unconfirmed');

    expect(sessionRepo.releaseUnconfirmedRuntimeSessionId('ses-1', 'runtime-unconfirmed')).toBe(false);

    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });
    invocationRepo.updateStatus('inv-1', 'failed', {
      reason_code: 'acp_cancelled',
    });

    expect(sessionRepo.releaseUnconfirmedRuntimeSessionId('ses-1', 'runtime-unconfirmed')).toBe(true);
    expect(sessionRepo.getById('ses-1')?.cli_session_id).toBeNull();
  });

  it('seals a confirmed generation only when its latest invocation is a persisted ACP load failure', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });
    sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-confirmed', 'inv-1');
    invocationRepo.create({
      id: 'inv-2',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });
    invocationRepo.updateStatus('inv-2', 'failed', {
      reason_code: 'acp_session_load_failed',
    });

    expect(sessionRepo.sealIfLatestInvocationLoadFailed('ses-1')).toBe(true);
    expect(sessionRepo.getById('ses-1')).toMatchObject({
      status: 'sealed',
      seal_reason: 'runtime_session_load_failed',
      cli_session_id: 'runtime-confirmed',
    });
    expect(
      sessionRepo.getOrCreateActive({
        id: 'ses-2',
        conversationId: 'conv-1',
        agentId: 'agent-a',
        taskId: 'task-1',
        seq: 1,
      }).id,
    ).toBe('ses-2');
  });

  it('keeps a generation when the latest failure is unrelated to session loading', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-confirmed');
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });
    invocationRepo.updateStatus('inv-1', 'failed', {
      reason_code: 'acp_timeout',
    });

    expect(sessionRepo.sealIfLatestInvocationLoadFailed('ses-1')).toBe(false);
    expect(sessionRepo.getById('ses-1')?.status).toBe('active');
  });

  it('atomically confirms runtime binding and successful invocation', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });

    expect(sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-confirmed', 'inv-1')).toEqual({
      status: 'bound',
      current: 'runtime-confirmed',
    });
    expect(sessionRepo.getById('ses-1')?.cli_session_id).toBe('runtime-confirmed');
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'succeeded',
      exit_code: 0,
      cli_session_id: 'runtime-confirmed',
    });
    expect(sessionRepo.releaseUnconfirmedRuntimeSessionId('ses-1', 'runtime-confirmed')).toBe(false);
  });

  it('does not reverse a timed-out invocation when runtime success arrives late', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });
    expect(
      invocationRepo.settleIfActive('inv-1', 'failed', {
        exit_code: 1,
        reason_code: 'timeout',
      }),
    ).toBe(true);

    expect(sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-late', 'inv-1')).toEqual({
      status: 'bound',
      current: 'runtime-late',
    });
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'failed',
      exit_code: 1,
      reason_code: 'timeout',
    });
  });

  it('does not confirm an invocation when runtime identity mismatches', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    sessionRepo.bindRuntimeSessionId('ses-1', 'runtime-confirmed');
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });

    expect(sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-other', 'inv-1')).toEqual({
      status: 'mismatch',
      current: 'runtime-confirmed',
    });
    expect(invocationRepo.getById('inv-1')?.status).toBe('queued');
  });

  it('keeps a two-project by two-agent identity matrix stable for three turns', () => {
    conversationRepo.create({ id: 'conv-2', title: 'Test 2' });
    const bindings = new Map<string, string>();

    for (const projectId of ['conv-1', 'conv-2']) {
      for (const agentId of ['agent-a', 'agent-b']) {
        const key = `${projectId}:${agentId}`;
        for (let turn = 0; turn < 3; turn += 1) {
          const logical = sessionRepo.getOrCreateActive({
            id: `ses-${projectId}-${agentId}-${turn}`,
            conversationId: projectId,
            agentId,
            taskId: `task-${projectId}-${turn}`,
            seq: turn,
          });
          const runtimeId = `runtime-${projectId}-${agentId}`;
          sessionRepo.bindRuntimeSessionId(logical.id, runtimeId);
          expect(sessionRepo.getById(logical.id)?.cli_session_id).toBe(runtimeId);
          bindings.set(key, runtimeId);
        }
      }
    }

    expect(bindings.size).toBe(4);
    expect(new Set(bindings.values()).size).toBe(4);
  });
});

describe('invocation-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'agent-a',
    });
  });

  it('creates an invocation with queued status', () => {
    const inv = invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      task_id: 'task-1',
    });
    expect(inv.status).toBe('queued');
    expect(inv.agent_id).toBe('agent-a');
  });

  it('transitions status queued→running→succeeded', () => {
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.updateStatus('inv-1', 'running');
    expect(invocationRepo.getById('inv-1')!.status).toBe('running');

    invocationRepo.updateStatus('inv-1', 'succeeded', { exit_code: 0 });
    const inv = invocationRepo.getById('inv-1')!;
    expect(inv.status).toBe('succeeded');
    expect(inv.exit_code).toBe(0);
  });

  it('records failure with error message', () => {
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.updateStatus('inv-1', 'failed', {
      exit_code: 1,
      error_message: 'OOM',
    });
    const inv = invocationRepo.getById('inv-1')!;
    expect(inv.status).toBe('failed');
    expect(inv.error_message).toBe('OOM');
  });

  it('settles a runtime invocation once and ignores late terminal callbacks', () => {
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.updateStatus('inv-1', 'running');

    expect(invocationRepo.settleIfActive('inv-1', 'succeeded', { exit_code: 0 })).toBe(true);
    expect(
      invocationRepo.settleIfActive('inv-1', 'failed', {
        exit_code: 1,
        reason_code: 'late_failure',
      }),
    ).toBe(false);
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'succeeded',
      exit_code: 0,
      reason_code: null,
    });
  });

  it('gets invocations by agent', () => {
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.create({
      id: 'inv-2',
      conversation_id: 'conv-1',
      agent_id: 'agent-b',
    });
    const invs = invocationRepo.getByAgent('agent-a');
    expect(invs.length).toBe(1);
    expect(invs[0].id).toBe('inv-1');
  });

  it('gets invocations by conversation', () => {
    invocationRepo.create({
      id: 'inv-b',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.create({
      id: 'inv-a',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    getDb().prepare(
      'UPDATE invocation SET created_at = ? WHERE conversation_id = ?',
    ).run('2026-07-28T00:00:00.000Z', 'conv-1');

    const invs = invocationRepo.getByConversation('conv-1');
    expect(invs.map((invocation) => invocation.id)).toEqual(['inv-a', 'inv-b']);
  });

  it('gets the latest invocation for a logical session', () => {
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      task_id: 'task-1',
      session_id: 'ses-1',
    });
    invocationRepo.create({
      id: 'inv-2',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      task_id: 'task-1',
      session_id: 'ses-1',
      runtime_id: 'codex-cli',
    });
    expect(invocationRepo.findLatestForSession('ses-1')).toMatchObject({
      id: 'inv-2',
      runtime_id: 'codex-cli',
    });
  });

  it('getActive excludes terminal statuses', () => {
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.create({
      id: 'inv-2',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.updateStatus('inv-2', 'succeeded');
    const active = invocationRepo.getActive();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('inv-1');
  });

  it('settles orphaned active invocations when the daemon restarts', () => {
    invocationRepo.create({
      id: 'inv-queued',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.create({
      id: 'inv-running',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.create({
      id: 'inv-done',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.updateStatus('inv-running', 'running');
    invocationRepo.updateStatus('inv-done', 'succeeded');

    expect(invocationRepo.failActiveAfterRestart(new Date('2026-07-28T00:00:00.000Z'))).toBe(2);
    expect(invocationRepo.getById('inv-queued')).toMatchObject({
      status: 'failed',
      reason_code: 'process_restarted',
      error_message: 'daemon restarted before invocation settled',
    });
    expect(invocationRepo.getById('inv-running')).toMatchObject({
      status: 'failed',
      reason_code: 'process_restarted',
    });
    expect(invocationRepo.getById('inv-done')?.status).toBe('succeeded');
  });

  it('allows retry: failed→running', () => {
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.updateStatus('inv-1', 'running');
    invocationRepo.updateStatus('inv-1', 'failed', { exit_code: 1 });
    invocationRepo.updateStatus('inv-1', 'running');
    expect(invocationRepo.getById('inv-1')!.status).toBe('running');
  });

  it('stores optional fields', () => {
    const inv = invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      engine: 'opencode',
      account_id: 'acct-1',
      prompt: 'Fix the bug',
      session_id: 'ses-1',
    });
    expect(inv.engine).toBe('opencode');
    expect(inv.account_id).toBe('acct-1');
    expect(inv.prompt).toBe('Fix the bug');
    expect(inv.session_id).toBe('ses-1');
  });

  it('maps the legacy runtime lifecycle onto the managed invocation schema', () => {
    installManagedInvocationSchema();
    const inv = invocationRepo.create({
      id: 'inv-managed',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    expect(inv).toMatchObject({
      status: 'planned',
      outcome: null,
      revision: 0,
    });

    invocationRepo.updateStatus(inv.id, 'running', {
      cli_session_id: 'runtime-1',
    });
    expect(invocationRepo.getById(inv.id)).toMatchObject({
      status: 'running',
      outcome: null,
      cli_session_id: 'runtime-1',
      started_at: expect.any(String),
      revision: 2,
    });

    expect(invocationRepo.settleIfActive(inv.id, 'succeeded', { exit_code: 0 })).toBe(true);
    expect(
      invocationRepo.settleIfActive(inv.id, 'failed', {
        reason_code: 'late_failure',
      }),
    ).toBe(false);
    expect(invocationRepo.getById(inv.id)).toMatchObject({
      status: 'terminated',
      outcome: 'completed',
      exit_code: 0,
      terminated_at: expect.any(String),
      revision: 3,
    });
  });

  it('confirms runtime identity without prematurely settling a managed invocation', () => {
    installManagedInvocationSchema();
    sessionRepo.create({
      id: 'ses-1',
      conversationId: 'conv-1',
      agentId: 'agent-a',
      taskId: 'task-1',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
      session_id: 'ses-1',
    });
    invocationRepo.updateStatus('inv-1', 'running');

    expect(sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-managed', 'inv-1')).toEqual({
      status: 'bound',
      current: 'runtime-managed',
    });
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'running',
      outcome: null,
      cli_session_id: 'runtime-managed',
    });

    expect(
      invocationRepo.settleIfActive('inv-1', 'failed', {
        reason_code: 'timeout',
      }),
    ).toBe(true);
    sessionRepo.confirmRuntimeSessionId('ses-1', 'runtime-managed', 'inv-1');
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'terminated',
      outcome: 'timed_out',
      reason_code: 'timeout',
    });
  });

  it('maps managed timeout and restart settlement to terminal outcomes', () => {
    installManagedInvocationSchema();
    invocationRepo.create({
      id: 'inv-timeout',
      conversation_id: 'conv-1',
      agent_id: 'agent-a',
    });
    invocationRepo.create({
      id: 'inv-orphan',
      conversation_id: 'conv-1',
      agent_id: 'agent-b',
    });
    invocationRepo.updateStatus('inv-timeout', 'running');
    expect(
      invocationRepo.settleIfActive('inv-timeout', 'failed', {
        reason_code: 'timeout',
        exit_code: 1,
      }),
    ).toBe(true);
    expect(invocationRepo.getById('inv-timeout')).toMatchObject({
      status: 'terminated',
      outcome: 'timed_out',
      reason_code: 'timeout',
    });

    expect(invocationRepo.failActiveAfterRestart(new Date('2026-07-28T00:00:00.000Z'))).toBe(1);
    expect(invocationRepo.getById('inv-orphan')).toMatchObject({
      status: 'terminated',
      outcome: 'failed',
      reason_code: 'process_restarted',
      terminated_at: '2026-07-28T00:00:00.000Z',
    });
  });
});

describe('event-repo', () => {
  beforeEach(() => {
    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'conv-1',
      title: 'T1',
      agent_id: 'agent-a',
    });
  });

  it('appends an event and returns ID', () => {
    const id = eventRepo.append({
      conversationId: 'conv-1',
      agentId: 'agent-a',
      type: 'agent.text',
      payload: { text: 'Hello' },
    });
    expect(id).toBeTruthy();
    expect(id.startsWith('evt-')).toBe(true);
  });

  it('gets events by conversation', () => {
    eventRepo.append({
      conversationId: 'conv-1',
      agentId: 'agent-a',
      type: 'agent.text',
    });
    eventRepo.append({
      conversationId: 'conv-1',
      agentId: 'agent-a',
      type: 'agent.tool_use',
    });
    const events = eventRepo.getByConversation('conv-1');
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('agent.text');
  });

  it('gets events by task', () => {
    eventRepo.append({
      conversationId: 'conv-1',
      taskId: 'task-1',
      agentId: 'agent-a',
      type: 'agent.text',
    });
    eventRepo.append({
      conversationId: 'conv-1',
      agentId: 'agent-a',
      type: 'agent.text',
    });
    const taskEvents = eventRepo.getByTask('task-1');
    expect(taskEvents.length).toBe(1);
  });

  it('gets events by agent', () => {
    eventRepo.append({
      conversationId: 'conv-1',
      agentId: 'agent-a',
      type: 'agent.text',
    });
    eventRepo.append({
      conversationId: 'conv-1',
      agentId: 'agent-b',
      type: 'agent.text',
    });
    const events = eventRepo.getByAgent('agent-a');
    expect(events.length).toBe(1);
  });

  it('stores payload as JSON', () => {
    eventRepo.append({
      conversationId: 'conv-1',
      agentId: 'agent-a',
      type: 'agent.tool_use',
      payload: { tool: 'Read', args: { path: '/foo' } },
    });
    const events = eventRepo.getByConversation('conv-1');
    expect(JSON.parse(events[0].payload!)).toEqual({
      tool: 'Read',
      args: { path: '/foo' },
    });
  });

  it('respects limit option', () => {
    for (let i = 0; i < 5; i++) {
      eventRepo.append({
        conversationId: 'conv-1',
        agentId: 'agent-a',
        type: `event-${i}`,
      });
    }
    const limited = eventRepo.getByConversation('conv-1', { limit: 3 });
    expect(limited.length).toBe(3);
  });
});
